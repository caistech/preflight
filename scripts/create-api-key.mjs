#!/usr/bin/env node
// Mint an API key for a machine caller, scoped to named projects.
//
//   node --env-file=.env.local scripts/create-api-key.mjs "Kira (orchestrator-managed)" lot-91-wavecrest [more-slugs…]
//
// The raw key is printed ONCE and never stored — only its SHA-256 goes into api_keys.
// Put it straight into the caller's secret store; there is no way to read it back.

import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const [name, ...slugs] = process.argv.slice(2);
if (!name || slugs.length === 0) {
  console.error('usage: create-api-key.mjs "<caller name>" <project-slug> [project-slug…]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials missing');
const db = createClient(url, key, { auth: { persistSession: false } });

const { data: projects, error } = await db.from('projects').select('id, slug').in('slug', slugs);
if (error) throw new Error(error.message);
const missing = slugs.filter((s) => !(projects ?? []).some((p) => p.slug === s));
if (missing.length) throw new Error(`No such project: ${missing.join(', ')}`);

const raw = 'pfk_' + randomBytes(32).toString('base64url');
const { error: insertError } = await db.from('api_keys').insert({
  name,
  key_hash: createHash('sha256').update(raw).digest('hex'),
  project_ids: projects.map((p) => p.id),
});
if (insertError) throw new Error(insertError.message);

console.log(`Created "${name}" for ${slugs.join(', ')}.`);
console.log(raw);
