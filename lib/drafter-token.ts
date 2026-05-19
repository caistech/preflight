import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Short-lived per-project drafter URL tokens.
 *
 * The raw token is given to the drafter via email/link; only its HMAC is
 * stored in the database. Verification recomputes the HMAC and compares
 * against `drafter_tokens.token_hash`. Rotating DRAFTER_TOKEN_SECRET
 * revokes every outstanding token at once.
 *
 * Token shape: 32 random bytes base64url. Hash: HMAC-SHA256 with the
 * DRAFTER_TOKEN_SECRET key.
 */
function getSecret(): string {
  const s = process.env.DRAFTER_TOKEN_SECRET;
  if (!s) throw new Error('Missing DRAFTER_TOKEN_SECRET');
  return s;
}

export function newDrafterToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHmac('sha256', getSecret()).update(raw).digest('hex');
  return { raw, hash };
}

export function hashDrafterToken(raw: string): string {
  return createHmac('sha256', getSecret()).update(raw).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
