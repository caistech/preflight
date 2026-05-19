import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolve a project's UUID from either a UUID or a slug.
 *
 * Lets every /projects/[id] and /api/projects/[id] route accept the more
 * memorable slug form (e.g. lot-442-seafields) alongside the canonical UUID.
 * Downstream foreign-key queries always use the UUID.
 *
 * Returns null if no project matches.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export async function resolveProjectId(
  db: SupabaseClient,
  idOrSlug: string
): Promise<string | null> {
  if (!idOrSlug) return null;
  const column = looksLikeUuid(idOrSlug) ? 'id' : 'slug';
  const { data } = await db
    .from('projects')
    .select('id')
    .eq(column, idOrSlug)
    .maybeSingle();
  return data?.id ?? null;
}
