/**
 * Single-query embedding helper for retrieval-time lookups.
 *
 * Uses the same OpenAI model (text-embedding-3-small, 1536 dims) as the
 * ingest-time chunk embedder so the vector spaces are consistent and
 * cosine similarity in match_kb_chunks() is meaningful.
 */

const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
const OPENAI_EMBED_DIM = 1536;

export async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!text || text.trim().length === 0) return null;

  try {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input: text.slice(0, 8000) }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const emb = j.data?.[0]?.embedding;
    if (Array.isArray(emb) && emb.length === OPENAI_EMBED_DIM) {
      return emb as number[];
    }
    return null;
  } catch {
    return null;
  }
}
