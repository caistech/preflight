/**
 * Shared plumbing for /api/v1 — the machine API (Kira, through the orchestrator).
 *
 * Every route here authenticates by API key (lib/api-key.ts), never by session,
 * and every answer is JSON with `ok`. A refusal carries a sentence a person could
 * be read, because that is exactly what the caller does with it.
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticateApiKey, keyReachesProject, type ApiKeyRow } from '@/lib/api-key';
import { resolveProjectId } from '@/lib/project-resolver';

export function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

/** Authenticate, then resolve `idOrSlug` to a project this key may touch. */
export async function projectForKey(
  db: SupabaseClient,
  request: Request,
  idOrSlug: string,
): Promise<{ ok: true; key: ApiKeyRow; projectId: string } | { ok: false; response: NextResponse }> {
  const auth = await authenticateApiKey(db, request);
  if ('error' in auth) return { ok: false, response: fail(auth.status, auth.error) };

  const projectId = await resolveProjectId(db, idOrSlug);
  // Not found and not permitted read the same to the caller: a key must not be
  // able to discover which projects exist outside its own list.
  if (!projectId || !keyReachesProject(auth.key, projectId)) {
    return { ok: false, response: fail(404, 'No such project for this key') };
  }
  return { ok: true, key: auth.key, projectId };
}
