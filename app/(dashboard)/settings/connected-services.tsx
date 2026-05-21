/**
 * Server-side panel that surfaces which BYOK env vars are configured on
 * the deployment. Doesn't accept key INPUT via the UI — the BYOK contract
 * is that keys are env-var-managed at deploy time. This is the read-only
 * status surface that tells the operator "your function has access to X".
 */

interface Service {
  name: string;
  envVar: string | string[]; // accepts an alternative env var name
  configured: boolean;
  purpose: string;
}

function check(envVar: string | string[]): boolean {
  const vars = Array.isArray(envVar) ? envVar : [envVar];
  return vars.some((v) => !!process.env[v]);
}

export function ConnectedServicesPanel() {
  const services: Service[] = [
    {
      name: 'Anthropic',
      envVar: ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY'],
      configured: check(['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']),
      purpose: 'Manual-check + rule-proposer LLM (Sonnet). OpenRouter substitutes if ANTHROPIC_API_KEY absent.',
    },
    {
      name: 'OpenAI',
      envVar: 'OPENAI_API_KEY',
      configured: check('OPENAI_API_KEY'),
      purpose: 'KB chunk embeddings + retrieval queries (text-embedding-3-small).',
    },
    {
      name: 'Resend',
      envVar: ['RESEND_API_KEY', 'RESEND_INBOUND_SECRET'],
      configured: check('RESEND_API_KEY'),
      purpose: 'Drafter-link emails + inbound webhook (forward correspondence to KB).',
    },
    {
      name: 'Google Drive OAuth',
      envVar: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
      configured: check(['GOOGLE_CLIENT_ID']) && check(['GOOGLE_CLIENT_SECRET']) && check(['GOOGLE_REDIRECT_URI']),
      purpose: 'Per-project Drive folder sync (30-min cron).',
    },
    {
      name: 'ElevenLabs',
      envVar: 'ELEVENLABS_API_KEY',
      configured: check('ELEVENLABS_API_KEY'),
      purpose: 'Voice agent (per VOICE AI STANDARD RULE — deferred per session decision).',
    },
    {
      name: 'Supabase',
      envVar: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      configured:
        check('NEXT_PUBLIC_SUPABASE_URL') &&
        check('NEXT_PUBLIC_SUPABASE_ANON_KEY') &&
        check('SUPABASE_SERVICE_ROLE_KEY'),
      purpose: 'Database, auth, storage. URL + anon + service-role all required.',
    },
    {
      name: 'Token secrets',
      envVar: ['DRAFTER_TOKEN_SECRET', 'CRON_SECRET'],
      configured: check('DRAFTER_TOKEN_SECRET') && check('CRON_SECRET'),
      purpose: 'HMAC for drafter URL tokens and cron-route auth. Rotating either revokes outstanding tokens.',
    },
  ];

  const allConfigured = services.every((s) => s.configured);

  return (
    <section className="mt-6 rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-sm font-semibold text-gray-200">Connected services</div>
        <div className={`text-xs ${allConfigured ? 'text-emerald-400' : 'text-amber-400'}`}>
          {allConfigured ? 'All configured' : 'Some keys missing'}
        </div>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Preflight is BYOK: third-party credentials live in env vars at deploy time.
        Run <code className="rounded bg-gray-800 px-1 text-emerald-300">node scripts/setup-byok.mjs</code> from a
        fresh clone to set them, or paste into Vercel project settings for a deployed instance.
      </p>
      <ul className="space-y-2 text-sm">
        {services.map((s) => (
          <li
            key={s.name}
            className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3"
          >
            <span
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${s.configured ? 'bg-emerald-500' : 'bg-gray-600'}`}
              aria-hidden
            />
            <div className="flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-gray-100">{s.name}</span>
                <span className={`text-xs ${s.configured ? 'text-emerald-400' : 'text-gray-500'}`}>
                  {s.configured ? 'configured' : 'not set'}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-gray-400">{s.purpose}</div>
              <div className="mt-1 font-mono text-xs text-gray-600">
                {Array.isArray(s.envVar) ? s.envVar.join(' · ') : s.envVar}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
