import type { RegisterRow } from './types';
import { UNIVERSAL_PACK } from './packs/universal';
import { MULTI_UNIT_PACK } from './packs/multi-unit';
import { MODULARWA_PACK } from './packs/modularwa';

/**
 * Seed rules — entrypoint that composes layered packs into the starter
 * register for any new project.
 *
 * Three reusability tiers:
 *   - UNIVERSAL_PACK   — every DA drawing set, single or multi-unit
 *   - MULTI_UNIT_PACK  — gated on unit_count > 1 / has_multi_unit_site_plan
 *   - MODULARWA_PACK   — gated on builder === 'ModularWA'
 *
 * Council-, LDP-, and project-specific rules do NOT belong here. They are
 * added per-project by the operator (via the register UI) or by a one-off
 * migration (see supabase/migrations/0009_modularwa_register_update.sql for
 * the canonical pattern).
 *
 * Backward compatibility: `SEED_RULES` is preserved as the universal pack
 * only. `app/api/projects/route.ts` runs at project-creation with no facts
 * available, so it seeds universal-only and the operator opts into the
 * other packs later. `instantiateSeedRules()` keeps its signature; given
 * facts it returns the right union with `expected_count` substituted.
 */

export { UNIVERSAL_PACK, MULTI_UNIT_PACK, MODULARWA_PACK };

/** Universal rules — seeded into every new project. */
export const SEED_RULES: Omit<RegisterRow, 'id' | 'project_id'>[] = UNIVERSAL_PACK;

export interface PackSelectorFacts {
  unit_count?: number | string;
  has_multi_unit_site_plan?: string;
  builder?: string;
}

function isMultiUnit(facts: PackSelectorFacts): boolean {
  if (facts.has_multi_unit_site_plan === 'true') return true;
  const n = Number(facts.unit_count ?? 0);
  return Number.isFinite(n) && n > 1;
}

/**
 * Return the union of packs that apply to a project with the given facts.
 * Use this when you have facts at the call site (e.g. the seed script,
 * or a future "apply pack" API). Project creation runs before facts exist
 * and should keep using SEED_RULES (universal-only) directly.
 */
export function selectSeedRules(
  facts: PackSelectorFacts
): Omit<RegisterRow, 'id' | 'project_id'>[] {
  const out: Omit<RegisterRow, 'id' | 'project_id'>[] = [...UNIVERSAL_PACK];
  if (isMultiUnit(facts)) out.push(...MULTI_UNIT_PACK);
  if (facts.builder === 'ModularWA') out.push(...MODULARWA_PACK);
  return out;
}

/**
 * Apply seed-row substitutions for a specific project — fills in
 * expected_count etc from the project's facts. Returns rows ready to
 * insert into register_rows.
 */
export function instantiateSeedRules(
  projectId: string,
  facts: Record<string, string>
): Omit<RegisterRow, 'id'>[] {
  const rules = selectSeedRules({
    unit_count: facts.unit_count,
    has_multi_unit_site_plan: facts.has_multi_unit_site_plan,
    builder: facts.builder,
  });
  return rules.map((r) => {
    let spec = r.check_spec;
    if (spec.kind === 'logic-rule' && spec.logic === 'unit_numbering_set') {
      const count = Number(facts.unit_count ?? 0);
      spec = { ...spec, params: { ...spec.params, expected_count: count } };
    }
    return { ...r, check_spec: spec, project_id: projectId };
  });
}
