#!/usr/bin/env node
/**
 * One-shot DB cleanup after a robocopy left CQR's migration on Preflight's
 * brand-new Supabase project. Drops CQR tables + clears migration history
 * so `supabase db push` can re-apply 0001_init.sql cleanly.
 *
 * Delete after first successful re-push.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

async function main() {
  const env = await loadEnv();
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split('.')[0];
  const pat = process.env.SUPABASE_ACCESS_TOKEN;
  if (!pat) {
    console.error('SUPABASE_ACCESS_TOKEN env var required (Supabase Management API PAT)');
    process.exit(1);
  }

  const sql = `
DROP TABLE IF EXISTS public.slack_drafts CASCADE;
DROP TABLE IF EXISTS public.slack_channels CASCADE;
DROP TABLE IF EXISTS public.slack_workspaces CASCADE;
DROP TABLE IF EXISTS public.kb_chunks CASCADE;
DROP TABLE IF EXISTS public.kb_documents CASCADE;
DROP TABLE IF EXISTS public.audit_log CASCADE;
DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('0001','0002','0003');
SELECT 1 AS ok;
`;

  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.text();
  console.log('status', r.status, body.slice(0, 500));
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
