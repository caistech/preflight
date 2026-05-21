import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PasswordForm } from './password-form';
import { ProfileForm } from './profile-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Settings</div>
      <h1 className="mb-2 text-3xl font-bold">Your account</h1>
      <p className="mb-8 max-w-2xl text-sm text-gray-400">
        Per-account preferences and integration status. Preflight is BYOK —
        third-party credentials (Anthropic, OpenAI, Resend, Google) live in
        env vars; a credentials UI lands in a follow-up.
      </p>

      {/* Identity */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
        <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Signed in as</div>
        <div className="text-sm text-gray-100">{user?.email ?? 'unknown'}</div>
        <div className="mt-1 text-xs text-gray-500">
          Email lives on auth.users — change it via the magic-link flow (Forgot password →
          Update email). Profile fields below are stored in public.profiles.
        </div>
      </section>

      {/* Profile */}
      <section className="mt-6 rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
        <div className="mb-3 text-sm font-semibold text-gray-200">Profile</div>
        <ProfileForm />
      </section>

      {/* Password */}
      <section className="mt-6 rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
        <div className="mb-3 text-sm font-semibold text-gray-200">Change password</div>
        <PasswordForm />
      </section>

      {/* Sign out */}
      <section className="mt-6 rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
        <div className="mb-3 text-sm font-semibold text-gray-200">Sign out</div>
        <div className="flex flex-wrap items-center gap-3">
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-red-500 hover:text-red-400"
            >
              Sign out of this session
            </button>
          </form>
          <form action="/api/settings/logout-everywhere" method="post">
            <button
              type="submit"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300 hover:border-red-500 hover:bg-red-500/20"
              title="Revokes every refresh token for your account — all other devices get booted to /login on their next request."
            >
              Sign out everywhere
            </button>
          </form>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          &ldquo;Everywhere&rdquo; revokes every refresh token across all your devices.
        </div>
      </section>

      {/* Integrations status */}
      <section className="mt-6 rounded-2xl border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-400">
        <div className="mb-3 font-semibold text-gray-200">Integrations</div>
        <ul className="space-y-2 text-xs">
          <li><strong className="text-gray-300">Resend inbound webhook:</strong> wired; text/html body auto-promoted to KB. PDF attachments NOT yet extracted (follow-up).</li>
          <li><strong className="text-gray-300">Google Drive OAuth + sync:</strong> wired; recursive folder enumeration; PDF / Docs / Sheets / Slides / DOCX / XLSX / TXT / MD; OCR fallback for image-only PDFs via Claude Haiku.</li>
          <li><strong className="text-gray-300">ElevenLabs voice agent:</strong> deferred per session decision (returning to evaluate relevance per surface).</li>
          <li><strong className="text-gray-300">PDF extraction:</strong> pdfjs positioned-text (cad-pdf) + pdf-parse fallback live.</li>
          <li><strong className="text-gray-300">LLM stack:</strong> Sonnet for manual-check + rule proposer; Haiku for facts proposer, scope classifier, OCR fallback.</li>
          <li><strong className="text-gray-300">KB retrieval (manual-check rules):</strong> scope-aware; pulls project + matching cross-project + general chunks.</li>
        </ul>
      </section>

      {/* Honest audit footer — what's still missing per the global rule */}
      <section className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-200/90">
        <div className="mb-2 font-semibold text-amber-300">Still pending per the global rule</div>
        Profile + password + sign-out are live. Still missing: avatar uploader (needs Supabase
        Storage bucket); delete-account flow with confirm-by-typing-email; sign-out-everywhere
        (revoke all refresh tokens — Supabase admin call). Returning in a follow-up.
        <div className="mt-2">
          <Link href="/projects" className="text-amber-300 hover:underline">
            Back to projects →
          </Link>
        </div>
      </section>
    </div>
  );
}
