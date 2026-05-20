#!/usr/bin/env node
/**
 * Quick follow-up to the two pitch emails sent earlier today —
 * adds the Preflight site URL that was missing from the originals.
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--send') || process.argv.includes('--apply');

async function loadEnv() {
  const raw = await fs.readFile(path.join(PROJECT_ROOT, '.env.local'), 'utf-8');
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const FROM = 'Dennis McMahon (F2K) <noreply@updates.corporateaisolutions.com>';
const CC = 'dennis@factory2key.com.au';
const REPLY_TO = 'dennis@factory2key.com.au';
const APP_URL = 'https://preflight-phi.vercel.app';

function body(firstName, subject) {
  const text = `Hi ${firstName},

Quick PS to the earlier email — I forgot to include the Preflight site link itself.

Site: ${APP_URL}

The drafter link I sent through is the only thing you actually need for the checking workflow; the site root just shows a landing page. The project-owner side (where the register + KB live) is login-gated since it's my side of the relationship, not yours — but the link being visible makes it clear where the tool runs and that it's not a black box.

Disclaimer from the earlier email still applies: Preflight is a regression check, not a compliance certification — responsibility for the drawing's correctness rests with the licensed professional whose name appears on the set.

Dennis

DENNIS PATRICK MCMAHON
Factory2Key  |  Corporate AI Solutions
M: +61 402 612 471
E: dennis@factory2key.com.au
`;
  return { subject: 'Re: ' + subject + ' — quick PS', text };
}

function htmlEmail(textBody) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1f2937;line-height:1.55;font-size:14px;white-space:pre-wrap">${escapeHtml(textBody)}</div>`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function send(env, to, payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to,
      cc: CC,
      reply_to: REPLY_TO,
      subject: payload.subject,
      text: payload.text,
      html: htmlEmail(payload.text),
    }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

async function main() {
  const env = await loadEnv();
  const fiona = body('Fiona', 'Pre-submission check tool for Lot 442');
  const luke = body('Luke', 'Following up on Rev H');

  if (!APPLY) {
    console.log('=== DRY RUN ===');
    console.log('\nTO: Fiona@modularwa.com.au\n' + fiona.subject + '\n\n' + fiona.text);
    console.log('\n---\n\nTO: luke@unisonmodular.com\n' + luke.subject + '\n\n' + luke.text);
    return;
  }
  console.log('Sending Fiona follow-up...');
  const r1 = await send(env, 'Fiona@modularwa.com.au', fiona);
  console.log('  status', r1.status, 'id', r1.body?.id);
  console.log('Sending Luke follow-up...');
  const r2 = await send(env, 'luke@unisonmodular.com', luke);
  console.log('  status', r2.status, 'id', r2.body?.id);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
