-- Crew pay: what each crew member earned (hours at a rate, or a flat amount) and what
-- they have been paid.
-- Run this after the other SQL files. Running it twice is safe. It changes no jobs, hours, prices or payments.

create table if not exists public.crew_pay (
  id uuid primary key,
  kind text not null check (kind in ('pay', 'payment')),
  worker_id uuid not null,
  day date not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists crew_pay_day_idx on public.crew_pay (day desc);
create index if not exists crew_pay_worker_idx on public.crew_pay (worker_id);

alter table public.crew_pay enable row level security;

-- No client policies on purpose. The app reads and writes this table with the
-- service role only, so nobody can read wages straight from a browser. Wages are
-- kept here, not on the job records, because a job's customer and crew can read those.
