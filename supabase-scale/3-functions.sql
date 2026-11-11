-- STEP 3 of 4: list, accounting and pay-type functions
-- Supabase -> SQL Editor: paste this whole file, click Run. Then run the next step.
-- Safe to run again. If a step waits for the database for more than 15 seconds it stops with
-- "canceling statement due to lock timeout": just click Run again (ideally when few people are saving).
set lock_timeout = '15s';

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
      -- list columns only; the full entry is read when it is opened, printed or downloaded
      select id, branch_id, gc_no, entry_date, from_city, to_city, consignor, consignee, total, created_at, data ->> 'payType' as pay_type
      from f order by
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

-- ---------- 6. change a GC's pay type in place (no need to download and re-upload the whole entry) ----------
create or replace function public.set_pay_type(p_id bigint, p_pay text) returns void
language sql volatile set search_path = public as $$
  update public.entries set data = jsonb_set(data, '{payType}', to_jsonb(p_pay))
  where id = p_id and p_pay in ('Paid', 'To Pay', 'To be Billed')
$$;

grant execute on function public.app_num(text), public.entries_page(bigint, text, text, text, int, int),
  public.acc_totals(bigint, date, date), public.set_pay_type(bigint, text) to anon, authenticated;
