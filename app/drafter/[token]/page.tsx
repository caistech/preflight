import { createServiceClient } from '@/lib/supabase/service';
import { hashDrafterToken } from '@/lib/drafter-token';
import { DrafterUpload } from './drafter-upload';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function DrafterPage({ params }: Props) {
  const { token } = await params;
  const db = createServiceClient();

  let projectName = '';
  let projectId = '';
  let drafterName: string | null = null;
  let tokenInvalid = false;
  let tokenInvalidReason = '';

  try {
    const hash = hashDrafterToken(token);
    const { data: t } = await db
      .from('drafter_tokens')
      .select('id, project_id, drafter_name, expires_at, revoked_at, projects(name)')
      .eq('token_hash', hash)
      .single();

    if (!t) {
      tokenInvalid = true;
      tokenInvalidReason = 'This link is not recognised. It may have been rotated or never issued.';
    } else if (t.revoked_at) {
      tokenInvalid = true;
      tokenInvalidReason = 'This link has been revoked by the project owner.';
    } else if (new Date(t.expires_at) < new Date()) {
      tokenInvalid = true;
      tokenInvalidReason = 'This link has expired. Ask the project owner for a fresh link.';
    } else {
      projectId = t.project_id;
      drafterName = t.drafter_name;
      // @ts-expect-error joined relation
      projectName = t.projects?.name ?? '';
    }
  } catch (e) {
    tokenInvalid = true;
    tokenInvalidReason = `Could not validate link: ${(e as Error).message}`;
  }

  if (tokenInvalid) {
    return (
      <main className="min-h-screen bg-gray-950 text-white">
        <div className="mx-auto max-w-md px-6 py-16">
          <div className="mb-2 text-sm text-emerald-400">Preflight</div>
          <h1 className="mb-2 text-3xl font-bold">Link not valid</h1>
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
            {tokenInvalidReason}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-2 text-sm text-emerald-400">Preflight</div>
        <h1 className="mb-2 text-3xl font-bold">
          Pre-submission check{drafterName ? ` — ${drafterName}` : ''}
        </h1>
        <p className="mb-8 max-w-2xl text-sm text-gray-400">
          You&apos;re working on <strong className="text-gray-200">{projectName}</strong>. Drop the latest set
          and we&apos;ll run it against the project&apos;s requirements register before it
          leaves your desk. No account, no portal — the result is yours to act
          on; you decide what (if anything) you share back.
        </p>

        <DrafterUpload token={token} projectId={projectId} />

        <div className="mt-10 rounded-2xl border border-gray-800 bg-gray-900/30 p-4 text-xs text-gray-500">
          <div className="mb-1 font-semibold text-gray-400">Honest limits</div>
          Preflight catches <strong>known</strong> error types only — every
          recurring rejection the project has logged. A novel error passes
          straight through. It is a regression check, not a substitute for
          human review. Items marked <span className="text-amber-400">needs eyes</span> are
          prompts for a human (you), not findings.
        </div>
      </div>
    </main>
  );
}
