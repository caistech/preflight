-- ============================================================================
-- Backfill project_memberships for every existing auth.users × projects pair.
--
-- This unblocks the switch from service-client reads to RLS-scoped reads on
-- /projects. Without the backfill, switching to user-scoped reads would
-- show every existing operator an empty project list — they have no
-- memberships yet because membership wasn't enforced before today.
--
-- Single-operator MVP: every user is granted 'owner' on every project. When
-- a second operator joins, this stops being acceptable and we should
-- introduce per-project ACL UI. For now it's strictly additive.
-- ============================================================================

insert into public.project_memberships (project_id, user_id, role)
select p.id, u.id, 'owner'
  from public.projects p
 cross join auth.users u
on conflict (project_id, user_id) do nothing;
