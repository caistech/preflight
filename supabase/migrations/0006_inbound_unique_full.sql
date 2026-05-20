-- 0006 — make inbound_emails.message_id a full unique index instead of partial.
-- A partial unique index (WHERE message_id IS NOT NULL) can't be used as the
-- conflict target for ON CONFLICT, so Supabase JS upsert was silently erroring
-- and the audit-trail insert never landed. Full unique index works because
-- PostgreSQL treats multiple NULLs as distinct by default.

drop index if exists idx_inbound_emails_message_id;
create unique index if not exists idx_inbound_emails_message_id
  on public.inbound_emails (message_id);
