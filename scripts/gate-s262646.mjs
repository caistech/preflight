#!/usr/bin/env node
// THE S262646 ACCURACY GATE — is the saved reading of the Lot 91 carport set good enough to keep?
//
//   node --env-file=.env.local scripts/gate-s262646.mjs [reader-version]
//
// A saved reading makes every run give the same answer, including the same mistakes
// (lib/pdf/sheet-readings.ts). This checks the readings saved for the nine S262646
// sheets contain the notes a check on that set depends on. Run it after the first check
// with a new reader version.
//
//   PASS → keep the readings.
//   FAIL → re-read (POST check-runs with reread: true) and run this again. If a note is
//          still missing, reading sheets in sections (TODOS.md) comes back into scope.
//
// Exit code 0 on pass, 1 on fail, 2 when there is nothing to check.

import { createClient } from '@supabase/supabase-js';

// Must match READER_VERSION in lib/pdf/transcribe.ts when no version is given.
const READER_VERSION = process.argv[2] ?? 'pdf-document-temp0-2026-11-19';
const EXPECTED_SHEETS = 9;

// Each note as it is printed on the sheet (confirmed against the drawings, 2026-11-19),
// matched loosely so case and spacing do not matter.
const REQUIRED = [
  { what: 'timber joist note (S-031/S-004)', pattern: /50\s*x\s*150\s*joist/i },
  { what: 'ledger fixing to the existing wall (S-031 detail 3)', pattern: /ledge[r]?\s+(member|channel)/i },
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials missing');
const db = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await db
  .from('sheet_readings')
  .select('file_name, text, created_at')
  .eq('reader_version', READER_VERSION)
  .ilike('file_name', 'S262646%');
if (error) throw new Error(error.message);

const readings = data ?? [];
console.log(`Reader ${READER_VERSION}: ${readings.length} saved S262646 sheet reading(s).`);
if (readings.length === 0) {
  console.log('Nothing to check — run a check on the S262646 set first.');
  process.exit(2);
}
if (readings.length < EXPECTED_SHEETS) {
  console.log(`Only ${readings.length} of ${EXPECTED_SHEETS} sheets have a saved reading.`);
}

const all = readings.map((r) => r.text).join('\n');
let failed = false;
for (const req of REQUIRED) {
  const hit = readings.find((r) => req.pattern.test(r.text));
  console.log(`${hit ? 'PASS' : 'FAIL'}  ${req.what}${hit ? ` — on ${hit.file_name}` : ''}`);
  if (!hit) failed = true;
}
const illegible = (all.match(/\[illegible\]/gi) ?? []).length;
console.log(`[illegible] markers across the set: ${illegible}`);

process.exit(failed ? 1 : 0);
