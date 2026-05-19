-- 0005 — align inbound_emails columns with lib/email/inbound.ts.

alter table public.inbound_emails add column if not exists message_id text;
alter table public.inbound_emails add column if not exists body_text  text;
alter table public.inbound_emails add column if not exists body_html  text;
alter table public.inbound_emails add column if not exists parsed     boolean not null default false;
alter table public.inbound_emails add column if not exists kb_document_id uuid references public.kb_documents(id) on delete set null;

-- message_id is the idempotency key for the webhook upsert
create unique index if not exists idx_inbound_emails_message_id on public.inbound_emails (message_id) where message_id is not null;
create index if not exists idx_inbound_emails_parsed on public.inbound_emails (parsed, created_at desc);
