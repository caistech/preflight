// POST /api/v1/projects/:id/check-runs — start a check of one or more Drive PDFs.
//
// Body: { requestId?: string, driveFileIds: string[] }, or the request id as an `Idempotency-Key`
// header — which is how the orchestrator sends it (the effect row's id, on every write).
//
// RETURNS BEFORE THE CHECK FINISHES. A run can take minutes (manual-check rows go to
// the model), far longer than a voice turn or an orchestrator call should wait. The
// files are fetched and their text extracted BEFORE answering, so every reason a run
// cannot start — a file Preflight's Drive account cannot see, not a PDF, too large —
// comes back now, as a sentence. Only the rule evaluation continues after the reply,
// and its outcome is read from GET /api/v1/check-runs/:id.
//
// IDEMPOTENT ON requestId. The same key and requestId return the run they already
// started rather than paying for a second one.

import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { createServiceClient } from '@/lib/supabase/service';
import { fail, projectForKey } from '@/lib/api-v1';
import { fetchDriveFileForProject } from '@/lib/drive/fetch-file';
import { CheckRunError, evaluateRun, openRun, type CheckFile, type LogFn } from '@/lib/check-run';
import { savedReadingTranscriber } from '@/lib/pdf/sheet-readings';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_FILES = 10;

async function existingRun(db: ReturnType<typeof createServiceClient>, keyId: string, requestId: string) {
  const { data } = await db
    .from('check_runs')
    .select('id, status')
    .eq('api_key_id', keyId)
    .eq('request_id', requestId)
    .maybeSingle();
  return data as { id: string; status: string } | null;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const t0 = Date.now();
  const log: LogFn = (phase, extra) =>
    console.log(JSON.stringify({ src: 'api-v1-check-run', phase, ms: Date.now() - t0, ...(extra ?? {}) }));

  const db = createServiceClient();
  const gate = await projectForKey(db, request, params.id);
  if ('response' in gate) return gate.response;

  const body = (await request.json().catch(() => null)) as {
    requestId?: unknown;
    driveFileIds?: unknown;
    reread?: unknown;
  } | null;
  // `reread: true` throws away the saved reading of every drawn sheet in the set and
  // reads it again — the way out when a saved reading turns out to have missed something.
  const reread = body?.reread === true;
  const requestId =
    (typeof body?.requestId === 'string' ? body.requestId.trim() : '') ||
    (request.headers.get('idempotency-key') ?? '').trim();
  const ids = Array.isArray(body?.driveFileIds)
    ? [...new Set(body!.driveFileIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))]
    : [];

  if (!requestId || requestId.length > 200) return fail(400, 'requestId is required');
  if (ids.length === 0) return fail(400, 'Which drawings? driveFileIds needs at least one file');
  if (ids.length > MAX_FILES) return fail(400, `At most ${MAX_FILES} files per check`);

  const prior = await existingRun(db, gate.key.id, requestId);
  if (prior) return NextResponse.json({ ok: true, runId: prior.id, status: prior.status, replayed: true });

  // Every file is fetched before anything is recorded, so one unreadable file
  // stops the run cleanly instead of checking a partial set as if it were whole.
  const files: CheckFile[] = [];
  for (const id of ids) {
    const got = await fetchDriveFileForProject(db, gate.projectId, id);
    if ('reason' in got) {
      const status = got.reason === 'unreadable' ? 503 : 422;
      return fail(status, got.message, { reason: got.reason, driveFileId: id });
    }
    files.push({ name: got.name, bytes: got.bytes });
  }
  log('files-fetched', { count: files.length });

  let opened;
  try {
    opened = await openRun(db, gate.projectId, files, { apiKeyId: gate.key.id, label: gate.key.name }, log, {
      request_id: requestId,
    });
  } catch (e) {
    // Two identical requests racing: the unique index lets one through and the
    // other finds it here.
    const raced = await existingRun(db, gate.key.id, requestId);
    if (raced) return NextResponse.json({ ok: true, runId: raced.id, status: raced.status, replayed: true });
    if (e instanceof CheckRunError) return fail(500, e.message);
    throw e;
  }

  // The slow part. evaluateRun marks the run `failed` itself if anything throws,
  // so a crash here can never leave a run that reads as finished-and-clean.
  waitUntil(
    evaluateRun(db, gate.projectId, opened, log, savedReadingTranscriber(db, log, { reread })).catch((e) => {
      log('background-failed', { message: (e as Error).message });
    }),
  );

  return NextResponse.json(
    {
      ok: true,
      runId: opened.runId,
      status: 'running',
      replayed: false,
      files: opened.fileSummaries,
      // Said as-is by the caller. It promises nothing it cannot keep: the run is started, the
      // result is not known, and the way to get it is to ask.
      message:
        `the ${gate.projectName} check has started on ${opened.fileSummaries.map((f) => f.name).join(', ')}. ` +
        'It usually takes a minute or two; ask how it went and I will read you what it found.',
    },
    { status: 202 },
  );
}
