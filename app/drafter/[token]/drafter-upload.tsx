'use client';

import { useState } from 'react';

interface Result {
  outcome: string;
  message: string;
  severity: string;
  requirement: string;
  source: string;
}

interface UploadResponse {
  check_run_id: string;
  hard_fails: Result[];
  needs_review: Result[];
  confirmed_ok: Result[];
  not_applicable: number;
  errors: number;
  warnings: string[];
}

export function DrafterUpload({ token, projectId: _projectId }: { token: string; projectId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const permalinkBase = `/drafter/${token}/runs`;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Pick a PDF file first.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append('file', file);
    form.append('token', token);

    try {
      const r = await fetch('/api/drafter/upload', {
        method: 'POST',
        body: form,
      });
      const j = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok) {
        setError(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setResult(j);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  };

  return (
    <div>
      <form onSubmit={onSubmit} className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
        <label className="mb-2 block text-sm text-gray-300">Drop your drawing-set PDF</label>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-gray-300 file:mr-4 file:rounded-lg file:border file:border-gray-700 file:bg-gray-800 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-200 hover:file:bg-gray-700"
        />
        {file && (
          <div className="mt-2 text-xs text-gray-500">
            {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !file}
          className="mt-4 rounded-lg bg-emerald-500 px-6 py-3 text-sm font-medium text-gray-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy ? 'Running checks…' : 'Run preflight check'}
        </button>
      </form>

      {result && (
        <>
          <div className="mt-6 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">
            This result is saved. Permanent link to come back to it later:{' '}
            <a
              href={`${permalinkBase}/${result.check_run_id}`}
              className="font-mono text-emerald-300 hover:underline"
            >
              {permalinkBase}/{result.check_run_id}
            </a>
          </div>
          <TriageSheet result={result} />
        </>
      )}
    </div>
  );
}

function TriageSheet({ result }: { result: UploadResponse }) {
  return (
    <div className="mt-8 space-y-6">
      <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
        <div className="mb-3 text-xs uppercase tracking-wide text-gray-500">Summary</div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-3xl font-bold text-red-400">{result.hard_fails.length}</div>
            <div className="text-xs text-gray-500">Hard fails</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-amber-400">{result.needs_review.length}</div>
            <div className="text-xs text-gray-500">Needs eyes</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-emerald-400">{result.confirmed_ok.length}</div>
            <div className="text-xs text-gray-500">Confirmed OK</div>
          </div>
        </div>
        {result.warnings.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            {result.warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}
      </div>

      {result.hard_fails.length > 0 && (
        <Section title="Hard fails" tone="red" rows={result.hard_fails} />
      )}
      {result.needs_review.length > 0 && (
        <Section title="Needs eyes" tone="amber" rows={result.needs_review} />
      )}
      {result.confirmed_ok.length > 0 && (
        <Section title="Confirmed OK" tone="emerald" rows={result.confirmed_ok} />
      )}
    </div>
  );
}

function Section({ title, tone, rows }: { title: string; tone: string; rows: Result[] }) {
  const toneClasses: Record<string, string> = {
    red: 'border-red-500/30 bg-red-500/10',
    amber: 'border-amber-500/30 bg-amber-500/10',
    emerald: 'border-emerald-500/30 bg-emerald-500/10',
  };
  const textClasses: Record<string, string> = {
    red: 'text-red-300',
    amber: 'text-amber-300',
    emerald: 'text-emerald-300',
  };
  return (
    <div className={`rounded-2xl border p-6 ${toneClasses[tone]}`}>
      <div className={`mb-4 text-sm font-semibold ${textClasses[tone]}`}>{title}</div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg bg-gray-950/60 p-4">
            <div className="mb-1 text-sm text-gray-100">{r.requirement}</div>
            <div className="mb-2 text-xs text-gray-400">{r.message}</div>
            <div className="text-xs text-gray-500">Source: {r.source}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
