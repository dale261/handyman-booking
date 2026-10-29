-- Leads: people who gave a name and phone to see a price on the public page.
-- Run this after the other SQL files. Running it twice is safe. It changes no prices.

create table if not exists public.leads (
  id uuid primary key,
  full_name text not null,
  phone text not null,
  email text not null default '',
  service text not null,
  address text not null default '',
  zip text not null,
  description text not null default '',
  total numeric(12, 2),
  review boolean not null default false,
  job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_phone_idx on public.leads (phone);

alter table public.leads enable row level security;

drop policy if exists leads_owner_read on public.leads;
create policy leads_owner_read on public.leads
  for select to authenticated
  using (public.current_role() = 'owner');

-- No client write policy. The app writes leads with the service role.

-- If the table was created by an earlier version of this file, add the address column.
alter table public.leads add column if not exists address text not null default '';
