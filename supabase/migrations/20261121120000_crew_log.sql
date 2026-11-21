-- Crew log: shop time and receipts to reimburse.
-- These are the two things the crew records that don't belong to one job.
-- Run this after the other SQL files. Running it twice is safe. It changes no jobs, prices or payments.

create table if not exists public.crew_entries (
  id uuid primary key,
  kind text not null check (kind in ('shop_hours', 'expense')),
  worker_id uuid not null,
  day date not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists crew_entries_day_idx on public.crew_entries (day desc);
create index if not exists crew_entries_worker_idx on public.crew_entries (worker_id);

alter table public.crew_entries enable row level security;

-- No client policies on purpose. The app reads and writes this table with the
-- service role only, so nobody can reach it straight from a browser.
