/**
 * KB ingestion pipeline — extract text → chunk → embed → persist.
 *
 * Per the unified-KB-ingestion rule: every source the system surfaces
 * (uploads, URLs, Drive, inbound email, generated assets) feeds into the
 * project KB so manual-check rules with use_kb_retrieval: true have
 * something to retrieve from.
 *
 * v0: char-based chunking with ~500-token target. Real semantic chunking
 * (heading splits, table preservation) is a follow-up turn.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
const OPENAI_EMBED_DIM = 1536;
const TARGET_CHARS_PER_CHUNK = 2000; // ~500 tokens for English prose
const CHUNK_OVERLAP_CHARS = 200;

export interface IngestInput {
  projectId: string;
  title: string;
  sourceKind: 'upload' | 'url' | 'drive' | 'inbound-email' | 'planner-letter' | 'council-audit' | 'engineer-note' | 'manual';
  sourceRef: string | null;
  content: string;
}

export interface IngestResult {
  document_id: string;
  chunk_count: number;
  warnings: string[];
}

export async function ingestKbDocument(
  db: SupabaseClient,
  input: IngestInput
): Promise<IngestResult> {
  const warnings: string[] = [];

  const trimmed = (input.content ?? '').trim();
  if (!trimmed) {
    throw new Error('Empty content — nothing to ingest');
  }

  // Dedup: if a doc with the same (project_id, title) already exists,
  // SKIP rather than insert a duplicate. Drive sync's source_ref dedup
  // can miss when the same file lives in multiple subfolders with
  // different Drive IDs; title-level dedup catches that case too.
  const { data: dup } = await db
    .from('kb_documents')
    .select('id')
    .eq('project_id', input.projectId)
    .eq('title', input.title)
    .maybeSingle();
  if (dup) {
    return { document_id: dup.id, chunk_count: 0, warnings: [`Skipped — document with title "${input.title}" already exists in this project's KB`] };
  }

  // 1. Persist the document
  const { data: doc, error: docErr } = await db
    .from('kb_documents')
    .insert({
      project_id: input.projectId,
      title: input.title,
      source_kind: input.sourceKind,
      source_ref: input.sourceRef,
      content: trimmed,
    })
    .select('id')
    .single();
  if (docErr || !doc) {
    throw new Error(`Could not persist document: ${docErr?.message ?? 'unknown'}`);
  }

  // 2. Chunk
  const chunks = chunkText(trimmed);

  // 3. Embed (batched, with one call per chunk for clarity; OpenAI accepts
  //    arrays but we keep it simple for v0)
  const embeddings = await embedChunks(chunks);
  if (embeddings.warnings.length) warnings.push(...embeddings.warnings);

  // 4. Persist chunks
  if (embeddings.vectors.length) {
    const rows = chunks.map((c, i) => ({
      document_id: doc.id,
      project_id: input.projectId,
      content: c,
      embedding: embeddings.vectors[i] ?? null,
      tokens: Math.round(c.length / 4),
    }));
    const { error: chunkErr } = await db.from('kb_chunks').insert(rows);
    if (chunkErr) warnings.push(`Chunk persist failed: ${chunkErr.message}`);
  } else {
    warnings.push('No embeddings produced — chunks not persisted');
  }

  return {
    document_id: doc.id,
    chunk_count: chunks.length,
    warnings,
  };
}

function chunkText(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + TARGET_CHARS_PER_CHUNK);
    out.push(text.slice(i, end));
    if (end >= text.length) break;
    i = end - CHUNK_OVERLAP_CHARS;
  }
  return out;
}

async function embedChunks(chunks: string[]): Promise<{ vectors: number[][]; warnings: string[] }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { vectors: [], warnings: ['OPENAI_API_KEY not set — KB chunks persisted without embeddings'] };

  const vectors: number[][] = [];
  const warnings: string[] = [];

  // Batch in groups of 50 to stay well under OpenAI's request size limit
  for (let i = 0; i < chunks.length; i += 50) {
    const batch = chunks.slice(i, i + 50);
    try {
      const r = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input: batch }),
      });
      const j = await r.json();
      if (!r.ok) {
        warnings.push(`Embedding batch ${i / 50 + 1} failed: ${j.error?.message ?? r.status}`);
        for (let k = 0; k < batch.length; k++) vectors.push([]);
        continue;
      }
      for (const item of j.data ?? []) {
        const emb = item.embedding;
        if (Array.isArray(emb) && emb.length === OPENAI_EMBED_DIM) {
          vectors.push(emb);
        } else {
          vectors.push([]);
          warnings.push('Unexpected embedding shape from OpenAI');
        }
      }
    } catch (e) {
      warnings.push(`Embedding batch ${i / 50 + 1} errored: ${(e as Error).message}`);
      for (let k = 0; k < batch.length; k++) vectors.push([]);
    }
  }

  return { vectors, warnings };
}

/**
 * Fetch text from a URL via simple HTML strip. For PDFs at URLs, the operator
 * should download and upload via the file route instead — we don't try to
 * sniff content types here.
 */
export async function fetchUrlAsText(url: string): Promise<{ title: string; content: string }> {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'PreflightBot/1.0 (+https://preflight-phi.vercel.app)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('text/html') && !ct.includes('text/plain')) {
    throw new Error(`Unsupported content-type (${ct}); for PDFs use the file upload`);
  }
  const html = await r.text();
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? url;
  // Strip scripts/styles, then tags
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, content: stripped };
}
