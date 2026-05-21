-- ============================================================================
-- Tag PF-442-SV-001 (SV 2m exclusion-zone) with requires_geometric_reasoning
-- so runManualCheck prepends the honest "you cannot measure distances from
-- text" hint to the LLM prompt. This rule should land in "needs eyes" by
-- design — distances aren't in the PDF text layer.
-- ============================================================================

update public.register_rows
   set check_spec = jsonb_set(check_spec, '{requires_geometric_reasoning}', 'true'::jsonb, true),
       updated_at = now()
 where check_spec->>'external_id' = 'PF-442-SV-001'
   and (check_spec->>'requires_geometric_reasoning') is distinct from 'true';
