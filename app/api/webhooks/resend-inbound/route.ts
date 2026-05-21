import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { createServiceClient } from '@/lib/supabase/service';
import { persistInboundEmail } from '@/lib/email/inbound';

export const dynamic = 'force-dynamic';

/**
 * Resend inbound webhook.
 *
 * Resend signs every webhook delivery with svix (svix-id / svix-timestamp /
 * svix-signature headers). The signing secret is the `whsec_…` value Resend
 * gives you when you create the webhook (stored as RESEND_INBOUND_SECRET).
 *
 * Payload shape for inbound (event type 'email.received'):
 *   {
 *     type: 'email.received',
 *     created_at: '...',
 *     data: {
 *       from: { email, name },
 *       to: ['alias@inbound.domain'],
 *       subject: '...',
 *       text: '...',
 *       html: '...',
 *       headers: {...}
 *     }
 *   }
 *
 * On match we hand off to persistInboundEmail which auto-promotes to KB.
 *
 * Allowlisted in middleware so svix verification runs here.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // svix needs the raw body string for HMAC verification
  const rawBody = await request.text();
  const headers = {
    'svix-id': request.headers.get('svix-id') ?? '',
    'svix-timestamp': request.headers.get('svix-timestamp') ?? '',
    'svix-signature': request.headers.get('svix-signature') ?? '',
  };

  let verified: unknown;
  try {
    const wh = new Webhook(secret);
    verified = wh.verify(rawBody, headers);
  } catch (e) {
    // Bad/missing signature — reject without persisting anything
    return NextResponse.json({ error: `Signature verification failed: ${(e as Error).message}` }, { status: 401 });
  }

  interface RawAttachment {
    filename?: string;
    name?: string;
    content_type?: string;
    contentType?: string;
    type?: string;
    content?: string;        // base64
    content_base64?: string;
    data?: string;           // base64 (alt provider shape)
    url?: string;
    href?: string;
  }

  const envelope = verified as {
    type?: string;
    created_at?: string;
    data?: {
      from?: { email?: string; name?: string } | string;
      to?: string[] | string;
      subject?: string;
      text?: string;
      html?: string;
      headers?: Record<string, string>;
      email_id?: string;
      attachments?: RawAttachment[];
    };
    // some inbound providers put fields at the top level — accept both
    from?: { email?: string; name?: string } | string;
    to?: string[] | string;
    subject?: string;
    text?: string;
    html?: string;
    attachments?: RawAttachment[];
    id?: string;
    message_id?: string;
  };

  // Ignore non-inbound events (e.g. if the same webhook URL ever gets bound
  // to outbound events by mistake — be polite, return 200 so Resend doesn't
  // retry forever).
  if (envelope.type && envelope.type !== 'email.received' && envelope.type !== 'inbound.received') {
    return NextResponse.json({ ok: true, ignored: `event type ${envelope.type}` });
  }

  const data = (envelope.data ?? envelope) as {
    from?: { email?: string; name?: string } | string;
    to?: string[] | string;
    subject?: string;
    text?: string;
    html?: string;
    email_id?: string;
    attachments?: RawAttachment[];
  };
  const fromRaw = data.from;
  const toRaw = data.to;
  const fromEmail = typeof fromRaw === 'string' ? fromRaw : fromRaw?.email;
  const toEmail = Array.isArray(toRaw) ? toRaw[0] : toRaw;

  const messageId =
    envelope.id ??
    envelope.message_id ??
    data.email_id ??
    headers['svix-id'] ??
    `inbound-${Date.now()}`;

  // Resend's inbound webhook payload deliberately omits the body — we have to
  // fetch it via GET /emails/inbound/{email_id} to get text/html (and the
  // attachments array). Webhooks stay small + cheap; full content lives
  // behind a second API call.
  let text = data.text;
  let html = data.html;
  let attachmentsRaw: RawAttachment[] = data.attachments ?? envelope.attachments ?? [];

  if ((!text && !html && attachmentsRaw.length === 0) && data.email_id) {
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      try {
        const r = await fetch(`https://api.resend.com/emails/inbound/${data.email_id}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          const full = (await r.json()) as { text?: string; html?: string; attachments?: RawAttachment[] };
          text = full.text ?? text;
          html = full.html ?? html;
          if (Array.isArray(full.attachments) && full.attachments.length > 0) {
            attachmentsRaw = full.attachments;
          }
        }
      } catch {
        // body fetch failed — fall through; persist row with empty body so we
        // at least audit the receipt
      }
    }
  }

  // Normalise the various provider shapes into our InboundAttachment shape.
  const attachments = attachmentsRaw
    .map((a) => {
      const filename = (a.filename ?? a.name ?? '').trim();
      if (!filename) return null;
      const content_base64 = a.content_base64 ?? a.content ?? a.data;
      const url = a.url ?? a.href;
      if (!content_base64 && !url) return null;
      return {
        filename,
        content_type: a.content_type ?? a.contentType ?? a.type,
        content_base64,
        url,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const db = createServiceClient();
  const result = await persistInboundEmail(db, {
    message_id: messageId,
    from: fromEmail,
    to: toEmail,
    subject: data.subject,
    text,
    html,
    attachments,
    raw: envelope,
  });

  return NextResponse.json({ ok: true, ...result });
}
