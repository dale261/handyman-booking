-- The owner's rate list: what each crew member is paid an hour, in general, for shop
-- time, or on one job. New hours get their rate from it as they are logged.
-- Run this after the other SQL files. Running it twice is safe. It changes no jobs, hours, pay or payments.

create table if not exists public.crew_rates (
  id text primary key,
  worker_id uuid not null,
  -- 'usual', 'shop', or a job's id.
  scope text not null,
  rate numeric(10,2) not null check (rate >= 0),
  updated_at timestamptz not null default now(),
  unique (worker_id, scope)
);

create index if not exists crew_rates_worker_idx on public.crew_rates (worker_id);

alter table public.crew_rates enable row level security;

-- No client policies on purpose. The app reads and writes this table with the
-- service role only, so nobody can read wages straight from a browser.
