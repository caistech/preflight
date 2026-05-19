import { NextRequest } from 'next/server';
import { createClient } from './server';
import { createServiceClient } from './service';

export async function authenticateAndGetDb(_request?: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { user: null, db: null as ReturnType<typeof createServiceClient> | null, error: 'Unauthorized' };
  }
  return { user, db: createServiceClient(), error: null as string | null };
}

export function verifyCronSecret(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    request.headers.get('x-cron-secret');
  return provided === expected;
}
