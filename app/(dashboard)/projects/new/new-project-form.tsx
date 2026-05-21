'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [council, setCouncil] = useState('');
  const [ownerLabel, setOwnerLabel] = useState('');
  const [drafterLabel, setDrafterLabel] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-derive slug from name unless the operator has manually edited it.
  function onNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug: slug || undefined,
          council: council || undefined,
          owner_label: ownerLabel || undefined,
          drafter_label: drafterLabel || undefined,
          description: description || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      router.push(`/projects/${j.project.slug}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-gray-800 bg-gray-900/40 p-6 text-sm">
      <Field
        label="Project name"
        value={name}
        onChange={onNameChange}
        placeholder="e.g. Lot 17 Bayview"
        required
      />
      <div>
        <label className="mb-1 block text-xs text-gray-400">
          Slug <span className="text-gray-600">(URL-safe; auto-derived from name unless edited)</span>
        </label>
        <input
          type="text"
          value={slug}
          onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }}
          placeholder="lot-17-bayview"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-500"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Council" value={council} onChange={setCouncil} placeholder="City of Greater Geraldton" />
        <Field label="Project owner label" value={ownerLabel} onChange={setOwnerLabel} placeholder="F2K" />
      </div>
      <Field label="Drafter label (optional)" value={drafterLabel} onChange={setDrafterLabel} placeholder="Unison's drafter, ModularWA's drafter…" />
      <div>
        <label className="mb-1 block text-xs text-gray-400">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          placeholder="A sentence the operator will see at the top of this project's page."
        />
      </div>
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{error}</div>
      )}
      <button
        type="submit"
        disabled={busy || !name}
        className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-emerald-400 disabled:opacity-40"
      >
        {busy ? 'Creating…' : 'Create project'}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-400">
        {label}{required ? <span className="text-red-400"> *</span> : null}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      />
    </div>
  );
}
