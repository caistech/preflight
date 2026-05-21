'use client';

import { useState } from 'react';
import { DecisionForm } from './decision-form';

interface Result {
  check_result_id: string;
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
  files?: Array<{ name: string; bytes: number; extraction_method: string; pages: number }>;
}

export function DrafterUpload({ token, projectId: _projectId }: { token: string; projectId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const permalinkBase = `/drafter/${token}/runs`;

  function onFilesPicked(picked: FileList | null) {
    if (!picked) return;
    const incoming = Array.from(picked).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    // De-dupe by (name + size + lastModified)
    const key = (f: File) => `${f.name}::${f.size}::${f.lastModified}`;
    const existing = new Set(files.map(key));
    const merged = [...files];
    for (const f of incoming) {
      if (!existing.has(key(f))) {
        merged.push(f);
        existing.add(key(f));
      }
    }
    setFiles(merged);
    setError(null);
  }

  function removeFile(idx: number) {
    setFiles(files.filter((_, i) => i !== idx));
  }

  function clearAll() {
    setFiles([]);
    setResult(null);
    setError(null);
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setError('Pick at least one PDF first.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    for (const f of files) form.append('file', f);
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
        <label className="mb-2 block text-sm text-gray-300">
          Drop one or more PDFs — they&apos;ll be evaluated as a combined set
        </label>
        <input
          type="file"
          accept="application/pdf"
          multiple
          onChange={(e) => {
            onFilesPicked(e.target.files);
            // Reset the input so the same file can be re-selected after removing
            e.target.value = '';
          }}
          className="block w-full text-sm text-gray-300 file:mr-4 file:rounded-lg file:border file:border-gray-700 file:bg-gray-800 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-200 hover:file:bg-gray-700"
        />

        {files.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Files to check ({files.length})</span>
              <button
                type="button"
                onClick={clearAll}
                className="text-gray-500 hover:text-red-400"
              >
                Clear all
              </button>
            </div>
            <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-2 bg-gray-900/40 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-gray-200">{f.name}</div>
                    <div className="text-xs text-gray-500">{(f.size / 1024 / 1024).toFixed(1)} MB</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:border-red-500 hover:text-red-400"
                    aria-label="Remove file"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || files.length === 0}
          className="mt-4 rounded-lg bg-emerald-500 px-6 py-3 text-sm font-medium text-gray-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy
            ? `Running checks on ${files.length} file${files.length === 1 ? '' : 's'}…`
            : files.length > 1
              ? `Run preflight check on ${files.length} files`
              : 'Run preflight check'}
        </button>
      </form>

      {result && (
        <>
          <div className="mt-6 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">
            <div className="mb-1">
              This result is saved. Permanent link to come back to it later:{' '}
              <a
                href={`${permalinkBase}/${result.check_run_id}`}
                className="font-mono text-emerald-300 hover:underline"
              >
                {permalinkBase}/{result.check_run_id}
              </a>
            </div>
            {result.files && result.files.length > 0 && (
              <div className="mt-2 border-t border-emerald-500/10 pt-2">
                <div className="mb-1 text-emerald-300">Files in this run:</div>
                <ul className="space-y-0.5">
                  {result.files.map((f, i) => (
                    <li key={i} className="font-mono text-emerald-200/80">
                      • {f.name}{' '}
                      <span className="text-emerald-200/40">
                        ({(f.bytes / 1024 / 1024).toFixed(1)} MB · {f.pages}p · {f.extraction_method})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <TriageSheet result={result} token={token} />
        </>
      )}
    </div>
  );
}

function TriageSheet({ result, token }: { result: UploadResponse; token: string }) {
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
        <Section title="Hard fails" tone="red" rows={result.hard_fails} token={token} />
      )}
      {result.needs_review.length > 0 && (
        <Section title="Needs eyes" tone="amber" rows={result.needs_review} token={token} />
      )}
      {result.confirmed_ok.length > 0 && (
        <Section title="Confirmed OK" tone="emerald" rows={result.confirmed_ok} token={token} />
      )}
    </div>
  );
}

function Section({ title, tone, rows, token }: { title: string; tone: string; rows: Result[]; token: string }) {
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
            {r.check_result_id && (
              <DecisionForm
                token={token}
                checkResultId={r.check_result_id}
                toolOutcome={r.outcome}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
