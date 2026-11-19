import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. Server-only. Bypasses RLS.
 * Use for cron jobs, drafter-token verification, and admin actions.
 *
 * EVERY READ GOES TO THE DATABASE. Next 14 caches `fetch` in route handlers, and supabase-js
 * reads through `fetch`, so without `cache: 'no-store'` a GET could answer from the first
 * response forever: a check run read "running" for ten minutes after it had completed, and
 * "latest" kept saying no check had been run after one had. A stale answer here is a wrong
 * answer read out to the owner, so nothing on this client is ever cached.
 */
export const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noStoreFetch },
  });
}
