-- Keep the crew's slot while a customer decides an on-site price change.
-- save_job only writes worker_reservations for statuses in this list.
-- price_change was missing, so a pending revision would drop the reservation
-- on Supabase even though the app still treats that status as blocking.

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
      'held', 'pending_area', 'booked', 'price_change', 'in_progress', 'awaiting_approval',
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
