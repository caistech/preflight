/**
 * Bulk-import project_units from an uploaded XLSX (or CSV).
 *
 * Column mapping is by header name (case + whitespace insensitive). The
 * unit_number column is required; everything else is optional. Rows
 * without a parseable unit_number are skipped with a warning. Upsert
 * semantics — re-importing the same sheet updates the existing rows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;

const HEADER_ALIASES: Record<string, string[]> = {
  unit_number: ['unit_number', 'unit no', 'unit#', 'unit #', 'unit', 'no', 'no.', 'number', 'unit number'],
  unit_type: ['unit_type', 'type', 'dwelling type', 'product'],
  area_sqm: ['area_sqm', 'area', 'area m2', 'area (m²)', 'area (m^2)', 'sqm', 'm2', 'm²'],
  ffl_m: ['ffl_m', 'ffl', 'ffl (m)', 'floor level', 'finished floor level'],
  footing_system: ['footing_system', 'footing', 'foundation', 'footing type'],
  status: ['status', 'state'],
};

function normaliseHeader(s: string): string {
  return s.toLowerCase().replace(/[\s_()²^]/g, '').replace(/m2/g, 'm2');
}

function pickHeaderIndex(headers: string[], target: string): number {
  const aliases = HEADER_ALIASES[target] ?? [target];
  const normalisedHeaders = headers.map(normaliseHeader);
  for (const a of aliases) {
    const idx = normalisedHeaders.indexOf(normaliseHeader(a));
    if (idx >= 0) return idx;
  }
  return -1;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  const n = toNumber(v);
  if (n === null) return null;
  return Number.isInteger(n) ? n : Math.round(n);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idOrSlug } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart form' }, { status: 400 });

  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB > ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const lower = file.name.toLowerCase();
  const isXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xls');
  const isCsv = lower.endsWith('.csv') || lower.endsWith('.tsv');

  if (!isXlsx && !isCsv) {
    return NextResponse.json({ error: 'Only .xlsx / .xls / .csv / .tsv accepted' }, { status: 415 });
  }

  // Parse the sheet to a 2D array. First non-empty row is the header.
  let rows: unknown[][] = [];
  try {
    if (isXlsx) {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'buffer' });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      if (!firstSheet) return NextResponse.json({ error: 'Workbook is empty' }, { status: 422 });
      rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, blankrows: false }) as unknown[][];
    } else {
      // CSV/TSV — tolerant parse, no quoted-field handling for v0
      const delim = lower.endsWith('.tsv') ? '\t' : ',';
      const text = buf.toString('utf-8').replace(/\r\n/g, '\n');
      rows = text.split('\n').filter((line) => line.trim().length > 0).map((line) => line.split(delim));
    }
  } catch (e) {
    return NextResponse.json({ error: `Parse failed: ${(e as Error).message}` }, { status: 422 });
  }

  if (rows.length < 2) {
    return NextResponse.json({ error: 'Sheet needs a header row + at least one data row' }, { status: 422 });
  }

  const headers = rows[0].map((h) => String(h ?? '').trim());
  const idx = {
    unit_number: pickHeaderIndex(headers, 'unit_number'),
    unit_type: pickHeaderIndex(headers, 'unit_type'),
    area_sqm: pickHeaderIndex(headers, 'area_sqm'),
    ffl_m: pickHeaderIndex(headers, 'ffl_m'),
    footing_system: pickHeaderIndex(headers, 'footing_system'),
    status: pickHeaderIndex(headers, 'status'),
  };

  if (idx.unit_number < 0) {
    return NextResponse.json(
      {
        error: 'Could not find a unit_number column. Expected one of: unit_number, unit no, unit#, number.',
        headers_seen: headers,
      },
      { status: 422 },
    );
  }

  const toInsert: Array<{
    project_id: string;
    unit_number: number;
    unit_type: string | null;
    area_sqm: number | null;
    ffl_m: number | null;
    footing_system: string | null;
    status: 'active' | 'archived' | 'planned';
    source: string;
    raw_row: Record<string, unknown>;
  }> = [];
  let skipped = 0;
  const skipReasons: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const n = toInt(row[idx.unit_number]);
    if (n === null || n < 1) {
      skipped++;
      if (skipReasons.length < 5) {
        skipReasons.push(`Row ${r + 1}: unit_number "${row[idx.unit_number]}" not a positive integer`);
      }
      continue;
    }
    const statusRaw = idx.status >= 0 ? String(row[idx.status] ?? '').toLowerCase().trim() : '';
    const status: 'active' | 'archived' | 'planned' =
      statusRaw === 'archived' ? 'archived' : statusRaw === 'planned' ? 'planned' : 'active';

    const rawRow: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) rawRow[headers[c] || `col${c}`] = row[c] ?? null;

    toInsert.push({
      project_id: projectId,
      unit_number: n,
      unit_type: idx.unit_type >= 0 ? String(row[idx.unit_type] ?? '').trim() || null : null,
      area_sqm: idx.area_sqm >= 0 ? toNumber(row[idx.area_sqm]) : null,
      ffl_m: idx.ffl_m >= 0 ? toNumber(row[idx.ffl_m]) : null,
      footing_system: idx.footing_system >= 0 ? String(row[idx.footing_system] ?? '').trim() || null : null,
      status,
      source: `xlsx:${file.name}`,
      raw_row: rawRow,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ error: 'No valid rows found', skipped, skipReasons }, { status: 422 });
  }

  const { error: upErr, data: upserted } = await db
    .from('project_units')
    .upsert(toInsert, { onConflict: 'project_id,unit_number' })
    .select('id, unit_number');
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'project_units_xlsx_import',
    payload: {
      filename: file.name,
      headers,
      imported: upserted?.length ?? toInsert.length,
      skipped,
      skip_reasons: skipReasons,
    },
  });

  return NextResponse.json({
    ok: true,
    imported: upserted?.length ?? toInsert.length,
    skipped,
    skip_reasons: skipReasons,
    headers_seen: headers,
  });
}
