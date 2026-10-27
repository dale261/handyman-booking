-- Daily OpenAI quote counts and IP rate limits. Run this after the cost library.
-- The app passes the Detroit calendar date. This file does not change any prices.

create table if not exists public.ai_usage (
  usage_date date not null,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  calls integer not null default 0 check (calls >= 0),
  primary key (usage_date, customer_id)
);

create table if not exists public.ip_rate_limits (
  bucket text not null,
  ip text not null,
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket, ip)
);

alter table public.ai_usage enable row level security;
alter table public.ip_rate_limits enable row level security;

drop policy if exists ai_usage_owner_select on public.ai_usage;
create policy ai_usage_owner_select on public.ai_usage
  for select to authenticated
  using (public.current_role() = 'owner');

-- No client policy on ip_rate_limits. The service role writes it.

create or replace function public.reserve_ai_call(
  p_customer uuid,
  p_day date,
  p_daily_cap integer,
  p_customer_cap integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_customer integer;
begin
  perform pg_advisory_xact_lock(hashtext('ai-usage:' || p_day::text)::bigint);

  select coalesce(sum(calls), 0) into v_total
  from public.ai_usage
  where usage_date = p_day;

  select coalesce(calls, 0) into v_customer
  from public.ai_usage
  where usage_date = p_day and customer_id = p_customer;

  if p_daily_cap < 1 or p_customer_cap < 1 or v_total >= p_daily_cap or v_customer >= p_customer_cap then
    return jsonb_build_object(
      'allowed', false,
      'total', v_total,
      'customerCalls', v_customer,
      'dailyCap', p_daily_cap,
      'customerCap', p_customer_cap
    );
  end if;

  insert into public.ai_usage (usage_date, customer_id, calls)
  values (p_day, p_customer, 1)
  on conflict (usage_date, customer_id)
  do update set calls = public.ai_usage.calls + 1;

  return jsonb_build_object(
    'allowed', true,
    'total', v_total + 1,
    'customerCalls', v_customer + 1,
    'dailyCap', p_daily_cap,
    'customerCap', p_customer_cap
  );
end;
$$;

create or replace function public.hit_ip_limit(
  p_bucket text,
  p_ip text,
  p_max integer,
  p_window_ms integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_hits integer;
  v_now timestamptz := clock_timestamp();
  v_window interval;
begin
  perform pg_advisory_xact_lock(hashtext('ip:' || p_bucket || ':' || p_ip)::bigint);
  v_window := make_interval(secs => p_window_ms / 1000.0);

  select window_start, hits into v_start, v_hits
  from public.ip_rate_limits
  where bucket = p_bucket and ip = p_ip
  for update;

  if v_start is null or v_now - v_start >= v_window then
    insert into public.ip_rate_limits (bucket, ip, window_start, hits)
    values (p_bucket, p_ip, v_now, 1)
    on conflict (bucket, ip)
    do update set window_start = excluded.window_start, hits = excluded.hits;
    return jsonb_build_object('allowed', p_max >= 1, 'hits', 1);
  end if;

  if v_hits >= p_max then
    return jsonb_build_object('allowed', false, 'hits', v_hits);
  end if;

  update public.ip_rate_limits
  set hits = hits + 1
  where bucket = p_bucket and ip = p_ip
  returning hits into v_hits;

  return jsonb_build_object('allowed', true, 'hits', v_hits);
end;
$$;

revoke all on function public.reserve_ai_call(uuid, date, integer, integer) from public;
revoke all on function public.reserve_ai_call(uuid, date, integer, integer) from anon;
revoke all on function public.reserve_ai_call(uuid, date, integer, integer) from authenticated;
grant execute on function public.reserve_ai_call(uuid, date, integer, integer) to service_role;

revoke all on function public.hit_ip_limit(text, text, integer, integer) from public;
revoke all on function public.hit_ip_limit(text, text, integer, integer) from anon;
revoke all on function public.hit_ip_limit(text, text, integer, integer) from authenticated;
grant execute on function public.hit_ip_limit(text, text, integer, integer) to service_role;

grant select, insert, update, delete on public.ai_usage to service_role;
grant select on public.ai_usage to authenticated;
grant select, insert, update, delete on public.ip_rate_limits to service_role;
