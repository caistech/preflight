-- ============================================================================
-- match_kb_chunks rewrite — scope-aware retrieval.
--
-- A project running a manual-check rule should now see chunks from:
--   1. Its own project-scoped docs (scope='project', project_id matches)
--   2. All cross-project docs whose scope_applies_when filter is a subset
--      of this project's project_facts (e.g. a ModularWA detail with
--      applies_when={"builder":"ModularWA"} surfaces for every project
--      whose builder fact = ModularWA)
--   3. All general docs (scope='general')
--
-- applies_when matching uses the @> "contains" operator on jsonb — the
-- project's facts must be a SUPERSET of the filter for inclusion.
--
-- Returns the same shape as before plus a `scope` column so callers know
-- where each chunk came from (useful for surfacing "this came from a
-- ModularWA cross-project doc" in the LLM context).
-- ============================================================================

drop function if exists public.match_kb_chunks(vector(1536), int, uuid);

create or replace function public.match_kb_chunks(
  query_embedding vector(1536),
  match_count int default 5,
  in_project_id uuid default null
)
returns table (
  id uuid,
  document_id uuid,
  project_id uuid,
  content text,
  similarity float,
  scope text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  project_facts_json jsonb := '{}'::jsonb;
begin
  -- Assemble the calling project's facts as one jsonb object so we can
  -- evaluate applies_when via the @> contains operator. NULL in_project_id
  -- means "no project context" — only general docs are retrievable.
  if in_project_id is not null then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into project_facts_json
      from public.project_facts
      where project_facts.project_id = in_project_id;
  end if;

  return query
    select
      c.id,
      c.document_id,
      c.project_id,
      c.content,
      1 - (c.embedding <=> query_embedding) as similarity,
      d.scope
    from public.kb_chunks c
    join public.kb_documents d on d.id = c.document_id
    where
      -- General: always in scope.
      d.scope = 'general'
      or
      -- Project-scoped: only when project_id matches.
      (d.scope = 'project' and in_project_id is not null and d.project_id = in_project_id)
      or
      -- Cross-project: applies_when filter must be a subset of the calling
      -- project's facts. NULL applies_when on a cross-project doc would be
      -- a misconfiguration; we exclude it rather than treating as match-all.
      (
        d.scope = 'cross-project'
        and in_project_id is not null
        and d.scope_applies_when is not null
        and project_facts_json @> d.scope_applies_when
      )
    order by c.embedding <=> query_embedding
    limit match_count;
end;
$$;
