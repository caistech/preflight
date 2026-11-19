-- ============================================================================
-- sheet_readings — a drawn sheet is read once; every later run uses that reading.
--
-- Keyed by what the file IS (sha256 of its bytes) and which reader produced the
-- text (lib/pdf/transcribe.ts READER_VERSION). Same file + same reader = same text,
-- with no model call. See lib/pdf/sheet-readings.ts for why (three runs on the same
-- Lot 91 sheets produced three different transcriptions, 2026-11-19).
--
-- Not project-scoped on purpose: the reading of a file depends only on its bytes,
-- and the table holds no project facts. Access is service-role only (RLS on, no
-- policies) — no browser client ever reads or writes it.
-- ============================================================================

create table if not exists public.sheet_readings (
  id              uuid primary key default gen_random_uuid(),
  content_sha256  text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  reader_version  text not null,
  file_name       text,
  text            text not null,
  read_ms         integer,
  created_at      timestamptz not null default now()
);

create unique index if not exists idx_sheet_readings_hash_version
  on public.sheet_readings (content_sha256, reader_version);

alter table public.sheet_readings enable row level security;
