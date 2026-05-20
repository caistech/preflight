#!/usr/bin/env node
/**
 * One-shot: for each (project_id, title) group with >1 kb_documents row,
 * keep the most-recently-created row and delete the rest. Chunks cascade.
 * Idempotent — re-running is a no-op once it converges.
 */

import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

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

  const { data: rows } = await db
    .from('kb_documents')
    .select('id, project_id, title, source_kind, source_ref, created_at')
    .order('created_at', { ascending: false });

  // Group by (project_id, title)
  const groups = new Map();
  for (const r of rows ?? []) {
    const key = `${r.project_id}::${r.title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  let totalDeleted = 0;
  for (const [key, items] of groups) {
    if (items.length <= 1) continue;
    // Sorted desc by created_at — keep [0], delete the rest
    const keep = items[0];
    const toDelete = items.slice(1);
    console.log(`\n[${keep.project_id.slice(0, 8)}…] "${keep.title}": keeping ${keep.id.slice(0, 8)}…, deleting ${toDelete.length}`);
    for (const d of toDelete) {
      const { error } = await db.from('kb_documents').delete().eq('id', d.id);
      if (error) console.warn(`  ✗ ${d.id.slice(0, 8)}…: ${error.message}`);
      else {
        console.log(`  ✓ deleted ${d.id.slice(0, 8)}… (created ${d.created_at})`);
        totalDeleted++;
      }
    }
  }

  console.log(`\nTotal duplicate rows deleted: ${totalDeleted}`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
