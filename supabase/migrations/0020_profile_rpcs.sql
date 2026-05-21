-- ============================================================================
-- Profile RPC helpers so the API doesn't need to know which PK column the
-- live profiles table uses (id vs user_id). Both functions filter on
-- auth.uid() so each user is scoped to their own row regardless of RLS.
--
-- Split out from 0019 because 0019 was already applied before the helpers
-- were added. This migration is idempotent.
-- ============================================================================

do $$
declare
  pk_col text;
begin
  select column_name into pk_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name in ('user_id', 'id')
   order by case when column_name = 'user_id' then 0 else 1 end
   limit 1;

  if pk_col is null then
    raise exception 'profiles table missing both id and user_id columns';
  end if;

  execute format($fn$
    create or replace function public.get_my_profile()
    returns table (
      first_name text, last_name text, phone text, company text,
      job_title text, email_marketing_opt_in boolean
    )
    language sql stable security definer set search_path = public as $body$
      select first_name, last_name, phone, company, job_title, email_marketing_opt_in
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
      p_email_marketing_opt_in boolean default null
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
             email_marketing_opt_in = coalesce(p_email_marketing_opt_in, email_marketing_opt_in)
       where %I = auth.uid();
    end;
    $body$
  $fn$, pk_col);
end$$;
