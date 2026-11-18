import { describe, expect, it } from 'vitest';
import { authenticateApiKey, bearerFrom, hashApiKey, keyReachesProject, newApiKey } from '@/lib/api-key';

function db(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  const touched: unknown[] = [];
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => ({ data: row, error });
  chain.update = (v: unknown) => {
    touched.push(v);
    return { eq: async () => ({ error: null }) };
  };
  return { client: { from: () => chain } as never, touched };
}

const req = (auth?: string) =>
  new Request('https://x.test/api/v1/projects', { headers: auth ? { authorization: auth } : {} });

describe('API keys', () => {
  it('stores only a hash, and a fresh key hashes to it', () => {
    const { raw, hash } = newApiKey();
    expect(raw.startsWith('pfk_')).toBe(true);
    expect(hash).toBe(hashApiKey(raw));
    expect(hash).not.toContain(raw);
  });

  it('reads a bearer token and nothing else', () => {
    expect(bearerFrom(req('Bearer pfk_abc'))).toBe('pfk_abc');
    expect(bearerFrom(req('Basic pfk_abc'))).toBeNull();
    expect(bearerFrom(req())).toBeNull();
  });

  it('refuses a missing or malformed key', async () => {
    const { client } = db(null);
    expect(await authenticateApiKey(client, req())).toMatchObject({ ok: false, status: 401 });
    expect(await authenticateApiKey(client, req('Bearer nope'))).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses a revoked key', async () => {
    const { client } = db({ id: 'k1', name: 'Kira', project_ids: ['p1'], revoked_at: '2026-11-01' });
    expect(await authenticateApiKey(client, req('Bearer pfk_x'))).toMatchObject({ ok: false, status: 401 });
  });

  it('a failed lookup is "could not check" (503), not "not allowed"', async () => {
    const { client } = db(null, { message: 'down' });
    expect(await authenticateApiKey(client, req('Bearer pfk_x'))).toMatchObject({ ok: false, status: 503 });
  });

  it('accepts a live key and stamps its last use', async () => {
    const { client, touched } = db({ id: 'k1', name: 'Kira', project_ids: ['p1'], revoked_at: null });
    const auth = await authenticateApiKey(client, req('Bearer pfk_x'));
    expect(auth).toMatchObject({ ok: true, key: { id: 'k1', project_ids: ['p1'] } });
    expect(touched).toHaveLength(1);
  });

  it('reaches only the projects listed on it', () => {
    const key = { id: 'k1', name: 'Kira', project_ids: ['p1'] };
    expect(keyReachesProject(key, 'p1')).toBe(true);
    expect(keyReachesProject(key, 'p2')).toBe(false);
    expect(keyReachesProject({ ...key, project_ids: [] }, 'p1')).toBe(false);
  });
});
