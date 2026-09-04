'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { StarInput } from '@/components/ui';
import {
  STATUS_OPTIONS, MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, terminology, getItemlistCategories,
  isArchivedStatus, isRentalType, TOUR_RATING_KEY,
} from '@/lib/constants';
import { visibleOrderedItems, parseListingText } from '@/lib/matching';
import { extractAddressFromListingUrl } from '@/lib/listingUrl';

export default function HomeModal({ initial, priorities, onSave, onClose }) {
  const [form, setForm] = useState(initial);
  const [pasteText, setPasteText] = useState('');
  const [parseMsg, setParseMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [lastImportedAddress, setLastImportedAddress] = useState('');

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

  // Reads the address straight out of the URL string (no fetching the listing page).
  // Only offers to fill the Address field if it's still empty, so this never clobbers
  // something the user already typed or corrected.
  const tryFillAddressFromUrl = () => {
    if (form.address.trim()) return;
    const result = extractAddressFromListingUrl(form.listingUrl);
    if (result?.address) {
      set('address', result.address);
      setImportMsg('Filled in the address from your listing link — check it, then look up property details below.');
    }
  };

  // Looks up objective property data for the current Address value via our own
  // server route (which holds the RentCast key) and merges any results into
  // fields that are still empty. Never overwrites anything the user already
  // entered, and never saves — the user still reviews and clicks Save home.
  const runImport = async () => {
    const address = form.address.trim();
    if (!address || importing || address === lastImportedAddress) return;
    setImporting(true);
    setImportMsg('');
    try {
      const res = await fetch('/api/import-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, mode: isRentalType(priorities.searchType) ? 'rental' : 'sale' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Temporary diagnostic patch: surface upstream HTTP status codes when present,
        // so failures can be identified without deeper log access. Remove this branch
        // once the RentCast integration is confirmed working.
        if (data.diagnostics) {
          setImportMsg(`Property lookup failed (property: ${data.diagnostics.propertyStatus}, listing: ${data.diagnostics.listingStatus}).`);
        } else {
          setImportMsg(data.error || "Couldn't look up that address — you can enter details manually.");
        }
        return;
      }
      setLastImportedAddress(address);
      if (!data.found) {
        setImportMsg(data.message || 'No property data was found for that address — you can enter details manually.');
        return;
      }
      let count = 0;
      setForm((f) => {
        const next = { ...f };
        Object.entries(data.fields || {}).forEach(([k, v]) => { if (v && !next[k]) { next[k] = v; count += 1; } });
        return next;
      });
      setImportMsg(count > 0
        ? `Filled in ${count} field${count === 1 ? '' : 's'} from property data — double-check before saving.`
        : 'Found the property, but every matching field was already filled in.');
    } catch {
      setImportMsg("Couldn't reach the property data provider — you can enter details manually.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="hh-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hh-modal hh-corner">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: initial.address ? 18 : 6 }}>
          <h2 className="hh-serif" style={{ fontSize: 20, margin: 0, fontWeight: 600 }}>{initial.address ? 'Edit home' : 'Add a home'}</h2>
          <button className="hh-btn hh-btn-ghost" style={{ padding: 6 }} onClick={onClose}><X size={16} /></button>
        </div>

        {!initial.address && (
          <p style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.55, margin: '0 0 18px' }}>
            Found something you like on Zillow, Realtor.com, Homes.com, Trulia, a builder site, or somewhere else? Add it here and we'll compare it against your search. Enter whatever you know today — you can come back after a showing to add ratings, notes, and anything else you learn.
          </p>
        )}

        <details open={!initial.address} className="hh-details">
          <summary>Paste listing details</summary>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '8px 0' }}>Copy the listing description or details here and we'll try to fill in anything we recognize — price, beds/baths, square footage, and more. You can review everything before saving.</p>
          <textarea className="hh-textarea" style={{ minHeight: 90 }} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the full listing text here..." />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: parseMsg.startsWith("Couldn't") ? 'var(--brick)' : 'var(--moss)' }}>{parseMsg}</span>
            <button type="button" className="hh-btn hh-btn-ghost" onClick={runAutofill} disabled={!pasteText.trim()}>Fill in fields</button>
          </div>
        </details>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 6 }}>
          <div>
            <label className="hh-label">Address *</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="hh-input" style={{ flex: 1 }} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="123 Maple St, Ann Arbor, MI" />
              <button
                type="button"
                className="hh-btn hh-btn-ghost"
                style={{ whiteSpace: 'nowrap' }}
                onClick={runImport}
                disabled={!form.address.trim() || importing || form.address.trim() === lastImportedAddress}
              >
                {importing ? 'Looking up...' : 'Look up property details'}
              </button>
            </div>
            {importMsg && <p style={{ fontSize: 11.5, color: importMsg.startsWith("Couldn't") || importMsg.startsWith('No property') || importMsg.startsWith('Property lookup failed') ? 'var(--brick)' : 'var(--moss)', margin: '4px 0 0' }}>{importMsg}</p>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label className="hh-label">Nearby cross streets</label><input className="hh-input" value={form.crossroads} onChange={(e) => set('crossroads', e.target.value)} placeholder="Main & 5th" /></div>
            <div>
              <label className="hh-label">Listing URL</label>
              <input className="hh-input" value={form.listingUrl} onChange={(e) => set('listingUrl', e.target.value)} onBlur={tryFillAddressFromUrl} placeholder="https://..." />
              <p style={{ fontSize: 11, color: 'var(--ink-soft)', margin: '4px 0 0' }}>A link back to the listing. If the address field above is empty, we'll try to read it from this link — then you can look up property details.</p>
            </div>
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
              {!STATUS_OPTIONS.includes(form.status) && <option value={form.status}>{form.status} (legacy)</option>}
            </select>
          </div>
        </div>

        {isArchivedStatus(form.status) && (
          <div style={{ marginBottom: 14 }}>
            <label className="hh-label">Why did you rule this one out?</label>
            <input className="hh-input" value={form.rejectionReason} onChange={(e) => set('rejectionReason', e.target.value)} placeholder="e.g. Busy road, no basement, taxes too high" />
          </div>
        )}

        {(form.status === 'Toured' || isArchivedStatus(form.status)) && (
          <div style={{ marginBottom: 18, background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px' }}>
            <label className="hh-label" style={{ marginBottom: 6 }}>How did this home feel?</label>
            <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '0 0 8px' }}>Your own reaction after seeing it in person — separate from the calculated match score. Optional.</p>
            <StarInput value={form.ratings[TOUR_RATING_KEY] || 0} onChange={(v) => setRatingItem('tour', 'overall', v)} size={20} />
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
              {def.options.filter((o) => o !== 'No Preference').map((o) => <span key={o} className={`hh-chip ${form[def.key]?.includes(o) ? 'on' : ''}`} onClick={() => toggleMulti(def.key, o)}>{o}</span>)}
            </div>
            {def.key === 'homeLayout' && SINGLESELECT_CATEGORIES.some((d) => priorities[d.key]?.tier !== 'dontcare') && (
              <div style={{ marginTop: 12, paddingLeft: 14, borderLeft: '2px solid var(--line)' }}>
                {SINGLESELECT_CATEGORIES.filter((d) => priorities[d.key]?.tier !== 'dontcare').map((d) => (
                  <div key={d.key} style={{ marginBottom: 10 }}>
                    <label className="hh-label">{d.title}{priorities[d.key]?.tier === 'must' && <span className="hh-must-badge">MUST</span>}</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {d.options.filter((o) => o !== 'No Preference').map((o) => <span key={o} className={`hh-chip ${form[d.key] === o ? 'on' : ''}`} onClick={() => setForm((f) => ({ ...f, [d.key]: f[d.key] === o ? '' : o }))}>{o}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {getItemlistCategories(priorities.searchType).map((def) => {
          const visible = visibleOrderedItems(def, priorities);
          if (!visible.length) return null;
          const ratingItems = visible.filter((i) => i.kind === 'rating');
          const checkItems = visible.filter((i) => i.kind === 'check');
          const mustCount = visible.filter((i) => priorities[def.key]?.tiers?.[i.label] === 'must').length;
          return (
            <details key={def.key} open={mustCount > 0 || def.key === 'location' || def.key === 'homeFeel'} className="hh-details">
              <summary>{def.title}{mustCount > 0 && <span className="hh-must-badge">{mustCount} MUST</span>}</summary>
              {ratingItems.length > 0 && (
                <>
                  <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '10px 0 0', fontStyle: 'italic' }}>Rate what you can now — the rest can wait until after you've seen it in person.</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 10, columnGap: 16, margin: '10px 0 12px' }}>
                    {ratingItems.map((item) => (
                      <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13 }}>{item.label}{priorities[def.key]?.tiers?.[item.label] === 'must' && <span className="hh-must-badge">MUST</span>}</span>
                        <StarInput value={form.ratings[nsKey(def.key, item.label)] || 0} onChange={(v) => setRatingItem(def.key, item.label, v)} />
                      </div>
                    ))}
                  </div>
                </>
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
