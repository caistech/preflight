-- ============================================================================
-- profiles — per-user profile fields keyed by auth.users.id.
--
-- Required by the global AUTHENTICATED-APP CHROME + SETTINGS PAGE RULE.
-- This migration is defensive: a profiles table already exists in the
-- live DB (likely scaffolded earlier with `id` as the FK column). We
-- detect the existing PK column name and add the new fields + policies
-- against whichever convention is in place, rather than crashing on a
-- column-name mismatch.
-- ============================================================================

do $$
declare
  has_user_id boolean;
  has_id boolean;
  pk_col text;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'user_id'
  ) into has_user_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'id'
  ) into has_id;

  if has_user_id then
    pk_col := 'user_id';
  elsif has_id then
    pk_col := 'id';
  else
    -- Fresh install — create from scratch.
    execute $ct$
      create table public.profiles (
        user_id uuid primary key references auth.users(id) on delete cascade,
        created_at timestamptz not null default now()
      )
    $ct$;
    pk_col := 'user_id';
  end if;

  -- Add missing fields. ADD COLUMN IF NOT EXISTS is idempotent.
  execute 'alter table public.profiles add column if not exists first_name text';
  execute 'alter table public.profiles add column if not exists last_name text';
  execute 'alter table public.profiles add column if not exists phone text';
  execute 'alter table public.profiles add column if not exists company text';
  execute 'alter table public.profiles add column if not exists job_title text';
  execute 'alter table public.profiles add column if not exists email_marketing_opt_in boolean not null default false';
  execute 'alter table public.profiles add column if not exists updated_at timestamptz not null default now()';

  execute 'alter table public.profiles enable row level security';

  -- Policies — use whichever PK column the table actually has.
  execute 'drop policy if exists "profiles_select_self" on public.profiles';
  execute format(
    'create policy "profiles_select_self" on public.profiles for select using (%I = auth.uid())',
    pk_col
  );

  execute 'drop policy if exists "profiles_update_self" on public.profiles';
  execute format(
    'create policy "profiles_update_self" on public.profiles for update using (%I = auth.uid())',
    pk_col
  );

  -- updated_at touch trigger
  execute $fn$
    create or replace function public.touch_profiles_updated_at()
    returns trigger language plpgsql as $body$
    begin
      new.updated_at = now();
      return new;
    end;
    $body$
  $fn$;
  execute 'drop trigger if exists trg_profiles_touch on public.profiles';
  execute 'create trigger trg_profiles_touch before update on public.profiles for each row execute function public.touch_profiles_updated_at()';

  -- on_auth_user_created — inserts a profile row using the right PK column.
  execute format($fn$
    create or replace function public.on_auth_user_created()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    begin
      insert into public.profiles (%I) values (new.id)
      on conflict (%I) do nothing;
      return new;
    end;
    $body$
  $fn$, pk_col, pk_col);

  execute 'drop trigger if exists on_auth_user_created_trg on auth.users';
  execute 'create trigger on_auth_user_created_trg after insert on auth.users for each row execute function public.on_auth_user_created()';

  -- Backfill: ensure every existing auth.users row has a profile row.
  execute format($bf$
    insert into public.profiles (%I)
    select id from auth.users
    on conflict (%I) do nothing
  $bf$, pk_col, pk_col);

  -- Helper RPCs so the API doesn't have to know which PK column the live
  -- table uses. SECURITY DEFINER + filter on auth.uid() keeps each user
  -- scoped to their own row regardless of RLS.

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

