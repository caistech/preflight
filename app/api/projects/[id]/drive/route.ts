import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { resolveProjectId } from '@/lib/project-resolver';
import { syncDriveForProject } from '@/lib/drive/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Drive connection management:
 *   POST {folder_id|folder_url} → set the folder to sync
 *   POST {action: 'sync_now'} → run a sync pass immediately
 *   POST {action: 'pause'|'resume'} → toggle paused flag
 *   POST {action: 'disconnect'} → drop the connection entirely
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idOrSlug } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) {
    return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  }
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const action = body.action as string | undefined;

  // --- set folder ---
  if (body.folder_id || body.folder_url) {
    const folderId = parseDriveFolderId(body.folder_id ?? body.folder_url);
    if (!folderId) {
      return NextResponse.json({ error: 'Could not extract a Drive folder ID from that input' }, { status: 400 });
    }
    const { error: upErr } = await db
      .from('drive_connections')
      .update({ folder_id: folderId, updated_at: new Date().toISOString() })
      .eq('project_id', projectId);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, folder_id: folderId });
  }

  // --- sync now ---
  if (action === 'sync_now') {
    try {
      const result = await syncDriveForProject(db, projectId);
      await db.from('audit_log').insert({
        project_id: projectId,
        actor_id: user.id,
        action: 'drive_sync_manual',
        payload: { result },
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // --- pause / resume ---
  if (action === 'pause' || action === 'resume') {
    const { error: upErr } = await db
      .from('drive_connections')
      .update({ paused: action === 'pause', updated_at: new Date().toISOString() })
      .eq('project_id', projectId);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, paused: action === 'pause' });
  }

  // --- disconnect ---
  if (action === 'disconnect') {
    const { error: delErr } = await db
      .from('drive_connections')
      .delete()
      .eq('project_id', projectId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    await db.from('audit_log').insert({
      project_id: projectId,
      actor_id: user.id,
      action: 'drive_disconnected',
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'No recognised action — pass folder_id, folder_url, or action=sync_now/pause/resume/disconnect' }, { status: 400 });
}

/**
 * Accept either a raw Drive folder ID (33+ alphanumeric/dash/underscore)
 * or a folder URL like:
 *   https://drive.google.com/drive/folders/<ID>
 *   https://drive.google.com/drive/u/0/folders/<ID>?q=...
 */
function parseDriveFolderId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return null;
}
