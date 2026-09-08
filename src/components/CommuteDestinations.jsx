'use client';

import { useState } from 'react';
import { X, Plus, MapPin } from 'lucide-react';
import { TIER_META, SELECTABLE_TIERS } from '@/lib/constants';

// Phase 5 — named commute destinations. PERSONAL: each destination lives in
// the current user's own priorities (priorities.location.commuteDestinations),
// never a shared household concept. Two co-buyers can each have their own
// "Work" without any conflict or averaging, exactly per the approved product
// decision — the house is shared, the destination is not.
//
// Deliberately does NOT calculate or display any travel time — no provider
// has been chosen yet. This is purely the ownership/CRUD/tiering
// architecture; a future pass wires in real drive-time calculation without
// needing to change this data shape (just adds a cached result alongside it).
export default function CommuteDestinations({ priorities, patch }) {
  const destinations = priorities.location?.commuteDestinations || [];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  const setDestinations = (next) => patch((p) => {
    p.location = { ...p.location, commuteDestinations: next };
    return p;
  });

  const addDestination = () => {
    const trimmedName = name.trim();
    const trimmedAddress = address.trim();
    if (!trimmedName || !trimmedAddress) return;
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    setDestinations([...destinations, { id, name: trimmedName, address: trimmedAddress, tier: 'important' }]);
    setName('');
    setAddress('');
    setAdding(false);
  };

  const removeDestination = (id) => setDestinations(destinations.filter((d) => d.id !== id));
  const setTier = (id, tier) => setDestinations(destinations.map((d) => (d.id === id ? { ...d, tier } : d)));

  return (
    <div>
      <div className="hh-serif" style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>Places you travel to often</div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 12px' }}>
        Work, family, school — anywhere your own commute matters. These are yours alone; your co-buyer keeps their own list.
      </p>

      {destinations.length > 0 && (
        <div style={{ display: 'grid', gap: 2, marginBottom: 12 }}>
          {destinations.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: 'var(--ink)', minWidth: 0 }}>
                <MapPin size={13} color="var(--ink-soft)" style={{ flexShrink: 0 }} />
                <span style={{ fontWeight: 600 }}>{d.name}</span>
                <span style={{ color: 'var(--ink-soft)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.address}</span>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {SELECTABLE_TIERS.map((t) => (
                    <button
                      key={t} type="button" onClick={() => setTier(d.id, t)}
                      style={{
                        fontSize: 11, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', fontWeight: d.tier === t ? 600 : 400,
                        border: '1px solid ' + (d.tier === t ? TIER_META[t].color : 'var(--line)'),
                        background: d.tier === t ? TIER_META[t].color : 'transparent',
                        color: d.tier === t ? '#fff' : 'var(--ink-soft)',
                      }}
                    >
                      {TIER_META[t].label}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => removeDestination(d.id)} aria-label={`Remove ${d.name}`} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', padding: 4, display: 'flex' }}>
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input className="hh-input" placeholder="Name (e.g. Work)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: '1 1 120px' }} />
          <input
            className="hh-input" placeholder="Address" value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDestination())}
            style={{ flex: '2 1 200px' }}
          />
          <button type="button" className="hh-btn hh-btn-ghost" onClick={addDestination} disabled={!name.trim() || !address.trim()}>Add</button>
          <button type="button" className="hh-btn hh-btn-ghost" onClick={() => { setAdding(false); setName(''); setAddress(''); }}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 12 }} onClick={() => setAdding(true)}>
          <Plus size={14} /> Add a place
        </button>
      )}
    </div>
  );
}
