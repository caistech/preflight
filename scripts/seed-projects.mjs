#!/usr/bin/env node
/**
 * Seed Lot 442 Seafields and Lot 91 Wavecrest as starter testbed projects.
 *
 * Run:
 *   node scripts/seed-projects.mjs
 *
 * Idempotent — uses upsert on project slug. Re-running with the same .env.local
 * is safe; it won't duplicate.
 */

import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

async function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env.local');
  const raw = await fs.readFile(envPath, 'utf-8');
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

// Pack definitions — mirror lib/rules/packs/*.ts. Inline here so a fresh
// checkout can seed without compiling TypeScript. If the canonical packs
// in lib/rules/packs/ change, regenerate the matching constants below.
//
// Pack selection logic mirrors selectSeedRules() in lib/rules/seed-rules.ts:
//   universal  — always
//   multi-unit — when unit_count > 1 or has_multi_unit_site_plan === 'true'
//   modularwa  — when builder === 'ModularWA'  (currently empty; see
//                supabase/migrations/0009_modularwa_register_update.sql)

const UNIVERSAL_PACK = [
  {
    requirement:
      'All level values on the drawing set must use the SAME datum reference. Mixing AHD-converted FFL/FCL values with assumed-datum contour levels is a hard-fail — produces misleading readings (e.g. a ~38m stilt where there is actually a ~600mm pad).',
    source: 'Project history — partial AHD conversions caught in prior reviews; datum inconsistency is a recurring pattern',
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Look at the level values on this drawing set: FFL, FCL, NGL, and any RL contour heights on the site plan or location plan. Is there an internal inconsistency between datum systems — for example FFL/FCL values in the 40–50m range (suggesting AHD) sitting alongside contour levels in the 9–11m range (suggesting assumed datum)? Answer pass / fail / unsure with a one-sentence reason. Cite specific values if you find a mismatch. Do NOT recommend which datum to use — that is a project-owner decision.',
      context_hints: ['FFL', 'FCL', 'NGL', 'AHD', 'datum', 'RL', 'contour'],
      use_kb_retrieval: true,
      max_answer_chars: 500,
    },
    severity: 'hard-fail',
  },
  {
    requirement:
      'The DATUM note (typically in the title block or bottom-right of the sheet) must accurately describe the datum used for the level values shown on the drawing. A note that says "All levels shown are assumed datum. Add Xm to convert to AHD" is invalid if FFL/FCL values are already shown in AHD.',
    source: 'Project history — DATUM note inaccuracy is a recurring pattern when level conversions are partial',
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Find the DATUM note on this drawing (typically in or near the title block, bottom-right). Does the note accurately describe what is shown on the drawing? If the note says levels are in assumed datum, are the FFL/FCL values actually in the assumed range? If the note says levels are in AHD, are they in the AHD range? Answer pass / fail / unsure with a one-sentence reason quoting the DATUM note and a sample FFL value. Do NOT recommend a rewrite of the note — flag the discrepancy for human review only.',
      context_hints: ['DATUM', 'AHD', 'assumed', 'convert', 'FFL'],
      use_kb_retrieval: true,
      max_answer_chars: 500,
    },
    severity: 'review',
  },
  {
    requirement:
      'The revision-history line in the title block must accurately describe what changed in the current revision. Generic claims like "Datum conversion — all levels revised to AHD" must match what is actually on the drawing; a partial conversion described as complete is a fail.',
    source: 'Project history — revision-history mis-description is a recurring pattern',
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Find the revision-history block on this drawing (usually in or above the title block). Read the description for the latest revision. Does that description accurately reflect what is shown on the drawing? Examples of misalignment to flag: revision says "all levels revised to AHD" but contour levels are still in assumed datum; revision says "DATUM note added" but no DATUM note is visible; revision says "Unit numbering corrected" but the letterbox still shows duplicates. When the revision lists elements (e.g. "added carport and verandah to elevations") and the extracted text contains both those element labels and elevation-sheet markers (E1/E2/E3/E4 or "ELEVATION"), treat the claim as confirmed (pass). Answer pass / fail / unsure with a one-sentence reason. Do NOT rewrite the revision line for the drafter.',
      context_hints: ['REVISION', 'REV ', 'revision history', 'DATUM', 'AHD', 'ELEVATION', 'E1', 'E2', 'E3', 'E4'],
      use_kb_retrieval: true,
      max_answer_chars: 500,
    },
    severity: 'review',
  },
  {
    requirement:
      'Each lot boundary should be annotated. If a boundary has a bearing/distance but no street name, flag for human review (the tool does not supply the street name).',
    source:
      'Project history — wrong street name once propagated from the wrong source; tool must not become a new wrong source',
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Look at the extracted text excerpts that reference lot boundaries. For each boundary that has a bearing/distance value, is there an adjacent street name annotation? Answer pass / fail / unsure. If fail, list the boundary that is missing a street name. Do NOT suggest what the street name should be — that is for the human reviewer.',
      context_hints: ['boundary', 'bearing', 'street'],
      use_kb_retrieval: false,
      max_answer_chars: 400,
      requires_geometric_reasoning: true,
    },
    severity: 'review',
  },
  {
    requirement: 'A crossover annotation should be present and on the correct road reserve.',
    source: 'Council audit pattern — crossover off wrong reserve flagged in prior submissions',
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Look at the extracted text excerpts. Is a crossover annotated, and does it appear to be on the correct road reserve given the project address and orientation? Answer pass / fail / unsure with a one-sentence reason. Unsure is the right answer if the geometry cannot be determined from extracted text alone.',
      context_hints: ['crossover', 'driveway', 'road reserve'],
      use_kb_retrieval: true,
      max_answer_chars: 400,
      requires_geometric_reasoning: true,
    },
    severity: 'review',
  },
];

const MULTI_UNIT_PACK = [
  {
    requirement:
      'The letterbox bank on the fencing/site sheet must contain one cell per unit, with no duplicates and none missing — exactly the {1..N} set (or the project_units active set when present). A bank that shows UNIT 4 twice and no UNIT 8 is a hard-fail.',
    source: 'Council audit pattern — duplicate/missing letterbox cells flagged in prior submissions (e.g. Lot 442 A110: UNIT 4 duplicated, UNIT 8 missing)',
    check_type: 'logic-rule',
    check_spec: {
      kind: 'logic-rule',
      logic: 'unit_numbering_set',
      params: { expected_count: 0 }, // filled in below from facts.unit_count
      when_facts: { has_multi_unit_site_plan: 'true' },
    },
    severity: 'hard-fail',
  },
  {
    requirement:
      'On a site-wide sheet (showing multiple units), the title block must reflect the full scope — not a single unit. A title block reading "UNIT 1 - 2x1 DWELLING (UNIT 1)" on a sheet that depicts the whole subdivision is a hard-fail; the title block must describe the site-wide scope instead.',
    source: 'F2K drafting standard',
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        "For each candidate sheet listed in the pre-scoping block above, read its title block (the CLIENT / ADDRESS / HOUSE TYPE labels — usually near the bottom of the page). Decide whether the title-block scope (e.g. 'UNIT 1 - 2x1 DWELLING (UNIT 1)') matches the scope of what the sheet depicts (a single unit vs the whole site). FAIL when at least one site-wide candidate sheet carries a single-unit title block — name each failing sheet by its sheet_id (e.g. A109). PASS only when every candidate sheet's title-block scope matches what's on the sheet. UNSURE if the title-block text isn't recoverable from the excerpts. Do NOT propose a corrected title — that's for the drafter.",
      context_hints: ['title block', 'CLIENT', 'ADDRESS', 'HOUSE TYPE', 'UNIT', 'DWELLING', 'SHEET', 'PROJECT NO', 'SCALE', 'FENCING PLAN', 'SITE PLAN'],
      use_kb_retrieval: false,
      max_answer_chars: 400,
      pre_scope: 'site_wide_sheets',
    },
    severity: 'hard-fail',
  },
];

const MODULARWA_PACK = [];

function selectSeedRules(factsMap) {
  const out = [...UNIVERSAL_PACK];
  const isMultiUnit =
    factsMap.has_multi_unit_site_plan === 'true' ||
    Number(factsMap.unit_count ?? 0) > 1;
  if (isMultiUnit) out.push(...MULTI_UNIT_PACK);
  if (factsMap.builder === 'ModularWA') out.push(...MODULARWA_PACK);
  return out;
}

const PROJECTS = [
  {
    slug: 'lot-442-seafields',
    name: 'Lot 442 Seafields',
    owner_label: 'F2K',
    drafter_label: 'ModularWA',
    council: 'City of Greater Geraldton',
    description:
      'Modular dwelling subdivision, 8 units, slab-on-biscuit footing system. F2K + ModularWA workflow.',
    facts: [
      { key: 'footing_system', value: 'slab-on-biscuit', source: 'Project definition' },
      { key: 'unit_count', value: '8', source: 'Project definition' },
      { key: 'has_multi_unit_site_plan', value: 'true', source: 'Project definition' },
      { key: 'sheet_is_site_wide', value: 'true', source: 'Project definition (applies to overview sheet)' },
      { key: 'address_summary', value: 'Lot 442 (#31) Half Moon Drive, Geraldton WA', source: 'Project definition' },
    ],
  },
  {
    slug: 'lot-91-wavecrest',
    name: 'Lot 91 Wavecrest',
    owner_label: 'F2K',
    drafter_label: 'TBC',
    council: 'Shoalhaven City Council',
    description:
      'Single-dwelling site, brick-veneer construction. F2K project; drafter firm to be confirmed.',
    facts: [
      { key: 'footing_system', value: 'concrete-strip', source: 'Project definition' },
      { key: 'unit_count', value: '1', source: 'Project definition' },
      { key: 'has_multi_unit_site_plan', value: 'false', source: 'Project definition' },
      { key: 'sheet_is_site_wide', value: 'true', source: 'Project definition' },
      { key: 'address_summary', value: 'Lot 91, Wavecrest Estate', source: 'Project definition' },
    ],
  },
];

async function main() {
  const env = await loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env in .env.local');

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const p of PROJECTS) {
    console.log(`\n== Seeding ${p.name} (${p.slug}) ==`);

    // 1. Upsert project
    const { data: proj, error: projErr } = await db
      .from('projects')
      .upsert(
        {
          slug: p.slug,
          name: p.name,
          owner_label: p.owner_label,
          drafter_label: p.drafter_label,
          council: p.council,
          description: p.description,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'slug' }
      )
      .select('id')
      .single();
    if (projErr || !proj) {
      console.error(`  ✗ project upsert failed: ${projErr?.message}`);
      continue;
    }
    console.log(`  ✓ project id: ${proj.id}`);

    // 2. Upsert facts
    for (const f of p.facts) {
      const { error } = await db
        .from('project_facts')
        .upsert(
          {
            project_id: proj.id,
            key: f.key,
            value: f.value,
            source: f.source,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'project_id,key' }
        );
      if (error) console.warn(`  ⚠ fact ${f.key}: ${error.message}`);
      else console.log(`  ✓ fact ${f.key} = ${f.value}`);
    }

    // 3. Replace register
    const factsMap = Object.fromEntries(p.facts.map((f) => [f.key, f.value]));
    const unitCount = Number(factsMap.unit_count ?? 0);
    const rules = selectSeedRules(factsMap);

    // Wipe existing seed rows for this project so re-running this seed
    // doesn't accumulate duplicates. Match on the union of source strings
    // across every pack — covers projects that previously got rules from
    // a wider pack than they qualify for now. Project-specific rows added
    // manually are NOT wiped (they have a different source pattern).
    const allPackSources = Array.from(
      new Set([...UNIVERSAL_PACK, ...MULTI_UNIT_PACK, ...MODULARWA_PACK].map((r) => r.source))
    );
    await db
      .from('register_rows')
      .delete()
      .eq('project_id', proj.id)
      .in('source', allPackSources);

    for (const r of rules) {
      let spec = r.check_spec;
      if (spec.kind === 'logic-rule' && spec.logic === 'unit_numbering_set') {
        spec = { ...spec, params: { ...spec.params, expected_count: unitCount } };
      }
      const { error } = await db.from('register_rows').insert({
        project_id: proj.id,
        requirement: r.requirement,
        source: r.source,
        check_type: r.check_type,
        check_spec: spec,
        severity: r.severity,
        active: true,
      });
      if (error) console.warn(`  ⚠ register row "${r.requirement.slice(0, 40)}...": ${error.message}`);
    }
    console.log(`  ✓ register seeded (${rules.length} rows from packs: universal${factsMap.has_multi_unit_site_plan === 'true' || Number(factsMap.unit_count ?? 0) > 1 ? ' + multi-unit' : ''}${factsMap.builder === 'ModularWA' ? ' + modularwa' : ''})`);
  }

  console.log('\n✅ Seed complete.');
  console.log('Next: sign in at /login, click into each project, generate a drafter link.');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
