'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { StarInput } from '@/components/ui';
import {
  STATUS_OPTIONS, MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, ITEMLIST_CATEGORIES, terminology,
} from '@/lib/constants';
import { visibleOrderedItems, parseListingText } from '@/lib/matching';

export default function HomeModal({ initial, priorities, onSave, onClose }) {
  const [form, setForm] = useState(initial);
  const [pasteText, setPasteText] = useState('');
  const [parseMsg, setParseMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.address.trim()) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };
  const nsKey = (cat, label) => `${cat}:${label}`;
  const setRatingItem = (cat, label, v) => setForm((f) => ({ ...f, ratings: { ...f.ratings, [nsKey(cat, label)]: v } }));
  const toggleCheckItem = (cat, label) => setForm((f) => { const k = nsKey(cat, label); return { ...f, checks: { ...f.checks, [k]: !f.checks[k] } }; });
  const toggleMulti = (catKey, opt) => setForm((f) => ({ ...f, [catKey]: f[catKey].includes(opt) ? f[catKey].filter((x) => x !== opt) : [...f[catKey], opt] }));

  const runAutofill = () => {
    const parsed = parseListingText(pasteText);
    let count = 0;
    setForm((f) => {
      const next = { ...f };
      Object.entries(parsed).forEach(([k, v]) => { if (v && !next[k]) { next[k] = v; count += 1; } });
      return next;
    });
    setParseMsg(count > 0 ? `Filled in ${count} field${count === 1 ? '' : 's'} from what you pasted — double-check before saving.` : `Couldn't find anything usable in that text — try filling fields in manually.`);
  };

  return (
    <div className="hh-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hh-modal hh-corner">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <h2 className="hh-serif" style={{ fontSize: 20, margin: 0, fontWeight: 600 }}>{initial.address ? 'Edit home' : 'Add a home'}</h2>
          <button className="hh-btn hh-btn-ghost" style={{ padding: 6 }} onClick={onClose}><X size={16} /></button>
        </div>

        <details open={!initial.address} className="hh-details">
          <summary>Paste from a listing</summary>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '8px 0' }}>Paste the listing description and we'll try to pull out price, beds/baths, sqft, and more. We only fill in blank fields.</p>
          <textarea className="hh-textarea" style={{ minHeight: 90 }} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the full listing text here..." />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: parseMsg.startsWith("Couldn't") ? 'var(--brick)' : 'var(--moss)' }}>{parseMsg}</span>
            <button type="button" className="hh-btn hh-btn-ghost" onClick={runAutofill} disabled={!pasteText.trim()}>Fill in fields</button>
          </div>
        </details>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 6 }}>
          <div><label className="hh-label">Address *</label><input className="hh-input" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="123 Maple St, Ann Arbor, MI" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label className="hh-label">Nearby cross streets</label><input className="hh-input" value={form.crossroads} onChange={(e) => set('crossroads', e.target.value)} placeholder="Main & 5th" /></div>
            <div><label className="hh-label">Listing URL</label><input className="hh-input" value={form.listingUrl} onChange={(e) => set('listingUrl', e.target.value)} placeholder="https://..." /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: form.photoUrl ? '1fr 64px' : '1fr', gap: 12, alignItems: 'end' }}>
            <div><label className="hh-label">Photo URL</label><input className="hh-input" value={form.photoUrl} onChange={(e) => set('photoUrl', e.target.value)} placeholder="https://.../photo.jpg" /></div>
            {form.photoUrl && <img src={form.photoUrl} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} onError={(e) => { e.target.style.opacity = 0.15; }} />}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, margin: '14px 0' }}>
          {priorities.budget?.tier !== 'dontcare' && <div><label className="hh-label">{terminology(priorities.searchType).priceFieldLabel}{priorities.budget?.tier === 'must' && <span className="hh-must-badge">MUST</span>}</label><input className="hh-input" value={form.price} onChange={(e) => set('price', e.target.value)} placeholder={terminology(priorities.searchType).pricePlaceholder} /></div>}
          <div><label className="hh-label">Est. monthly pmt</label><input className="hh-input" value={form.estMonthly} onChange={(e) => set('estMonthly', e.target.value)} placeholder="2800" /></div>
          <div><label className="hh-label">Status</label>
            <select className="hh-select" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {form.status === 'Passed' && (
          <div style={{ marginBottom: 14 }}>
            <label className="hh-label">Why did you pass on this one?</label>
            <input className="hh-input" value={form.rejectionReason} onChange={(e) => set('rejectionReason', e.target.value)} placeholder="e.g. Busy road, no basement, taxes too high" />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
          {priorities.bedsMin?.tier !== 'dontcare' && <div><label className="hh-label">Beds{priorities.bedsMin?.tier === 'must' && <span className="hh-must-badge">MUST</span>}</label><input className="hh-input" value={form.beds} onChange={(e) => set('beds', e.target.value)} placeholder="3" /></div>}
          {priorities.bathsMin?.tier !== 'dontcare' && <div><label className="hh-label">Baths{priorities.bathsMin?.tier === 'must' && <span className="hh-must-badge">MUST</span>}</label><input className="hh-input" value={form.baths} onChange={(e) => set('baths', e.target.value)} placeholder="2" /></div>}
          {priorities.sqftTarget?.tier !== 'dontcare' && <div><label className="hh-label">Sq ft{priorities.sqftTarget?.tier === 'must' && <span className="hh-must-badge">MUST</span>}</label><input className="hh-input" value={form.sqft} onChange={(e) => set('sqft', e.target.value)} placeholder="1800" /></div>}
          {priorities.lotSizeTarget?.tier !== 'dontcare' && <div><label className="hh-label">Lot size{priorities.lotSizeTarget?.tier === 'must' && <span className="hh-must-badge">MUST</span>}</label><input className="hh-input" value={form.lotSize} onChange={(e) => set('lotSize', e.target.value)} placeholder="0.25 acres" /></div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 }}>
          <div><label className="hh-label">Garage spaces</label><input className="hh-input" value={form.garageSpaces} onChange={(e) => set('garageSpaces', e.target.value)} placeholder="2" /></div>
          <div><label className="hh-label">Year built</label><input className="hh-input" value={form.yearBuilt} onChange={(e) => set('yearBuilt', e.target.value)} placeholder="1965" /></div>
          <div><label className="hh-label">Days on market</label><input className="hh-input" value={form.daysOnMarket} onChange={(e) => set('daysOnMarket', e.target.value)} placeholder="14" /></div>
        </div>

        {MULTISELECT_CATEGORIES.filter((def) => priorities[def.key]?.tier !== 'dontcare').map((def) => (
          <div key={def.key} style={{ marginBottom: 16 }}>
            <label className="hh-label">{def.title}{priorities[def.key]?.tier === 'must' && <span className="hh-must-badge">MUST</span>}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {def.options.map((o) => <span key={o} className={`hh-chip ${form[def.key]?.includes(o) ? 'on' : ''}`} onClick={() => toggleMulti(def.key, o)}>{o}</span>)}
            </div>
          </div>
        ))}

        {SINGLESELECT_CATEGORIES.filter((def) => priorities[def.key]?.tier !== 'dontcare').map((def) => (
          <div key={def.key} style={{ marginBottom: 16 }}>
            <label className="hh-label">{def.title}{priorities[def.key]?.tier === 'must' && <span className="hh-must-badge">MUST</span>}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {def.options.filter((o) => o !== 'Either / No Preference').map((o) => <span key={o} className={`hh-chip ${form[def.key] === o ? 'on' : ''}`} onClick={() => setForm((f) => ({ ...f, [def.key]: f[def.key] === o ? '' : o }))}>{o}</span>)}
            </div>
          </div>
        ))}

        {ITEMLIST_CATEGORIES.map((def) => {
          const visible = visibleOrderedItems(def, priorities);
          if (!visible.length) return null;
          const ratingItems = visible.filter((i) => i.kind === 'rating');
          const checkItems = visible.filter((i) => i.kind === 'check');
          const mustCount = visible.filter((i) => priorities[def.key]?.tiers?.[i.label] === 'must').length;
          return (
            <details key={def.key} open={mustCount > 0 || def.key === 'location' || def.key === 'homeFeel'} className="hh-details">
              <summary>{def.title}{mustCount > 0 && <span className="hh-must-badge">{mustCount} MUST</span>}</summary>
              {ratingItems.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 10, columnGap: 16, margin: '12px 0' }}>
                  {ratingItems.map((item) => (
                    <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13 }}>{item.label}{priorities[def.key]?.tiers?.[item.label] === 'must' && <span className="hh-must-badge">MUST</span>}</span>
                      <StarInput value={form.ratings[nsKey(def.key, item.label)] || 0} onChange={(v) => setRatingItem(def.key, item.label, v)} />
                    </div>
                  ))}
                </div>
              )}
              {checkItems.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: ratingItems.length ? 4 : 12 }}>
                  {checkItems.map((item) => (
                    <span key={item.label} className={`hh-chip ${form.checks[nsKey(def.key, item.label)] ? 'on' : ''}`} onClick={() => toggleCheckItem(def.key, item.label)}>
                      {item.label}{priorities[def.key]?.tiers?.[item.label] === 'must' && <span className="hh-must-badge">MUST</span>}
                    </span>
                  ))}
                </div>
              )}
            </details>
          );
        })}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div><label className="hh-label">Pros</label><textarea className="hh-textarea" value={form.pros} onChange={(e) => set('pros', e.target.value)} /></div>
          <div><label className="hh-label">Cons</label><textarea className="hh-textarea" value={form.cons} onChange={(e) => set('cons', e.target.value)} /></div>
        </div>
        <div style={{ marginBottom: 24 }}>
          <label className="hh-label">Notes</label>
          <textarea className="hh-textarea" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything else worth remembering..." />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="hh-btn hh-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="hh-btn" onClick={submit} disabled={!form.address.trim() || saving}>{saving ? 'Saving...' : 'Save home'}</button>
        </div>
      </div>
    </div>
  );
}
