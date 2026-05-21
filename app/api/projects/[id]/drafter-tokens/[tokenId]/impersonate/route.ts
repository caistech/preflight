/**
 * Operator "Enter as drafter" — mints a short-lived impersonation token.
 *
 * The drafter view itself is unchanged: an impersonation token is a real
 * drafter_tokens row with a 10-minute expiry, a parent_token_id pointing
 * at the source token, and impersonated_by_user_id pointing at the
 * operator. The drafter route's HMAC verification works without any
 * special-casing.
 *
 * Form-POST style: returns a 302 redirect to the drafter URL so an
 * <form target="_blank" action="…/impersonate"> in the operator UI opens
 * the actual drafter page in a new tab with no client JS required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/service';
import { resolveProjectId } from '@/lib/project-resolver';
import { newDrafterToken } from '@/lib/drafter-token';

export const dynamic = 'force-dynamic';

const IMPERSONATION_TTL_MIN = 10;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tokenId: string }> },
) {
  const { id: idOrSlug, tokenId } = await params;
  const { user, error } = await authenticateAndGetDb(request);
  if (error || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });

  // Use the service client for the write — RLS on drafter_tokens scopes
  // selects but the operator needs cross-project trust to mint a token.
  // Auth above already verified they're a signed-in operator.
  const db = createServiceClient();
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { data: source, error: srcErr } = await db
    .from('drafter_tokens')
    .select('id, project_id, drafter_name')
    .eq('id', tokenId)
    .eq('project_id', projectId)
    .single();
  if (srcErr || !source) return NextResponse.json({ error: 'Source token not found' }, { status: 404 });

  // Mint the new token + persist
  const { raw, hash } = newDrafterToken();
  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MIN * 60_000).toISOString();
  const label = source.drafter_name
    ? `OPERATOR PREVIEW (${source.drafter_name})`
    : 'OPERATOR PREVIEW';

  const { error: insErr } = await db.from('drafter_tokens').insert({
    project_id: projectId,
    drafter_name: label,
    token_hash: hash,
    expires_at: expiresAt,
    parent_token_id: source.id,
    impersonated_by_user_id: user.id,
  });
  if (insErr) {
    return NextResponse.json({ error: `Could not mint impersonation token: ${insErr.message}` }, { status: 500 });
  }

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'operator_impersonate_drafter',
    payload: {
      source_token_id: source.id,
      source_drafter_name: source.drafter_name,
      ttl_minutes: IMPERSONATION_TTL_MIN,
      expires_at: expiresAt,
    },
  });

  // Redirect to the actual drafter page. The destination is on the same
  // origin so this works whether the form opens in the current tab or
  // target=_blank.
  const url = new URL(`/drafter/${raw}`, request.url);
  return NextResponse.redirect(url, 303);
}
