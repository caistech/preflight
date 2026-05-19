import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (_client) return _client;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  if (anthropicKey) {
    _client = new Anthropic({ apiKey: anthropicKey });
  } else if (openrouterKey) {
    _client = new Anthropic({
      apiKey: openrouterKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer':
          process.env.NEXT_PUBLIC_APP_URL || 'https://preflight.vercel.app',
        'X-Title': 'Preflight',
      },
    });
  } else {
    throw new Error('Missing ANTHROPIC_API_KEY or OPENROUTER_API_KEY');
  }
  return _client;
}

export const MODEL_MANUAL_CHECK = process.env.PREFLIGHT_MODEL || 'claude-sonnet-4-5';
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
