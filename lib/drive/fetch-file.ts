/**
 * Fetch ONE Drive file for a check run, through the project's own Drive connection.
 *
 * Why Preflight fetches and the caller does not send bytes: a drawing set is
 * routinely larger than a serverless request body may be (4.5 MB on Vercel), so
 * the only reliable route is for the side that runs the check to pull the file.
 *
 * The connection is the PROJECT's, so a file shared with a different Google
 * account is invisible here. That is reported as `not_visible`, naming the
 * account that would need access — never as an empty or partial check.
 */

import { google } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOAuthClient } from './client';

/** Larger than the sync cap: a whole drawing set is one file and is the point of the run. */
export const MAX_CHECK_FILE_BYTES = 40 * 1024 * 1024;

export type FetchFileResult =
  | { ok: true; name: string; bytes: Buffer }
  | {
      ok: false;
      reason: 'no_connection' | 'not_visible' | 'not_pdf' | 'too_large' | 'unreadable';
      message: string;
    };

interface StoredDriveTokens {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
}

export async function fetchDriveFileForProject(
  db: SupabaseClient,
  projectId: string,
  fileId: string,
): Promise<FetchFileResult> {
  const { data: conn, error } = await db
    .from('drive_connections')
    .select('encrypted_tokens, email, paused')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) return { ok: false, reason: 'unreadable', message: `Could not read the Drive connection: ${error.message}` };
  if (!conn || conn.paused) {
    return { ok: false, reason: 'no_connection', message: 'This project has no active Google Drive connection in Preflight.' };
  }

  let tokens: StoredDriveTokens;
  try {
    tokens = JSON.parse(Buffer.from(conn.encrypted_tokens, 'base64').toString('utf-8'));
  } catch {
    return { ok: false, reason: 'no_connection', message: "The project's Drive connection could not be read." };
  }

  const oauth = getOAuthClient();
  oauth.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth });

  let meta: { name?: string | null; mimeType?: string | null; size?: string | null };
  try {
    const res = await drive.files.get({ fileId, fields: 'name, mimeType, size', supportsAllDrives: true });
    meta = res.data;
  } catch (e) {
    const status = (e as { code?: number }).code;
    if (status === 404 || status === 403) {
      return {
        ok: false,
        reason: 'not_visible',
        message: `That file is not visible to Preflight's Drive connection for this project (${conn.email ?? 'unknown account'}). Share it, or its folder, with that account.`,
      };
    }
    return { ok: false, reason: 'unreadable', message: `Drive could not be reached: ${(e as Error).message}` };
  }

  const name = meta.name ?? fileId;
  // PDFs only. The engine reads PDF text; accepting anything else would produce a
  // run with nothing extracted, whose every rule reads "not found".
  if (meta.mimeType !== 'application/pdf') {
    return { ok: false, reason: 'not_pdf', message: `"${name}" is not a PDF (${meta.mimeType ?? 'unknown type'}). Checks run on PDF drawing sets.` };
  }
  if (meta.size && Number(meta.size) > MAX_CHECK_FILE_BYTES) {
    return { ok: false, reason: 'too_large', message: `"${name}" is larger than ${MAX_CHECK_FILE_BYTES / 1024 / 1024} MB.` };
  }

  try {
    const dl = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    );
    const bytes = Buffer.from(dl.data as ArrayBuffer);
    if (bytes.byteLength > MAX_CHECK_FILE_BYTES) {
      return { ok: false, reason: 'too_large', message: `"${name}" is larger than ${MAX_CHECK_FILE_BYTES / 1024 / 1024} MB.` };
    }
    return { ok: true, name, bytes };
  } catch (e) {
    return { ok: false, reason: 'unreadable', message: `Could not download "${name}": ${(e as Error).message}` };
  }
}
