-- Course registration notice system
-- Stores parsed General Registration / Course Withdrawal periods
-- and user-level dismissal state.

create table if not exists public.registration_notice_periods (
    notice_key text primary key,
    source_url text,
    source_snapshot_hash text,
    registration_label text not null default 'General Registration',
    registration_period_text text,
    registration_start_at timestamptz,
    registration_end_at timestamptz,
    withdrawal_label text not null default 'Course Withdrawal Period',
    withdrawal_period_text text,
    withdrawal_start_at timestamptz,
    withdrawal_end_at timestamptz,
    last_synced_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.set_registration_notice_periods_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_registration_notice_periods_updated_at on public.registration_notice_periods;
create trigger trg_registration_notice_periods_updated_at
before update on public.registration_notice_periods
for each row
execute function public.set_registration_notice_periods_updated_at();

insert into public.registration_notice_periods (notice_key)
values ('ila-course-registration')
on conflict (notice_key) do nothing;

alter table public.registration_notice_periods enable row level security;

drop policy if exists "Public can read registration notice periods" on public.registration_notice_periods;
create policy "Public can read registration notice periods"
on public.registration_notice_periods
for select
to anon, authenticated
using (true);

grant select on table public.registration_notice_periods to anon;
grant select on table public.registration_notice_periods to authenticated;


create table if not exists public.user_notice_dismissals (
    user_id uuid not null references auth.users(id) on delete cascade,
    notice_key text not null,
    dismissed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, notice_key)
);

create or replace function public.set_user_notice_dismissals_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_user_notice_dismissals_updated_at on public.user_notice_dismissals;
create trigger trg_user_notice_dismissals_updated_at
before update on public.user_notice_dismissals
for each row
execute function public.set_user_notice_dismissals_updated_at();

alter table public.user_notice_dismissals enable row level security;

drop policy if exists "Users can view own notice dismissals" on public.user_notice_dismissals;
create policy "Users can view own notice dismissals"
on public.user_notice_dismissals
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own notice dismissals" on public.user_notice_dismissals;
create policy "Users can insert own notice dismissals"
on public.user_notice_dismissals
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own notice dismissals" on public.user_notice_dismissals;
create policy "Users can update own notice dismissals"
on public.user_notice_dismissals
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own notice dismissals" on public.user_notice_dismissals;
create policy "Users can delete own notice dismissals"
on public.user_notice_dismissals
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on table public.user_notice_dismissals to authenticated;


-- Optional monthly schedule for the edge function.
-- This block is intentionally resilient: if cron/net are unavailable,
-- the migration still succeeds and the app can trigger sync via client staleness checks.
do $$
declare
    schedule_name constant text := 'ila_registration_notice_monthly_sync';
    schedule_cron constant text := '13 1 1 * *'; -- 01:13 UTC on day 1 of each month
    fallback_project_ref constant text := 'vanfjbdnqqbxqhwwufaf';
    project_ref text;
    function_url text;
    existing_job_id bigint;
begin
    if to_regnamespace('cron') is null or to_regnamespace('net') is null then
        raise notice 'Skipping registration notice cron setup: cron/net extensions unavailable.';
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

    function_url := format('https://%s.supabase.co/functions/v1/registration-notice-sync', project_ref);

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

    raise notice 'Configured monthly registration notice cron job for %', function_url;
exception
    when others then
        raise notice 'Skipping registration notice cron setup due to error: %', sqlerrm;
end;
$$;
