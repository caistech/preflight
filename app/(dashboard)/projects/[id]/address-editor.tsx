'use client';

import { useState } from 'react';
import { AddressAutocomplete } from '@/components/address-autocomplete';
import type { GeocodedAddress } from '@caistech/mapbox';

export function AddressEditor({
  projectId,
  initialAddress,
}: {
  projectId: string;
  initialAddress: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!initialAddress);
  const [currentAddress, setCurrentAddress] = useState(initialAddress ?? '');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSelect(address: GeocodedAddress) {
    setBusy(true);
    setStatus(null);
    const r = await fetch(`/api/projects/${projectId}/address`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        formatted_address: address.formatted_address,
        latitude: address.latitude,
        longitude: address.longitude,
        suburb: address.suburb,
        state: address.state,
        postcode: address.postcode,
      }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setStatus({ ok: false, text: j.error ?? `HTTP ${r.status}` });
      return;
    }
    setCurrentAddress(address.formatted_address);
    setEditing(false);
    setStatus({ ok: true, text: 'Address saved.' });
    setTimeout(() => window.location.reload(), 1000);
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Project address</div>
          <div className="text-sm text-gray-200">{currentAddress || <span className="text-gray-500">(not set)</span>}</div>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-300 hover:border-emerald-500 hover:text-emerald-400"
        >
          {currentAddress ? 'Edit' : 'Set address'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Project address</div>
      <p className="mb-2 text-xs text-gray-500">
        Start typing — Mapbox suggestions are AU-only. Selecting an option saves the formatted address + lat/lng/suburb/state/postcode as project facts.
      </p>
      <AddressAutocomplete onSelect={onSelect} defaultValue={currentAddress} placeholder="Start typing the project address…" />
      <div className="mt-2 flex items-center gap-3 text-xs">
        {busy && <span className="text-gray-400">Saving…</span>}
        {status && (
          <span className={status.ok ? 'text-emerald-400' : 'text-red-400'}>{status.text}</span>
        )}
        {initialAddress && (
          <button
            onClick={() => setEditing(false)}
            className="text-gray-500 hover:text-gray-300"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
