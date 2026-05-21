'use client';

import { useEffect, useState, useTransition } from 'react';

interface Unit {
  id: string;
  unit_number: number;
  unit_type: string | null;
  area_sqm: number | null;
  ffl_m: number | null;
  footing_system: string | null;
  status: 'active' | 'archived' | 'planned';
}

interface NewUnit {
  unit_number: string;
  unit_type: string;
  area_sqm: string;
  ffl_m: string;
  footing_system: string;
}

const EMPTY_NEW: NewUnit = {
  unit_number: '',
  unit_type: '',
  area_sqm: '',
  ffl_m: '',
  footing_system: '',
};

export function UnitsPanel({ projectId }: { projectId: string }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [newUnit, setNewUnit] = useState<NewUnit>(EMPTY_NEW);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/units`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setUnits(j.units ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function addUnit() {
    setError(null);
    const num = parseInt(newUnit.unit_number, 10);
    if (!Number.isInteger(num) || num < 1) {
      setError('unit_number must be a positive integer');
      return;
    }
    const payload = {
      unit: {
        unit_number: num,
        unit_type: newUnit.unit_type || null,
        area_sqm: newUnit.area_sqm ? parseFloat(newUnit.area_sqm) : null,
        ffl_m: newUnit.ffl_m ? parseFloat(newUnit.ffl_m) : null,
        footing_system: newUnit.footing_system || null,
      },
    };
    startTransition(async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/units`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setNewUnit(EMPTY_NEW);
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  async function archiveUnit(unitNumber: number) {
    setError(null);
    startTransition(async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/units`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unit: { unit_number: unitNumber, status: 'archived' },
          }),
        });
        if (!r.ok) {
          const j = await r.json();
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  async function onImportXlsx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportBusy(true);
    setImportMessage(null);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch(`/api/projects/${projectId}/units/import`, {
        method: 'POST',
        body: form,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setImportMessage(`Imported ${j.imported} row(s) from ${file.name}${j.skipped ? `, ${j.skipped} skipped` : ''}.`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-100">Units</h2>
        <button type="button" onClick={refresh} className="text-xs text-gray-500 hover:text-emerald-400">
          Refresh
        </button>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Per-unit specs for multi-unit projects. The unit-numbering rule queries this table
        directly when its check_spec sets <code className="rounded bg-gray-800 px-1 text-emerald-300">use_project_units</code>.
        Add rows by hand below, or import an XLSX where each row is a unit (columns:{' '}
        <code className="rounded bg-gray-800 px-1 text-gray-300">unit_number, unit_type, area_sqm, ffl_m, footing_system</code>).
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {importMessage && (
        <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-300">
          {importMessage}
        </div>
      )}

      <div className="mb-4">
        <label className="mb-1 block text-xs text-gray-400">Bulk import XLSX</label>
        <input
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          disabled={importBusy}
          onChange={onImportXlsx}
          className="block w-full text-xs text-gray-300 file:mr-3 file:rounded-lg file:border file:border-gray-700 file:bg-gray-800 file:px-3 file:py-1.5 file:text-xs file:text-gray-200 hover:file:bg-gray-700 disabled:opacity-40"
        />
      </div>

      {loading && <div className="text-xs text-gray-500">Loading…</div>}

      {!loading && (
        <div className="mb-4 overflow-hidden rounded-lg border border-gray-800">
          <table className="w-full text-xs">
            <thead className="bg-gray-900/60 text-left uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Area (m²)</th>
                <th className="px-3 py-2">FFL (m)</th>
                <th className="px-3 py-2">Footing</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {units.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-gray-500">
                    No units yet. Add one below or import an XLSX.
                  </td>
                </tr>
              )}
              {units.map((u) => (
                <tr key={u.id} className={u.status === 'archived' ? 'text-gray-500 line-through' : 'text-gray-200'}>
                  <td className="px-3 py-2 font-mono">{u.unit_number}</td>
                  <td className="px-3 py-2">{u.unit_type ?? '—'}</td>
                  <td className="px-3 py-2">{u.area_sqm ?? '—'}</td>
                  <td className="px-3 py-2">{u.ffl_m ?? '—'}</td>
                  <td className="px-3 py-2">{u.footing_system ?? '—'}</td>
                  <td className="px-3 py-2">{u.status}</td>
                  <td className="px-3 py-2 text-right">
                    {u.status !== 'archived' && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => archiveUnit(u.unit_number)}
                        className="text-gray-400 hover:text-red-400"
                      >
                        Archive
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {/* Inline add row */}
              <tr className="bg-gray-950/40">
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="1"
                    placeholder="#"
                    value={newUnit.unit_number}
                    onChange={(e) => setNewUnit({ ...newUnit, unit_number: e.target.value })}
                    className="w-16 rounded border border-gray-700 bg-gray-900 px-2 py-1 font-mono text-gray-100 outline-none focus:border-emerald-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    placeholder="2x1"
                    value={newUnit.unit_type}
                    onChange={(e) => setNewUnit({ ...newUnit, unit_type: e.target.value })}
                    className="w-20 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-100 outline-none focus:border-emerald-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.1"
                    placeholder="75"
                    value={newUnit.area_sqm}
                    onChange={(e) => setNewUnit({ ...newUnit, area_sqm: e.target.value })}
                    className="w-20 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-100 outline-none focus:border-emerald-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="10.27"
                    value={newUnit.ffl_m}
                    onChange={(e) => setNewUnit({ ...newUnit, ffl_m: e.target.value })}
                    className="w-20 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-100 outline-none focus:border-emerald-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    placeholder="modularwa-biscuit-footing"
                    value={newUnit.footing_system}
                    onChange={(e) => setNewUnit({ ...newUnit, footing_system: e.target.value })}
                    className="w-44 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-100 outline-none focus:border-emerald-500"
                  />
                </td>
                <td className="px-3 py-2 text-gray-500">new</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={addUnit}
                    disabled={isPending || !newUnit.unit_number}
                    className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                  >
                    Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
