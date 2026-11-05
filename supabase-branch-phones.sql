-- Run once in the Supabase SQL editor (after supabase-branches.sql).
-- Each branch has one fixed booking phone and one fixed delivery phone; they print on every GC of that branch.
alter table public.branches add column if not exists booking_ph text;
alter table public.branches add column if not exists delivery_ph text;
