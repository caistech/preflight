-- ============================================================================
-- Operator "Enter as drafter" — short-lived impersonation tokens.
--
-- Adds provenance columns to drafter_tokens so an impersonation row is
-- distinguishable from a real drafter relationship and traceable back to
-- the operator + the source token. The drafter route itself doesn't change
-- — an impersonation token is just a regular drafter_token with a short
-- expiry and a parent link.
-- ============================================================================

alter table public.drafter_tokens
  add column if not exists parent_token_id uuid references public.drafter_tokens(id) on delete set null,
  add column if not exists impersonated_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_drafter_tokens_parent
  on public.drafter_tokens (parent_token_id)
  where parent_token_id is not null;
