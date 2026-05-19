# Preflight

**Drafter-led pre-submission triage for DA drawing sets.**

A drafter drops in their latest PDF and gets back a one-page triage sheet
against the project's accumulated knowledge — every known DA-blocking
error the project has hit before, surfaced *before* the set leaves their
desk. The 5-day round-trip (drafter → admin → project owner → AI tools
→ admin → drafter) collapses to a 5-minute self-service check.

Preflight is **BYOK and self-host by design**. Every metered API call lands
on the operator's account, not the developer's.

---

## Who this is for

- **Drafters and drafting coordinators** who'd rather catch their own
  recurring issues than receive an email about them five days later.
- **Project owners** (builder coordinators, developers, fund managers
  running construction projects) who want a tool the drafter actually
  WANTS to use — not a compliance gate that creates friction.
- **Drafting / building services firms** running parallel projects who
  want to operationalise institutional memory rather than re-discovering
  the same Council audit pattern every quarter.

---

## How it works

1. **Project owner curates the register.** Every recurring rejection the
   project has ever received is one row, with its source attributed
   (planner letter, Council audit, engineer note, project definition).
   The register grows monotonically — every new error caught becomes a
   new row, never re-invented from scratch.

2. **Project owner generates a drafter link.** Short-lived per-project URL.
   The drafter clicks; no account needed.

3. **Drafter drops the PDF.** Rule engine runs every register row against
   the extracted text and project facts:
   - **text-rule** / **logic-rule** / **cross-ref** rows: deterministic
     code, no LLM, returns pass/fail/sheet-reference.
   - **manual-check** rows: tight LLM call with the row's specific
     question — "unsure" is a valid return; the LLM never auto-passes
     and never invents specifics (street names, dimensions, citations).

4. **One-page triage sheet renders.** ✅ confirmed OK · 🟡 needs eyes ·
   🔴 hard fails. Drafter fixes; nothing is shared back to the project
   owner unless the drafter chooses to.

---

## Architecture

- **Next.js 14** (App Router, server components by default)
- **Supabase** for multi-project persistence + auth + `pgvector` KB
- **Vercel** for deploy + cron (Google Drive incremental sync)
- **Anthropic Claude** for manual-check rows (Sonnet) — alternative via
  OpenRouter if `OPENROUTER_API_KEY` is set
- **OpenAI** for embeddings (text-embedding-3-small) — per-project KB
  retrieval
- **Resend** for outbound notifications (drafter-link emails) + inbound
  webhook (planner / engineer / Council correspondence into the project KB)
- **Google Drive** for per-project source-document ingestion via OAuth

Every project is fully isolated: its own register, its own facts, its own
KB, its own drafter tokens. No cross-project bleed at any layer.

---

## Local development

```bash
git clone <repo>
cd preflight
cp .env.example .env.local
# fill in the credentials — or run the BYOK setup wizard:
node ../byok-setup/scripts/setup-byok.mjs

npm install --legacy-peer-deps
supabase start                # local Postgres + auth + storage
supabase db push              # apply migrations
node scripts/seed-projects.mjs   # seeds Lot 442 Seafields + Lot 91 Wavecrest
npm run dev
```

Open `http://localhost:3000`.

---

## Adding a project

For v0, projects are seeded via SQL (the projects-create UI lands in a
follow-up turn). To add a project:

```sql
INSERT INTO public.projects (slug, name, owner_label, drafter_label, council, description)
VALUES (
  'lot-442-seafields',
  'Lot 442 Seafields',
  'F2K',
  'ModularWA',
  'Wollongong City Council',
  'Modular dwelling subdivision, 8 units, slab-on-biscuit footing system'
);

-- Add facts that gate rule evaluation
INSERT INTO public.project_facts (project_id, key, value, source)
SELECT id, 'footing_system', 'slab-on-biscuit', 'Project definition'
FROM public.projects WHERE slug = 'lot-442-seafields';

-- Seed the standard register (run the seed script — instantiates from lib/rules/seed-rules.ts)
node scripts/seed-register.mjs --project lot-442-seafields
```

A drafter link is then issued from the project page in the dashboard.

---

## Status of components

| Component | Status |
|---|---|
| Auth (login / magic-link / forgot / reset) | ✓ Live |
| Multi-project schema + RLS | ✓ Live |
| Requirements register data model | ✓ Live |
| Rule engine (text-rule, logic-rule, cross-ref) | ✓ Live |
| Manual-check LLM layer | ✓ Live (Claude Sonnet via Anthropic or OpenRouter) |
| Drafter shareable URLs | ✓ Live |
| Drafter upload + triage sheet UI | ✓ Live |
| PDF extraction (pdf-parse path) | ✓ Live (born-digital PDFs) |
| PDF extraction (CAD-PDF positioned text) | ⏳ Deferred — title block / legend positioned-text path needs pdfjs-dist |
| Google Drive OAuth | ✓ Live |
| Google Drive incremental sync | ⏳ Deferred — cron route exists with stub handler |
| Resend inbound email webhook | ✓ Live (persists raw payloads) |
| Inbound email classification + KB ingest | ⏳ Deferred — sender classification + chunk + embed lands next |
| Voice agent per VOICE AI STANDARD RULE | ⏳ Deferred — `@caistech/elevenlabs-convai` retrofit lands next |
| Register-row CRUD UI | ⏳ Deferred — SQL editor for v0, UI lands next |

---

## License

Proprietary. © Corporate AI Solutions. Released selectively under the
portfolio's BYOK-free open-source slate at the operator's discretion.
