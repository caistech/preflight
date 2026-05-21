-- ============================================================================
-- Avatars storage bucket — public-read, owner-write.
--
-- Files are stored as `<user_id>` (no extension) so the canonical avatar URL
-- per user is predictable:
--   <SUPABASE_URL>/storage/v1/object/public/avatars/<user_id>
-- The client adds a cache-busting query param when re-uploading. Operator
-- doesn't need a profiles.avatar_url column — the URL is derivable from
-- user.id. If the object doesn't exist, the UI shows an initials fallback.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and auth.uid()::text = name
  );

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects
  for update using (
    bucket_id = 'avatars' and auth.uid()::text = name
  );

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'avatars' and auth.uid()::text = name
  );
