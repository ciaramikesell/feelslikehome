'use client';

import { useState } from 'react';
import { X, Plus, MapPin, Pencil } from 'lucide-react';

const EMPTY_FORM = { label: '', address: '', maximumMinutes: '' };

function statusCopy(destination) {
  if (destination.geocodeStatus === 'resolved') return `Found: ${destination.normalizedAddress || destination.address}`;
  if (destination.geocodeStatus === 'invalid') return "We couldn't find that place. Check the address and try again.";
  if (destination.geocodeStatus === 'ambiguous') return 'We found a few possibilities. Add a city or ZIP to narrow it down.';
  if (destination.geocodeStatus === 'unavailable') return "Commute time isn't available right now.";
  return 'Address will be checked when you save.';
}

function DestinationForm({ initial = EMPTY_FORM, saving, error, onSave, onCancel }) {
  const [form, setForm] = useState({
    label: initial.label || '', address: initial.address || '', maximumMinutes: initial.maximumMinutes ?? '',
  });
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
      <div>
        <label className="hh-label">Label</label>
        <input className="hh-input" value={form.label} onChange={(event) => set('label', event.target.value)} placeholder="Work" maxLength={80} />
      </div>
      <div>
        <label className="hh-label">Address</label>
        <input className="hh-input" value={form.address} onChange={(event) => set('address', event.target.value)} placeholder="123 Main St, Detroit, MI" maxLength={200} />
      </div>
      <div>
        <label className="hh-label">How long is too long?</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <input className="hh-input hh-mono" type="number" min="1" max="600" step="1" inputMode="numeric" value={form.maximumMinutes} onChange={(event) => set('maximumMinutes', event.target.value)} style={{ width: 100 }} />
          <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>minutes <em>· Optional</em></span>
        </div>
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--brick)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 7 }}>
        <button type="button" className="hh-btn" disabled={saving || !form.label.trim() || !form.address.trim()} onClick={() => onSave(form)}>{saving ? 'Saving…' : 'Save place'}</button>
        <button type="button" className="hh-btn hh-btn-ghost" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function CommuteDestinations({ destinations, onChange }) {
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const request = async (method, body) => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/commute/destinations', {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "We couldn't save that place. Please try again.");
      return payload;
    } catch (requestError) {
      setError(requestError.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveNew = async (form) => {
    const payload = await request('POST', form);
    if (!payload) return;
    onChange([...destinations, payload.destination]);
    setAdding(false);
  };
  const saveEdit = async (form) => {
    const payload = await request('PATCH', { id: editingId, ...form });
    if (!payload) return;
    onChange(destinations.map((destination) => destination.id === editingId ? payload.destination : destination));
    setEditingId(null);
  };
  const remove = async (destination) => {
    const payload = await request('DELETE', { id: destination.id });
    if (!payload) return;
    onChange(destinations.filter((candidate) => candidate.id !== destination.id));
  };

  return (
    <div>
      <div className="hh-serif" style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>Where do you need to go?</div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 12px' }}>Add the places that matter to you. Your co-buyer keeps their own list.</p>
      <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
        {destinations.map((destination) => editingId === destination.id ? (
          <DestinationForm key={destination.id} initial={destination} saving={saving} error={error} onSave={saveEdit} onCancel={() => { setEditingId(null); setError(''); }} />
        ) : (
          <div key={destination.id} style={{ borderBottom: '1px solid var(--line)', padding: '7px 0 10px', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}><MapPin size={13} /><strong>{destination.label}</strong></div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '3px 0' }}>{destination.address}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{destination.maximumMinutes ? `${destination.maximumMinutes} minute maximum` : 'No maximum'}</div>
              <div style={{ fontSize: 11.5, color: destination.geocodeStatus === 'resolved' ? 'var(--moss)' : 'var(--ink-soft)', marginTop: 3 }}>{statusCopy(destination)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
              <button type="button" aria-label={`Edit ${destination.label}`} onClick={() => { setAdding(false); setEditingId(destination.id); setError(''); }} style={{ border: 0, background: 'none', padding: 5, cursor: 'pointer', color: 'var(--ink-soft)' }}><Pencil size={13} /></button>
              <button type="button" aria-label={`Remove ${destination.label}`} onClick={() => remove(destination)} disabled={saving} style={{ border: 0, background: 'none', padding: 5, cursor: 'pointer', color: 'var(--ink-soft)' }}><X size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      {adding ? <DestinationForm saving={saving} error={error} onSave={saveNew} onCancel={() => { setAdding(false); setError(''); }} /> : (
        <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 12 }} onClick={() => { setEditingId(null); setAdding(true); setError(''); }}><Plus size={14} /> Add another place</button>
      )}
      {!adding && error && <div style={{ fontSize: 12, color: 'var(--brick)', marginTop: 8 }}>{error}</div>}
    </div>
  );
}
