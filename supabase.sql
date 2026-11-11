-- NOTE: after this file, also run supabase-branches.sql (branches, logins, per-branch security),
-- supabase-branch-phones.sql and supabase-scale.sql (one GC number per branch, fast lists and totals).
-- Run once in Supabase -> SQL Editor
create table if not exists public.entries (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  gc_no text,
  entry_date date,
  from_city text,
  to_city text,
  consignor text,
  consignee text,
  total numeric,
  data jsonb not null
);
alter table public.entries enable row level security;
create policy "anon all entries" on public.entries for all using (true) with check (true);

-- Blocks duplicate entries (every field identical, ignoring the print time). Run once; remove any existing duplicate rows first.
create unique index if not exists entries_unique_data on public.entries ((data - 'printedAt'));

-- Lorry receipts (LR). Run once.
create table if not exists public.lrs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  memo_no text,
  lr_date date,
  gc_numbers text[],
  data jsonb not null
);
alter table public.lrs enable row level security;
create policy "anon all lrs" on public.lrs for all using (true) with check (true);

-- INWARD (received GCs). Run once.
create table if not exists public.inwards (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  gc_no text unique
);
alter table public.inwards enable row level security;
create policy "anon all inwards" on public.inwards for all using (true) with check (true);

-- DELIVERY SLIP. Run once.
create table if not exists public.delivery_slips (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  slip_no text,
  slip_date date,
  gc_numbers text[],
  total numeric,
  data jsonb not null
);
alter table public.delivery_slips enable row level security;
create policy "anon all delivery_slips" on public.delivery_slips for all using (true) with check (true);
