# TODOs

Deferred from the review-jobs engineering review (2026-11-19). Each was a deliberate cut
to ship repeatable Lot 91 checks first.

## Read drawn sheets in sections

**What:** render each PDF page to an image and read the title block, each detail and the
notes separately, instead of sending the whole page as one document.

**Why:** the only fix for mistakes inside a reading — missed notes, invented labels,
misread title blocks. Saved readings (lib/pdf/sheet-readings.ts) make results repeatable;
they cannot make a bad reading good. Three readings of S262646 put the "50X150 JOIST"
note in 1 of 3, and every one read the title block's Drawn/Designed fields as blank when
the sheet shows "JCM".

**Pros:** accuracy on drawn sheets, title blocks read on their own.
**Cons:** needs a PDF-to-image renderer that runs in a serverless function (pdfjs + canvas
has crashed serverless module loading before); more model calls per sheet.

**Context:** comes back automatically if `scripts/gate-s262646.mjs` fails after a reread.

**Depends on:** the S262646 gate result.

## Draft the contractor reply

**What:** from a run's confirmed findings, draft the reply to the contractor — each point
tied to the rule's source document, attachments listed — and save it as a held Gmail
draft through the orchestrator.

**Why:** the Lot 91 reply to the engineer (2026-11-19) was drafted by hand from the run.

**Pros:** closes the loop from check to correspondence. **Cons:** needs the orchestrator
to save Gmail drafts with attachments, which is not verified.

**Depends on:** fails being held to their quote (lib/rules/evidence.ts) — only a fail with
its evidence on the sheet may become a pushback.

## Gather a job's documents from email attachments

**What:** ingest attachments from a project's email threads into its knowledge base.

**Why:** the Modular WA structural engineering for Lot 91 was in an August email
attachment, not the project folder, and was found only by searching mail.

**Pros:** evidence stops being scattered. **Cons:** needs permission to read the client's
mail; copies already in Drive must not be ingested twice.

**Depends on:** Gmail read scope on the tenant.
