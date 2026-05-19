#!/usr/bin/env node
/**
 * One-shot backfill — fetch existing inbound emails from Resend (which the
 * webhook didn't ingest because we didn't yet know to call /emails/inbound/{id}
 * for the body) and run them through the same persistInboundEmail pipeline.
 *
 * Pass the email_ids as args, or it picks them up from the Resend dashboard
 * by ID list embedded below.
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

// Inbound email IDs to backfill (from the Resend dashboard delivery logs)
const KNOWN_INBOUND_IDS = [
  'b277c060-e113-4a47-8652-94112608dc67', // twst 34 → lot-442-seafields@nexeukro
  // add others as needed
];

async function main() {
  const env = await loadEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const id of KNOWN_INBOUND_IDS) {
    console.log(`\n== ${id}`);
    const r = await fetch(`https://api.resend.com/emails/inbound/${id}`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
    if (!r.ok) { console.log('  ✗ fetch failed:', r.status); continue; }
    const full = await r.json();

    const toRaw = Array.isArray(full.to) ? full.to[0] : full.to;
    const local = (toRaw || '').split('@')[0]?.toLowerCase().trim();
    const { data: project } = await db.from('projects').select('id, name').eq('slug', local).maybeSingle();
    if (!project) { console.log(`  ✗ no project for slug "${local}"`); continue; }
    console.log(`  → ${project.name}`);

    const body = (full.text ?? '').trim();
    if (!body || body.length < 30) { console.log(`  ✗ body too short (${body.length} chars)`); continue; }

    // Persist raw inbound row (idempotent on message_id)
    const messageId = full.message_id || full.id || id;
    const { data: inboundRow } = await db.from('inbound_emails').upsert({
      project_id: project.id,
      message_id: messageId,
      from_address: full.from,
      to_address: toRaw,
      subject: full.subject,
      body_text: full.text,
      body_html: full.html,
      raw_payload: full,
      parsed: false,
    }, { onConflict: 'message_id' }).select('id').single();

    // Ingest to KB
    const { ingestKbDocument } = await import('../lib/kb/ingest.js').catch(() => null) ?? {};
    // The above .js import path won't work for TS modules — call the API directly instead
    // Inline minimal ingest:
    const { data: doc, error: docErr } = await db.from('kb_documents').insert({
      project_id: project.id,
      title: full.subject || `Email from ${full.from}`,
      source_kind: 'inbound-email',
      source_ref: full.from,
      content: body,
    }).select('id').single();
    if (docErr) { console.log('  ✗ kb_documents:', docErr.message); continue; }

    // Chunk + embed (simple inline, mirrors lib/kb/ingest.ts)
    const TARGET = 2000, OVERLAP = 200;
    const chunks = [];
    for (let i = 0; i < body.length; ) {
      const end = Math.min(body.length, i + TARGET);
      chunks.push(body.slice(i, end));
      if (end >= body.length) break;
      i = end - OVERLAP;
    }

    const eR = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: chunks }),
    });
    const eJ = await eR.json();
    const vectors = (eJ.data ?? []).map((d) => d.embedding);
    await db.from('kb_chunks').insert(chunks.map((c, i) => ({
      document_id: doc.id,
      project_id: project.id,
      content: c,
      embedding: vectors[i] ?? null,
      tokens: Math.round(c.length / 4),
    })));

    if (inboundRow) {
      await db.from('inbound_emails').update({ parsed: true, kb_document_id: doc.id }).eq('id', inboundRow.id);
    }
    console.log(`  ✓ ingested as kb_documents/${doc.id} (${chunks.length} chunks)`);
  }
  console.log('\nDone.');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
