import { afterEach, describe, expect, it, vi } from 'vitest';
import { noStoreFetch } from '@/lib/supabase/service';

afterEach(() => vi.unstubAllGlobals());

describe('the service client never reads from a cache', () => {
  it('sends every request with cache: no-store, keeping the caller options', async () => {
    const seen = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', seen);

    await noStoreFetch('https://db.example/rest/v1/check_runs', { method: 'GET', headers: { apikey: 'k' } });

    expect(seen).toHaveBeenCalledWith('https://db.example/rest/v1/check_runs', {
      method: 'GET',
      headers: { apikey: 'k' },
      cache: 'no-store',
    });
  });

  it('a caller cannot opt back into caching', async () => {
    const seen = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', seen);

    await noStoreFetch('https://db.example/x', { cache: 'force-cache' });

    expect(seen.mock.calls[0][1].cache).toBe('no-store');
  });
});
