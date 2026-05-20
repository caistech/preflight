#!/usr/bin/env node
/**
 * Copy the OAuth tokens from Lot 442's drive_connections into a new
 * Lot 91 drive_connections row + set the operator-provided folder_id.
 * Drive scope is account-wide so the same refresh_token works for both
 * projects' files.
 *
 * Then trigger a sync pass for Lot 91 immediately.
 */

import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const LOT_91_FOLDER_ID = '1T6IvFZ0Gkxp370l63DZV7PgePRPpoOZ5';

async function loadEnv() {
  const raw = await fs.readFile(path.join(PROJECT_ROOT, '.env.local'), 'utf-8');
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

async function main() {
  const env = await loadEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: l442 } = await db.from('projects').select('id').eq('slug', 'lot-442-seafields').single();
  const { data: l91 } = await db.from('projects').select('id').eq('slug', 'lot-91-wavecrest').single();
  if (!l442 || !l91) throw new Error('Could not find both projects');

  const { data: src } = await db
    .from('drive_connections')
    .select('encrypted_tokens, email')
    .eq('project_id', l442.id)
    .single();
  if (!src) throw new Error('Lot 442 Drive connection not found — connect Drive there first');

  console.log('Copying tokens from Lot 442 (connected as ' + src.email + ') to Lot 91...');

  const { error: upErr } = await db.from('drive_connections').upsert(
    {
      project_id: l91.id,
      encrypted_tokens: src.encrypted_tokens,
      email: src.email,
      folder_id: LOT_91_FOLDER_ID,
      paused: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id' }
  );
  if (upErr) throw new Error('Upsert failed: ' + upErr.message);
  console.log('  ✓ Lot 91 drive_connections set with folder_id ' + LOT_91_FOLDER_ID);

  // Trigger sync via the deployed cron endpoint with the cron secret
  console.log('\nTriggering immediate sync for both projects via cron...');
  const appUrl = (env.NEXT_PUBLIC_APP_URL ?? 'https://preflight-phi.vercel.app').replace(/\/$/, '');
  const r = await fetch(`${appUrl}/api/cron/drive-sync`, {
    headers: { 'x-cron-secret': env.CRON_SECRET },
  });
  const j = await r.json().catch(() => ({}));
  console.log('  status', r.status);
  for (const result of j.results ?? []) {
    console.log('  · project_id ' + result.project_id + ' → ' + (result.result?.message ?? result.error ?? 'no message'));
  }

  console.log('\nDone. Check /projects/lot-91-wavecrest — KB should populate within ~30s.');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
