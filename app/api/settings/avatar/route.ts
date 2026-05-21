/**
 * Upload (PUT) or remove (DELETE) the calling user's avatar in the
 * `avatars` Supabase Storage bucket. Object key is the user.id so the
 * public canonical URL is predictable: <SUPABASE_URL>/storage/v1/object/public/avatars/<id>.
 *
 * Size cap is 2 MB — avatars are small by nature and we don't want to
 * pay storage / bandwidth for ten-megapixel uploads.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart form' }, { status: 400 });

  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB > 2 MB)` },
      { status: 413 },
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported type ${file.type}. Use PNG, JPEG, WEBP, or GIF.` },
      { status: 415 },
    );
  }

  // Upload — overwrites any previous avatar at this key.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(user.id, bytes, { upsert: true, contentType: file.type });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, updated_at: new Date().toISOString() });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { error } = await supabase.storage.from('avatars').remove([user.id]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
