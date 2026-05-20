#!/usr/bin/env node
/**
 * One-shot send of the two relationship-pitch emails for Lot 442:
 *   1. Fiona (ModularWA)
 *   2. Luke (Unison Modular — drafter is Zulz)
 *
 * Generates a fresh drafter token for each + embeds the link inline so a
 * single email does both jobs (the pitch + the briefing).
 *
 * Run:
 *   node scripts/send-fiona-luke-emails.mjs            (dry run — prints what would send)
 *   node scripts/send-fiona-luke-emails.mjs --send      (actually sends via Resend)
 */

import { createClient } from '@supabase/supabase-js';
import { createHmac, randomBytes } from 'crypto';
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

function newDrafterToken(secret) {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHmac('sha256', secret).update(raw).digest('hex');
  return { raw, hash };
}

const FROM = 'Dennis McMahon (F2K) <noreply@updates.corporateaisolutions.com>';
const CC = 'dennis@factory2key.com.au';
const REPLY_TO = 'dennis@factory2key.com.au';

function bodyFiona(linkUrl) {
  return {
    subject: 'Pre-submission check tool for Lot 442 — would your drafters find it useful?',
    text: `Hi Fiona,

Quick note about something we've built for Lot 442 that I'd like to offer your drafters.

A few small things on the 25270 Rev0 set need correction — a SUB-FLOOR VENT entry in the legend on a slab-on-biscuit project, and a letterbox elevation where Unit 4 appears twice and Unit 8 is missing. Both straightforward to fix.

The point I want to be careful about: what I'd like to avoid is fixing those two and then hitting another small thing on the next pass that's also been on the project's pattern list for a while — and us going round again on something different. That's the round-trip cycle I'm trying to break with the tool.

What it is — Preflight:

- Your drafter opens a short-lived link (no account, no portal), drops the PDF in, gets a one-page sheet listing EVERYTHING that matches a known recurring issue on this project, all at once. Sub-floor vent, letterbox numbering, the planner's earlier notes, the Council audit patterns, all the project's accumulated learnings — surfaced in a single pass.
- The rules come from the project itself — the footing system, the unit count, what Council has flagged before, what Kathryn / Brad / Peter have written about. It only catches KNOWN error types. A novel error passes straight through — it's a regression check, not a substitute for a real review.
- "Unsure" is a valid answer; the tool never invents a street name or a dimension. The drafter decides what to act on.
- Result is for the drafter; nothing comes back to me unless they choose to share it.

Practical use: fix the two items I've flagged, then run the revised set through the tool before sending across. If anything else sits in the project's pattern list, it surfaces in the same pass. Submission lands clean, no second round on a different small item.

Here's the link for Lot 442 (it works for 30 days; if you need it longer let me know):

${linkUrl}

Happy to walk through it on a call if that's easier than email.

DISCLAIMER
Preflight is a regression check, not a compliance certification. Responsibility for the drawing's correctness — including anything the tool misses — rests with the licensed drafter, engineer, architect, surveyor, or other professional whose name appears on the set. Preflight, Corporate AI Solutions, and the project owner accept no liability. "Confirmed OK" results are within the tool's scope only and do not constitute a sign-off on Council acceptance.

Dennis

DENNIS PATRICK MCMAHON
Factory2Key  |  Corporate AI Solutions
M: +61 402 612 471
E: dennis@factory2key.com.au
`,
  };
}

function bodyLuke(linkUrl) {
  return {
    subject: 'Following up on Rev H — small tool to keep us out of another round-trip',
    text: `Hi Luke,

Following up on the Rev H email from a couple of weeks back — the datum conversion conversation Zulz and I were working through, where FFL/FCL went to AHD but the site contours stayed in assumed datum, and the DATUM note + revision-history line didn't match what was on the drawing. Those still need to come right on the next revision.

Also worth flagging on the 25278 RevK that came across more recently: the driveway/crossover is annotated to Ulla Street, but the project's on Half Moon Drive. Same kind of small annotation thing that's easy to miss internally and easy for Council to land on.

The point I want to be careful about: if we fix those and send the next rev, my concern is that SOMETHING ELSE in the project's pattern list — letterbox numbering, sub-floor vent in the legend, title-block scope, an unlabelled boundary — surfaces on the pass AFTER this one and we go round again on a different item. That's the cycle I'm trying to compress.

What we've built — Preflight:

- Drafter-side short-lived link (no account, no portal); drop the PDF, get a one-page sheet showing EVERYTHING that matches a known recurring issue on Lot 442, all in one pass.
- The May 18 datum-conversion email is now sitting in the project's reference set, and the three issues I raised then have become three rules the tool runs automatically on any new revision. The point being: I shouldn't catch that pattern by hand a third time, and Zulz shouldn't hear about it from me again.
- Same applies to the Ulla Street vs Half Moon Drive call — the tool flags geography mismatches against the project address; it doesn't invent the right street name, just holds the mismatch for human review.
- Result is for the drafter; nothing comes back to me unless you choose to share it. The tool isn't a report-to-management surface.

Practical use: fix the called-out items, then run the revised set through the tool before sending across. If anything else on the project's pattern list also wants attention, it surfaces in the same pass.

Here's the link for Zulz on Lot 442 — please forward to him (it works for 30 days; happy to extend or rotate as needed):

${linkUrl}

Same offer in both directions — if the tool flags something Zulz knows is fine, or misses something it should have caught, flag it back; that's how the rules stay accurate, and the rules belong to the project, not the tool.

DISCLAIMER
Preflight is a regression check, not a compliance certification. Responsibility for the drawing's correctness — including anything the tool misses — rests with the licensed drafter, engineer, architect, surveyor, or other professional whose name appears on the set. Preflight, Corporate AI Solutions, and the project owner accept no liability. "Confirmed OK" results are within the tool's scope only and do not constitute a sign-off on Council acceptance.

Dennis

DENNIS PATRICK MCMAHON
Factory2Key  |  Corporate AI Solutions
M: +61 402 612 471
E: dennis@factory2key.com.au
`,
  };
}

function htmlEmail(textBody) {
  // Simple text → HTML: preserve paragraphs, monospace the link
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
  const appUrl = (env.NEXT_PUBLIC_APP_URL ?? 'https://preflight-phi.vercel.app').replace(/\/$/, '');
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: project } = await db.from('projects').select('id, name').eq('slug', 'lot-442-seafields').single();
  if (!project) throw new Error('Lot 442 project not found');

  // Reuse existing tokens if present + active for these drafter_names; otherwise create new
  async function getOrCreateToken(drafterName) {
    const { data: existing } = await db
      .from('drafter_tokens')
      .select('id, token_hash, expires_at, revoked_at')
      .eq('project_id', project.id)
      .eq('drafter_name', drafterName)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing && new Date(existing.expires_at) > new Date()) {
      // We can't recover the raw token from the hash — generate a NEW one
      // and revoke the old. (HMAC is one-way by design.)
      await db.from('drafter_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', existing.id);
    }
    const { raw, hash } = newDrafterToken(env.DRAFTER_TOKEN_SECRET);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.from('drafter_tokens').insert({
      project_id: project.id,
      token_hash: hash,
      drafter_name: drafterName,
      drafter_email: null,
      expires_at: expiresAt.toISOString(),
    });
    return `${appUrl}/drafter/${raw}`;
  }

  const fionaLink = await getOrCreateToken('Fiona');
  const zulzLink = await getOrCreateToken('Zulz');

  console.log('Generated drafter links:');
  console.log('  Fiona:', fionaLink);
  console.log('  Zulz: ', zulzLink);

  const fionaEmail = bodyFiona(fionaLink);
  const lukeEmail = bodyLuke(zulzLink);

  if (!APPLY) {
    console.log('\n=== DRY RUN — re-run with --send to actually transmit ===');
    console.log('\nTO: Fiona@modularwa.com.au  CC:', CC);
    console.log('SUBJECT:', fionaEmail.subject);
    console.log('\n' + fionaEmail.text);
    console.log('\n---\n\nTO: luke@unisonmodular.com  CC:', CC);
    console.log('SUBJECT:', lukeEmail.subject);
    console.log('\n' + lukeEmail.text);
    return;
  }

  console.log('\n== Sending Fiona ==');
  const r1 = await send(env, 'Fiona@modularwa.com.au', fionaEmail);
  console.log('  status:', r1.status, ' id:', r1.body?.id ?? r1.body);

  console.log('\n== Sending Luke ==');
  const r2 = await send(env, 'luke@unisonmodular.com', lukeEmail);
  console.log('  status:', r2.status, ' id:', r2.body?.id ?? r2.body);

  console.log('\nDone.');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
