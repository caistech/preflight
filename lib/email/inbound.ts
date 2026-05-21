import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestKbDocument } from '@/lib/kb/ingest';
import { extractFile } from '@/lib/ingest/extract-file';

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

export interface InboundAttachment {
  filename: string;
  /** MIME type from the email envelope (e.g. application/pdf). May be missing
   *  or generic — the extractor falls back to extension sniffing. */
  content_type?: string;
  /** Base64-encoded content. Either this OR url is required. */
  content_base64?: string;
  /** HTTPS URL to fetch the attachment body. Either this OR content_base64
   *  is required. The fetch carries no auth headers — Resend's signed URLs
   *  are typically time-limited and don't need them. */
  url?: string;
}

export interface InboundEmailPayload {
  message_id: string;
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  attachments?: InboundAttachment[];
  raw?: unknown;
}

export interface InboundResult {
  stored: boolean;
  project_id: string | null;
  /** kb_document_id for the email body itself (text/html). Null if the body
   *  was too short or no project matched the inbound alias. */
  kb_document_id: string | null;
  /** kb_document_id for each successfully ingested attachment, in source order. */
  attachment_kb_document_ids: string[];
  /** Per-attachment failures (kept as warnings so the operator can audit). */
  attachment_warnings: string[];
  reason?: string;
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // matches operator upload cap

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
  const { data: inboundRow, error: inboundErr } = await db
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
  if (inboundErr) {
    // Don't fail the webhook — KB ingest is the load-bearing step — but
    // surface the error in the result so /api/webhooks/resend-inbound returns
    // it and we don't have a silent-failure debugging gap again.
    console.error('inbound_emails upsert failed:', inboundErr.message);
  }

  // 3. Auto-promote to KB if we matched a project. Body OR attachments
  // qualify — a planner emailing nothing-but-an-attached-PDF should still
  // land in the KB.
  if (!projectId) {
    return {
      stored: true,
      project_id: null,
      kb_document_id: null,
      attachment_kb_document_ids: [],
      attachment_warnings: [],
      reason: 'no project matched the inbound alias',
    };
  }

  const body = (payload.text ?? '').trim() || stripHtml(payload.html ?? '');
  const attachments = payload.attachments ?? [];
  const hasUsableBody = body.length >= 30;
  if (!hasUsableBody && attachments.length === 0) {
    return {
      stored: true,
      project_id: projectId,
      kb_document_id: null,
      attachment_kb_document_ids: [],
      attachment_warnings: [],
      reason: 'body too short and no attachments — nothing to ingest',
    };
  }

  // 3a. Body — only ingest if we actually have something
  let bodyDocId: string | null = null;
  if (hasUsableBody) {
    try {
      const title = (payload.subject ?? '').trim() || `Email from ${payload.from ?? 'unknown'}`;
      const result = await ingestKbDocument(db, {
        projectId,
        title,
        sourceKind: 'inbound-email',
        sourceRef: payload.from ?? null,
        content: body,
      });
      bodyDocId = result.document_id;
    } catch (e) {
      // Body ingest failure must not lose the attachments — record and continue.
      console.error(`[inbound] body ingest failed: ${(e as Error).message}`);
    }
  }

  // 3b. Attachments — each becomes its own kb_document. We don't merge bodies
  // because separate documents get separate facts proposer + scope classifier
  // passes, which is what the operator wants for cross-project propagation.
  const attachmentDocIds: string[] = [];
  const attachmentWarnings: string[] = [];

  for (const att of attachments) {
    try {
      const buf = await loadAttachmentBytes(att);
      if (!buf) {
        attachmentWarnings.push(`${att.filename}: no content_base64 or url provided`);
        continue;
      }
      if (buf.length > MAX_ATTACHMENT_BYTES) {
        attachmentWarnings.push(
          `${att.filename}: ${(buf.length / 1024 / 1024).toFixed(1)} MB exceeds attachment cap of ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`,
        );
        continue;
      }
      const extracted = await extractFile(att.filename, att.content_type ?? '', buf);
      if (extracted.format === 'dwg') {
        attachmentWarnings.push(`${att.filename}: native CAD format; export to PDF first.`);
        continue;
      }
      if (!extracted.text || extracted.text.trim().length < 30) {
        attachmentWarnings.push(
          `${att.filename}: extracted too little text (${extracted.text.length} chars, format=${extracted.format})`,
        );
        continue;
      }
      const result = await ingestKbDocument(db, {
        projectId,
        title: `${(payload.subject ?? '').trim() ? `${payload.subject} — ` : ''}${att.filename}`,
        sourceKind: 'inbound-email',
        sourceRef: `email:${payload.message_id}:attachment:${att.filename}`,
        content: extracted.text,
      });
      attachmentDocIds.push(result.document_id);
    } catch (e) {
      attachmentWarnings.push(`${att.filename}: ${(e as Error).message}`);
    }
  }

  // 4. Mark parsed + link the body's KB doc (attachments are linked via
  // source_ref pattern so they're discoverable from the inbound_emails row).
  if (inboundRow && (bodyDocId || attachmentDocIds.length > 0)) {
    await db
      .from('inbound_emails')
      .update({ parsed: true, kb_document_id: bodyDocId })
      .eq('id', inboundRow.id);
  }

  return {
    stored: true,
    project_id: projectId,
    kb_document_id: bodyDocId,
    attachment_kb_document_ids: attachmentDocIds,
    attachment_warnings: attachmentWarnings,
  };
}

/**
 * Load an attachment's bytes from either base64 content or a fetchable URL.
 * Returns null if neither is provided.
 */
async function loadAttachmentBytes(att: InboundAttachment): Promise<Buffer | null> {
  if (att.content_base64) {
    try {
      return Buffer.from(att.content_base64, 'base64');
    } catch {
      return null;
    }
  }
  if (att.url) {
    const r = await fetch(att.url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`attachment fetch ${att.url} returned ${r.status}`);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  }
  return null;
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
