-- ============================================================================
-- Member-management RPC helpers — list memberships with auth emails
-- attached, look up a user by email, find a project owner count.
--
-- auth.users isn't reachable through PostgREST by default; these helpers
-- are SECURITY DEFINER so the API route can query them without escalating
-- the service client into the auth schema.
-- ============================================================================

-- list_project_members — returns memberships + email for the operator UI.
-- RLS via current_user_project_ids: the function returns nothing for
-- projects the caller isn't a member of.
create or replace function public.list_project_members(in_project_id uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  created_at timestamptz,
  is_self boolean
)
language sql stable security definer set search_path = public
as $$
  select pm.user_id, u.email::text, pm.role, pm.created_at, (pm.user_id = auth.uid()) as is_self
    from public.project_memberships pm
    join auth.users u on u.id = pm.user_id
   where pm.project_id = in_project_id
     and pm.project_id in (select public.current_user_project_ids())
   order by pm.created_at asc;
$$;

-- find_user_id_by_email — used by the Add Member flow. Returns null when
-- the email isn't a registered user. Definer-scoped so we don't have to
-- expose auth.users wholesale.
create or replace function public.find_user_id_by_email(in_email text)
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from auth.users where lower(email) = lower(in_email) limit 1;
$$;

-- count_project_owners — used for the "can't remove the last owner" check.
create or replace function public.count_project_owners(in_project_id uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.project_memberships
   where project_id = in_project_id and role = 'owner';
$$;

-- caller_is_project_owner — convenience for API-side authorization.
create or replace function public.caller_is_project_owner(in_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.project_memberships
    where project_id = in_project_id and user_id = auth.uid() and role = 'owner'
  );
$$;
