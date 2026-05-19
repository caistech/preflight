#!/usr/bin/env node
/**
 * Resend inbound setup helper.
 *
 *   node scripts/setup-resend-inbound.mjs
 *
 * What it does:
 *   1. Validates RESEND_API_KEY is live and lists current domains
 *   2. Tries to create an inbound webhook + inbound domain via the API
 *      (Resend's inbound API surface has shifted over time; falls back to a
 *      printed dashboard checklist on any 404/501)
 *   3. Prints the exact DNS records you need to add at your DNS provider
 *      so the inbound subdomain receives mail
 *   4. Lists every project's inbound alias so you can forward correspondence
 *      to the right address immediately
 *
 * Idempotent — re-running with an existing webhook just reports its status.
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

async function resendGet(apiKey, path) {
  const r = await fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await r.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = body; }
  return { status: r.status, body: parsed };
}

async function resendPost(apiKey, path, payload) {
  const r = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await r.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = body; }
  return { status: r.status, body: parsed };
}

const RESEND_DASHBOARD = 'https://resend.com';

async function main() {
  console.log('\n=== Resend inbound setup ===\n');

  const env = await loadEnv();
  const apiKey = env.RESEND_API_KEY;
  const inboundSecret = env.RESEND_INBOUND_SECRET;
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? 'https://preflight-phi.vercel.app';
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey) { console.error('Missing RESEND_API_KEY in .env.local'); process.exit(1); }
  if (!inboundSecret) { console.error('Missing RESEND_INBOUND_SECRET in .env.local'); process.exit(1); }

  const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/webhooks/resend-inbound`;
  console.log(`Target webhook URL:  ${webhookUrl}`);
  console.log(`Webhook secret:      ${inboundSecret}`);
  console.log(`(this exact value goes in the Resend webhook config as the x-resend-secret header)\n`);

  // ---- 1. Verify API key + list domains -----------------------------------
  console.log('— Checking domains —');
  const domains = await resendGet(apiKey, '/domains');
  if (domains.status !== 200) {
    console.error('  ✗ API key invalid or domains endpoint unreachable');
    console.error('   ', domains.body);
    process.exit(1);
  }
  const domainList = domains.body?.data ?? [];
  if (domainList.length === 0) {
    console.log('  (no domains found on the account)');
  } else {
    for (const d of domainList) {
      const status = d.status === 'verified' ? '✓ verified' : `(${d.status})`;
      console.log(`  ${status}  ${d.name}  region=${d.region ?? 'us-east-1'}  id=${d.id}`);
    }
  }

  const verifiedSender = domainList.find((d) => d.status === 'verified');
  const senderDomain = verifiedSender?.name ?? 'updates.corporateaisolutions.com';
  // Recommended inbound subdomain — sits under the verified sender to keep DNS in one place
  const inboundDomain = `inbound.${senderDomain.replace(/^updates\./, '')}`;
  console.log(`\n  Recommended inbound subdomain:  ${inboundDomain}`);
  console.log(`  (sits under your verified ${senderDomain} so DNS lives in one place)\n`);

  // ---- 2. Existing webhooks -----------------------------------------------
  console.log('— Checking existing webhooks —');
  const webhooks = await resendGet(apiKey, '/webhooks');
  if (webhooks.status === 200) {
    const list = webhooks.body?.data ?? [];
    if (list.length === 0) {
      console.log('  (no webhooks configured)');
    } else {
      for (const w of list) {
        console.log(`  · ${w.endpoint}  events=[${(w.events ?? []).join(',')}]  id=${w.id}`);
      }
    }
    const match = list.find((w) => w.endpoint === webhookUrl);
    if (match) {
      console.log(`\n  ✓ Webhook for ${webhookUrl} already exists (id=${match.id})`);
    } else {
      // ---- 3. Try to create the inbound webhook via API -------------------
      console.log(`\n— Creating inbound webhook via API —`);
      const candidatePayloads = [
        // Newer Resend inbound API (best guess based on outbound webhook shape)
        { endpoint: webhookUrl, events: ['email.received'], description: 'Preflight inbound — auto-promote to project KB' },
        { endpoint: webhookUrl, event: 'email.received' },
        { url: webhookUrl, events: ['email.received'] },
      ];
      let created = false;
      for (const payload of candidatePayloads) {
        const r = await resendPost(apiKey, '/webhooks', payload);
        if (r.status === 200 || r.status === 201) {
          console.log(`  ✓ Webhook created via API (status ${r.status})`);
          console.log(`    Make sure to copy the signing-secret it returns into RESEND_INBOUND_SECRET if Resend issues its own.`);
          console.log('    Response:', JSON.stringify(r.body, null, 2));
          created = true;
          break;
        }
      }
      if (!created) {
        console.log('  ⚠ The Resend API did not accept inbound-webhook creation (likely a dashboard-only setting today).');
        console.log(`    Fall back to the dashboard: ${RESEND_DASHBOARD}/webhooks/new`);
      }
    }
  } else {
    console.log(`  Could not list webhooks (status ${webhooks.status}). Skipping auto-create.`);
  }

  // ---- 4. List projects + their inbound aliases ---------------------------
  console.log('\n— Per-project inbound aliases —');
  if (supabaseUrl && serviceKey) {
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: projects } = await db.from('projects').select('slug, name').order('created_at');
    if (projects?.length) {
      for (const p of projects) {
        console.log(`  ${p.name.padEnd(28)} →  ${p.slug}@${inboundDomain}`);
      }
    } else {
      console.log('  (no projects in DB yet)');
    }
  } else {
    console.log('  (skipped — Supabase env not set)');
  }

  // ---- 5. DNS + dashboard checklist --------------------------------------
  console.log('\n=== What to do now ===\n');
  console.log(`1. In your DNS provider (the same place where you verified ${senderDomain}), add an MX record:`);
  console.log(`     Host:     ${inboundDomain.replace(/\..*$/, '')}.${senderDomain.split('.').slice(-2).join('.')}`);
  console.log(`     Type:     MX`);
  console.log(`     Priority: 10`);
  console.log(`     Value:    feedback-smtp.${verifiedSender?.region ?? 'us-east-1'}.amazonses.com`);
  console.log(`     TTL:      Auto (or 3600)`);
  console.log(`   (Resend uses AWS SES under the hood for inbound — exact MX target may differ; the dashboard tells you the right one when you add the inbound domain.)\n`);

  console.log(`2. In the Resend dashboard, add ${inboundDomain} as an inbound domain:`);
  console.log(`   → ${RESEND_DASHBOARD}/inbound  (or ${RESEND_DASHBOARD}/domains/new and pick "Inbound")`);
  console.log(`   When prompted for the webhook URL, paste:`);
  console.log(`     ${webhookUrl}\n`);

  console.log(`3. In the same dashboard, set the webhook signing/secret header to:`);
  console.log(`     header name:  x-resend-secret`);
  console.log(`     header value: ${inboundSecret}\n`);

  console.log(`4. Verify the inbound domain (Resend will tell you when DNS has propagated — usually <10 min).\n`);

  console.log(`5. Smoke test: from any inbox, send a short test email to one of the aliases above.`);
  console.log(`   Then refresh /projects/<slug> on Preflight — the email should appear in Sources → Recent inbound emails with status "in KB".\n`);

  console.log('Done — this script is idempotent, re-run any time to re-print the checklist.\n');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
