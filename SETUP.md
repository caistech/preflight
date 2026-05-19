# Preflight — Setup

Step-by-step from a fresh checkout to "drafter clicks link, gets triage
sheet" for a real project. ~25 minutes end-to-end.

## 1. Prereqs

- Node 20+
- A Supabase project (free tier is fine)
- An Anthropic API key OR an OpenRouter API key
- An OpenAI API key (for embeddings)
- A Resend account with a verified sending domain
- A Google Cloud Console project with OAuth credentials (only if you want
  Drive sync — optional for v0)

## 2. Clone + install

```bash
git clone <repo>
cd preflight
npm install --legacy-peer-deps
```

## 3. Configure BYOK credentials

```bash
node ../byok-setup/scripts/setup-byok.mjs
```

Walks you through every credential the project needs, validates each as
you paste, writes `.env.local`. ~10 minutes if you have the accounts;
~30 minutes if you need to create them.

If you don't have `byok-setup` cloned alongside, copy `.env.example` to
`.env.local` and fill manually.

## 4. Apply the schema

Link to your Supabase project:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

(Or use the pooler URL form if your network blocks IPv6:
`supabase db push --db-url postgresql://postgres.<ref>:<pw>@aws-1-<region>.pooler.supabase.com:6543/postgres`)

## 5. Seed the two starter projects

```bash
node scripts/seed-projects.mjs
```

This creates:
- **Lot 442 Seafields** — F2K + ModularWA testbed
- **Lot 91 Wavecrest** — Unison + Unison's drafter testbed

Each lands with project facts (`footing_system`, `unit_count`, etc.) and
a starter register populated from `lib/rules/seed-rules.ts`.

## 6. Configure Supabase Auth

In the Supabase dashboard → Authentication → URL Configuration:

- **Site URL:** `https://<your-deploy>.vercel.app` (or `http://localhost:3000` for dev)
- **Redirect URLs allowlist:**
  - `<site-url>/api/auth/callback`
  - `<site-url>/api/auth/recover`
  - `<site-url>/api/drive/oauth/callback`

In **Auth → Email settings**, point SMTP at Resend (host `smtp.resend.com`,
port 465, user `resend`, password = your Resend API key, admin email =
your verified sender). Raise the rate limit to 30/hr while testing.

## 7. Run dev

```bash
npm run dev
```

Open `http://localhost:3000`.

## 8. First sign-in

- Hit `http://localhost:3000/login`
- Use magic link to your email
- Click the link from the Resend email
- You land at `/projects` and see Lot 442 Seafields + Lot 91 Wavecrest

## 9. Generate a drafter link

- Click into either project
- Use the **Drafter link** panel: enter a drafter name, set expiry
- Copy the URL (it's shown once; the token never round-trips through the DB
  in cleartext)

## 10. Test the full drafter flow

- Paste the drafter URL in a private browser window
- Drop in any PDF — for the first end-to-end test, a born-digital PDF
  (anything text-based, even a small invoice) is fine to verify the
  pipeline runs
- The triage sheet renders inline with hard fails / needs eyes / confirmed OK

## 11. Connect Google Drive (optional)

From the project page, click the Drive connect link (lands when the UI
ships in the next turn — for now use the API directly):

```bash
# Visit /api/drive/oauth?project_id=<uuid> in a signed-in browser
```

OAuth completes; tokens land in `drive_connections`. The cron route
(`/api/cron/drive-sync`) handles incremental pulls every 30 minutes — for
v0 it's a stub.

## 12. Inbound email integration

Configure your Resend inbound webhook to POST to:

```
https://<your-deploy>/api/webhooks/resend-inbound
```

Use the `RESEND_INBOUND_SECRET` (from `.env.local`) as the `x-resend-secret`
header.

Set up inbound aliases per project — convention is
`<project-slug>@inbound.<your-domain>`. For example:
- `lot-442-seafields@inbound.preflight.app`
- `lot-91-wavecrest@inbound.preflight.app`

Forward project correspondence (planner letters, Council audits, engineer
notes) to these addresses. v0 persists raw payloads to `inbound_emails`;
the parsing + KB-ingest layer lands in a follow-up turn.

## 13. Deploy

```bash
vercel link
vercel --prod
```

Add every key from `.env.local` to Vercel env vars (production + preview).
Update `NEXT_PUBLIC_APP_URL` to the deployed URL.

Re-update Supabase Auth allowlists with the deployed origin.

Done.

---

## Operator workflow once it's live

For each new project:

1. Create the project (SQL editor for v0; UI lands next turn)
2. Add facts (`footing_system`, `unit_count`, `has_multi_unit_site_plan`,
   `sheet_is_site_wide` — any key the seed rules' `when_facts` gates read)
3. Add project-specific register rows (Council audit findings, planner
   conditions, engineer requirements)
4. Issue a drafter link from the project page
5. Drafter clicks it, drops PDFs, fixes what's flagged, repeats

The system gets monotonically smarter — every new error caught becomes a
new register row, attributable to the source that surfaced it.
