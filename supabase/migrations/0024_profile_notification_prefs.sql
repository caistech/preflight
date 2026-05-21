-- ============================================================================
-- Notification preferences on profiles, plus updated RPCs.
--
-- Three categories beyond marketing opt-in:
--   email_review_queue   — notify when drafter decisions need review
--   email_weekly_digest  — Monday morning summary
--   email_project_alerts — hard-fails / cron failures
--
-- Schema landing now; email delivery infra wires in when transactional
-- triggers are written. The toggles are real and persisted as soon as
-- this migration ships — the email path is the only thing pending.
-- ============================================================================

alter table public.profiles
  add column if not exists email_review_queue boolean not null default true,
  add column if not exists email_weekly_digest boolean not null default true,
  add column if not exists email_project_alerts boolean not null default true;

-- Rebuild the RPCs to include the new columns. Same PK-column detection
-- pattern as 0020 so id/user_id ambiguity stays handled.
do $$
declare
  pk_col text;
begin
  select column_name into pk_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name in ('user_id', 'id')
   order by case when column_name = 'user_id' then 0 else 1 end limit 1;

  execute format($fn$
    create or replace function public.get_my_profile()
    returns table (
      first_name text, last_name text, phone text, company text,
      job_title text, email_marketing_opt_in boolean,
      email_review_queue boolean, email_weekly_digest boolean, email_project_alerts boolean
    )
    language sql stable security definer set search_path = public as $body$
      select first_name, last_name, phone, company, job_title,
             email_marketing_opt_in, email_review_queue, email_weekly_digest, email_project_alerts
        from public.profiles
       where %I = auth.uid()
    $body$
  $fn$, pk_col);

  execute format($fn$
    create or replace function public.update_my_profile(
      p_first_name text default null,
      p_last_name text default null,
      p_phone text default null,
      p_company text default null,
      p_job_title text default null,
      p_email_marketing_opt_in boolean default null,
      p_email_review_queue boolean default null,
      p_email_weekly_digest boolean default null,
      p_email_project_alerts boolean default null
    )
    returns void
    language plpgsql security definer set search_path = public as $body$
    begin
      update public.profiles
         set first_name = coalesce(p_first_name, first_name),
             last_name = coalesce(p_last_name, last_name),
             phone = coalesce(p_phone, phone),
             company = coalesce(p_company, company),
             job_title = coalesce(p_job_title, job_title),
             email_marketing_opt_in = coalesce(p_email_marketing_opt_in, email_marketing_opt_in),
             email_review_queue = coalesce(p_email_review_queue, email_review_queue),
             email_weekly_digest = coalesce(p_email_weekly_digest, email_weekly_digest),
             email_project_alerts = coalesce(p_email_project_alerts, email_project_alerts)
       where %I = auth.uid();
    end;
    $body$
  $fn$, pk_col);
end$$;
