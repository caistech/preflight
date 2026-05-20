/**
 * Send the drafter-link email when the operator provides a drafter email.
 * Uses Resend. Reuses RESEND_FROM_EMAIL as the verified sender.
 *
 * The email is the drafter's full briefing: what to upload, project context,
 * how the system works, what to do with the results — so the drafter doesn't
 * need to ask the operator before acting.
 */

interface SendDrafterLinkArgs {
  to: string;
  drafterName: string | null;
  projectName: string;
  ownerLabel: string | null;
  council: string | null;
  address: string | null;
  uploadInstructions: string | null;
  url: string;
  expiresAt: Date;
  ownerEmail: string | null;
}

export async function sendDrafterLinkEmail(args: SendDrafterLinkArgs): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@updates.corporateaisolutions.com';
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' };

  const greeting = args.drafterName ? `Hi ${args.drafterName.split(/\s|—|-/)[0]},` : 'Hi,';
  const expiryLine = args.expiresAt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const operatorLine = args.ownerEmail
    ? `${args.ownerEmail} has set up a pre-submission triage check for ${args.projectName}${args.ownerLabel ? ` (owned by ${args.ownerLabel})` : ''}.`
    : `A pre-submission triage check has been set up for ${args.projectName}${args.ownerLabel ? ` (owned by ${args.ownerLabel})` : ''}.`;
  const subject = `Pre-submission triage link — ${args.projectName}`;

  const projectDetails = [
    `Project: ${args.projectName}`,
    args.address ? `Address: ${args.address}` : null,
    args.council ? `Council: ${args.council}` : null,
    args.ownerLabel ? `Project owner: ${args.ownerLabel}` : null,
  ].filter(Boolean).join('\n');

  const uploadGuidance = args.uploadInstructions
    || 'Upload your latest revision of the drawing set as a PDF.';

  const textBody = `${greeting}

${operatorLine} This email gives you everything you need; no account, no portal.

WHAT THIS IS
Preflight runs your latest drawing set against the things this project has been pulled up on before — Council audit findings, the planner's letter, the project's own engineering constraints. The point is to catch the recurring stuff before the set goes out, not five days after Council sends it back.

PROJECT DETAILS
${projectDetails}

WHAT TO UPLOAD
${uploadGuidance}

THE LINK
${args.url}

(One use is fine; you can come back to it any time before ${expiryLine}.)

HOW IT WORKS
When you drop the PDF in, two things happen:
1. Deterministic checks fire on text-based rules — e.g. "if the legend lists sub-floor vents but the project uses slab-on-biscuit footings, flag it." These return a clean pass or fail with a sheet reference.
2. Manual-check rules use an LLM to scan the relevant excerpts and answer narrow yes/no/unsure questions — e.g. "is there a street name annotation on each boundary that carries a bearing/distance?" The LLM is allowed (and expected) to answer 'unsure'. It never invents specifics like street names, dimensions, or citations — those are always handed back for human judgment.

WHAT YOU'LL GET
A one-page triage sheet, broken into three groups:
  🔴 Hard fails — issues that will trigger a Council query. Fix before submission. Sheet reference is included.
  🟡 Needs eyes — the LLM was unsure, or it's a judgment call. Read these and decide; don't just trust the tool.
  ✅ Confirmed OK — short list of things the tool can positively confirm. Builds trust in the rest of the result.

WHAT TO DO WITH IT
- Fix the hard fails before sending the set on.
- For 'needs eyes', use your own judgment — the tool's prompting you, not gating you.
- Nothing is shared with ${args.ownerLabel ?? 'the project owner'} unless you choose to share the result. The output is yours.
- If anything looks wrong (a row flags that you know is fine, or the tool missed something it should have caught), reply to ${args.ownerEmail ?? 'the project owner'} — those gaps are how the register gets smarter for next time.

${args.ownerEmail ? `Reply to ${args.ownerEmail} with any questions.\n\n` : ''}DISCLAIMER
Preflight is a regression check, not a compliance certification. Responsibility for the drawing's correctness — including anything the tool misses — rests with the licensed drafter, engineer, architect, surveyor, or other professional whose name appears on the set. Preflight, Corporate AI Solutions, and the project owner accept no liability. "Confirmed OK" results are within the tool's scope only and do not constitute a sign-off on Council acceptance.

Thanks.
`;

  const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; color: #1f2937; line-height: 1.55;">
  <p style="margin: 0 0 16px;">${greeting}</p>

  <p style="margin: 0 0 16px;">${escapeHtml(operatorLine)} This email gives you everything you need; no account, no portal.</p>

  <h3 style="margin: 24px 0 8px; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7280;">What this is</h3>
  <p style="margin: 0 0 16px;">Preflight runs your latest drawing set against the things this project has been pulled up on before — Council audit findings, the planner's letter, the project's own engineering constraints. The point is to catch the recurring stuff before the set goes out, not five days after Council sends it back.</p>

  <h3 style="margin: 24px 0 8px; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7280;">Project details</h3>
  <table style="margin: 0 0 16px; border-collapse: collapse;">
    <tbody>
      <tr><td style="padding: 2px 14px 2px 0; color: #6b7280; vertical-align: top;">Project</td><td style="padding: 2px 0;"><strong>${escapeHtml(args.projectName)}</strong></td></tr>
      ${args.address ? `<tr><td style="padding: 2px 14px 2px 0; color: #6b7280; vertical-align: top;">Address</td><td style="padding: 2px 0;">${escapeHtml(args.address)}</td></tr>` : ''}
      ${args.council ? `<tr><td style="padding: 2px 14px 2px 0; color: #6b7280; vertical-align: top;">Council</td><td style="padding: 2px 0;">${escapeHtml(args.council)}</td></tr>` : ''}
      ${args.ownerLabel ? `<tr><td style="padding: 2px 14px 2px 0; color: #6b7280; vertical-align: top;">Project owner</td><td style="padding: 2px 0;">${escapeHtml(args.ownerLabel)}</td></tr>` : ''}
    </tbody>
  </table>

  <h3 style="margin: 24px 0 8px; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7280;">What to upload</h3>
  <p style="margin: 0 0 16px;">${escapeHtml(uploadGuidance)}</p>

  <p style="margin: 28px 0;">
    <a href="${escapeAttr(args.url)}" style="display:inline-block; background:#10b981; color:#0a0a0a; padding:12px 22px; border-radius:8px; text-decoration:none; font-weight:600;">Open the triage link →</a>
  </p>
  <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px;">Or copy this URL:</p>
  <p style="margin: 0 0 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #374151; word-break: break-all;">${escapeHtml(args.url)}</p>
  <p style="margin: 0 0 16px; color: #6b7280; font-size: 13px;">Comes back to the same result page any time before <strong>${escapeHtml(expiryLine)}</strong>.</p>

  <h3 style="margin: 28px 0 8px; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7280;">How it works</h3>
  <p style="margin: 0 0 12px;">When you drop the PDF in, two things happen:</p>
  <ol style="margin: 0 0 16px; padding-left: 20px;">
    <li style="margin-bottom: 8px;"><strong>Deterministic checks</strong> fire on text-based rules — e.g. <em>"if the legend lists sub-floor vents but the project uses slab-on-biscuit footings, flag it."</em> Clean pass or fail with a sheet reference.</li>
    <li><strong>Manual-check rules</strong> use an LLM to scan the relevant excerpts and answer narrow yes/no/unsure questions. The LLM is allowed (and expected) to answer <em>unsure</em>. It never invents specifics like street names, dimensions, or citations — those always come back for human judgment.</li>
  </ol>

  <h3 style="margin: 28px 0 8px; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7280;">What you'll get</h3>
  <p style="margin: 0 0 8px;">A one-page triage sheet:</p>
  <ul style="margin: 0 0 16px; padding-left: 20px;">
    <li style="margin-bottom: 6px;"><strong style="color: #b91c1c;">🔴 Hard fails</strong> — will trigger a Council query. Fix before submission. Sheet reference included.</li>
    <li style="margin-bottom: 6px;"><strong style="color: #b45309;">🟡 Needs eyes</strong> — LLM unsure, or judgment call. Read and decide; don't just trust the tool.</li>
    <li><strong style="color: #047857;">✅ Confirmed OK</strong> — short list of things the tool can positively confirm.</li>
  </ul>

  <h3 style="margin: 28px 0 8px; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7280;">What to do with it</h3>
  <ul style="margin: 0 0 16px; padding-left: 20px;">
    <li style="margin-bottom: 6px;">Fix the hard fails before sending the set on.</li>
    <li style="margin-bottom: 6px;">For <em>needs eyes</em>, use your own judgment — the tool's prompting you, not gating you.</li>
    <li style="margin-bottom: 6px;">Nothing is shared with ${escapeHtml(args.ownerLabel ?? 'the project owner')} unless you choose to share the result. The output is yours.</li>
    <li>If a row flags something you know is fine, or the tool missed something it should have caught — reply to ${args.ownerEmail ? `<a href="mailto:${escapeAttr(args.ownerEmail)}" style="color:#10b981;">${escapeHtml(args.ownerEmail)}</a>` : 'the project owner'}. Those gaps are how the register gets smarter for next time.</li>
  </ul>

  ${args.ownerEmail ? `<p style="margin: 24px 0 0; color: #6b7280; font-size: 13px;">Reply to <a href="mailto:${escapeAttr(args.ownerEmail)}" style="color:#10b981;">${escapeHtml(args.ownerEmail)}</a> with any questions.</p>` : ''}

  <div style="margin: 28px 0 0; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 11px; line-height: 1.5;">
    <strong style="color: #4b5563;">Disclaimer.</strong> Preflight is a regression check, not a compliance certification.
    Responsibility for the drawing's correctness — including anything the tool misses — rests with the licensed drafter, engineer,
    architect, surveyor, or other professional whose name appears on the set. Preflight, Corporate AI Solutions, and the project
    owner accept no liability. "Confirmed OK" results are within the tool's scope only and do not constitute a sign-off on Council acceptance.
  </div>
</div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Preflight <${fromEmail}>`,
      to: args.to,
      subject,
      text: textBody,
      html: htmlBody,
      reply_to: args.ownerEmail ?? undefined,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, error: j.message ?? `HTTP ${r.status}` };
  }
  return { ok: true, id: j.id };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
