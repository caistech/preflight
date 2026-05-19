/**
 * Google Drive client — v0 stubs.
 *
 * OAuth flow lands here; the actual document-fetch + incremental-sync is
 * deferred to a follow-up turn. The cron route exists and calls
 * `syncDriveForProject(projectId)`, which for v0 returns a stub result.
 */

import { google } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';

export function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing Google OAuth env');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

export function generateAuthUrl(state: string): string {
  return getOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces refresh_token issuance every time
    scope: DRIVE_SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const oauth = getOAuthClient();
  const { tokens } = await oauth.getToken(code);
  return tokens;
}

export interface DriveSyncResult {
  files_seen: number;
  files_new: number;
  files_updated: number;
  errors: string[];
  message: string;
}

/**
 * Stub. Real implementation enumerates the connection's folder_id,
 * fetches new/changed files since last_sync_at, downloads each,
 * extracts text, writes to kb_documents + kb_chunks via the embedder.
 *
 * v0: returns a no-op result so the cron route + dashboard surface work
 * end-to-end without depending on actual Drive content.
 */
export async function syncDriveForProject(
  _db: SupabaseClient,
  _projectId: string
): Promise<DriveSyncResult> {
  return {
    files_seen: 0,
    files_new: 0,
    files_updated: 0,
    errors: [],
    message:
      'Drive sync stub — real incremental sync deferred to a follow-up turn. Connection state is captured; folder enumeration not yet implemented.',
  };
}
