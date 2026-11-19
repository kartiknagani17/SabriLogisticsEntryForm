-- STEP 5: missing GCs, login hardening and the WhatsApp wallet.
-- Supabase -> SQL Editor: paste this whole file, click Run. Safe to run again.
set lock_timeout = '15s';

-- ---------- 1. INWARD: a GC can be marked "missing" instead of "received" ----------
alter table public.inwards add column if not exists status text not null default 'received';
alter table public.inwards drop constraint if exists inwards_status_chk;
alter table public.inwards add constraint inwards_status_chk check (status in ('received', 'missing'));

-- accounting: "GCs received" counts received ones only; missing ones are counted separately
create or replace function public.acc_totals(p_branch bigint default null, p_from date default null, p_to date default null)
returns json language sql stable set search_path = public as $$
  with e as (
    select branch_id, count(*) n, coalesce(sum(total), 0) total,
      sum(app_num(data ->> 'freight')) freight, sum(app_num(data ->> 'bc')) bc, sum(app_num(data ->> 'doorDelivery')) door,
      sum(app_num(data ->> 'handling')) handling, sum(app_num(data ->> 'other')) other,
      sum(app_num(data ->> 'sgst') + app_num(data ->> 'cgst')) tax,
      coalesce(sum(total) filter (where data ->> 'payType' = 'Paid'), 0) paid,
      coalesce(sum(total) filter (where data ->> 'payType' = 'To Pay'), 0) topay,
      coalesce(sum(total) filter (where data ->> 'payType' = 'To be Billed'), 0) billed
    from public.entries
    where (p_branch is null or branch_id = p_branch)
      and (p_from is null or entry_date >= p_from) and (p_to is null or entry_date <= p_to)
    group by branch_id
  ), s as (
    select branch_id, count(*) n, coalesce(sum(total), 0) total from public.delivery_slips
    where (p_branch is null or branch_id = p_branch)
      and (p_from is null or slip_date >= p_from) and (p_to is null or slip_date <= p_to)
    group by branch_id
  ), w as (
    select w.branch_id, count(*) filter (where w.status = 'received') n,
      coalesce(sum(en.total) filter (where w.status = 'received'), 0) value,
      count(*) filter (where w.status = 'missing') miss
    from public.inwards w left join public.entries en on en.branch_id = w.branch_id and en.gc_no = w.gc_no
    where (p_branch is null or w.branch_id = p_branch)
      and (p_from is null or (w.created_at at time zone 'Asia/Kolkata')::date >= p_from)
      and (p_to is null or (w.created_at at time zone 'Asia/Kolkata')::date <= p_to)
    group by w.branch_id
  ), ids as (select branch_id from e union select branch_id from s union select branch_id from w)
  select coalesce(json_agg(json_build_object('branch_id', ids.branch_id,
    'n', coalesce(e.n, 0), 'total', coalesce(e.total, 0), 'freight', coalesce(e.freight, 0), 'bc', coalesce(e.bc, 0),
    'door', coalesce(e.door, 0), 'handling', coalesce(e.handling, 0), 'other', coalesce(e.other, 0), 'tax', coalesce(e.tax, 0),
    'paid', coalesce(e.paid, 0), 'topay', coalesce(e.topay, 0), 'billed', coalesce(e.billed, 0),
    'slips', coalesce(s.n, 0), 'slipTotal', coalesce(s.total, 0), 'recv', coalesce(w.n, 0), 'recvValue', coalesce(w.value, 0),
    'missing', coalesce(w.miss, 0))), '[]'::json)
  from ids left join e on e.branch_id = ids.branch_id left join s on s.branch_id = ids.branch_id left join w on w.branch_id = ids.branch_id
$$;
grant execute on function public.acc_totals(bigint, date, date) to anon, authenticated;

-- ---------- 2. login hardening ----------
-- (a) an account marked "has password" but with no stored password could be signed into with any password: refuse it
-- (b) a new or reset employee must create their password within 7 days; after that the admin presses "Reset password" again
alter table public.accounts add column if not exists invite_until timestamptz default now() + interval '7 days';

create or replace function public.auth_status(p_id text) returns text
language plpgsql stable security definer set search_path = public as $$
declare a public.accounts;
begin
  a := public.app_find_account(p_id);
  if a.id is null then return 'unknown'; end if;
  if not a.active or (a.branch_id is not null and not (select active from public.branches where id = a.branch_id)) then return 'inactive'; end if;
  if a.has_password then return 'login'; end if;
  if a.role = 'employee' and coalesce(a.invite_until, now()) < now() then return 'expired'; end if;
  return 'set_password';
end $$;

create or replace function public.auth_set_password(p_id text, p_password text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a public.accounts; tok text;
begin
  if length(coalesce(p_password, '')) < 6 then raise exception 'PASSWORD_SHORT'; end if;
  a := public.app_find_account(p_id);
  if a.id is null or not a.active or a.has_password then raise exception 'INVALID_LOGIN'; end if;
  if a.role = 'employee' and coalesce(a.invite_until, now()) < now() then raise exception 'INVITE_EXPIRED'; end if;
  insert into public.account_secrets (account_id, pw_hash) values (a.id, crypt(p_password, gen_salt('bf')))
    on conflict (account_id) do update set pw_hash = excluded.pw_hash, failed = 0, locked_until = null;
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
  if s.account_id is null then return json_build_object('error', 'INVALID_LOGIN'); end if;
  if s.locked_until is not null and s.locked_until > now() then return json_build_object('error', 'LOCKED'); end if;
  if s.pw_hash is distinct from crypt(coalesce(p_password, ''), s.pw_hash) then
    update public.account_secrets
       set failed = case when failed >= 4 then 0 else failed + 1 end,
           locked_until = case when failed >= 4 then now() + interval '15 minutes' else null end
     where account_id = a.id;
    return json_build_object('error', 'INVALID_LOGIN');
  end if;
  update public.account_secrets set failed = 0, locked_until = null where account_id = a.id;
  delete from public.sessions where expires_at < now();
  insert into public.sessions (account_id) values (a.id) returning token into tok;
  return public.app_session_json(a.id, tok);
end $$;

create or replace function public.admin_reset_password(p_account bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.app_is_admin() then raise exception 'NOT_ALLOWED'; end if;
  if not exists (select 1 from public.accounts where id = p_account and role = 'employee') then raise exception 'NOT_ALLOWED'; end if;
  delete from public.account_secrets where account_id = p_account;
  delete from public.sessions where account_id = p_account;
  update public.accounts set has_password = false, invite_until = now() + interval '7 days' where id = p_account and role = 'employee';
end $$;

-- through the API only an employee's name, phone and on/off can be changed; role, e-mail, branch,
-- "has password" and the invite date change only through the functions above
revoke update on public.accounts from anon, authenticated;
grant update (name, phone, active) on public.accounts to anon, authenticated;

-- ---------- 3. WhatsApp wallet: money added to the Meta account (admin only) ----------
create table if not exists public.wa_topups (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  amount numeric not null check (amount > 0),
  note text
);
alter table public.wa_topups enable row level security;
drop policy if exists wa_topups_admin on public.wa_topups;
create policy wa_topups_admin on public.wa_topups for all using (public.app_is_admin()) with check (public.app_is_admin());
