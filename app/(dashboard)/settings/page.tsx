import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PasswordForm } from './password-form';
import { ProfileForm } from './profile-form';
import { AvatarForm } from './avatar-form';
import { ConnectedServicesPanel } from './connected-services';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const avatarBaseUrl = supabaseUrl ? `${supabaseUrl}/storage/v1/object/public/avatars` : '';

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Settings</div>
      <h1 className="mb-2 text-3xl font-bold">Your account</h1>
      <p className="mb-8 max-w-2xl text-sm text-gray-400">
        Per-account preferences and integration status. Preflight is BYOK —
        third-party credentials (Anthropic, OpenAI, Resend, Google) live in
        env vars; a credentials UI lands in a follow-up.
      </p>

      {/* Identity + avatar */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
        <div className="mb-3 text-xs uppercase tracking-wide text-gray-500">Signed in as</div>
        {user && avatarBaseUrl ? (
          <AvatarForm userId={user.id} email={user.email ?? ''} avatarBaseUrl={avatarBaseUrl} />
        ) : (
          <div className="text-sm text-gray-100">{user?.email ?? 'unknown'}</div>
        )}
        <div className="mt-3 text-xs text-gray-500">
          {user?.email}{' · '}email lives on auth.users — change it via the magic-link flow (Forgot password →
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

      <ConnectedServicesPanel />

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
