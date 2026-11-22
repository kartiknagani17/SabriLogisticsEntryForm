-- STEP 9. Run once in Supabase -> SQL Editor (safe to run again).
-- (1) anyone signed in can change their own password (current password needed)
-- (2) an admin sets a new password for any account directly
-- Both keep the session they are made from and sign out every other device of that account.

create or replace function public.app_session_token() returns text
language sql stable as $$
  select nullif(current_setting('request.headers', true), '')::json ->> 'x-session-token'
$$;

create or replace function public.auth_change_password(p_old text, p_new text) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare me bigint := public.app_account_id(); s public.account_secrets;
begin
  if me is null then raise exception 'NOT_LOGGED_IN'; end if;
  if length(coalesce(p_new, '')) < 6 then raise exception 'PASSWORD_SHORT'; end if;
  select * into s from public.account_secrets where account_id = me;
  if s.account_id is null or s.pw_hash is distinct from crypt(coalesce(p_old, ''), s.pw_hash) then raise exception 'WRONG_PASSWORD'; end if;
  update public.account_secrets set pw_hash = crypt(p_new, gen_salt('bf')), failed = 0, locked_until = null where account_id = me;
  delete from public.sessions where account_id = me and token <> coalesce(public.app_session_token(), '');
end $$;

create or replace function public.admin_set_password(p_account bigint, p_new text) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if not public.app_is_admin() then raise exception 'NOT_ALLOWED'; end if;
  if length(coalesce(p_new, '')) < 6 then raise exception 'PASSWORD_SHORT'; end if;
  if not exists (select 1 from public.accounts where id = p_account) then raise exception 'NOT_ALLOWED'; end if;
  insert into public.account_secrets (account_id, pw_hash) values (p_account, crypt(p_new, gen_salt('bf')))
    on conflict (account_id) do update set pw_hash = excluded.pw_hash, failed = 0, locked_until = null;
  update public.accounts set has_password = true where id = p_account;
  delete from public.sessions where account_id = p_account and token <> coalesce(public.app_session_token(), '');
end $$;

revoke all on function public.app_session_token() from public, anon, authenticated;
grant execute on function public.auth_change_password(text, text), public.admin_set_password(bigint, text) to anon, authenticated;
notify pgrst, 'reload schema';
