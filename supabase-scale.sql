-- SCALE-UP: one GC number per branch, fast paged lists, accounting totals worked out in the database.
-- Run once in Supabase -> SQL Editor, AFTER supabase.sql, supabase-branches.sql and supabase-branch-phones.sql.
-- Safe to run again. If a branch already has the same GC number saved twice, it stops and lists them:
-- delete or fix the extra rows (Table Editor -> entries), then run it again.

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

-- ---------- 3. helpers ----------
-- text -> number, 0 when it is not a number (form values are stored as text)
create or replace function public.app_num(t text) returns numeric
language sql immutable as $$
  select case when t ~ '^\s*-?(\d+\.?\d*|\.\d+)\s*$' then t::numeric else 0 end
$$;

-- ---------- 4. entries list: search, filter, sort and page in the database ----------
-- Runs with the caller's rights, so row level security still limits employees to their own branch.
create or replace function public.entries_page(p_branch bigint default null, p_q text default null, p_pay text default null,
                                               p_sort text default null, p_limit int default 100, p_offset int default 0)
returns json language sql stable set search_path = public as $$
  with f as (
    select e.* from public.entries e
    where (p_branch is null or e.branch_id = p_branch)
      and (coalesce(p_q, '') = '' or e.gc_no ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      and (coalesce(p_pay, '') = '' or e.data ->> 'payType' = p_pay)
  )
  select json_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((select json_agg(r) from (
      select * from f order by
        case when p_sort = 'gcAsc' then length(gc_no) end, case when p_sort = 'gcAsc' then gc_no end,
        case when p_sort = 'gcDesc' then length(gc_no) end desc, case when p_sort = 'gcDesc' then gc_no end desc,
        case when p_sort = 'dateDesc' then entry_date end desc nulls last,
        case when p_sort = 'dateAsc' then entry_date end asc nulls first,
        case when p_sort = 'dateAsc' then created_at end asc,
        created_at desc
      limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)) r), '[]'::json))
$$;

-- ---------- 5. accounting totals per branch ----------
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
    select w.branch_id, count(*) n, coalesce(sum(en.total), 0) value
    from public.inwards w left join public.entries en on en.branch_id = w.branch_id and en.gc_no = w.gc_no
    where (p_branch is null or w.branch_id = p_branch)
      and (p_from is null or (w.created_at at time zone 'UTC')::date >= p_from)
      and (p_to is null or (w.created_at at time zone 'UTC')::date <= p_to)
    group by w.branch_id
  ), ids as (select branch_id from e union select branch_id from s union select branch_id from w)
  select coalesce(json_agg(json_build_object('branch_id', ids.branch_id,
    'n', coalesce(e.n, 0), 'total', coalesce(e.total, 0), 'freight', coalesce(e.freight, 0), 'bc', coalesce(e.bc, 0),
    'door', coalesce(e.door, 0), 'handling', coalesce(e.handling, 0), 'other', coalesce(e.other, 0), 'tax', coalesce(e.tax, 0),
    'paid', coalesce(e.paid, 0), 'topay', coalesce(e.topay, 0), 'billed', coalesce(e.billed, 0),
    'slips', coalesce(s.n, 0), 'slipTotal', coalesce(s.total, 0), 'recv', coalesce(w.n, 0), 'recvValue', coalesce(w.value, 0))), '[]'::json)
  from ids left join e on e.branch_id = ids.branch_id left join s on s.branch_id = ids.branch_id left join w on w.branch_id = ids.branch_id
$$;

grant execute on function public.app_num(text), public.entries_page(bigint, text, text, text, int, int),
  public.acc_totals(bigint, date, date) to anon, authenticated;
