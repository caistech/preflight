import type { RegisterRow } from '../types';

/**
 * ModularWA pack — rules specific to projects built by ModularWA.
 *
 * Gated by selectSeedRules() on `builder === 'ModularWA'`.
 *
 * Currently empty. The two ModularWA rules in production (SV 2m exclusion
 * zone PF-442-SV-001 and orphan section callouts PF-442-A107-003) are
 * inserted per-project by supabase/migrations/0009_modularwa_register_update.sql
 * and live as project_id-scoped register_rows, not as seeds.
 *
 * Future ModularWA-only rules (e.g. pitching-plate spec, biscuit-footing
 * footing-system facts, A107 SV detail conventions) should be added here
 * so new ModularWA projects inherit them at creation time without needing
 * a follow-up migration.
 */
export const MODULARWA_PACK: Omit<RegisterRow, 'id' | 'project_id'>[] = [];
