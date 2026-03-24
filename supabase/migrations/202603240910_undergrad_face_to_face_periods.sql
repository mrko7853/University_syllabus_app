-- Undergraduate face-to-face class windows
-- Parsed from the official Doshisha undergraduate faculty calendar page.

create table if not exists public.undergrad_face_to_face_periods (
    academic_year integer not null,
    term text not null,
    source_url text,
    source_snapshot_hash text,
    face_to_face_start_text text,
    face_to_face_end_text text,
    face_to_face_start_at timestamptz,
    face_to_face_end_at timestamptz,
    last_synced_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (academic_year, term),
    constraint undergrad_face_to_face_periods_term_check check (term in ('Spring', 'Fall'))
);

create or replace function public.set_undergrad_face_to_face_periods_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_undergrad_face_to_face_periods_updated_at on public.undergrad_face_to_face_periods;
create trigger trg_undergrad_face_to_face_periods_updated_at
before update on public.undergrad_face_to_face_periods
for each row
execute function public.set_undergrad_face_to_face_periods_updated_at();

alter table public.undergrad_face_to_face_periods enable row level security;

drop policy if exists "Public can read undergrad face-to-face periods" on public.undergrad_face_to_face_periods;
create policy "Public can read undergrad face-to-face periods"
on public.undergrad_face_to_face_periods
for select
to anon, authenticated
using (true);

grant select on table public.undergrad_face_to_face_periods to anon;
grant select on table public.undergrad_face_to_face_periods to authenticated;


-- Optional monthly schedule for the edge function.
-- If cron/net extensions are unavailable, this block safely no-ops.
do $$
declare
    schedule_name constant text := 'undergrad_face_to_face_monthly_sync';
    schedule_cron constant text := '17 1 1 * *'; -- 01:17 UTC on day 1 of each month
    fallback_project_ref constant text := 'vanfjbdnqqbxqhwwufaf';
    project_ref text;
    function_url text;
    existing_job_id bigint;
begin
    if to_regnamespace('cron') is null or to_regnamespace('net') is null then
        raise notice 'Skipping undergrad face-to-face cron setup: cron/net extensions unavailable.';
        return;
    end if;

    begin
        project_ref := nullif(current_setting('app.settings.project_ref', true), '');
    exception
        when others then
            project_ref := null;
    end;

    if project_ref is null then
        project_ref := fallback_project_ref;
    end if;

    function_url := format('https://%s.supabase.co/functions/v1/undergrad-face-to-face-sync', project_ref);

    select jobid
    into existing_job_id
    from cron.job
    where jobname = schedule_name
    limit 1;

    if existing_job_id is not null then
        perform cron.unschedule(existing_job_id);
    end if;

    perform cron.schedule(
        schedule_name,
        schedule_cron,
        format(
            $job$
                select net.http_post(
                    url := %L,
                    headers := '{"Content-Type":"application/json"}'::jsonb,
                    body := '{"reason":"monthly_cron"}'::jsonb
                );
            $job$,
            function_url
        )
    );

    raise notice 'Configured monthly undergrad face-to-face cron job for %', function_url;
exception
    when others then
        raise notice 'Skipping undergrad face-to-face cron setup due to error: %', sqlerrm;
end;
$$;
