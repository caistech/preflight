/**
 * Google Drive client + incremental sync.
 *
 * OAuth flow lands here; the cron route at /api/cron/drive-sync calls
 * syncDriveForProject() for every project with a non-paused drive_connections
 * row.
 *
 * Sync features:
 *   - Recurses into all subfolders under the chosen root
 *   - Supports PDF (pdfjs), Google Docs/Sheets/Slides (Drive export),
 *     .docx (mammoth), .xlsx (sheetjs), plain text + markdown
 *   - Image-only PDFs fall back to Claude OCR (Haiku, document attachment)
 *     when pdfjs extraction returns < 50 chars
 *   - Files already in kb_documents (matched on source_ref=<file_id>) are
 *     skipped — incremental sync that never re-embeds the same file
 *   - Per-file errors are collected and surfaced to the UI
 */

import { google } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractFile } from '@/lib/ingest/extract-file';
import { ingestKbDocument } from '@/lib/kb/ingest';
import { anthropic, MODEL_HAIKU } from '@/lib/ai/anthropic';

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
    prompt: 'consent',
    scope: DRIVE_SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const oauth = getOAuthClient();
  const { tokens } = await oauth.getToken(code);
  return tokens;
}

export interface FileErrorDetail {
  file: string;
  reason: string;
}

export interface DriveSyncResult {
  files_seen: number;
  files_new: number;
  files_skipped: number;
  errors: FileErrorDetail[];
  message: string;
}

interface StoredDriveTokens {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  scope?: string;
  token_type?: string;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Drive download routing — only the Drive-specific half (media vs Google's
 * export-as-mimeType for native Docs/Sheets/Slides). The post-download bytes
 * are normalised via lib/ingest/extract-file.ts so adding a new format only
 * requires one edit there, not two.
 *
 * For PDF, the dispatcher returns ('cad-pdf' | 'pdf-parse' | 'failed'). When
 * extractFile returns too little text we OCR-fallback locally — that's the
 * one Drive-specific behaviour we keep here because OCR is expensive and we
 * don't want every ingest path to pay for it.
 */
interface DriveDownloadSpec {
  download: 'media' | 'export';
  /** When download='export', the MIME we ask Google to convert the native doc to. */
  exportMime?: string;
  /** When download='export', the synthetic filename extension we hand
   *  extract-file.ts so it picks the right branch. */
  syntheticExt?: string;
}

const DRIVE_DOWNLOAD_SPECS: Record<string, DriveDownloadSpec> = {
  'application/pdf': { download: 'media' },
  'application/vnd.google-apps.document': {
    download: 'export',
    exportMime: 'text/plain',
    syntheticExt: 'txt',
  },
  'application/vnd.google-apps.spreadsheet': {
    download: 'export',
    exportMime: 'text/csv',
    syntheticExt: 'csv',
  },
  'application/vnd.google-apps.presentation': {
    download: 'export',
    exportMime: 'text/plain',
    syntheticExt: 'txt',
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { download: 'media' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { download: 'media' },
  'text/plain': { download: 'media' },
  'text/markdown': { download: 'media' },
  'text/csv': { download: 'media' },
  'text/html': { download: 'media' },
};

const MAX_FILES_PER_RUN = 25;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_RECURSION_DEPTH = 5;

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

  let tokens: StoredDriveTokens;
  try {
    tokens = JSON.parse(Buffer.from(conn.encrypted_tokens, 'base64').toString('utf-8'));
  } catch (e) {
    result.errors.push({ file: '(connection)', reason: `Could not decode tokens: ${(e as Error).message}` });
    return result;
  }

  const oauth = getOAuthClient();
  oauth.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth });

  // Recursive enumeration with depth cap
  const allFiles = await enumerateFolderRecursive(drive, conn.folder_id, MAX_RECURSION_DEPTH, '');
  result.files_seen = allFiles.length;

  const { data: existing } = await db
    .from('kb_documents')
    .select('source_ref')
    .eq('project_id', projectId)
    .eq('source_kind', 'drive');
  const seenIds = new Set((existing ?? []).map((r) => r.source_ref).filter(Boolean));

  let processed = 0;
  for (const f of allFiles) {
    if (processed >= MAX_FILES_PER_RUN) {
      result.errors.push({
        file: '(cap)',
        reason: `Hit MAX_FILES_PER_RUN cap of ${MAX_FILES_PER_RUN}. Remaining files will sync on next pass.`,
      });
      break;
    }
    if (seenIds.has(f.id)) {
      result.files_skipped++;
      continue;
    }
    const spec = DRIVE_DOWNLOAD_SPECS[f.mimeType];
    if (!spec) {
      result.files_skipped++;
      continue;
    }

    try {
      let buf: Buffer;
      let extractFilename = f.name;
      let extractMime = f.mimeType;
      if (spec.download === 'export') {
        const exp = await drive.files.export(
          { fileId: f.id, mimeType: spec.exportMime! },
          { responseType: 'arraybuffer' }
        );
        buf = Buffer.from(exp.data as ArrayBuffer);
        // Synthesize filename + mime so the dispatcher routes to the
        // correct extractor branch (txt / csv).
        if (spec.syntheticExt) {
          extractFilename = `${f.name}.${spec.syntheticExt}`;
          extractMime = spec.exportMime!;
        }
      } else {
        const dl = await drive.files.get(
          { fileId: f.id, alt: 'media' },
          { responseType: 'arraybuffer' }
        );
        buf = Buffer.from(dl.data as ArrayBuffer);
      }
      if (buf.length > MAX_BYTES) {
        result.errors.push({ file: f.displayName, reason: `${(buf.length / 1024 / 1024).toFixed(1)} MB exceeds MAX_BYTES (${MAX_BYTES / 1024 / 1024} MB)` });
        continue;
      }

      const extracted = await extractFile(extractFilename, extractMime, buf);
      let content = extracted.text.trim();

      // OCR fallback for image-only PDFs — kept Drive-specific because OCR
      // is expensive and we don't want every ingest path to pay for it.
      if (f.mimeType === 'application/pdf' && (!content || content.length < 50)) {
        try {
          content = (await ocrPdfWithClaude(buf)).trim();
        } catch (e) {
          result.errors.push({ file: f.displayName, reason: `pdfjs extracted too little (${content.length} chars); OCR fallback also failed: ${(e as Error).message}` });
          continue;
        }
      }

      if (!content || content.length < 30) {
        result.errors.push({
          file: f.displayName,
          reason: `Extracted text too short (${content.length} chars, format=${extracted.format}) — may be image-only or empty. Warnings: ${extracted.warnings.join('; ') || 'none'}`,
        });
        continue;
      }

      await ingestKbDocument(db, {
        projectId,
        title: f.displayName,
        sourceKind: 'drive',
        sourceRef: f.id,
        content,
      });
      result.files_new++;
      processed++;
    } catch (e) {
      result.errors.push({ file: f.displayName, reason: (e as Error).message });
    }
  }

  await db
    .from('drive_connections')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('id', conn.id);

  result.message = `${result.files_seen} in folder (incl. subfolders), ${result.files_new} ingested, ${result.files_skipped} skipped, ${result.errors.length} errors`;
  return result;
}

interface EnumeratedFile {
  id: string;
  name: string;
  displayName: string; // includes folder breadcrumb
  mimeType: string;
  modifiedTime: string;
}

async function enumerateFolderRecursive(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  depthRemaining: number,
  pathPrefix: string
): Promise<EnumeratedFile[]> {
  const files: EnumeratedFile[] = [];
  let pageToken: string | undefined;
  do {
    const listResp = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
      pageSize: 100,
      pageToken,
    });
    for (const f of listResp.data.files ?? []) {
      if (!f.id || !f.name || !f.mimeType) continue;
      if (f.mimeType === FOLDER_MIME) {
        if (depthRemaining > 0) {
          const childPath = pathPrefix ? `${pathPrefix}/${f.name}` : f.name;
          const children = await enumerateFolderRecursive(drive, f.id, depthRemaining - 1, childPath);
          files.push(...children);
        }
      } else {
        files.push({
          id: f.id,
          name: f.name,
          displayName: pathPrefix ? `${pathPrefix}/${f.name}` : f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime ?? new Date().toISOString(),
        });
      }
    }
    pageToken = listResp.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

/**
 * OCR fallback — when pdfjs returns too little text for a PDF (i.e. it's a
 * scanned image), use Claude's native PDF document support to extract text.
 * Cheap on Haiku, no canvas/Tesseract needed.
 */
async function ocrPdfWithClaude(buf: Buffer): Promise<string> {
  const base64 = buf.toString('base64');
  try {
    const msg = await anthropic().messages.create({
      model: MODEL_HAIKU, // Haiku for OCR cost — image-only PDFs only fall here
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            {
              type: 'text',
              text: 'Extract all readable text from this PDF. Return ONLY the extracted text, line by line, no commentary or formatting.',
            },
          ],
        },
      ],
    });
    return msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n');
  } catch (e) {
    // Bubble up to caller as zero-length text; caller will error-out the file
    throw new Error(`OCR fallback failed: ${(e as Error).message}`);
  }
}
