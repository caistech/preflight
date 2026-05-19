-- 0004 — operator-editable upload guidance shown to the drafter on the landing page + email.

alter table public.projects add column if not exists upload_instructions text;

-- Seed sensible defaults for the two starter projects so the landing page + email
-- have something useful on day one. Operators can edit these via SQL or the
-- project-settings UI when that ships.
update public.projects
set upload_instructions =
  'Upload the latest combined drawing set (site plan, floor plan, elevations, electrical, fencing plan). Born-digital PDFs are best — CAD-exported PDFs work but the text extraction is less reliable for positioned drafting text.'
where slug = 'lot-442-seafields' and upload_instructions is null;

update public.projects
set upload_instructions =
  'Upload your latest single-dwelling drawing set. Born-digital PDF preferred.'
where slug = 'lot-91-wavecrest' and upload_instructions is null;
