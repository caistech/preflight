-- A sheet with no text layer is now read from its drawing image (lib/pdf/transcribe.ts),
-- and the drawing set records that its text came that way.
alter table drawing_sets drop constraint if exists drawing_sets_extraction_method_check;
alter table drawing_sets add constraint drawing_sets_extraction_method_check
  check (extraction_method in ('pdf-parse', 'cad-pdf', 'vision', 'failed'));
