import Link from 'next/link';
import { NewProjectForm } from './new-project-form';

export const dynamic = 'force-dynamic';

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/projects" className="text-xs text-emerald-400 hover:underline">
        ← Projects
      </Link>
      <h1 className="mt-2 mb-2 text-3xl font-bold">New project</h1>
      <p className="mb-8 max-w-xl text-sm text-gray-400">
        Spin up a new drafting-job project. Name, slug (auto-derived if you leave it
        blank), council, and owner labels are stored on the project. You become its
        owner automatically. The canonical SEED_RULES are inserted so the register is
        ready to run on day one — add project-specific facts under Project facts after
        the project lands.
      </p>

      <NewProjectForm />
    </div>
  );
}
