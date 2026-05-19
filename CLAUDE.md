# Preflight — CLAUDE.md

## Guardrails

This project operates under the Corporate AI Solutions global guardrails at
`~/.claude/CLAUDE.md`. All workflow contracts, stop-phrase rules, responsive
design rules, auth-page-pattern rules, VOICE AI STANDARD RULE, and quality
self-checks defined there apply without exception.

**Risk Tier: STANDARD** (testbed-with-real-projects)
- Two real projects feed v0 (Lot 442 Seafields, Lot 91 Wavecrest)
- BYOK-clean discipline applies — every metered call on the user's account
- Self-host as the only supported deployment model
- Approval-gate equivalent here: drafter sees results immediately,
  nothing auto-routes to the project owner; the drafter chooses what to share

---

## Project Purpose

Drafter-led pre-submission triage for DA drawing sets. The drafter uploads
a PDF; the rule engine runs every active register row against the
extracted text and project facts; the triage sheet renders before the set
leaves the drafter's desk.

The strategic point: every recurring rejection the project has ever received
is codified as a register row. The tool is the institutional memory of
"things Dennis has been hand-checking for years via Claude/GPT," extracted
into a structured, attributable, reusable form. The system gets monotonically
smarter every project cycle — never retrained, just appended.

Two real testbed projects from day one:
- **Lot 442 Seafields** — F2K + ModularWA workflow
- **Lot 91 Wavecrest** — Unison + Unison's drafter workflow

Two-project testbed is intentional: one customer = miss every generalisation;
three+ = speculative abstraction; two = forcing function for clean architecture.

---

## Architecture

Next.js 14 App Router on Vercel with Supabase (pgvector for per-project KB).

```
Project owner side                       Drafter side
──────────────────                       ────────────
Sign in via /login                       Click shareable URL → /drafter/[token]
Curate register at /projects/[id]        Drop PDF → /api/drafter/upload
Generate drafter link                    Rule engine + LLM manual-check
Ingest correspondence:                   Triage sheet renders inline
  - Drive OAuth (auto sync)
  - Inbound email webhook
```

**Hard constraints:**
- Multi-project from day one — never embed F2K-specific or any single-customer assumptions in shared paths
- Drafter never logs in. Drafter never sees project facts or register sources unless the operator deliberately exposes them in result messages
- LLM never auto-passes. "unsure" is a valid first-class return
- Tool never supplies a specific value the drafter could copy verbatim (street name, dimension, citation) — flags for human review instead
- Per-project KB isolation. No cross-project similarity search ever
- BYOK totality — every metered API call lands on the user's account

---

## Key Files

### Schema
- `supabase/migrations/0001_init.sql` — full schema, RLS-enabled, `match_kb_chunks()` per-project retrieval

### Libraries
- `lib/supabase/{server,browser,service,auth}.ts` — clients + auth helper + cron secret
- `lib/drafter-token.ts` — HMAC-signed shareable URLs (raw never stored; only hash persisted)
- `lib/rules/types.ts` — `CheckType`, `CheckSpec` discriminated union, `RegisterRow`
- `lib/rules/engine.ts` — deterministic evaluator for text-rule / logic-rule / cross-ref
- `lib/rules/seed-rules.ts` — canonical starter register applied to every new project
- `lib/pdf/extract.ts` — pdf-parse for born-digital; CAD-PDF positioned-text deferred
- `lib/drive/client.ts` — Google OAuth + stub sync handler
- `lib/ai/anthropic.ts` — singleton Claude client (Anthropic direct or OpenRouter)
- `lib/ai/manual-check.ts` — LLM call for manual-check rows with tight prompt + JSON-tail outcome parsing
- `lib/email/inbound.ts` — persists raw inbound webhook payloads (classification deferred)

### Routes
- `app/(dashboard)/projects/[id]` — project detail with register, facts, drafter links, recent runs
- `app/drafter/[token]` — drafter landing + upload + triage sheet
- `app/api/projects/[id]/drafter-link` — operator generates a new drafter URL
- `app/api/drafter/upload` — drafter posts PDF; runs rule engine + LLM manual-check; returns triage payload
- `app/api/webhooks/resend-inbound` — Resend inbound webhook (stores raw)
- `app/api/drive/oauth` + `app/api/drive/oauth/callback` — Drive OAuth flow
- `app/api/cron/drive-sync` — cron handler (stub sync for v0)

---

## Voice rules (operator + drafter copy)

Per the VOICE AI STANDARD RULE in global CLAUDE.md, Preflight will ship
a voice agent surface in a follow-up turn. The agent's persona matches the
portfolio canonical (consistent across products). Use-cases:
- "Walk me through this triage sheet" (drafter side, voice-narrated results)
- "What changed since the last set?" (drafter side, version comparison)
- "Add a new register row" (operator side, voice-captured)

Until that retrofit, all UI copy on the drafter side is plain, neutral,
non-blame:
- ✓ Confirmed OK — positive but understated
- 🟡 Needs eyes — frames the row as a prompt for the human, never as a verdict
- 🔴 Hard fail — states the issue + the sheet reference + the fix; no blame language

---

## LLM Configuration

- Primary: Anthropic Claude via `@anthropic-ai/sdk`
- Fallback: OpenRouter if `OPENROUTER_API_KEY` is set
- Model for manual-check: Sonnet (default `claude-sonnet-4-5`, override via `PREFLIGHT_MODEL`)
- Model for classification (future inbound-email party classification): Haiku 4.5

Manual-check is one-shot per row. No agentic loops. No streaming. JSON-tail
output parsed; "unsure" is the default when JSON is malformed.

---

## Architectural Rules

### All mutations through API routes
Client components never write to Supabase directly. Every action (link
generation, drafter upload, register edit, Drive OAuth, etc.) routes
through `/api/*`.

### Service role key is server-only
`SUPABASE_SERVICE_ROLE_KEY` never appears in any `'use client'` file or
any `NEXT_PUBLIC_*` variable.

### Drafter tokens never persisted in raw form
Only the HMAC is stored. Rotating `DRAFTER_TOKEN_SECRET` revokes every
outstanding token at once.

### Middleware allowlist pattern
`/api/cron/*`, `/api/webhooks/*`, `/api/drafter/*`, `/drafter/*`, and the
three auth callbacks are allowlisted in `middleware.ts` — they self-
authenticate (cron secret, webhook secret, or drafter token) before doing
anything destructive.

### RLS on every table
JWT-claim multi-org pattern from InvestorPilot migration 029. RLS reads
`current_user_project_ids()` helper. Service-role client bypasses RLS for
cron/webhook/drafter-flow paths only.

### BYOK totality
Every metered third-party call lands on the user's account. No operator-
hosted fallback. Self-host or BYOK-paste keys are the only two modes.

---

## Environment Variables

See `.env.example` for the complete list and `byok.config.json` for the
setup-wizard manifest.

Required:
- Supabase (URL + anon + service-role)
- Anthropic OR OpenRouter
- OpenAI (embeddings)
- Resend (outbound + inbound webhook secret)
- Google OAuth (Drive sync)
- CRON_SECRET, DRAFTER_TOKEN_SECRET (both auto-generatable)
- NEXT_PUBLIC_APP_URL

ElevenLabs is declared in the manifest as "deferred" — leave blank for v0;
populated when the voice-agent retrofit lands.

---

## Cron schedule

Configured in `vercel.json`:

- `/api/cron/drive-sync` every 30 minutes — incremental Drive pull per project

All cron routes verify `CRON_SECRET` header before any work.

---

## Skill Routing

When the user's request matches an available skill, ALWAYS invoke it via
the Skill tool as your FIRST action — same convention as the portfolio standard.

| Stage / Situation | Skill to invoke |
|---|---|
| Bugs, errors, 500s | `/investigate` |
| Ship, deploy, push, create PR | `/ship` |
| QA, test the site | `/qa` |
| Code review | `/review` |
| Architecture review | `/plan-eng-review` |
| Save progress, checkpoint | `/checkpoint` |
| Visual audit | `/design-review` |
