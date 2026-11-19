import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { hashDrafterToken } from '@/lib/drafter-token';
import { CheckRunError, evaluateRun, openRun, withTimeout, type LogFn } from '@/lib/check-run';

export const dynamic = 'force-dynamic';
// 300s ceiling so a Lot 442-sized register (many manual-check rules) has room
// to land. Phase-2 of the loop below already parallelises the LLM calls, so
// the worst case is the slowest single call, not the sum.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  const log: LogFn = (phase, extra) =>
    console.log(
      JSON.stringify({ src: 'drafter-upload', phase, ms: Date.now() - t0, ...(extra ?? {}) }),
    );
  log('received', { url: request.url });
  try {
    return await handleUpload(request, log);
  } catch (e) {
    const err = e as Error;
    console.error(
      JSON.stringify({
        src: 'drafter-upload',
        phase: 'fatal',
        ms: Date.now() - t0,
        message: err.message,
        stack: err.stack,
      }),
    );
    return NextResponse.json({ error: `Upload failed: ${err.message}` }, { status: 500 });
  }
}

async function handleUpload(request: NextRequest, log: LogFn) {
  const db = createServiceClient();

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart form' }, { status: 400 });

  const token = form.get('token');
  if (typeof token !== 'string') {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  // Accept either a single 'file' or multiple 'file' fields (the same key
  // repeated). Filter to actual File instances; tolerate any null junk.
  const files = form.getAll('file').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'Missing file(s)' }, { status: 400 });
  }
  log('form-parsed', {
    fileCount: files.length,
    totalBytes: files.reduce((s, f) => s + f.size, 0),
    fileSummaries: files.map((f) => ({ name: f.name, bytes: f.size, type: f.type })),
  });

  // Verify drafter token (timeout-wrapped — this is the first Supabase call
  // and the one we've seen hang silently on the live function).
  const hash = hashDrafterToken(token);
  const tTok = Date.now();
  log('token-query-start');
  const { data: tokenRow, error: tokenErr } = await withTimeout(
    db
      .from('drafter_tokens')
      .select('id, project_id, drafter_name, expires_at, revoked_at, uses')
      .eq('token_hash', hash)
      .single(),
    10000,
    'drafter_tokens',
  );
  log('token-query-done', { ms: Date.now() - tTok, found: !!tokenRow, err: tokenErr?.message });
  if (!tokenRow) return NextResponse.json({ error: 'Invalid link' }, { status: 401 });
  if (tokenRow.revoked_at) return NextResponse.json({ error: 'Link revoked' }, { status: 401 });
  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Link expired' }, { status: 401 });
  }

  const projectId = tokenRow.project_id;
  log('token-validated', { projectId, drafterTokenId: tokenRow.id });

  // The engine is shared with the machine API (lib/check-run.ts), so a drafter
  // upload and a run started by Kira can never disagree about what a check found.
  const checkFiles = await Promise.all(
    files.map(async (file) => ({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) })),
  );
  let opened;
  try {
    opened = await openRun(
      db,
      projectId,
      checkFiles,
      { drafterTokenId: tokenRow.id, label: tokenRow.drafter_name ?? 'drafter' },
      log,
    );
  } catch (e) {
    if (e instanceof CheckRunError) return NextResponse.json({ error: e.message }, { status: 500 });
    throw e;
  }

  let payload;
  try {
    payload = await evaluateRun(db, projectId, opened, log);
  } catch (e) {
    // evaluateRun has already marked the run failed. A set it could not read at all is the
    // drafter's to fix (a different export), so it gets the sentence, not a bare 500.
    if (e instanceof CheckRunError) {
      return NextResponse.json({ error: `${e.message}. Nothing was checked.` }, { status: 422 });
    }
    throw e;
  }

  await db
    .from('drafter_tokens')
    .update({ uses: (tokenRow.uses ?? 0) + 1, last_used_at: new Date().toISOString() })
    .eq('id', tokenRow.id);

  return NextResponse.json(payload);
}
