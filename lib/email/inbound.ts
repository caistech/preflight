import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestKbDocument } from '@/lib/kb/ingest';

/**
 * Inbound email handler — auto-promotes to KB.
 *
 *  1. Look up the project by the inbound-alias local-part (the bit before @).
 *     Convention: <project-slug>@inbound.<your-domain>.
 *  2. Persist the raw payload + metadata to inbound_emails (audit trail).
 *  3. If we matched a project AND the email has a usable text body, ingest it
 *     as a kb_documents row (kind='inbound-email') and chunk+embed via the
 *     standard KB pipeline so manual-check rules with use_kb_retrieval: true
 *     immediately get the new context.
 *  4. Mark inbound_emails.parsed=true and link kb_document_id.
 *
 * Operator workflow this enables: forward correspondence to the project's
 * inbound alias → it shows up in Sources → no CLI, no script, no scratch
 * SQL editing. Same surface as Drive when that lands.
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

export interface InboundResult {
  stored: boolean;
  project_id: string | null;
  kb_document_id: string | null;
  reason?: string;
}

export async function persistInboundEmail(
  db: SupabaseClient,
  payload: InboundEmailPayload
): Promise<InboundResult> {
  // 1. Resolve project by inbound-alias local-part
  let projectId: string | null = null;
  if (payload.to) {
    const local = payload.to.split('@')[0]?.toLowerCase().trim();
    if (local) {
      const { data: p } = await db.from('projects').select('id').eq('slug', local).maybeSingle();
      if (p) projectId = p.id;
    }
  }

  // 2. Always persist the raw inbound row (audit trail, even if project unknown)
  const { data: inboundRow } = await db
    .from('inbound_emails')
    .upsert(
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
    )
    .select('id')
    .single();

  // 3. Auto-promote to KB if we matched a project and have a body
  if (!projectId) {
    return { stored: true, project_id: null, kb_document_id: null, reason: 'no project matched the inbound alias' };
  }
  const body = (payload.text ?? '').trim() || stripHtml(payload.html ?? '');
  if (body.length < 30) {
    return { stored: true, project_id: projectId, kb_document_id: null, reason: 'body too short to ingest' };
  }

  try {
    const title = (payload.subject ?? '').trim() || `Email from ${payload.from ?? 'unknown'}`;
    const result = await ingestKbDocument(db, {
      projectId,
      title,
      sourceKind: 'inbound-email',
      sourceRef: payload.from ?? null,
      content: body,
    });

    // 4. Mark parsed + link the KB doc
    if (inboundRow) {
      await db
        .from('inbound_emails')
        .update({ parsed: true, kb_document_id: result.document_id })
        .eq('id', inboundRow.id);
    }

    return { stored: true, project_id: projectId, kb_document_id: result.document_id };
  } catch (e) {
    return {
      stored: true,
      project_id: projectId,
      kb_document_id: null,
      reason: `KB ingest failed: ${(e as Error).message}`,
    };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
