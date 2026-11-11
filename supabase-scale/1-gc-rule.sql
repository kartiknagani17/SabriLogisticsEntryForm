-- STEP 1 of 4: one GC number per branch
-- Supabase -> SQL Editor: paste this whole file, click Run. Then run the next step.
-- Safe to run again. If a step waits for the database for more than 15 seconds it stops with
-- "canceling statement due to lock timeout": just click Run again (ideally when few people are saving).
set lock_timeout = '15s';

-- ---------- 1. one GC number per branch ----------
update public.entries set gc_no = btrim(gc_no) where gc_no <> btrim(gc_no);

do $$
declare dups text;
begin
  select string_agg(format('branch %s: GC %s (%s times)', branch_id, gc_no, n), '; ')
    into dups
    from (select branch_id, gc_no, count(*) n from public.entries where gc_no is not null
          group by 1, 2 having count(*) > 1 order by 1, 2 limit 50) d;
  if dups is not null then
    raise exception 'These GC numbers are saved more than once in the same branch. Delete or fix the extra rows, then run this file again: %', dups;
  end if;
end $$;

create unique index if not exists entries_branch_gc_uq on public.entries (branch_id, gc_no);
-- the old "every field identical" rule is covered by the GC-number rule, and its index was large
drop index if exists public.entries_unique_data;
