'use client';

import { useState } from 'react';
import { MapPin, Pencil, Plus, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { createCommuteDestination, deleteCommuteDestination, updateCommuteDestination } from '@/lib/supabase/collaboration';

const blank = { label: '', address: '', maxDriveMinutes: '' };

export default function CommuteDestinations({ searchId, userId, destinations, onChange, hideHeader = false }) {
  const [draft, setDraft] = useState(blank);
  const [adding, setAdding] = useState(destinations.length === 0);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const beginEdit = (destination) => {
    setEditingId(destination.id);
    setAdding(false);
    setDraft({ label: destination.label, address: destination.address, maxDriveMinutes: destination.maxDriveMinutes ?? '' });
    setError('');
  };
  const cancel = () => { setEditingId(null); setAdding(false); setDraft(blank); setError(''); };
  const parsedMax = draft.maxDriveMinutes === '' ? null : Number(draft.maxDriveMinutes);
  const valid = draft.label.trim() && draft.address.trim() && (parsedMax === null || (Number.isInteger(parsedMax) && parsedMax > 0 && parsedMax <= 1440));

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true); setError('');
    try {
      const supabase = createClient();
      const values = { label: draft.label, address: draft.address, maxDriveMinutes: parsedMax };
      const saved = editingId
        ? await updateCommuteDestination(supabase, editingId, values)
        : await createCommuteDestination(supabase, searchId, userId, values);
      onChange(editingId ? destinations.map((d) => d.id === editingId ? saved : d) : [...destinations, saved]);
      cancel();
    } catch (e) {
      console.error('Could not save commute destination', e);
      setError('We couldn’t save that place. Check the details and try again.');
    } finally { setBusy(false); }
  };

  const remove = async (destination) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await deleteCommuteDestination(createClient(), destination.id);
      onChange(destinations.filter((d) => d.id !== destination.id));
      if (editingId === destination.id) cancel();
    } catch (e) {
      console.error('Could not delete commute destination', e);
      setError('We couldn’t remove that place right now.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      {!hideHeader && <><div className="hh-serif" style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>Places you travel to often</div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 12px', lineHeight: 1.5 }}>These places are private to you. Add a drive-time limit only when it should affect your single Commute priority.</p></>}
      <div className="hh-destination-grid">
        {destinations.map((d) => (
          <div key={d.id} className="hh-destination-card">
            <div style={{ display: 'flex', gap: 7, minWidth: 0 }}><MapPin size={14} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600 }}>{d.label}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', overflowWrap: 'anywhere' }}>{d.address}</div>
                <div style={{ fontSize: 11.5, color: 'var(--moss)', marginTop: 4, fontWeight: 600 }}>{d.maxDriveMinutes ? `${d.maxDriveMinutes} min max` : 'Informational only'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <button type="button" aria-label={`Edit ${d.label}`} onClick={() => beginEdit(d)} className="hh-btn hh-btn-ghost" style={{ padding: 5 }}><Pencil size={13} /></button>
              <button type="button" aria-label={`Remove ${d.label}`} onClick={() => remove(d)} className="hh-btn hh-btn-ghost" style={{ padding: 5 }}><X size={13} /></button>
            </div>
          </div>
        ))}
      </div>
      {(editingId !== null || adding || destinations.length === 0) ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <input className="hh-input" aria-label="Destination label" placeholder="Name (e.g. Work)" maxLength={80} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          <input className="hh-input" aria-label="Destination address" placeholder="123 Main St, Detroit, MI" maxLength={500} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
          <label className="hh-label">How long is too long? <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4 }}><input className="hh-input" type="number" min="1" max="1440" placeholder="30" value={draft.maxDriveMinutes} onChange={(e) => setDraft({ ...draft, maxDriveMinutes: e.target.value })} style={{ width: 100 }} /> minutes</span>
          </label>
          <div style={{ display: 'flex', gap: 7 }}><button type="button" className="hh-btn" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Add place'}</button>
            {(editingId || destinations.length > 0) && <button type="button" className="hh-btn hh-btn-ghost" onClick={cancel}>Cancel</button>}
          </div>
        </div>
      ) : <button type="button" className="hh-btn hh-btn-ghost" onClick={() => setAdding(true)}><Plus size={14} /> Add another place</button>}
      {error && <p role="alert" style={{ fontSize: 12, color: 'var(--brick)', marginBottom: 0 }}>{error}</p>}
    </div>
  );
}
