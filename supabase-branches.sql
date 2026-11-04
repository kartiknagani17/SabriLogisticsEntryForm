-- BRANCHES + LOGIN. Run once in Supabase -> SQL Editor (safe to run again).
-- Run it AFTER supabase.sql. Afterwards, open the site and sign in with the admin e-mail below
-- (first sign-in asks you to create the password), so do that right after running this.

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------
create table if not exists public.branches (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  city text,
  address text,
  phone text,
  active boolean not null default true
);
create unique index if not exists branches_name_uq on public.branches (lower(name));

create table if not exists public.accounts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  role text not null check (role in ('admin', 'employee')),
  name text not null,
  email text unique check (email = lower(email)),
  phone text unique check (phone ~ '^[0-9]{10}$'),
  branch_id bigint references public.branches(id),
  active boolean not null default true,
  has_password boolean not null default false,
  check ((role = 'admin' and email is not null and branch_id is null)
      or (role = 'employee' and phone is not null and branch_id is not null))
);

-- password hashes + login sessions: never readable through the API
create table if not exists public.account_secrets (
  account_id bigint primary key references public.accounts(id) on delete cascade,
  pw_hash text not null,
  failed int not null default 0,
  locked_until timestamptz
);
create table if not exists public.sessions (
  token text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  account_id bigint not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
alter table public.account_secrets enable row level security;
alter table public.sessions enable row level security;
revoke all on public.account_secrets, public.sessions from anon, authenticated;

-- ---------- who is calling? (the app sends its session token in the x-session-token header) ----------
create or replace function public.app_account_id() returns bigint
language sql stable security definer set search_path = public as $$
  select s.account_id from public.sessions s join public.accounts a on a.id = s.account_id
  where s.token = nullif(current_setting('request.headers', true), '')::json ->> 'x-session-token'
    and s.expires_at > now() and a.active
$$;
create or replace function public.app_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.accounts where id = public.app_account_id() and role = 'admin')
$$;
create or replace function public.app_branch_id() returns bigint
language sql stable security definer set search_path = public as $$
  select a.branch_id from public.accounts a join public.branches b on b.id = a.branch_id
  where a.id = public.app_account_id() and a.role = 'employee' and b.active
$$;

-- ---------- existing data -> a first branch (rename it in the app), add branch_id everywhere ----------
insert into public.branches (name) select 'Main Branch' where not exists (select 1 from public.branches);

do $$
declare t text; first_branch bigint := (select min(id) from public.branches);
begin
  foreach t in array array['entries', 'lrs', 'inwards', 'delivery_slips'] loop
    execute format('alter table public.%I add column if not exists branch_id bigint references public.branches(id) default public.app_branch_id()', t);
    execute format('update public.%I set branch_id = %s where branch_id is null', t, first_branch);
    execute format('alter table public.%I alter column branch_id set not null', t);
    execute format('create index if not exists %I on public.%I (branch_id)', t || '_branch_idx', t);
  end loop;
end $$;

-- uniqueness now applies inside one branch only
drop index if exists public.entries_unique_data;
-- exact duplicate entries (same branch, identical apart from print time) are removed, keeping the oldest of each
delete from public.entries a using public.entries b
 where a.branch_id = b.branch_id and (a.data - 'printedAt') = (b.data - 'printedAt') and a.id > b.id;
create unique index if not exists entries_unique_data on public.entries (branch_id, (data - 'printedAt'));
alter table public.inwards drop constraint if exists inwards_gc_no_key;
create unique index if not exists inwards_branch_gc_uq on public.inwards (branch_id, gc_no);

-- ---------- row level security: admin sees all, an employee sees only their own branch ----------
drop policy if exists "anon all entries" on public.entries;
drop policy if exists "anon all lrs" on public.lrs;
drop policy if exists "anon all inwards" on public.inwards;
drop policy if exists "anon all delivery_slips" on public.delivery_slips;

do $$
declare t text;
begin
  foreach t in array array['entries', 'lrs', 'inwards', 'delivery_slips'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists branch_scope on public.%I', t);
    execute format('create policy branch_scope on public.%I for all using (public.app_is_admin() or branch_id = (select public.app_branch_id())) with check (public.app_is_admin() or branch_id = (select public.app_branch_id()))', t);
  end loop;
end $$;

alter table public.branches enable row level security;
drop policy if exists branches_read on public.branches;
drop policy if exists branches_admin on public.branches;
create policy branches_read on public.branches for select using (public.app_is_admin() or id = (select public.app_branch_id()));
create policy branches_admin on public.branches for all using (public.app_is_admin()) with check (public.app_is_admin());

alter table public.accounts enable row level security;
drop policy if exists accounts_read on public.accounts;
drop policy if exists accounts_admin on public.accounts;
create policy accounts_read on public.accounts for select using (public.app_is_admin() or id = (select public.app_account_id()));
-- the admin manages employees only (admin accounts are created with SQL, below)
create policy accounts_admin on public.accounts for all
  using (public.app_is_admin() and role = 'employee') with check (public.app_is_admin() and role = 'employee');

-- ---------- login functions ----------
create or replace function public.app_norm_id(p text) returns text
language sql immutable as $$
  select case when position('@' in p) > 0 then lower(btrim(p)) else right(regexp_replace(p, '\D', '', 'g'), 10) end
$$;

create or replace function public.app_find_account(p_id text) returns public.accounts
language sql stable security definer set search_path = public as $$
  select a.* from public.accounts a
  where (position('@' in p_id) > 0 and a.email = public.app_norm_id(p_id))
     or (position('@' in p_id) = 0 and a.phone = public.app_norm_id(p_id))
$$;

create or replace function public.app_session_json(p_account bigint, p_token text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('token', p_token, 'id', a.id, 'role', a.role, 'name', a.name, 'email', a.email,
                           'phone', a.phone, 'branch_id', a.branch_id, 'branch_name', b.name)
  from public.accounts a left join public.branches b on b.id = a.branch_id where a.id = p_account
$$;

-- 'unknown' | 'inactive' | 'set_password' | 'login'
create or replace function public.auth_status(p_id text) returns text
language plpgsql stable security definer set search_path = public as $$
declare a public.accounts;
begin
  a := public.app_find_account(p_id);
  if a.id is null then return 'unknown'; end if;
  if not a.active or (a.branch_id is not null and not (select active from public.branches where id = a.branch_id)) then return 'inactive'; end if;
  return case when a.has_password then 'login' else 'set_password' end;
end $$;

create or replace function public.auth_set_password(p_id text, p_password text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a public.accounts; tok text;
begin
  if length(coalesce(p_password, '')) < 6 then raise exception 'PASSWORD_SHORT'; end if;
  a := public.app_find_account(p_id);
  if a.id is null or not a.active or a.has_password then raise exception 'INVALID_LOGIN'; end if;
  insert into public.account_secrets (account_id, pw_hash) values (a.id, crypt(p_password, gen_salt('bf')));
  update public.accounts set has_password = true where id = a.id;
  insert into public.sessions (account_id) values (a.id) returning token into tok;
  return public.app_session_json(a.id, tok);
end $$;

create or replace function public.auth_login(p_id text, p_password text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a public.accounts; s public.account_secrets; tok text;
begin
  a := public.app_find_account(p_id);
  if a.id is null or not a.active or not a.has_password then return json_build_object('error', 'INVALID_LOGIN'); end if;
  if a.branch_id is not null and not (select active from public.branches where id = a.branch_id) then return json_build_object('error', 'INVALID_LOGIN'); end if;
  select * into s from public.account_secrets where account_id = a.id;
  if s.locked_until is not null and s.locked_until > now() then return json_build_object('error', 'LOCKED'); end if;
  if s.pw_hash <> crypt(coalesce(p_password, ''), s.pw_hash) then
    update public.account_secrets
       set failed = case when failed >= 4 then 0 else failed + 1 end,
           locked_until = case when failed >= 4 then now() + interval '15 minutes' else null end
     where account_id = a.id;
    return json_build_object('error', 'INVALID_LOGIN');  -- returned (not raised) so the failed-attempt count is kept
  end if;
  update public.account_secrets set failed = 0, locked_until = null where account_id = a.id;
  delete from public.sessions where expires_at < now();
  insert into public.sessions (account_id) values (a.id) returning token into tok;
  return public.app_session_json(a.id, tok);
end $$;

create or replace function public.auth_me() returns json
language plpgsql stable security definer set search_path = public as $$
declare id bigint := public.app_account_id();
begin
  if id is null then raise exception 'NOT_LOGGED_IN'; end if;
  return public.app_session_json(id, nullif(current_setting('request.headers', true), '')::json ->> 'x-session-token');
end $$;

create or replace function public.auth_logout() returns void
language sql volatile security definer set search_path = public as $$
  delete from public.sessions where token = nullif(current_setting('request.headers', true), '')::json ->> 'x-session-token'
$$;

-- admin: forget an employee's password so they create a new one at their next login
create or replace function public.admin_reset_password(p_account bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.app_is_admin() then raise exception 'NOT_ALLOWED'; end if;
  if not exists (select 1 from public.accounts where id = p_account and role = 'employee') then raise exception 'NOT_ALLOWED'; end if;
  delete from public.account_secrets where account_id = p_account;
  delete from public.sessions where account_id = p_account;
  update public.accounts set has_password = false where id = p_account and role = 'employee';
end $$;

revoke all on function public.app_find_account(text), public.app_session_json(bigint, text) from public, anon, authenticated;
grant execute on function public.app_account_id(), public.app_is_admin(), public.app_branch_id(),
  public.auth_status(text), public.auth_set_password(text, text), public.auth_login(text, text),
  public.auth_me(), public.auth_logout(), public.admin_reset_password(bigint) to anon, authenticated;

-- ---------- the admin account (change the e-mail/name here if needed) ----------
insert into public.accounts (role, name, email) values ('admin', 'Admin', 'kartiknagani17@gmail.com') on conflict do nothing;
