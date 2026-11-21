-- STEP 6: missing PARCELS per received GC (replaces the whole-GC "missing" switch).
-- Supabase -> SQL Editor: paste this whole file, click Run. Safe to run again.
set lock_timeout = '15s';

alter table public.inwards add column if not exists missing_qty integer not null default 0;
alter table public.inwards drop constraint if exists inwards_missing_qty_chk;
alter table public.inwards add constraint inwards_missing_qty_chk check (missing_qty >= 0);

-- any GC earlier marked "missing" as a whole becomes: received, with all its parcels missing (at least 1)
update public.inwards w
   set missing_qty = greatest(1, coalesce((select nullif(regexp_replace(en.data ->> 'quantity', '\D', '', 'g'), '')::int
                                           from public.entries en where en.branch_id = w.branch_id and en.gc_no = w.gc_no), 1)),
       status = 'received'
 where w.status = 'missing';

-- accounting: "missing" is now the number of missing parcels
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
    select w.branch_id, count(*) n, coalesce(sum(en.total), 0) value, coalesce(sum(w.missing_qty), 0) miss
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
