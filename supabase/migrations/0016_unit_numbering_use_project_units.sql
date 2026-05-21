-- ============================================================================
-- Flip the seeded unit_numbering_set rules on Lot 442 + Lot 91 to use
-- the typed project_units table instead of params.expected_count.
--
-- The rule engine supports both code paths (added in 2283b2f). Existing
-- rules use the count path; flipping them here means the next triage
-- queries project_units directly, so the operator can model real-world
-- unit sets that aren't contiguous (e.g. ModularWA skipping 13).
--
-- Defensive: only touches rules whose check_spec.logic = 'unit_numbering_set'
-- AND don't already have use_project_units set. Re-running is a no-op.
-- ============================================================================

update public.register_rows
   set check_spec = jsonb_set(
         check_spec,
         '{params,use_project_units}',
         'true'::jsonb,
         true
       ),
       updated_at = now()
 where project_id in (
         select id from public.projects
         where name ilike 'lot 442%' or name ilike 'lot 91%'
       )
   and check_spec->>'kind' = 'logic-rule'
   and check_spec->>'logic' = 'unit_numbering_set'
   and (check_spec->'params'->>'use_project_units') is distinct from 'true';
