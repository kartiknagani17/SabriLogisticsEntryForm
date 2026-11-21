-- STEP 7: automatic "WhatsApp out of funds" alert.
-- Meta tells our worker (webhook) when a message fails for payment reasons; the worker records it here.
-- Supabase -> SQL Editor: paste this whole file, click Run. Safe to run again (the secret is kept).
set lock_timeout = '15s';

create table if not exists public.wa_state (key text primary key, value text not null);
alter table public.wa_state enable row level security;   -- no policies: nobody but the database functions can read it
revoke all on public.wa_state from anon, authenticated;
insert into public.wa_state (key, value) values ('hook_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) on conflict (key) do nothing;

create table if not exists public.wa_alerts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null default 'funds',
  detail text
);
alter table public.wa_alerts enable row level security;
drop policy if exists wa_alerts_admin on public.wa_alerts;
create policy wa_alerts_admin on public.wa_alerts for select using (public.app_is_admin());
revoke insert, update, delete on public.wa_alerts from anon, authenticated;

-- called by the worker only; needs the shared secret, and records at most one alert per 10 minutes
create or replace function public.wa_funds_alert(p_secret text, p_detail text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret is distinct from (select value from public.wa_state where key = 'hook_secret') then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.wa_alerts where created_at > now() - interval '10 minutes') then
    insert into public.wa_alerts (kind, detail) values ('funds', left(p_detail, 300));
  end if;
end $$;
revoke all on function public.wa_funds_alert(text, text) from public;
grant execute on function public.wa_funds_alert(text, text) to anon, authenticated;
