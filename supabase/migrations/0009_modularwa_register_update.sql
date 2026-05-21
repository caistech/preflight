-- ============================================================================
-- 2026-05-21 ModularWA register update for Lot 442 + Lot 91
--
-- Lands three operator-provided rules and retires one mis-classified rule
-- that fired a false hard-fail on the 21 May 2026 04:23 UTC triage run.
--
-- Rules:
--   PF-442-SV-001       SV symbol 2m exclusion-zone check (manual-check)
--   PF-442-FOUND-002    Foundation-system reference (project_facts entries)
--   PF-442-A107-003     Orphan section-callout completeness (logic-rule)
--
-- Source: dennis@corporateaisolutions.com 2026-05-21, structured rule data
--         derived from ModularWA A107 SV detail + Sion Williams (MWA Site
--         Install Manager) verbal confirmation 2026-05-21.
-- ============================================================================

-- Target both Lot 442 (Seafields) and Lot 91 (Wavecrest) by name match. Done
-- as a temp scratch list so subsequent statements can reference it.
do $$
declare
  pid uuid;
  rid uuid;
begin
  -- ------------------------------------------------------------------------
  -- 1) Retire the misfiring rule on every targeted project.
  --    We identify the bad rule by the requirement text shipped in the
  --    canonical seed (bc49d33). Setting active=false rather than DELETE so
  --    the audit trail and any past check_results stay intact.
  -- ------------------------------------------------------------------------
  for pid in
    select id from public.projects
    where name ilike 'lot 442%' or name ilike 'lot 91%'
  loop
    update public.register_rows
      set active = false, updated_at = now()
      where project_id = pid
        and active = true
        and requirement ilike '%sub-floor vent%'
        and requirement ilike '%slab-on-biscuit%';
  end loop;

  -- ------------------------------------------------------------------------
  -- 2) Insert PF-442-SV-001 — SV symbol 2m exclusion-zone check.
  -- ------------------------------------------------------------------------
  for pid in
    select id from public.projects
    where name ilike 'lot 442%' or name ilike 'lot 91%'
  loop
    if not exists (
      select 1 from public.register_rows
      where project_id = pid
        and check_spec->>'external_id' = 'PF-442-SV-001'
    ) then
      insert into public.register_rows
        (project_id, requirement, source, source_url, check_type, check_spec, severity, active)
      values (
        pid,
        'SV symbols on A102 floor plan and A104 electrical plan must each sit at least 2000mm (centre-to-centre) from the rangehood vent location and from the gas regulator location if applicable.',
        'A107 SV Sub Floor Ventilation detail at 1:20 — note: "Sub-floor vent to have a 2m radius exclusion zone from centre of hood & gas reg location"',
        null,
        'manual-check',
        jsonb_build_object(
          'kind', 'manual-check',
          'external_id', 'PF-442-SV-001',
          'prompt', 'Looking at the floor plan (A102) and electrical plan (A104), do all SV (sub-floor vent) symbols sit at least 2000mm (centre-to-centre) from each RH (rangehood) symbol and from each gas regulator symbol if present? Answer pass only when every SV→RH and SV→gas-reg pair is clearly ≥2000mm. Answer fail when at least one pair is clearly under 2000mm. Answer unsure when SV/RH/gas-reg symbol positions cannot be reliably read from the extracted text. NEVER state the exact measured distance — that goes to human review.',
          'context_hints', jsonb_build_array('SV', 'sub-floor vent', 'subfloor vent', 'RH', 'range\\s*hood', 'rangehood', 'gas\\s*reg', 'gas regulator', '2000', '2m radius', 'exclusion zone', 'A102', 'A104', 'A107'),
          'use_kb_retrieval', false,
          'max_answer_chars', 240,
          'when_facts', jsonb_build_object('dwelling_type', 'mwa-2x1')
        ),
        'hard-fail',
        true
      );
    end if;
  end loop;

  -- ------------------------------------------------------------------------
  -- 3) Insert PF-442-A107-003 — orphan section-callout completeness.
  -- ------------------------------------------------------------------------
  for pid in
    select id from public.projects
    where name ilike 'lot 442%' or name ilike 'lot 91%'
  loop
    if not exists (
      select 1 from public.register_rows
      where project_id = pid
        and check_spec->>'external_id' = 'PF-442-A107-003'
    ) then
      insert into public.register_rows
        (project_id, requirement, source, source_url, check_type, check_spec, severity, active)
      values (
        pid,
        'Section callouts on any uploaded sheet (e.g. S1/A107, D3/A107, E1/A104) must reference sheets that are present in the uploaded drawing set. Orphan callouts indicate missing companion sheets.',
        'F2K drafting standard — orphan section references in a DA submission set are a known Council audit pattern (Peter Wilks CGG Lot 442 feedback on sub-floor enclosure).',
        null,
        'logic-rule',
        jsonb_build_object(
          'kind', 'logic-rule',
          'external_id', 'PF-442-A107-003',
          'logic', 'orphan_section_callouts',
          'params', jsonb_build_object('callout_regex', '[SDE]\d+/A\d{3}')
        ),
        'hard-fail',
        true
      );
    end if;
  end loop;

  -- ------------------------------------------------------------------------
  -- 4) Upsert project_facts for PF-442-FOUND-002 — foundation reference.
  --    These facts also serve as the when_facts gate for PF-442-SV-001.
  -- ------------------------------------------------------------------------
  for pid in
    select id from public.projects
    where name ilike 'lot 442%' or name ilike 'lot 91%'
  loop
    insert into public.project_facts (project_id, key, value, source, updated_at) values
      (pid, 'builder', 'ModularWA', 'PF-442-FOUND-002 (Sion Williams MWA, 2026-05-21)', now()),
      (pid, 'dwelling_type', 'mwa-2x1', 'PF-442-FOUND-002 (Sion Williams MWA, 2026-05-21)', now()),
      (pid, 'footing_system', 'modularwa-biscuit-footing', 'PF-442-FOUND-002 (Sion Williams MWA, 2026-05-21) — Ø600 × 150mm concrete biscuit footings, transportable concrete base', now()),
      (pid, 'sub_floor_void', 'no', 'PF-442-FOUND-002 — owner backfills perimeter post-install; no enclosed void', now()),
      (pid, 'sv_symbols_expected', 'yes', 'PF-442-FOUND-002 — SV symbols are correct for this dwelling type; they represent 100mm PVC vents in backfill terminating in a screened end cap', now())
    on conflict (project_id, key) do update
      set value = excluded.value,
          source = excluded.source,
          updated_at = excluded.updated_at;
  end loop;

  -- ------------------------------------------------------------------------
  -- 5) Audit trail. The do-block bypasses the audit_log RLS via service-role
  --    context when applied by supabase db push. Recording one entry per
  --    project so the operator can see when this migration landed.
  -- ------------------------------------------------------------------------
  for pid in
    select id from public.projects
    where name ilike 'lot 442%' or name ilike 'lot 91%'
  loop
    insert into public.audit_log (project_id, actor_id, action, payload, created_at)
    values (
      pid,
      null,
      'register_update_modularwa_2026_05_21',
      jsonb_build_object(
        'rules_added', jsonb_build_array('PF-442-SV-001', 'PF-442-A107-003'),
        'fact_keys_set', jsonb_build_array('builder', 'dwelling_type', 'footing_system', 'sub_floor_void', 'sv_symbols_expected'),
        'rule_retired', 'Subfloor vents must NOT appear ... slab-on-biscuit ...',
        'source', 'dennis@corporateaisolutions.com 2026-05-21'
      ),
      now()
    );
  end loop;
end$$;
