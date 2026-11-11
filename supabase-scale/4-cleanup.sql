-- STEP 4 of 4: nightly clean-up that keeps the last 60 days
-- Supabase -> SQL Editor: paste this whole file, click Run. Then run the next step.
-- Safe to run again. If a step waits for the database for more than 15 seconds it stops with
-- "canceling statement due to lock timeout": just click Run again (ideally when few people are saving).
set lock_timeout = '15s';

-- ---------- 7. keep 60 days: every night, records older than that are deleted ----------
-- To keep a different number of days, change 60 in the schedule below and run this file again (30 is the minimum).
create or replace function public.app_retention(p_days int default 60) returns void
language plpgsql volatile security definer set search_path = public as $$
declare cutoff timestamptz := now() - make_interval(days => greatest(p_days, 30));
begin
  delete from public.entries where created_at < cutoff;
  delete from public.lrs where created_at < cutoff;
  delete from public.inwards where created_at < cutoff;
  delete from public.delivery_slips where created_at < cutoff;
  delete from public.sessions where expires_at < now();
end $$;
revoke all on function public.app_retention(int) from public, anon, authenticated;

-- runs at 03:00 India time (21:30 UTC) every night
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.unschedule(jobid) from cron.job where jobname = 'sabri-delete-old-data';
  perform cron.schedule('sabri-delete-old-data', '30 21 * * *', 'select public.app_retention(60)');
  raise notice 'Nightly clean-up scheduled: records older than 60 days are deleted at 03:00 IST.';
exception when others then
  raise notice 'Nightly clean-up NOT scheduled (%). Turn on pg_cron under Database -> Extensions, then run this file again.', sqlerrm;
end $$;
