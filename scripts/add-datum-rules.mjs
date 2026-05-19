#!/usr/bin/env node
/**
 * One-shot:
 *   1. Ingest the Dennis → Zulz Rev H email (18 May 2026) into Lot 442's KB
 *      as a planner-letter kind so the LLM can retrieve it during manual-checks
 *   2. Add 3 datum-related register rows to Lot 442 Seafields:
 *      - datum consistency (hard-fail)
 *      - DATUM note accuracy (review)
 *      - revision-history accuracy (review)
 *
 * Each rule is a manual-check with use_kb_retrieval: true so it pulls
 * relevant context from the ingested email + any future planner letters.
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

const EMAIL_TITLE = 'Dennis → Zulz/Luke (Unison) — Rev H datum-conversion issues — 18 May 2026';
const EMAIL_CONTENT = `From: Dennis McMahon, F2K
To: Zulz, Luke (Unison Modular)
Date: 18 May 2026
Subject: Luke, Zulz RE Lot 442 Status 18 May 2025

Hi Zulz, Luke,

Thanks Zulz — quick turnaround on Rev H, appreciated. Before we treat it as the working drawing, two things to flag.

1. REV H IS PENDING

The datum question with CGG is still open. Peter Wilks is considering whether CGG will accept the DA submission on the assumed-datum levels tied to the Quantum survey, with AHD conditioned at building permit — or whether AHD is required on the DA drawings. Kathryn Jackson's planning-compliance view is that assumed datum is generally acceptable in this situation; Brad Harris's engineering-conservative view is that AHD is the safer default. Peter has the casting vote.

Until Peter answers, Rev G stands as the working drawing.

2. WHEN WE DO PROCEED, REV H NEEDS TO BE INTERNALLY CONSISTENT

The conversion math is correct — +37.84m to each value, tied to the Quantum TBM at AHD RL 47.84m. That part is fine.

However, the conversion has only been applied to the FFL and FCL values (e.g. Unit 1 now reads FFL 48.44, FCL 47.89). The survey contour levels around the site plan and location plan (10.27, 10.10, 9.98, 9.87, etc.) have not been converted — they remain in assumed datum. That creates an internal inconsistency: a reader sees Unit 1 FFL at 48.44 RL sitting next to a natural ground level marked 10.10, which reads as a 38-metre stilt rather than a ~600mm pad.

Two flow-on items follow:

- The DATUM note in the bottom-right reads 'All levels shown are assumed datum. Add 37.84m to convert to AHD.' That is no longer true — the FFL/FCL values have already been converted.
- The revision-history line in the title block reads 'Datum conversion — all levels revised to AHD.' Also not accurate to what is actually on the drawing.

When we do proceed (whichever way Peter directs), the drawing needs to be internally consistent end-to-end:

- If AHD is required: every level converted — site plan contours, location plan contours, FFLs, FCLs, NGLs. DATUM note rewritten to 'All levels in AHD. Refer Quantum Surveys Drawing 25345FS01-3D AHD, dated 12 January 2026.'
- If assumed datum is accepted by CGG: FFL/FCL values reverted to assumed (Unit 1 back to FFL 10.60, FCL 10.05, etc.). DATUM note retained as it stands. Revision-history line updated to something like 'Datum reference note added. All levels remain in assumed datum tied to Quantum AHD survey via TBM.'

3. TO DO NOW

Hold Rev H internally. Rev G remains the working drawing. Once Peter answers, we will action a single clean revision that is internally consistent.

Dennis
DENNIS PATRICK MCMAHON
Factory2Key | Global-BuildTech | Corporate AI Solutions`;

const NEW_RULES = [
  {
    requirement:
      'All level values on the drawing set must use the SAME datum reference. Mixing AHD-converted FFL/FCL values (typically in the 40–50m range for this project) with assumed-datum contour levels (typically in the 9–11m range) is a hard fail — it produces a misleading reading of a ~38m stilt where there is actually a ~600mm pad.',
    source:
      'Project history — Rev H 2026-05-18 partial-AHD-conversion error caught by F2K review (see Dennis→Zulz email in KB)',
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Look at the level values on this drawing set: FFL, FCL, NGL, and any RL contour heights on the site plan or location plan. Is there an internal inconsistency between datum systems — for example FFL/FCL values in the 40–50m range (suggesting AHD) sitting alongside contour levels in the 9–11m range (suggesting assumed datum)? Answer pass / fail / unsure with a one-sentence reason. Cite specific values if you find a mismatch. Do NOT recommend which datum to use — that is a project-owner decision pending Council direction.',
      context_hints: ['FFL', 'FCL', 'NGL', 'AHD', 'datum', 'RL', 'contour'],
      use_kb_retrieval: true,
      max_answer_chars: 500,
    },
    severity: 'hard-fail',
  },
  {
    requirement:
      'The DATUM note (typically in the title block or bottom-right of the sheet) must accurately describe the datum used for the level values shown on the drawing. A note that says "All levels shown are assumed datum. Add 37.84m to convert to AHD" is invalid if FFL/FCL values are already shown in AHD.',
    source:
      'Project history — Rev H 2026-05-18 DATUM note inaccuracy caught by F2K review (see Dennis→Zulz email in KB)',
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Find the DATUM note on this drawing (typically in or near the title block, bottom-right). Does the note accurately describe what is shown on the drawing? Specifically: if the note says levels are in assumed datum, are the FFL/FCL values actually in the assumed range (typically 9–11m for this project)? If the note says levels are in AHD, are they in the AHD range (typically 40–50m for this project)? Answer pass / fail / unsure with a one-sentence reason quoting the DATUM note and a sample FFL value. Do NOT recommend a rewrite of the note — flag the discrepancy for human review only.',
      context_hints: ['DATUM', 'AHD', 'assumed', 'convert', 'FFL', 'add 37.84'],
      use_kb_retrieval: true,
      max_answer_chars: 500,
    },
    severity: 'review',
  },
  {
    requirement:
      'The revision-history line in the title block must accurately describe what changed in the current revision. Generic claims like "Datum conversion — all levels revised to AHD" must match what is actually on the drawing; a partial conversion described as complete is a fail.',
    source:
      'Project history — Rev H 2026-05-18 revision-history mis-description caught by F2K review (see Dennis→Zulz email in KB)',
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Find the revision-history block on this drawing (usually in or above the title block). Read the description for the latest revision. Does that description accurately reflect what is shown on the drawing? Examples of misalignment to flag: revision says "all levels revised to AHD" but contour levels are still in assumed datum; revision says "DATUM note added" but no DATUM note is visible; revision says "Unit numbering corrected" but the letterbox still shows duplicates. Answer pass / fail / unsure with a one-sentence reason. Do NOT rewrite the revision line for the drafter.',
      context_hints: ['REVISION', 'REV ', 'revision history', 'DATUM', 'AHD'],
      use_kb_retrieval: true,
      max_answer_chars: 500,
    },
    severity: 'review',
  },
];

async function main() {
  const env = await loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = env.OPENAI_API_KEY;
  if (!url || !key) throw new Error('Missing Supabase env in .env.local');
  if (!openaiKey) console.warn('  ⚠ OPENAI_API_KEY missing — KB chunks will be persisted without embeddings');

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: project, error: pErr } = await db
    .from('projects')
    .select('id')
    .eq('slug', 'lot-442-seafields')
    .single();
  if (pErr || !project) throw new Error('Lot 442 Seafields project not found');
  console.log('✓ project id:', project.id);

  // 1. Ingest the email as a KB document
  console.log('\nIngesting Rev H email into KB...');
  const { data: doc, error: docErr } = await db
    .from('kb_documents')
    .insert({
      project_id: project.id,
      title: EMAIL_TITLE,
      source_kind: 'planner-letter',
      source_ref: 'dennis@factory2key.com.au → zulz@unisonmodular.com 2026-05-18',
      content: EMAIL_CONTENT,
    })
    .select('id')
    .single();
  if (docErr || !doc) throw new Error('kb_documents insert failed: ' + docErr?.message);
  console.log('  ✓ kb_documents id:', doc.id);

  // Chunk + embed
  const TARGET = 2000, OVERLAP = 200;
  const chunks = [];
  for (let i = 0; i < EMAIL_CONTENT.length; ) {
    const end = Math.min(EMAIL_CONTENT.length, i + TARGET);
    chunks.push(EMAIL_CONTENT.slice(i, end));
    if (end >= EMAIL_CONTENT.length) break;
    i = end - OVERLAP;
  }
  console.log(`  → ${chunks.length} chunks`);

  const embeddings = [];
  if (openaiKey) {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: chunks }),
    });
    const j = await r.json();
    if (!r.ok) console.warn('  ⚠ embedding failed:', j.error?.message);
    else for (const item of j.data ?? []) embeddings.push(item.embedding);
    console.log(`  ✓ embedded ${embeddings.length}/${chunks.length} chunks`);
  }

  const chunkRows = chunks.map((c, i) => ({
    document_id: doc.id,
    project_id: project.id,
    content: c,
    embedding: embeddings[i] ?? null,
    tokens: Math.round(c.length / 4),
  }));
  const { error: chunkErr } = await db.from('kb_chunks').insert(chunkRows);
  if (chunkErr) console.warn('  ⚠ kb_chunks insert:', chunkErr.message);
  else console.log('  ✓ kb_chunks persisted');

  // 2. Insert the 3 new register rows (idempotent — skip if requirement already present)
  console.log('\nAdding register rows...');
  for (const r of NEW_RULES) {
    const { data: existing } = await db
      .from('register_rows')
      .select('id')
      .eq('project_id', project.id)
      .eq('source', r.source)
      .maybeSingle();
    if (existing) {
      console.log(`  ↻ already present, skipping: ${r.requirement.slice(0, 60)}…`);
      continue;
    }
    const { error: insErr } = await db.from('register_rows').insert({
      project_id: project.id,
      requirement: r.requirement,
      source: r.source,
      check_type: r.check_type,
      check_spec: r.check_spec,
      severity: r.severity,
      active: true,
    });
    if (insErr) console.warn(`  ⚠ insert failed: ${insErr.message}`);
    else console.log(`  ✓ added: ${r.requirement.slice(0, 60)}…`);
  }

  console.log('\n✅ Done. Re-run Rev K through the drafter portal to see the new rules fire.');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
