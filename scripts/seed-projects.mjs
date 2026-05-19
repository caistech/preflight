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

// Seed register definition — kept inline here so a fresh checkout can seed
// without compiling TypeScript. Mirrors lib/rules/seed-rules.ts; if the
// canonical seed list grows, regenerate this constant.
const SEED_RULES = [
  {
    requirement:
      'Subfloor vents must NOT appear in the legend when the project uses a slab-on-biscuit footing system.',
    source:
      'Project definition — footing system is slab-on-biscuit, no subfloor void',
    check_type: 'text-rule',
    check_spec: {
      kind: 'text-rule',
      fail_if_found: true,
      regex: '\\bSUB-?\\s*FLOOR\\s+VENT(?:S|ING)?\\b',
      when_facts: { footing_system: 'slab-on-biscuit' },
    },
    severity: 'hard-fail',
  },
  {
    requirement:
      'The unit-numbering set on the site plan must be exactly {1..N} with no repeats, where N is the project unit_count.',
    source: 'Council audit pattern — repeated unit numbers flagged in prior submissions',
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
      'A site-wide sheet should contain exactly one title block; multiple usually indicates a single-unit drawing on a site-wide sheet.',
    source: 'F2K drafting standard',
    check_type: 'logic-rule',
    check_spec: {
      kind: 'logic-rule',
      logic: 'title_block_count',
      params: { expected: 1 },
      when_facts: { sheet_is_site_wide: 'true' },
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
    },
    severity: 'review',
  },
];

const PROJECTS = [
  {
    slug: 'lot-442-seafields',
    name: 'Lot 442 Seafields',
    owner_label: 'F2K',
    drafter_label: 'ModularWA',
    council: 'Wollongong City Council',
    description:
      'Modular dwelling subdivision, 8 units, slab-on-biscuit footing system. F2K + ModularWA workflow.',
    facts: [
      { key: 'footing_system', value: 'slab-on-biscuit', source: 'Project definition' },
      { key: 'unit_count', value: '8', source: 'Project definition' },
      { key: 'has_multi_unit_site_plan', value: 'true', source: 'Project definition' },
      { key: 'sheet_is_site_wide', value: 'true', source: 'Project definition (applies to overview sheet)' },
      { key: 'address_summary', value: 'Lot 442, Seafields Estate', source: 'Project definition' },
    ],
  },
  {
    slug: 'lot-91-wavecrest',
    name: 'Lot 91 Wavecrest',
    owner_label: 'Unison',
    drafter_label: 'Unison Drafting',
    council: 'Shoalhaven City Council',
    description:
      'Single-dwelling site, brick-veneer construction. Unison + Unison drafter workflow.',
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

    // Wipe existing seed rows for this project so re-running this seed
    // doesn't accumulate duplicates. Project-specific rows added manually
    // are NOT wiped (they have a different source pattern).
    await db
      .from('register_rows')
      .delete()
      .eq('project_id', proj.id)
      .in(
        'source',
        SEED_RULES.map((r) => r.source)
      );

    for (const r of SEED_RULES) {
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
    console.log(`  ✓ register seeded (${SEED_RULES.length} rows)`);
  }

  console.log('\n✅ Seed complete.');
  console.log('Next: sign in at /login, click into each project, generate a drafter link.');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
