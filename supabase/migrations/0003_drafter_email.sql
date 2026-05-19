-- 0003 — drafter_email on drafter_tokens so operator can email the link directly.

alter table public.drafter_tokens add column if not exists drafter_email text;
