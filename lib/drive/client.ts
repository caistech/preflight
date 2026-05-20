/**
 * Google Drive client + incremental sync.
 *
 * OAuth flow lands here; the cron route at /api/cron/drive-sync calls
 * syncDriveForProject() for every project that has a non-paused
 * drive_connections row.
 *
 * Sync model:
 *   - drive_connections.folder_id is the operator-chosen folder to ingest
 *   - For each Drive file under that folder (recursive), check whether
 *     it's already in kb_documents via (project_id, source_kind='drive',
 *     source_ref=<drive_file_id>). Skip if present. Otherwise download,
 *     extract text, run through ingestKbDocument with source_kind='drive'.
 *   - last_sync_at is updated on every successful pass.
 *
 * Initially only PDFs + Google Docs + plain text are supported. Other
 * MIME types are skipped with a warning.
 */

import { google } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractPdf } from '@/lib/pdf/extract';
import { ingestKbDocument } from '@/lib/kb/ingest';

export function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing Google OAuth env (GOOGLE_CLIENT_ID / _SECRET / _REDIRECT_URI)');
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
  files_skipped: number;
  errors: string[];
  message: string;
}

interface StoredDriveTokens {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  scope?: string;
  token_type?: string;
}

const INGESTIBLE_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.google-apps.document',
  'text/plain',
  'text/markdown',
]);

const MAX_FILES_PER_RUN = 25; // protect cron wall-time
const MAX_BYTES = 10 * 1024 * 1024;

export async function syncDriveForProject(
  db: SupabaseClient,
  projectId: string
): Promise<DriveSyncResult> {
  const result: DriveSyncResult = { files_seen: 0, files_new: 0, files_skipped: 0, errors: [], message: '' };

  const { data: conn } = await db
    .from('drive_connections')
    .select('id, encrypted_tokens, folder_id, paused, last_sync_at')
    .eq('project_id', projectId)
    .maybeSingle();
  if (!conn) {
    result.message = 'No Drive connection for this project';
    return result;
  }
  if (conn.paused) {
    result.message = 'Connection paused';
    return result;
  }
  if (!conn.folder_id) {
    result.message = 'No folder configured — operator needs to pick a Drive folder';
    return result;
  }

  // Tokens are stored as JSON string in encrypted_tokens (v0 uses base64 not real encryption — TODO).
  let tokens: StoredDriveTokens;
  try {
    tokens = JSON.parse(Buffer.from(conn.encrypted_tokens, 'base64').toString('utf-8'));
  } catch (e) {
    result.errors.push(`Could not decode tokens: ${(e as Error).message}`);
    return result;
  }

  const oauth = getOAuthClient();
  oauth.setCredentials(tokens);
  // googleapis auto-refreshes when access_token expires using refresh_token.

  const drive = google.drive({ version: 'v3', auth: oauth });

  // Enumerate files under the folder (single-level for v0; recursive later).
  // Use q='<folder>' in parents to keep the query simple.
  let pageToken: string | undefined;
  const filesToProcess: Array<{ id: string; name: string; mimeType: string; modifiedTime: string }> = [];
  do {
    const listResp = await drive.files.list({
      q: `'${conn.folder_id}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
      pageSize: 100,
      pageToken,
    });
    for (const f of listResp.data.files ?? []) {
      if (!f.id || !f.name || !f.mimeType) continue;
      filesToProcess.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime ?? new Date().toISOString(),
      });
    }
    pageToken = listResp.data.nextPageToken ?? undefined;
  } while (pageToken);

  result.files_seen = filesToProcess.length;

  // Filter to ingestible + not-yet-seen
  const { data: existing } = await db
    .from('kb_documents')
    .select('source_ref')
    .eq('project_id', projectId)
    .eq('source_kind', 'drive');
  const seenIds = new Set((existing ?? []).map((r) => r.source_ref).filter(Boolean));

  let processed = 0;
  for (const f of filesToProcess) {
    if (processed >= MAX_FILES_PER_RUN) {
      result.errors.push(`Hit MAX_FILES_PER_RUN cap of ${MAX_FILES_PER_RUN} — remaining files will sync on the next cron pass`);
      break;
    }
    if (seenIds.has(f.id)) {
      result.files_skipped++;
      continue;
    }
    if (!INGESTIBLE_MIME_TYPES.has(f.mimeType)) {
      result.files_skipped++;
      continue;
    }

    try {
      let content = '';

      if (f.mimeType === 'application/vnd.google-apps.document') {
        // Google Docs — export as plain text
        const exp = await drive.files.export(
          { fileId: f.id, mimeType: 'text/plain' },
          { responseType: 'arraybuffer' }
        );
        content = Buffer.from(exp.data as ArrayBuffer).toString('utf-8');
      } else if (f.mimeType === 'application/pdf') {
        const dl = await drive.files.get(
          { fileId: f.id, alt: 'media' },
          { responseType: 'arraybuffer' }
        );
        const buf = Buffer.from(dl.data as ArrayBuffer);
        if (buf.length > MAX_BYTES) {
          result.errors.push(`${f.name}: ${(buf.length / 1024 / 1024).toFixed(1)} MB exceeds MAX_BYTES`);
          continue;
        }
        const extracted = await extractPdf(buf);
        content = extracted.text;
      } else {
        // text/plain or text/markdown
        const dl = await drive.files.get(
          { fileId: f.id, alt: 'media' },
          { responseType: 'arraybuffer' }
        );
        content = Buffer.from(dl.data as ArrayBuffer).toString('utf-8');
      }

      if (!content || content.trim().length < 30) {
        result.errors.push(`${f.name}: extracted body too short — skipped`);
        continue;
      }

      await ingestKbDocument(db, {
        projectId,
        title: f.name,
        sourceKind: 'drive',
        sourceRef: f.id,
        content,
      });
      result.files_new++;
      processed++;
    } catch (e) {
      result.errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }

  await db
    .from('drive_connections')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('id', conn.id);

  result.message = `${result.files_seen} in folder, ${result.files_new} ingested, ${result.files_skipped} skipped, ${result.errors.length} errors`;
  return result;
}
