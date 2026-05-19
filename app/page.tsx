import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <section className="px-6 pt-24 pb-16">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 inline-block rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            Private beta
          </div>
          <h1 className="mb-6 text-4xl font-bold leading-tight md:text-6xl">
            Catch known issues before the set leaves your desk.
            <br />
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              Not five days later.
            </span>
          </h1>
          <p className="mb-10 max-w-2xl text-lg text-gray-400 md:text-xl">
            Preflight is a drafter-led pre-submission triage. Drop in a drawing
            set, get back a one-page sheet against the project&apos;s
            accumulated knowledge — every known DA-blocking error the project
            has hit before, surfaced before the set leaves your desk.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/projects"
              className="rounded-lg bg-emerald-500 px-6 py-3 font-medium text-gray-950 transition-colors hover:bg-emerald-400"
            >
              Open project dashboard
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-gray-700 px-6 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-900"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-gray-800 bg-gray-900/40 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-2xl font-semibold">How it works</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            {[
              {
                step: '1',
                title: 'Project owner curates the register',
                body: 'Every recurring rejection from past projects becomes a register row, with its source attributed.',
              },
              {
                step: '2',
                title: 'Drafter gets a project link',
                body: 'Short-lived shareable URL. No account, no portal, no friction.',
              },
              {
                step: '3',
                title: 'Drafter drops the PDF',
                body: 'Rule engine runs against the project\'s register. Manual-check rows are LLM-assisted with “unsure” as a valid answer.',
              },
              {
                step: '4',
                title: 'One-page triage sheet',
                body: 'Hard fails, items needing eyes, and what the set already gets right. Drafter fixes; nothing goes back to the project owner.',
              },
            ].map((s) => (
              <div
                key={s.step}
                className="rounded-2xl border border-gray-800 bg-gray-950 p-6"
              >
                <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 font-bold text-gray-950">
                  {s.step}
                </div>
                <div className="mb-2 font-semibold">{s.title}</div>
                <div className="text-sm text-gray-400">{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl text-sm text-gray-400">
          Built by{' '}
          <a
            href="https://corporate-ai-solutions.vercel.app/"
            className="text-emerald-400 hover:underline"
          >
            Corporate AI Solutions
          </a>
          . Preflight is BYOK and self-host by design — every metered API call
          lands on your account, not ours.
        </div>
      </section>
    </main>
  );
}
