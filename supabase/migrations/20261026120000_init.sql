-- eX Construction LC booking app.
-- Run this in a fresh Supabase project before the ZIP seed.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Settings, people, crews
-- ---------------------------------------------------------------------------

create table public.app_settings (
  id int primary key check (id = 1),
  owner_email text not null default '',
  data jsonb not null
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'worker', 'owner')),
  email text not null default '',
  full_name text not null default '',
  phone text not null default '',
  billing_address text not null default '',
  billing_zip text not null default '',
  created_at timestamptz not null default now()
);

create table public.crews (
  id uuid primary key,
  name text not null,
  active boolean not null default true
);

create table public.workers (
  id uuid primary key,
  profile_id uuid unique references public.profiles (id) on delete set null,
  full_name text not null,
  email text not null,
  crew_id uuid references public.crews (id) on delete set null,
  day_start_min int not null default 480,
  day_end_min int not null default 1020,
  work_days int[] not null default '{1,2,3,4,5,6}',
  active boolean not null default true
);

create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers (id) on delete cascade,
  off_date date not null,
  unique (worker_id, off_date)
);

-- ---------------------------------------------------------------------------
-- Service area. Rows are loaded by the next migration.
-- ---------------------------------------------------------------------------

create table public.service_area_zips (
  zip text primary key check (zip ~ '^[0-9]{5}$'),
  city text not null default '',
  county text not null default '',
  counties_spanned text[] not null default '{}',
  status text not null check (status in ('auto_book', 'owner_review')),
  flag_reason text,
  county_note text,
  miles_from_cadillac numeric,
  lat double precision,
  lng double precision,
  source text not null default ''
);

-- ---------------------------------------------------------------------------
-- Jobs, money, messages
-- ---------------------------------------------------------------------------

create sequence public.invoice_number_seq as integer start with 1000 increment by 1 minvalue 1000;

create table public.jobs (
  id uuid primary key,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  crew_id uuid references public.crews (id) on delete set null,
  status text not null,
  scheduled_date date,
  invoice_number integer unique,
  total numeric not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_customer_idx on public.jobs (customer_id);
create index jobs_status_idx on public.jobs (status);
create index jobs_day_idx on public.jobs (scheduled_date, crew_id);

create table public.worker_reservations (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  exclude using gist (worker_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
);

create table public.payments (
  id uuid primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  kind text not null check (kind in ('deposit', 'full', 'balance', 'refund')),
  amount numeric not null,
  method text not null check (method in ('paypal', 'cash', 'check')),
  status text not null check (status in ('pending', 'paid', 'sent')),
  closed boolean not null default false,
  note text not null default '',
  paypal_capture_id text,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key,
  kind text not null,
  title text not null,
  detail text not null,
  read boolean not null default false,
  job_id uuid references public.jobs (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.emails (
  id uuid primary key,
  recipient text not null,
  subject text not null,
  body text not null,
  job_id uuid references public.jobs (id) on delete set null,
  sent boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.reviews (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  customer_name text not null default '',
  rating int not null check (rating between 1 and 5),
  comment text not null default '',
  publish_photos boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.geo_cache (
  address_key text primary key,
  lat double precision not null,
  lng double precision not null
);

create table public.route_cache (
  route_key text primary key,
  miles numeric not null,
  source text not null
);

-- ---------------------------------------------------------------------------
-- Invoice numbers come from the sequence inside this function, in the same
-- transaction as the job save. A failed reservation rolls the save back
-- before the sequence is used.
-- ---------------------------------------------------------------------------

create or replace function public.save_job(p_job jsonb, p_issue boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (p_job->>'id')::uuid;
  v_status text := p_job->>'status';
  v_invoice integer := nullif(p_job->>'invoiceNumber', '')::integer;
  v_date date := nullif(p_job->>'scheduledDate', '')::date;
  v_start integer := nullif(p_job->>'reserveStartMin', '')::integer;
  v_end integer := nullif(p_job->>'reserveEndMin', '')::integer;
  v_worker uuid;
  v_existing integer;
begin
  insert into public.jobs (id, customer_id, crew_id, status, scheduled_date, invoice_number, total, payload, updated_at)
  values (
    v_id,
    (p_job->>'customerId')::uuid,
    nullif(p_job->>'crewId', '')::uuid,
    v_status,
    v_date,
    v_invoice,
    coalesce((p_job->>'total')::numeric, 0),
    p_job,
    now()
  )
  on conflict (id) do update set
    customer_id = excluded.customer_id,
    crew_id = excluded.crew_id,
    status = excluded.status,
    scheduled_date = excluded.scheduled_date,
    invoice_number = coalesce(excluded.invoice_number, public.jobs.invoice_number),
    total = excluded.total,
    payload = excluded.payload,
    updated_at = now();

  delete from public.worker_reservations where job_id = v_id;

  if v_status in (
      'held', 'pending_area', 'booked', 'in_progress', 'awaiting_approval',
      'disputed', 'balance_due', 'completed', 'reviewed', 'cancel_requested'
    )
    and v_date is not null
    and v_start is not null
    and v_end is not null
    and v_end > v_start
  then
    for v_worker in
      select value::uuid from jsonb_array_elements_text(coalesce(p_job->'workerIds', '[]'::jsonb)) as value
    loop
      insert into public.worker_reservations (worker_id, job_id, starts_at, ends_at)
      values (
        v_worker,
        v_id,
        (v_date::timestamp + make_interval(mins => v_start)) at time zone 'America/Detroit',
        (v_date::timestamp + make_interval(mins => v_end)) at time zone 'America/Detroit'
      );
    end loop;
  end if;

  if v_status = 'held' then
    select invoice_number into v_existing from public.jobs where id = v_id;
    if v_existing is null and p_issue then
      v_existing := nextval('public.invoice_number_seq');
      update public.jobs
        set invoice_number = v_existing,
            payload = jsonb_set(payload, '{invoiceNumber}', to_jsonb(v_existing))
        where id = v_id;
    end if;
    if v_existing is not null then
      p_job := jsonb_set(p_job, '{invoiceNumber}', to_jsonb(v_existing));
    end if;
  end if;

  return p_job;
end;
$$;

revoke all on function public.save_job(jsonb, boolean) from public;
grant execute on function public.save_job(jsonb, boolean) to service_role;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_mail text := coalesce((select owner_email from public.app_settings where id = 1), '');
  new_role text := 'customer';
begin
  if owner_mail <> '' and lower(coalesce(new.email, '')) = lower(owner_mail) then
    new_role := 'owner';
  elsif exists (select 1 from public.workers w where lower(w.email) = lower(coalesce(new.email, ''))) then
    new_role := 'worker';
  end if;

  insert into public.profiles (id, email, full_name, phone, billing_address, billing_zip, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'billing_address', ''),
    coalesce(new.raw_user_meta_data->>'billing_zip', ''),
    new_role
  );

  update public.workers
    set profile_id = new.id
    where lower(email) = lower(coalesce(new.email, ''))
      and profile_id is null;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.prevent_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if coalesce(auth.role(), '') <> 'service_role' and public.current_role() is distinct from 'owner' then
      raise exception 'Only the owner can change a role';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_role_guard
  before update on public.profiles
  for each row execute function public.prevent_role_change();

-- ---------------------------------------------------------------------------
-- Row level security. The server uses the secret service key and checks the
-- signed-in person in the app. These policies stop the public anon key from
-- reading someone else's jobs, payments, or settings.
-- ---------------------------------------------------------------------------

alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.crews enable row level security;
alter table public.workers enable row level security;
alter table public.time_off enable row level security;
alter table public.service_area_zips enable row level security;
alter table public.jobs enable row level security;
alter table public.worker_reservations enable row level security;
alter table public.payments enable row level security;
alter table public.notifications enable row level security;
alter table public.emails enable row level security;
alter table public.reviews enable row level security;
alter table public.geo_cache enable row level security;
alter table public.route_cache enable row level security;

create policy zips_read on public.service_area_zips
  for select to anon, authenticated using (true);

create policy settings_read on public.app_settings
  for select to authenticated using (true);
create policy settings_write on public.app_settings
  for update to authenticated using (public.current_role() = 'owner') with check (public.current_role() = 'owner');

create policy profiles_read on public.profiles
  for select to authenticated using (id = auth.uid() or public.current_role() = 'owner');
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid() or public.current_role() = 'owner')
  with check (id = auth.uid() or public.current_role() = 'owner');

create policy crews_read on public.crews for select to authenticated using (true);
create policy crews_write on public.crews for all to authenticated
  using (public.current_role() = 'owner') with check (public.current_role() = 'owner');

create policy workers_read on public.workers for select to authenticated using (true);
create policy workers_write on public.workers for all to authenticated
  using (public.current_role() = 'owner') with check (public.current_role() = 'owner');

create policy time_off_read on public.time_off for select to authenticated using (true);
create policy time_off_write on public.time_off for all to authenticated
  using (
    public.current_role() = 'owner'
    or worker_id in (select id from public.workers where profile_id = auth.uid())
  )
  with check (
    public.current_role() = 'owner'
    or worker_id in (select id from public.workers where profile_id = auth.uid())
  );

create policy jobs_read on public.jobs for select to authenticated using (
  customer_id = auth.uid()
  or public.current_role() = 'owner'
  or crew_id in (select crew_id from public.workers where profile_id = auth.uid())
);

create policy payments_read on public.payments for select to authenticated using (
  public.current_role() = 'owner'
  or job_id in (select id from public.jobs where customer_id = auth.uid())
  or job_id in (
    select j.id from public.jobs j
    join public.workers w on w.crew_id = j.crew_id
    where w.profile_id = auth.uid()
  )
);

create policy notifications_read on public.notifications
  for select to authenticated using (public.current_role() = 'owner');
create policy notifications_update on public.notifications
  for update to authenticated using (public.current_role() = 'owner') with check (public.current_role() = 'owner');

create policy emails_read on public.emails
  for select to authenticated using (public.current_role() = 'owner');

create policy reviews_read on public.reviews
  for select to anon, authenticated using (true);

create policy reservations_read on public.worker_reservations
  for select to authenticated using (public.current_role() = 'owner');

grant usage on schema public to anon, authenticated, service_role;
grant select on public.service_area_zips, public.reviews to anon;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Starting rates and two sample crews. Rename or replace them in the app.
-- ---------------------------------------------------------------------------

insert into public.app_settings (id, owner_email, data) values (
  1,
  '',
  '{
    "shopAddress": "1339 N Mitchell St, Cadillac, MI 49601",
    "shopLat": 44.2683,
    "shopLng": -85.406593,
    "ownerNotifyEmail": "",
    "rrpCertified": false,
    "premiumEnabled": true,
    "premiumMultiplier": 1.2,
    "premiumCounties": ["Grand Traverse", "Leelanau", "Emmet", "Charlevoix"],
    "depositThreshold": 1500,
    "cancelFee": 50,
    "holdHours": 24,
    "bufferMinutes": 15,
    "roadFactor": 1.25,
    "driveFactor": 1.1,
    "drivePadMinutes": 5,
    "mileRate": 1,
    "travelMinimum": 50,
    "hourly": 95,
    "minimumJob": 150,
    "helperRate": 100,
    "helperMax": 3,
    "helperMaxHours": 8,
    "paintSqft": 6.5,
    "paintCeiling": 1.75,
    "paintDoor": 75,
    "paintColor": 60,
    "paintCrewSize": 2,
    "yardCrewSize": 2,
    "tvSmall": 225,
    "tvMid": 275,
    "tvLarge": 350,
    "tvConceal": 175,
    "tvPlaster": 75,
    "tvBrick": 125,
    "tvRaceway": 95,
    "asmSmall": 95,
    "asmMedium": 150,
    "asmLarge": 250,
    "blindsEach": 85,
    "urgency": 50,
    "pickup": 35,
    "haul": 95,
    "height9": 1.15,
    "height11": 1.3,
    "condFair": 1.1,
    "condPoor": 1.25,
    "deepClean": 1.2,
    "onsitePaint": 240,
    "onsiteTv": 60,
    "onsiteBlinds": 60,
    "onsiteFurniture": 90,
    "onsiteYard": 120,
    "onsiteClean": 120,
    "onsiteOther": 120,
    "slotStartMin": 480,
    "slotEndMin": 960,
    "slotStepMin": 30,
    "builderThreshold": 600
  }'::jsonb
);

insert into public.crews (id, name) values
  ('00000000-0000-4000-8000-0000000000c1', 'Crew 1'),
  ('00000000-0000-4000-8000-0000000000c2', 'Crew 2');

insert into public.workers (id, full_name, email, crew_id, day_start_min, day_end_min, work_days) values
  ('00000000-0000-4000-8000-0000000000a1', 'Worker A (sample)', 'worker.a@exconstruction.example', '00000000-0000-4000-8000-0000000000c1', 450, 1050, '{1,2,3,4,5,6}'),
  ('00000000-0000-4000-8000-0000000000b2', 'Worker B (sample)', 'worker.b@exconstruction.example', '00000000-0000-4000-8000-0000000000c1', 480, 960, '{1,2,3,4,5,6}'),
  ('00000000-0000-4000-8000-0000000000c3', 'Helper C (sample)', 'helper.c@exconstruction.example', '00000000-0000-4000-8000-0000000000c2', 480, 1020, '{1,2,3,4,5,6}'),
  ('00000000-0000-4000-8000-0000000000d4', 'Worker D (sample)', 'worker.d@exconstruction.example', '00000000-0000-4000-8000-0000000000c2', 480, 1020, '{1,2,3,4,5,6}');

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('job-photos', 'job-photos', false)
  on conflict (id) do nothing;
exception
  when undefined_table then
    raise notice 'storage.buckets is not available in this database. Create a private bucket named job-photos in the Supabase dashboard.';
end $$;
