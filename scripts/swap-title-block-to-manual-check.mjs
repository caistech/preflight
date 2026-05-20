#!/usr/bin/env node
/**
 * Replace the existing title_block_count logic-rule on every project with a
 * stronger manual-check version. The deterministic logic-rule depends on a
 * 'SHEET NO' proxy that doesn't survive in most CAD-PDFs; the manual-check
 * version asks the LLM the actual question — does a title block on this
 * sheet describe a single unit while the sheet itself shows multiple?
 *
 * Idempotent — finds rows by source='F2K drafting standard' and check_type=
 * 'logic-rule' and updates them in place.
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

const NEW_REQUIREMENT =
  'On a site-wide sheet (showing multiple units), the title block must reflect the full scope — not a single unit. A title block reading "UNIT 1 - 2x1 DWELLING (UNIT 1)" on a sheet that depicts all 8 units is a hard-fail; the title block must describe the site-wide scope instead.';

const NEW_CHECK_SPEC = {
  kind: 'manual-check',
  prompt:
    "Look at the title block on this sheet (usually bottom-right corner — contains project name, sheet number, scale, etc.). Read what scope the title block describes — does it name a single unit (e.g. 'UNIT 1', '2x1 DWELLING (UNIT 1)') or the full site? Then check what the sheet itself depicts — does it show multiple units / a site-wide plan / multiple buildings? Answer pass / fail / unsure. FAIL = single-unit title block on a sheet showing multiple units (or vice versa). PASS = title block scope matches what's on the sheet. UNSURE = cannot determine from extracted text. Do NOT recommend a new title; flag for human review only.",
  context_hints: ['title block', 'UNIT', 'DWELLING', 'SHEET', 'PROJECT NO', 'SCALE'],
  use_kb_retrieval: false,
  max_answer_chars: 400,
};

async function main() {
  const env = await loadEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error } = await db
    .from('register_rows')
    .select('id, project_id, requirement, source, check_type, severity, projects(name)')
    .eq('source', 'F2K drafting standard')
    .eq('check_type', 'logic-rule');
  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }
  console.log(`Found ${rows?.length ?? 0} title-block logic-rule rows to convert.`);

  for (const r of rows ?? []) {
    const { error: upErr } = await db
      .from('register_rows')
      .update({
        requirement: NEW_REQUIREMENT,
        check_type: 'manual-check',
        check_spec: NEW_CHECK_SPEC,
        severity: 'hard-fail',
      })
      .eq('id', r.id);
    if (upErr) {
      console.warn(`  ✗ ${r.projects?.name}: ${upErr.message}`);
    } else {
      console.log(`  ✓ ${r.projects?.name}: converted to manual-check (hard-fail)`);
    }
  }

  console.log('\nDone. Title-block check is now LLM-backed across projects.');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
