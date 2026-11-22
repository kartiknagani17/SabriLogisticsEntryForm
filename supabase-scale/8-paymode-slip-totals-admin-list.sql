-- STEP 8. Run once in Supabase -> SQL Editor (safe to run again).
-- (1) inward: how a Paid GC was paid (Cash / UPI / Cheque)
-- (2) delivery slip: the delivery charges total kept apart from the grand total (= delivery + GC totals)
-- (3) an admin can be listed among a branch's employees, and any admin can reset an admin's password

-- ---------- 1. inward payment mode ----------
alter table public.inwards add column if not exists pay_mode text;
alter table public.inwards drop constraint if exists inwards_pay_mode_chk;
alter table public.inwards add constraint inwards_pay_mode_chk check (pay_mode is null or pay_mode in ('Cash', 'UPI', 'Cheque'));

-- ---------- 2. delivery slip totals ----------
alter table public.delivery_slips add column if not exists delivery_total numeric;

-- ---------- 3. admins in a branch's employee list ----------
alter table public.accounts add column if not exists shown_in_branch bigint references public.branches(id) on delete set null;

create or replace function public.admin_reset_password(p_account bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.app_is_admin() then raise exception 'NOT_ALLOWED'; end if;
  if not exists (select 1 from public.accounts where id = p_account) then raise exception 'NOT_ALLOWED'; end if;
  delete from public.account_secrets where account_id = p_account;
  delete from public.sessions where account_id = p_account;
  update public.accounts set has_password = false, invite_until = now() + interval '7 days' where id = p_account;
end $$;

-- the 7-day window to create a new password now applies to admins too
create or replace function public.auth_status(p_id text) returns text
language plpgsql stable security definer set search_path = public as $$
declare a public.accounts;
begin
  a := public.app_find_account(p_id);
  if a.id is null then return 'unknown'; end if;
  if not a.active or (a.branch_id is not null and not (select active from public.branches where id = a.branch_id)) then return 'inactive'; end if;
  if a.has_password then return 'login'; end if;
  if coalesce(a.invite_until, now()) < now() then return 'expired'; end if;
  return 'set_password';
end $$;

create or replace function public.auth_set_password(p_id text, p_password text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a public.accounts; tok text;
begin
  if length(coalesce(p_password, '')) < 6 then raise exception 'PASSWORD_SHORT'; end if;
  a := public.app_find_account(p_id);
  if a.id is null or not a.active or a.has_password then raise exception 'INVALID_LOGIN'; end if;
  if coalesce(a.invite_until, now()) < now() then raise exception 'INVITE_EXPIRED'; end if;
  insert into public.account_secrets (account_id, pw_hash) values (a.id, crypt(p_password, gen_salt('bf')))
    on conflict (account_id) do update set pw_hash = excluded.pw_hash, failed = 0, locked_until = null;
  update public.accounts set has_password = true where id = a.id;
  insert into public.sessions (account_id) values (a.id) returning token into tok;
  return public.app_session_json(a.id, tok);
end $$;

-- MOEEZ (admin, 9998622244) is listed with the Surat Main employees
update public.accounts set name = 'MOEEZ', shown_in_branch = (select min(id) from public.branches)
 where role = 'admin' and phone = '9998622244';
