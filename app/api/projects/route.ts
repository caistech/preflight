/**
 * POST /api/projects — operator creates a new project.
 *
 * Three writes happen atomically (from the operator's POV):
 *   1. projects row
 *   2. project_memberships row granting the creator 'owner'
 *   3. seed canonical SEED_RULES into register_rows
 *
 * Slug is auto-derived from name if not supplied. Conflicts on slug surface
 * as a 409 with a hint so the form can prompt for a different slug.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { SEED_RULES } from '@/lib/rules/seed-rules';

export const dynamic = 'force-dynamic';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export async function POST(request: NextRequest) {
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 3) {
    return NextResponse.json({ error: 'Project name must be at least 3 characters' }, { status: 400 });
  }
  if (name.length > 200) {
    return NextResponse.json({ error: 'Project name capped at 200 characters' }, { status: 400 });
  }

  const slug = (typeof body.slug === 'string' && body.slug.trim().length > 0)
    ? slugify(body.slug.trim())
    : slugify(name);
  if (slug.length < 3) {
    return NextResponse.json({ error: 'Slug must be at least 3 characters after normalisation' }, { status: 400 });
  }

  const projectFields = {
    slug,
    name,
    owner_label: typeof body.owner_label === 'string' ? body.owner_label.trim() || null : null,
    drafter_label: typeof body.drafter_label === 'string' ? body.drafter_label.trim() || null : null,
    council: typeof body.council === 'string' ? body.council.trim() || null : null,
    description: typeof body.description === 'string' ? body.description.trim() || null : null,
  };

  // Slug uniqueness check first so the error has a clean message.
  const { data: existing } = await db
    .from('projects')
    .select('id, slug')
    .eq('slug', slug)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: `A project with slug "${slug}" already exists. Pick a different name or set slug explicitly.` },
      { status: 409 },
    );
  }

  const { data: project, error: insErr } = await db
    .from('projects')
    .insert(projectFields)
    .select('id, slug, name')
    .single();
  if (insErr || !project) {
    return NextResponse.json({ error: `Could not create project: ${insErr?.message}` }, { status: 500 });
  }

  // Membership — creator becomes owner.
  const { error: memErr } = await db
    .from('project_memberships')
    .insert({ project_id: project.id, user_id: user.id, role: 'owner' });
  if (memErr) {
    // Roll back the project so we don't leave an orphan the operator can't see.
    await db.from('projects').delete().eq('id', project.id);
    return NextResponse.json({ error: `Could not grant membership: ${memErr.message}` }, { status: 500 });
  }

  // Seed canonical rules so the project has something to check against on
  // day one. Per-project facts substitution (e.g. unit_count) is the
  // operator's job in the Project facts panel.
  const seedRows = SEED_RULES.map((r) => ({
    project_id: project.id,
    requirement: r.requirement,
    source: r.source,
    source_url: r.source_url ?? null,
    check_type: r.check_type,
    check_spec: r.check_spec,
    severity: r.severity,
    active: r.active,
  }));
  if (seedRows.length > 0) {
    const { error: seedErr } = await db.from('register_rows').insert(seedRows);
    if (seedErr) {
      // Project + membership stay; seed-failure is a warning, not a fatal.
      console.warn(`[projects.create] seed register insert failed: ${seedErr.message}`);
    }
  }

  await db.from('audit_log').insert({
    project_id: project.id,
    actor_id: user.id,
    action: 'project_created',
    payload: { slug: project.slug, name: project.name, seed_rule_count: seedRows.length },
  });

  return NextResponse.json({
    ok: true,
    project: { id: project.id, slug: project.slug, name: project.name },
    seed_rule_count: seedRows.length,
  });
}
