import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Settings</div>
      <h1 className="mb-2 text-3xl font-bold">Account &amp; integrations</h1>
      <p className="mb-8 max-w-2xl text-sm text-gray-400">
        Per-account preferences and per-project integration status. Preflight
        is BYOK — all credentials are env-var managed; the credentials UI
        lands in a follow-up turn.
      </p>

      <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
        <div className="text-sm text-gray-300">
          <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Signed in as</div>
          {user?.email ?? 'unknown'}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-400">
        <div className="mb-3 font-semibold text-gray-200">Integrations (status)</div>
        <ul className="space-y-2">
          <li><strong className="text-gray-300">Resend inbound webhook:</strong> wired (parsing deferred to follow-up).</li>
          <li><strong className="text-gray-300">Google Drive OAuth:</strong> wired (incremental sync deferred to follow-up).</li>
          <li><strong className="text-gray-300">ElevenLabs voice agent:</strong> pending VOICE AI STANDARD RULE retrofit (follow-up).</li>
          <li><strong className="text-gray-300">PDF extraction:</strong> pdf-parse path live; CAD-PDF positioned-text path deferred.</li>
          <li><strong className="text-gray-300">LLM manual-check layer:</strong> live (Claude Sonnet via Anthropic or OpenRouter).</li>
        </ul>
      </div>
    </div>
  );
}
