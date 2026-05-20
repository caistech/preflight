/**
 * Liability disclaimer — visible on every Preflight surface so it's seen
 * at every touchpoint (admin page, drafter landing, triage result viewer)
 * and not buried in a terms-of-service link.
 *
 * The tool surfaces patterns; the professional whose name appears on the
 * drawing carries responsibility for what's actually in the set.
 */

export function Disclaimer({ variant = 'default' }: { variant?: 'default' | 'compact' }) {
  if (variant === 'compact') {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-3 text-xs text-gray-500">
        <strong className="text-gray-400">Disclaimer.</strong> Preflight is a regression check, not a compliance certification.
        Responsibility for the drawing's correctness — including anything the tool misses — rests with the licensed
        drafter, engineer, architect, surveyor, or other professional whose name appears on the set. Preflight,
        Corporate AI Solutions, and the project owner accept no liability. &quot;Confirmed OK&quot; results are within
        the tool&apos;s scope only and do not constitute a sign-off on Council acceptance.
      </div>
    );
  }

  return (
    <section className="mt-10 rounded-2xl border border-gray-800 bg-gray-900/30 p-5 text-xs text-gray-400">
      <div className="mb-2 font-semibold text-gray-300">Disclaimer</div>
      <p className="mb-2">
        Preflight is a regression check against the project&apos;s accumulated pattern register. It is{' '}
        <strong className="text-gray-300">not</strong> a certification of compliance, accuracy, or fitness for
        submission.
      </p>
      <p className="mb-2">
        Responsibility for the correctness of the drawing — including any item the tool fails to catch — rests
        with the licensed drafter, engineer, architect, surveyor, or other professional whose name appears on the
        set. Preflight, Corporate AI Solutions, and the project owner accept no liability for any error or
        omission in the drawing.
      </p>
      <p>
        &quot;Confirmed OK&quot; outcomes are positive confirmation within the tool&apos;s scope only — they do
        not constitute a sign-off on Council acceptance. &quot;Needs eyes&quot; outcomes are explicit
        acknowledgement that human professional judgment is required.
      </p>
    </section>
  );
}
