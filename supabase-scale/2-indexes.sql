-- STEP 2 of 4: indexes for fast lists and searches
-- Supabase -> SQL Editor: paste this whole file, click Run. Then run the next step.
-- Safe to run again. If a step waits for the database for more than 15 seconds it stops with
-- "canceling statement due to lock timeout": just click Run again (ideally when few people are saving).
set lock_timeout = '15s';

-- ---------- 2. indexes for newest-first lists and searches ----------
create extension if not exists pg_trgm with schema extensions;
create index if not exists entries_branch_created_idx on public.entries (branch_id, created_at desc);
create index if not exists entries_created_idx on public.entries (created_at desc);
create index if not exists entries_branch_date_idx on public.entries (branch_id, entry_date);
create index if not exists entries_gc_trgm_idx on public.entries using gin (gc_no extensions.gin_trgm_ops);
create index if not exists lrs_branch_created_idx on public.lrs (branch_id, created_at desc);
create index if not exists inwards_branch_created_idx on public.inwards (branch_id, created_at desc);
create index if not exists slips_branch_created_idx on public.delivery_slips (branch_id, created_at desc);
-- the composite indexes above start with branch_id, so the single-column ones are no longer needed
drop index if exists public.entries_branch_idx;
drop index if exists public.lrs_branch_idx;
drop index if exists public.inwards_branch_idx;
drop index if exists public.delivery_slips_branch_idx;
