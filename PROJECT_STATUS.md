# Preflight — Project Status

> Save-game file per the global CLAUDE.md "Project Status Tracking" section.
> Update at session end (or when pausing) so the next session starts cold-readable.
> Created 2026-05-21 from an inline minimal frame — the documented template at
> `~/PycharmProjects/packages/corporate-ai-common/PROJECT_STATUS_TEMPLATE.md`
> wasn't present on this machine.

## What this project is

Drafter-led pre-submission triage for DA drawing sets. Drafter drops a PDF; the
deterministic rule engine plus a constrained Claude judgement layer produce a
per-sheet triage sheet (Confirmed OK / Needs eyes / Hard fail) before the set
leaves the drafter's desk. Multi-project from day one; BYOK-totality (every
metered call lands on the user's account); self-host is the only supported
deployment model.

## Testbeds

- **Lot 442 Seafields** — F2K + ModularWA workflow
- **Lot 91 Wavecrest** — Unison + Unison's drafter workflow

Two-project testbed is deliberate (one = miss every generalisation; three+ =
speculative abstraction; two = forcing function for clean architecture).

## Risk tier

STANDARD (testbed-with-real-projects). Adjacent council-side product opportunity
exists ([[preflight-assessor-variant]] in `memory/`) — would be REGULATED if pursued.

## Recent commit context

Latest five commits at time of writing:

- `bc49d33` chore(seed): canonical seed now includes title-block manual-check + 3 datum rules
- `3426c05` fix(inbound): full unique index on message_id (was partial — broke upsert audit)
- `abdfa49` fix(kb): dedupe ingest by (project_id, title) + cleanup script
- `6112008` feat(cron): ?project=<slug|uuid> override + raw_nonpaused_count diagnostic
- `560f1e8` chore: bust function cache so Lot 91 drive_connection picks up

## Current focus

_Owner to fill in. Last touched: 2026-05-21 — compliance sweep (metadata block,
manifest registration, PROJECT_STATUS bootstrap). Email drafted to Peter Wilks at
City of Greater Geraldton exploring whether the same engine could run on the
council assessor side — not yet sent._

## Next up

_Owner to fill in. Open items the compliance sweep surfaced but did not close:_

- Voice agent retrofit per VOICE AI STANDARD RULE (currently deferred per project CLAUDE.md)
- Project-owner self-signup flow (currently provisioned out-of-band; flagged during 2026-05-20 auth sweep)
- Decision on whether to act on the Peter Wilks outreach if it produces interest — would spin a parallel `preflight-assessor` SKU rather than feature-flag the drafter product

## Blockers

_Owner to fill in. None currently identified._

## Key facts non-obvious from the code

- Drafter never logs in — uses HMAC-signed shareable URL (`lib/drafter-token.ts`). Rotating `DRAFTER_TOKEN_SECRET` revokes every outstanding token at once.
- LLM is one-shot per row, no agentic loops, no streaming. "unsure" is a valid first-class return; never auto-passes; never invents a specific value.
- Per-project KB isolation is a hard constraint — no cross-project similarity search ever.
- Middleware allowlist pattern is the security perimeter: `/api/cron/*`, `/api/webhooks/*`, `/api/drafter/*`, `/drafter/*`, and the three auth callbacks self-authenticate (cron secret / webhook secret / drafter token) before doing anything destructive.

## Memory pointers

See `memory/MEMORY.md` for the per-project memory index. Particularly relevant for
external-facing communication:

- [[peter-wilks-geraldton]] — warm contact at City of Greater Geraldton, prior DA history
- [[dennis-tools-as-pm-work]] — how Dennis positions tools externally (extension of PM role, not a side hobby)
- [[preflight-assessor-variant]] — strategic context on the council-side adjacent product
