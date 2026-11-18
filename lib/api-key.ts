/**
 * Machine-caller API keys.
 *
 * A key is 32 random bytes, shown once. Only its SHA-256 is stored: with that much
 * entropy a plain hash is not brute-forceable, and unlike the drafter-token HMAC it
 * needs no server secret, so rotating an unrelated secret can never silently revoke
 * every machine caller at once.
 *
 * Authorisation is per project: a valid key that is not listed for a project gets a
 * 403 for it, never a quiet empty answer.
 */

import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const API_KEY_PREFIX = 'pfk_';

export interface ApiKeyRow {
  id: string;
  name: string;
  project_ids: string[];
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function newApiKey(): { raw: string; hash: string } {
  const raw = API_KEY_PREFIX + randomBytes(32).toString('base64url');
  return { raw, hash: hashApiKey(raw) };
}

/** The bearer token from `Authorization: Bearer <key>`, or null. */
export function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

export type ApiAuth =
  | { ok: true; key: ApiKeyRow }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Verify the caller's key and stamp its last use. A failed read is a 503, never a
 * 401 — "we could not check" and "you are not allowed" have different fixes.
 */
export async function authenticateApiKey(db: SupabaseClient, request: Request): Promise<ApiAuth> {
  const raw = bearerFrom(request);
  if (!raw || !raw.startsWith(API_KEY_PREFIX)) {
    return { ok: false, status: 401, error: 'Missing or malformed API key' };
  }

  const { data, error } = await db
    .from('api_keys')
    .select('id, name, project_ids, revoked_at')
    .eq('key_hash', hashApiKey(raw))
    .maybeSingle();

  if (error) {
    console.error('[api-key] lookup failed:', error.message);
    return { ok: false, status: 503, error: 'Could not verify the API key just now' };
  }
  if (!data || data.revoked_at) return { ok: false, status: 401, error: 'Invalid API key' };

  const { error: touchError } = await db
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);
  if (touchError) console.error('[api-key] last_used_at not stamped:', touchError.message);

  return { ok: true, key: { id: data.id, name: data.name, project_ids: data.project_ids ?? [] } };
}

export function keyReachesProject(key: ApiKeyRow, projectId: string): boolean {
  return key.project_ids.includes(projectId);
}
