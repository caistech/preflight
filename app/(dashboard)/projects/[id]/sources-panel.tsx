'use client';

import { useState } from 'react';

interface KbDocument {
  id: string;
  title: string;
  source_kind: string;
  source_ref: string | null;
  created_at: string;
}

interface InboundEmail {
  id: string;
  from_address: string | null;
  subject: string | null;
  parsed: boolean;
  kb_document_id: string | null;
  created_at: string;
}

const SOURCE_KIND_OPTIONS = [
  { value: 'planner-letter', label: 'Planner letter' },
  { value: 'council-audit', label: 'Council audit / feedback' },
  { value: 'engineer-note', label: 'Engineer note' },
  { value: 'manual', label: 'General note' },
];

export function SourcesPanel({
  projectId,
  inboundEmailAlias,
  driveConnected,
  existingDocs,
  recentInbound = [],
}: {
  projectId: string;
  inboundEmailAlias: string;
  driveConnected: boolean;
  existingDocs: KbDocument[];
  recentInbound?: InboundEmail[];
}) {
  const [activeTab, setActiveTab] = useState<'file' | 'url' | 'text'>('file');

  return (
    <section className="mt-10">
      <h2 className="mb-2 text-lg font-semibold">Sources</h2>
      <p className="mb-5 max-w-2xl text-sm text-gray-400">
        Preload any background context — planner letters, Council audit findings,
        engineer notes, gazette notices — into the project KB. The manual-check
        rules retrieve from this when answering "are X and Y addressed?". Anything
        a drafter would have to learn through hand-explanation goes in here.
      </p>

      {/* Channels — drive + inbound email (passive sources, no admin action per item) */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-4">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-gray-500">Inbound email</div>
            {recentInbound.length > 0 && (
              <div className="text-xs text-emerald-400">
                {recentInbound.filter((e) => e.parsed).length}/{recentInbound.length} ingested
              </div>
            )}
          </div>
          <div className="mb-2 font-mono text-xs break-all text-emerald-300">{inboundEmailAlias}</div>
          <div className="text-xs text-gray-400">
            Forward (or BCC) planner / Council / engineer correspondence here. Each email is auto-ingested into the KB — no further action needed.
          </div>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Google Drive</div>
          {driveConnected ? (
            <div className="text-xs text-emerald-300">Connected — incremental sync runs every 30 min.</div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-gray-400">Not connected. The Drive ingest runs on a 30-min cron once OAuth completes.</div>
              <a
                href={`/api/drive/oauth?project_id=${projectId}`}
                className="inline-block rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:border-emerald-500 hover:text-emerald-400"
              >
                Connect Drive →
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Recent inbound — auto-promoted to KB */}
      {recentInbound.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">
            Recent inbound emails ({recentInbound.length})
          </div>
          <div className="overflow-hidden rounded-2xl border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">From</th>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Received</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {recentInbound.map((e) => (
                  <tr key={e.id} className="text-gray-300">
                    <td className="px-3 py-2 truncate max-w-[180px]">{e.from_address ?? '—'}</td>
                    <td className="px-3 py-2 truncate max-w-[260px]">{e.subject ?? '(no subject)'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{new Date(e.created_at).toLocaleString('en-AU')}</td>
                    <td className="px-3 py-2">
                      {e.parsed ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                          in KB
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                          captured
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tabbed add-source form */}
      <div className="rounded-2xl border border-gray-800 bg-gray-900/40">
        <div className="flex border-b border-gray-800">
          <TabButton active={activeTab === 'file'} onClick={() => setActiveTab('file')}>Upload file</TabButton>
          <TabButton active={activeTab === 'url'} onClick={() => setActiveTab('url')}>From URL</TabButton>
          <TabButton active={activeTab === 'text'} onClick={() => setActiveTab('text')}>Paste text</TabButton>
        </div>
        <div className="p-5">
          {activeTab === 'file' && <FileForm projectId={projectId} />}
          {activeTab === 'url' && <UrlForm projectId={projectId} />}
          {activeTab === 'text' && <TextForm projectId={projectId} />}
        </div>
      </div>

      {/* Existing KB documents */}
      {existingDocs.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">In the KB ({existingDocs.length})</div>
          <div className="overflow-hidden rounded-2xl border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {existingDocs.map((d) => (
                  <tr key={d.id} className="text-gray-300">
                    <td className="px-4 py-3">
                      <div className="text-gray-200">{d.title}</div>
                      {d.source_ref && (
                        <div className="text-xs text-gray-500 break-all">{d.source_ref}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{d.source_kind}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(d.created_at).toLocaleDateString('en-AU')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-4 py-3 text-sm transition-colors ${
        active
          ? 'border-b-2 border-emerald-500 text-emerald-300'
          : 'border-b-2 border-transparent text-gray-400 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

function FileForm({ projectId }: { projectId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('planner-letter');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    form.append('source_kind', kind);
    const r = await fetch(`/api/projects/${projectId}/sources/upload`, { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: j.error ?? `HTTP ${r.status}` });
      return;
    }
    setMsg({
      ok: true,
      text: `Ingested. ${j.chunk_count} chunks. ${j.warnings?.length ? 'Warnings: ' + j.warnings.join('; ') : ''}`,
    });
    setFile(null);
    setTitle('');
    setTimeout(() => window.location.reload(), 1500);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <KindSelect value={kind} onChange={setKind} />
      <div>
        <label className="mb-1 block text-xs text-gray-400">Title (optional — defaults to filename)</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. CGG audit letter — Apr 2026"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-400">PDF / .txt / .md (max 8 MB)</label>
        <input
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-gray-300 file:mr-4 file:rounded-lg file:border file:border-gray-700 file:bg-gray-800 file:px-3 file:py-1.5 file:text-xs file:text-gray-200 hover:file:bg-gray-700"
        />
      </div>
      <button
        type="submit"
        disabled={busy || !file}
        className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {busy ? 'Ingesting…' : 'Add to KB'}
      </button>
      {msg && <StatusMessage ok={msg.ok} text={msg.text} />}
    </form>
  );
}

function UrlForm({ projectId }: { projectId: string }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('council-audit');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/projects/${projectId}/sources/url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, title: title || null, source_kind: kind }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: j.error ?? `HTTP ${r.status}` });
      return;
    }
    setMsg({ ok: true, text: `Ingested. ${j.chunk_count} chunks.` });
    setUrl('');
    setTitle('');
    setTimeout(() => window.location.reload(), 1500);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <KindSelect value={kind} onChange={setKind} />
      <div>
        <label className="mb-1 block text-xs text-gray-400">URL (HTML page only — PDFs go through the file tab)</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://council.gov.au/dap-determination/..."
          required
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-400">Title override (optional)</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </div>
      <button
        type="submit"
        disabled={busy || !url}
        className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {busy ? 'Fetching + ingesting…' : 'Add to KB'}
      </button>
      {msg && <StatusMessage ok={msg.ok} text={msg.text} />}
    </form>
  );
}

function TextForm({ projectId }: { projectId: string }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [kind, setKind] = useState('manual');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/projects/${projectId}/sources/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, content, source_kind: kind }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: j.error ?? `HTTP ${r.status}` });
      return;
    }
    setMsg({ ok: true, text: `Ingested. ${j.chunk_count} chunks.` });
    setTitle('');
    setContent('');
    setTimeout(() => window.location.reload(), 1500);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <KindSelect value={kind} onChange={setKind} />
      <div>
        <label className="mb-1 block text-xs text-gray-400">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Kathryn — court layout justification (May 2026)"
          required
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-400">Content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          placeholder="Paste the planner letter / Council audit / engineer note here…"
          required
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </div>
      <button
        type="submit"
        disabled={busy || !title || content.length < 30}
        className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {busy ? 'Ingesting…' : 'Add to KB'}
      </button>
      {msg && <StatusMessage ok={msg.ok} text={msg.text} />}
    </form>
  );
}

function KindSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-400">Source kind</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      >
        {SOURCE_KIND_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function StatusMessage({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div
      className={`rounded-lg border p-3 text-xs ${
        ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200'
      }`}
    >
      {text}
    </div>
  );
}
