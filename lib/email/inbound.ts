import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Inbound email handler — v0 stub.
 *
 * Real implementation:
 *   1. Verifies the inbound webhook shared secret (Resend signs payloads via svix).
 *   2. Maps the inbound to a project via the "to" address — convention is
 *      `<project-slug>@inbound.<your-domain>` (e.g. lot-442-seafields@inbound.preflight.app).
 *   3. Stores raw payload in inbound_emails.
 *   4. Classifies the sender (planner / council / engineer / drafter / owner) via simple
 *      pattern + LLM fallback.
 *   5. Writes a kb_documents row with party tag + body text, chunks + embeds for retrieval.
 *   6. Marks inbound_emails.parsed=true.
 *
 * v0: persists the raw payload only. Classification + KB write is deferred.
 */

export interface InboundEmailPayload {
  message_id: string;
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  raw?: unknown;
}

export async function persistInboundEmail(
  db: SupabaseClient,
  payload: InboundEmailPayload
): Promise<{ stored: boolean; project_id: string | null }> {
  // Best-effort project lookup by inbound address: anything before '@' is a candidate slug
  let projectId: string | null = null;
  if (payload.to) {
    const local = payload.to.split('@')[0]?.toLowerCase();
    if (local) {
      const { data: p } = await db.from('projects').select('id').eq('slug', local).single();
      if (p) projectId = p.id;
    }
  }

  await db.from('inbound_emails').upsert(
    {
      project_id: projectId,
      message_id: payload.message_id,
      from_address: payload.from ?? null,
      to_address: payload.to ?? null,
      subject: payload.subject ?? null,
      body_text: payload.text ?? null,
      body_html: payload.html ?? null,
      raw_payload: payload.raw ?? null,
      parsed: false,
    },
    { onConflict: 'message_id' }
  );

  return { stored: true, project_id: projectId };
}
