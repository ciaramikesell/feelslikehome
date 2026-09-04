'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Upload, Link2 } from 'lucide-react';
import { StarInput } from '@/components/ui';
import {
  STATUS_OPTIONS, MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, terminology, getItemlistCategories,
  isArchivedStatus, isRentalType, TOUR_RATING_KEY,
} from '@/lib/constants';
import { visibleOrderedItems, parseListingText, selectedSubjectiveCriteria } from '@/lib/matching';
import { extractAddressFromListingUrl } from '@/lib/listingUrl';
import { splitAddressLines, formatFoundCardFacts, countFoundFacts } from '@/lib/homeDisplay';
import { createClient } from '@/lib/supabase/client';

const PHOTO_BUCKET = 'home-photos';
const ALLOWED_PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB — approved limit: covers a full-resolution phone photo/screenshot without bloating page loads or storage cost.

// Pure — no network. Returns the object path within PHOTO_BUCKET if this URL is one
// of our own public Storage URLs, or null for any externally-pasted Photo URL. Used
// so Save can best-effort clean up a replaced/removed *uploaded* photo without ever
// touching a URL the user pasted in manually.
function storagePathFromPublicUrl(url) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

export default function HomeModal({ initial, priorities, onSave, onClose, userId }) {
  const [form, setForm] = useState(initial);
  const [pasteText, setPasteText] = useState('');
  const [parseMsg, setParseMsg] = useState('');
  const [saving, setSaving] = useState(false);

  // Find-a-home flow: one input that accepts a listing URL or a plain address.
  const [findInput, setFindInput] = useState(initial.listingUrl || initial.address || '');
  const [importPhase, setImportPhase] = useState('idle'); // idle | loading | success | empty | error
  const [importResult, setImportResult] = useState(null); // { fields, searchedAddress }
  const [importErrorMsg, setImportErrorMsg] = useState('');
  const [urlFallbackMsg, setUrlFallbackMsg] = useState('');
  const [fallbackAddressInput, setFallbackAddressInput] = useState('');
  const [editDetailsOpen, setEditDetailsOpen] = useState(false);
  const [lastLookupAddress, setLastLookupAddress] = useState('');

  // "+ Add more details" starts collapsed for a blank home (the whole point of this
  // pass), but starts open if the home already has data in there — editing shouldn't
  // feel like your own answers vanished behind a click.
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(() => {
    const i = initial;
    return !!(
      i.homeLayout?.length || i.homeCondition?.length || i.primaryBedroomLocation || i.secondaryBedroomLocation
      || i.pros || i.cons || i.notes || Object.values(i.checks || {}).some(Boolean)
    );
  });
  // "How did it feel?" is the post-tour subjective-impressions panel — same idea:
  // collapsed until there's a tour to reflect on, open by default if already answered.
  const [tourFeelOpen, setTourFeelOpen] = useState(() => {
    if ((initial.ratings?.[TOUR_RATING_KEY] || 0) > 0) return true;
    return selectedSubjectiveCriteria(priorities).some((item) => (initial.ratings?.[`${item.categoryKey}:${item.label}`] || 0) > 0);
  });

  // Photo: the file is only staged locally (with an in-browser preview) until Save
  // actually runs — nothing is uploaded to Storage at selection time, so Cancel never
  // leaves an orphaned upload behind.
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [showPhotoUrlInput, setShowPhotoUrlInput] = useState(false);
  const photoInputRef = useRef(null);

  useEffect(() => () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  }, [photoPreviewUrl]);

  const handlePhotoFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after Remove
    if (!file) return;
    if (!ALLOWED_PHOTO_TYPES[file.type]) {
      setPhotoError('Please choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError('That image is larger than 5MB — please choose a smaller one.');
      return;
    }
    setPhotoError('');
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  };

  const handleRemovePhoto = () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setPhotoError('');
    set('photoUrl', '');
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.address.trim()) return;
    setSaving(true);
    setPhotoError('');
    try {
      let finalPhotoUrl = form.photoUrl;

      if (photoFile) {
        const supabase = createClient();
        const ext = ALLOWED_PHOTO_TYPES[photoFile.type] || 'jpg';
        const path = `${userId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, photoFile, { contentType: photoFile.type, upsert: false });
        if (uploadError) {
          setPhotoError("We couldn't upload that photo — please try again, or save without it.");
          setSaving(false);
          return;
        }
        const { data: publicUrlData } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
        finalPhotoUrl = publicUrlData?.publicUrl || '';
      }

      await onSave({ ...form, photoUrl: finalPhotoUrl });

      // Best-effort cleanup: if a photo we previously uploaded to our own bucket was
      // just replaced or removed, delete the old object so it doesn't linger as an
      // orphan. Never touches an externally-pasted Photo URL, and never blocks Save.
      if (initial.photoUrl && initial.photoUrl !== finalPhotoUrl) {
        const oldPath = storagePathFromPublicUrl(initial.photoUrl);
        if (oldPath) {
          createClient().storage.from(PHOTO_BUCKET).remove([oldPath]).catch(() => {});
        }
      }
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

  // Runs a RentCast lookup for a specific address via our own server route (which
  // holds the RentCast key). Sets form.address to whatever was actually looked up,
  // and only ever fills fields that are still empty — it never overwrites anything
  // the user already entered or corrected. Never saves on its own.
  const lookupAddress = async (rawAddress, opts = {}) => {
    const address = (rawAddress || '').trim();
    if (!address || importPhase === 'loading' || address === lastLookupAddress) return;

    setImportPhase('loading');
    setImportErrorMsg('');
    setUrlFallbackMsg('');
    setForm((f) => ({ ...f, address, ...(opts.listingUrl !== undefined ? { listingUrl: opts.listingUrl } : {}) }));

    try {
      const res = await fetch('/api/import-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, mode: isRentalType(priorities.searchType) ? 'rental' : 'sale' }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Intentionally do NOT set lastLookupAddress here — a failed lookup must
        // always be retryable with the exact same address. The guard only exists
        // to prevent redundant *successful* lookups.
        setImportPhase('error');
        setImportResult(null);
        setImportErrorMsg("We couldn't look up that address right now — you can enter details manually below.");
        return;
      }

      setLastLookupAddress(address);

      if (!data.found) {
        setImportPhase('empty');
        setImportResult(null);
        return;
      }

      setImportResult({ fields: data.fields || {}, searchedAddress: address });
      setEditDetailsOpen(false);
      setImportPhase('success');
      setForm((f) => {
        const next = { ...f };
        Object.entries(data.fields || {}).forEach(([k, v]) => { if (v && !next[k]) next[k] = v; });
        return next;
      });
    } catch {
      setImportPhase('error');
      setImportResult(null);
      setImportErrorMsg("We couldn't reach the property data provider — you can enter details manually below.");
    }
  };

  // Single Find-a-home entry point: figures out whether the pasted text is a
  // listing URL or a plain address, and routes it accordingly. URL parsing is
  // string-only (see src/lib/listingUrl.js) — nothing here fetches the listing page.
  const handleFind = () => {
    const raw = findInput.trim();
    if (!raw) return;
    const looksLikeUrl = /^https?:\/\//i.test(raw);

    if (looksLikeUrl) {
      const result = extractAddressFromListingUrl(raw);
      if (result?.address) {
        setUrlFallbackMsg('');
        lookupAddress(result.address, { listingUrl: raw });
      } else {
        // Graceful, non-technical fallback — never a raw error for an unrecognized link.
        setImportPhase('idle');
        setImportResult(null);
        setUrlFallbackMsg("We couldn't read an address from that link — enter the property address below and we'll look it up.");
        set('listingUrl', raw);
      }
    } else {
      setUrlFallbackMsg('');
      lookupAddress(raw);
    }
  };

  const handleFallbackAddressLookup = () => {
    const address = fallbackAddressInput.trim();
    if (!address) return;
    setUrlFallbackMsg('');
    lookupAddress(address);
  };

  const isNewHome = !initial.address;
  // The Find-a-home import UI (Find bar, status messages, URL fallback, compact
  // card, "Edit details") is Add Home only for this pass — existing homes open
  // straight into the classic detailed edit experience, with no re-check affordance.
  const showFindUI = isNewHome;
  const showCompactCard = isNewHome && importPhase === 'success' && !editDetailsOpen && importResult;
  const foundFactsCount = importResult ? countFoundFacts(importResult.fields) : 0;
  const addressLines = showCompactCard ? splitAddressLines(importResult.fields.address || importResult.searchedAddress) : { line1: '', line2: '' };
  const cardFacts = showCompactCard ? formatFoundCardFacts(importResult.fields) : null;
  // On a new home, the manual field grid only appears once there's something to
  // resolve manually (no data found / lookup failed) or the user asks to edit an
  // import — never during idle/loading, so idle Add Home shows only the Find bar.
  const showObjectiveGrid = !isNewHome || importPhase === 'empty' || importPhase === 'error' || (importPhase === 'success' && editDetailsOpen);

  const visibleMultiselect = MULTISELECT_CATEGORIES.filter((def) => priorities[def.key]?.tier !== 'dontcare');
  const visibleSingleselect = SINGLESELECT_CATEGORIES.filter((d) => priorities[d.key]?.tier !== 'dontcare');

  return (
    <div className="hh-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hh-modal hh-corner">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: isNewHome ? 14 : 18 }}>
          <h2 className="hh-serif" style={{ fontSize: 20, margin: 0, fontWeight: 600 }}>{isNewHome ? 'Add a home' : 'Edit home'}</h2>
          <button className="hh-btn hh-btn-ghost" style={{ padding: 6 }} onClick={onClose}><X size={16} /></button>
        </div>

        {isNewHome && (
          <div
            style={{
              background: 'rgba(193,89,47,0.07)',
              border: '1px solid rgba(193,89,47,0.25)',
              borderRadius: 16,
              padding: '18px 20px 20px',
              marginBottom: 16,
            }}
          >
            <p style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.5, margin: '0 0 14px' }}>
              Paste a listing link or enter an address. We'll fill in what we can.
            </p>
            <label className="hh-label">Listing link or address</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="hh-input"
                style={{ flex: 1, fontSize: 15, background: 'var(--paper-raised)' }}
                value={findInput}
                onChange={(e) => setFindInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFind()}
                placeholder="Paste a listing link, or type an address"
              />
              <button
                type="button"
                className="hh-btn"
                style={{ whiteSpace: 'nowrap' }}
                onClick={handleFind}
                disabled={!findInput.trim() || importPhase === 'loading'}
              >
                {importPhase === 'loading' ? 'Finding...' : 'Find this home'}
              </button>
            </div>
          </div>
        )}

        {/* -------------------------- Find feedback (Add Home only) -------------------------- */}
        {showFindUI && (
          <>
            {importPhase === 'success' && importResult && (
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--moss)', margin: '10px 0 4px' }}>
                ✓ We found {foundFactsCount} property detail{foundFactsCount === 1 ? '' : 's'}. Review them below.
              </p>
            )}
            {importPhase === 'empty' && (
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '10px 0 4px' }}>
                We couldn't find property data for that address — enter what you know below.
              </p>
            )}
            {importPhase === 'error' && importErrorMsg && (
              <p style={{ fontSize: 13, color: 'var(--brick)', margin: '10px 0 4px' }}>{importErrorMsg}</p>
            )}

            {urlFallbackMsg && (
              <div style={{ marginTop: 8, padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--paper-raised)' }}>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 8px' }}>{urlFallbackMsg}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="hh-input"
                    style={{ flex: 1 }}
                    value={fallbackAddressInput}
                    onChange={(e) => setFallbackAddressInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleFallbackAddressLookup()}
                    placeholder="123 Maple St, Ann Arbor, MI"
                  />
                  <button
                    type="button"
                    className="hh-btn"
                    onClick={handleFallbackAddressLookup}
                    disabled={!fallbackAddressInput.trim() || importPhase === 'loading'}
                  >
                    Find this home
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <details className="hh-details" style={{ marginTop: 14 }}>
          <summary>Can't find the home? Paste listing details instead</summary>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '8px 0' }}>Copy the property description or listing details from the listing page and paste them here. We'll try to recognize price, beds, baths, square footage, and other details.</p>
          <textarea className="hh-textarea" style={{ minHeight: 90 }} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the full listing text here..." />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: parseMsg.startsWith("Couldn't") ? 'var(--brick)' : 'var(--moss)' }}>{parseMsg}</span>
            <button type="button" className="hh-btn hh-btn-ghost" onClick={runAutofill} disabled={!pasteText.trim()}>Fill in fields</button>
          </div>
        </details>

        {/* -------------------------- Found automatically -------------------------- */}
        {showCompactCard && (
          <div style={{ border: '1px solid var(--moss)', background: 'rgba(116,128,79,0.07)', borderRadius: 14, padding: '16px 18px', margin: '16px 0' }}>
            <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color: 'var(--moss)', letterSpacing: '.02em', marginBottom: 8 }}>✓ Found automatically</span>
            <div className="hh-address" style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.35 }}>
              {addressLines.line1}
              {addressLines.line2 && <><br />{addressLines.line2}</>}
            </div>
            {cardFacts.priceLine && <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '10px 0 2px' }}>{cardFacts.priceLine}</div>}
            {cardFacts.bedsBathsSqft && <div style={{ fontSize: 13.5, color: 'var(--ink)', margin: '2px 0' }}>{cardFacts.bedsBathsSqft}</div>}
            {cardFacts.secondaryFacts && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6 }}>{cardFacts.secondaryFacts}</div>}
            <button type="button" className="hh-btn hh-btn-ghost" style={{ marginTop: 12, fontSize: 12.5, padding: '6px 12px' }} onClick={() => setEditDetailsOpen(true)}>Edit details</button>
          </div>
        )}

        {/* -------------------------- Objective property fields -------------------------- */}
        {showObjectiveGrid && (
          <div style={{ marginTop: 16 }}>
            {isNewHome && editDetailsOpen && importPhase === 'success' && (
              <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 12.5, padding: '5px 10px', marginBottom: 10 }} onClick={() => setEditDetailsOpen(false)}>
                ← Back to summary
              </button>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 6 }}>
              <div>
                <label className="hh-label">Address *</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="hh-input" style={{ flex: 1 }} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="123 Maple St, Ann Arbor, MI" />
                  {isNewHome && (
                    <button
                      type="button"
                      className="hh-btn hh-btn-ghost"
                      style={{ whiteSpace: 'nowrap' }}
                      onClick={() => lookupAddress(form.address)}
                      disabled={!form.address.trim() || importPhase === 'loading' || form.address.trim() === lastLookupAddress}
                    >
                      {importPhase === 'loading' ? 'Looking up...' : 'Look up property details'}
                    </button>
                  )}
                </div>
              </div>
              <div><label className="hh-label">Listing URL</label><input className="hh-input" value={form.listingUrl} onChange={(e) => set('listingUrl', e.target.value)} placeholder="https://..." /></div>
              <details className="hh-details">
                <summary>More location details</summary>
                <div style={{ marginTop: 10 }}>
                  <label className="hh-label">Nearby cross streets</label>
                  <input className="hh-input" value={form.crossroads} onChange={(e) => set('crossroads', e.target.value)} placeholder="Main & 5th" />
                </div>
              </details>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, margin: '14px 0' }}>
              {priorities.budget?.tier !== 'dontcare' && <div><label className="hh-label">{terminology(priorities.searchType).priceFieldLabel}{priorities.budget?.tier === 'must' && <span className="hh-must-badge">MUST</span>}</label><input className="hh-input" value={form.price} onChange={(e) => set('price', e.target.value)} placeholder={terminology(priorities.searchType).pricePlaceholder} /></div>}
              <div><label className="hh-label">Est. monthly pmt</label><input className="hh-input" value={form.estMonthly} onChange={(e) => set('estMonthly', e.target.value)} placeholder="2800" /></div>
              {!isNewHome && (
                <div><label className="hh-label">Status</label>
                  <select className="hh-select" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    {!STATUS_OPTIONS.includes(form.status) && <option value={form.status}>{form.status} (legacy)</option>}
                  </select>
                </div>
              )}
            </div>

            {isArchivedStatus(form.status) && (
              <div style={{ marginBottom: 14 }}>
                <label className="hh-label">Why did you rule this one out?</label>
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
          </div>
        )}

        {/* -------------------------- Photo -------------------------- */}
        {(() => {
          const currentPreviewSrc = photoFile ? photoPreviewUrl : (form.photoUrl || null);
          const urlInputVisible = !photoFile && (showPhotoUrlInput || !!form.photoUrl);
          return (
            <div
              style={{
                background: 'rgba(198,146,69,0.08)',
                border: '1px solid rgba(198,146,69,0.28)',
                borderRadius: 16,
                padding: '14px 16px 16px',
                margin: '14px 0',
              }}
            >
              <h3 className="hh-serif" style={{ fontSize: 15, fontWeight: 600, margin: '0 0 3px' }}>Add a photo</h3>
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 12px', lineHeight: 1.45 }}>
                Give this home a face so it's easy to spot later — you can always add or change it.
              </p>

              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoFileChange}
                style={{ display: 'none' }}
              />

              {currentPreviewSrc ? (
                <div>
                  <div style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--line)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={currentPreviewSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 12.5, padding: '6px 12px' }} onClick={() => photoInputRef.current?.click()}>Change photo</button>
                    <button type="button" className="hh-btn hh-btn-danger" style={{ fontSize: 12.5 }} onClick={handleRemovePhoto}>Remove</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="hh-btn"
                    style={{ flex: '1 1 160px', justifyContent: 'center' }}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <Upload size={14} /> Upload photo
                  </button>
                  <button
                    type="button"
                    className="hh-btn hh-btn-ghost"
                    style={{ flex: '1 1 160px', justifyContent: 'center' }}
                    onClick={() => setShowPhotoUrlInput((v) => !v)}
                  >
                    <Link2 size={14} /> Paste a photo URL
                  </button>
                </div>
              )}

              {photoError && <p style={{ fontSize: 12, color: 'var(--brick)', margin: '8px 0 0' }}>{photoError}</p>}

              {urlInputVisible && (
                <div style={{ marginTop: 10 }}>
                  <label className="hh-label">Photo URL</label>
                  <input className="hh-input" style={{ background: 'var(--paper-raised)' }} value={form.photoUrl} onChange={(e) => set('photoUrl', e.target.value)} placeholder="https://.../photo.jpg" />
                </div>
              )}
            </div>
          );
        })()}

        {/* -------------------------- How did it feel? (post-tour, optional) -------------------------- */}
        {(form.status === 'Toured' || isArchivedStatus(form.status)) && (() => {
          const subjectiveItems = selectedSubjectiveCriteria(priorities);
          return (
            <div style={{ marginTop: 20 }}>
              <button
                type="button"
                className="hh-btn hh-btn-ghost"
                style={{ fontSize: 13, borderColor: 'rgba(193,89,47,0.4)', color: 'var(--brick)' }}
                onClick={() => setTourFeelOpen((v) => !v)}
              >
                {tourFeelOpen ? '− Hide' : 'How did it feel? →'}
              </button>

              {tourFeelOpen && (
                <div style={{ marginTop: 12, background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
                  <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '0 0 12px' }}>Things you can only really know after seeing it in person. Optional — skip anything you're not sure about.</p>

                  <div style={{ marginBottom: subjectiveItems.length ? 14 : 0 }}>
                    <label className="hh-label" style={{ marginBottom: 6 }}>Overall, how did this home feel?</label>
                    <StarInput value={form.ratings[TOUR_RATING_KEY] || 0} onChange={(v) => setRatingItem('tour', 'overall', v)} size={20} />
                  </div>

                  {subjectiveItems.length > 0 && (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {subjectiveItems.map((item) => {
                        const must = priorities[item.categoryKey]?.tiers?.[item.label] === 'must';
                        return (
                          <div key={`${item.categoryKey}:${item.label}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 13, color: must ? 'var(--brick)' : 'var(--ink)', fontWeight: must ? 700 : 400 }}>{item.label}</span>
                            <StarInput value={form.ratings[nsKey(item.categoryKey, item.label)] || 0} onChange={(v) => setRatingItem(item.categoryKey, item.label, v)} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* -------------------------- Add more details (optional, collapsed by default) -------------------------- */}
        <div style={{ marginTop: 20, marginBottom: 8 }}>
          <button
            type="button"
            className="hh-btn hh-btn-ghost"
            style={{ fontSize: 13 }}
            onClick={() => setMoreDetailsOpen((v) => !v)}
          >
            {moreDetailsOpen ? '− Hide more details' : '+ Add more details'}
          </button>

          {moreDetailsOpen && (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 14px' }}>Optional — add anything else you already know. You can always come back to this later.</p>

              {visibleMultiselect.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {visibleMultiselect.map((def) => (
                    <div key={def.key} style={{ marginBottom: 16 }}>
                      <label className="hh-label">{def.title}{priorities[def.key]?.tier === 'must' && <span className="hh-must-badge">MUST</span>}</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {def.options.filter((o) => o !== 'No Preference').map((o) => <span key={o} className={`hh-chip ${form[def.key]?.includes(o) ? 'on' : ''}`} onClick={() => toggleMulti(def.key, o)}>{o}</span>)}
                      </div>
                      {def.key === 'homeLayout' && visibleSingleselect.length > 0 && (
                        <div style={{ marginTop: 12, paddingLeft: 14, borderLeft: '2px solid var(--line)' }}>
                          {visibleSingleselect.map((d) => (
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
                </div>
              )}

              {/* Only the objectively-observable (check-kind) items show here — things you
                  can only judge in person (star ratings) live in "How did it feel?" instead. */}
              {getItemlistCategories(priorities.searchType).map((def) => {
                const visible = visibleOrderedItems(def, priorities).filter((i) => i.kind === 'check');
                if (!visible.length) return null;
                const mustCount = visible.filter((i) => priorities[def.key]?.tiers?.[i.label] === 'must').length;
                return (
                  <details key={def.key} open={mustCount > 0} className="hh-details" style={{ marginBottom: 10 }}>
                    <summary>{def.title}</summary>
                    {mustCount > 0 && (
                      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--brick)', margin: '10px 0 4px' }}>
                        Your Must-Have {mustCount === 1 ? 'Feature' : 'Features'}
                      </p>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {visible.map((item) => {
                        const must = priorities[def.key]?.tiers?.[item.label] === 'must';
                        const checked = form.checks[nsKey(def.key, item.label)];
                        return (
                          <span
                            key={item.label}
                            className={`hh-chip ${checked ? 'on' : ''}`}
                            onClick={() => toggleCheckItem(def.key, item.label)}
                            style={must ? { fontWeight: 700, color: checked ? undefined : 'var(--brick)' } : undefined}
                          >
                            {item.label}
                          </span>
                        );
                      })}
                    </div>
                  </details>
                );
              })}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16, marginBottom: 12 }}>
                <div><label className="hh-label">Pros</label><textarea className="hh-textarea" value={form.pros} onChange={(e) => set('pros', e.target.value)} /></div>
                <div><label className="hh-label">Cons</label><textarea className="hh-textarea" value={form.cons} onChange={(e) => set('cons', e.target.value)} /></div>
              </div>
              <div>
                <label className="hh-label">Notes</label>
                <textarea className="hh-textarea" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything else worth remembering..." />
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button className="hh-btn hh-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="hh-btn" onClick={submit} disabled={!form.address.trim() || saving}>{saving ? 'Saving...' : 'Save home'}</button>
        </div>
      </div>
    </div>
  );
}
