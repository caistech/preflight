import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { persistInboundEmail } from '@/lib/email/inbound';

export const dynamic = 'force-dynamic';

/**
 * Inbound email webhook — Resend posts here when an email arrives at the
 * project's inbound address (e.g. lot-442-seafields@inbound.<domain>).
 *
 * v0 persists raw payloads only. Classification (planner / engineer / council /
 * drafter) + KB write lands in a follow-up turn.
 *
 * Allowlisted in middleware so the shared-secret check below runs.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.RESEND_INBOUND_SECRET;
  const provided = request.headers.get('x-resend-secret');
  if (expected && expected !== provided) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = createServiceClient();
  const result = await persistInboundEmail(db, {
    message_id:
      (payload.message_id as string) ||
      (payload.id as string) ||
      `inbound-${Date.now()}`,
    from: payload.from as string | undefined,
    to: payload.to as string | undefined,
    subject: payload.subject as string | undefined,
    text: payload.text as string | undefined,
    html: payload.html as string | undefined,
    raw: payload,
  });

  return NextResponse.json({ ok: true, ...result });
}
