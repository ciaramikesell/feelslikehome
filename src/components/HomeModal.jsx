'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Upload, Link2, Footprints, Archive as ArchiveIcon, ExternalLink, Check, Users } from 'lucide-react';
import { StarInput } from '@/components/ui';
import {
  MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, terminology, getItemlistCategories,
  isArchivedStatus, isRentalType, TOUR_RATING_KEY, criterionDisplayLabel, TIER_ORDER,
} from '@/lib/constants';
import { visibleOrderedItems, parseListingText, selectedSubjectiveCriteria } from '@/lib/matching';
import { extractAddressFromListingUrl } from '@/lib/listingUrl';
import { splitAddressLines, formatFoundCardFacts, countFoundFacts, formatCurrencyDisplay, digitsOnly, formatLotSizeDisplay } from '@/lib/homeDisplay';
import { createClient } from '@/lib/supabase/client';
import { hasToured } from '@/lib/lifecycle';
import { HOME_PROPERTY_TYPE_OPTIONS, PROPERTY_TYPE_LABELS, searchIntentCapabilities } from '@/lib/searchIntent';

const PHOTO_BUCKET = 'home-photos';
const ALLOWED_PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB — approved limit: covers a full-resolution phone photo/screenshot without bloating page loads or storage cost.

function LikeDislikeInput({ value, onChange }) {
  const liked = value >= 3;
  const disliked = value > 0 && value < 3;
  return (
    <div className="hh-like-dislike">
      <button type="button" className={liked ? 'selected liked' : ''} onClick={() => onChange(liked ? 0 : 5)}>Liked</button>
      <button type="button" className={disliked ? 'selected disliked' : ''} onClick={() => onChange(disliked ? 0 : 2)}>Didn&apos;t like</button>
    </div>
  );
}

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

// A single compact fact input. Filled values look settled (solid border, dark
// text); empty ones look like an understated invitation to add something (dashed
// border, muted "Add ___" placeholder) — never alarming, never a blank form field.
function CoBuyerOnlyHelper() {
  return <span className="hh-shared-fact" title="This detail matters to your co-buyer"><Users size={11} /> Shared</span>;
}

function CompactField({ label, value, onChange, isCurrency, placeholder, must, coBuyerOnly }) {
  const filled = !!value;
  const shown = isCurrency ? (filled ? formatCurrencyDisplay(value) : '') : (value || '');
  return (
    <div>
      <label className="hh-label" style={{ fontSize: 10.5, marginBottom: 3 }}>{label}{must && <span className="hh-must-badge">MUST</span>}{coBuyerOnly && <CoBuyerOnlyHelper />}</label>
      <input
        className="hh-input"
        style={{
          fontSize: 12.5,
          padding: '6px 9px',
          borderStyle: filled ? 'solid' : 'dashed',
          borderColor: filled ? 'var(--line)' : 'var(--ink-soft)',
          color: filled ? 'var(--ink)' : 'var(--ink-soft)',
          background: filled ? 'var(--paper-raised)' : 'transparent',
        }}
        value={shown}
        onChange={(e) => onChange(isCurrency ? digitsOnly(e.target.value) : e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function TriStateField({ label, value, onChange }) {
  return <div><label className="hh-label" style={{ fontSize: 10.5, marginBottom: 3 }}>{label}</label><div style={{ display: 'flex', gap: 5 }}>
    {[['unknown', 'Unknown'], ['yes', 'Yes'], ['no', 'No']].map(([key, text]) => {
      const selected = key === 'unknown' ? value == null : key === 'yes' ? value === true : value === false;
      return <button key={key} type="button" className={`hh-chip ${selected ? 'on' : ''}`} aria-pressed={selected} onClick={() => onChange(key === 'unknown' ? null : key === 'yes')}>{text}</button>;
    })}
  </div></div>;
}

// The compact "Property details" area: a settled, scannable summary of what's
// known by default, with an explicit toggle to reveal small editable fields —
// replacing what used to be nine equally-prominent form boxes. Filled vs. empty
// fields are visually distinct so it's obvious at a glance what's known vs. what's
// merely optional to add.
function PropertyFacts({ form, set, priorities, sharedFactAwareness }) {
  const [editOpen, setEditOpen] = useState(() => !(form.price || form.beds || form.baths || form.sqft));
  const { showsRentalFacts } = searchIntentCapabilities(priorities.searchType);
  const priceLabel = showsRentalFacts ? 'Monthly Rent' : terminology(priorities.searchType).priceFieldLabel;

  const facts = formatFoundCardFacts({
    price: form.price, beds: form.beds, baths: form.baths, sqft: form.sqft,
    yearBuilt: form.yearBuilt, garageSpaces: form.garageSpaces,
    lotSize: form.lotSize, daysOnMarket: form.daysOnMarket,
    hoaFeeMonthly: form.hoaFeeMonthly, propertyTaxAnnual: form.propertyTaxAnnual, propertyTaxYear: form.propertyTaxYear,
  }, priorities.searchType);
  const hasAnyFacts = !!(facts.priceLine || facts.bedsBathsSqft || facts.secondaryFacts);

  return (
    <div style={{ marginBottom: 16 }}>
      <label className="hh-label" style={{ marginBottom: 8 }}>Property details</label>

      {!editOpen && hasAnyFacts && (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px' }}>
          {facts.priceLine && <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{facts.priceLine}</div>}
          {facts.bedsBathsSqft && <div style={{ fontSize: 13.5, color: 'var(--ink)', marginTop: 2 }}>{facts.bedsBathsSqft}</div>}
          {facts.secondaryFacts && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>{facts.secondaryFacts}</div>}
          {facts.hoaTaxLine && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>{facts.hoaTaxLine}</div>}
          {!showsRentalFacts && !form.estMonthly && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6, fontStyle: 'italic' }}>Estimated monthly payment not added</div>
          )}
          <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px', marginTop: 10 }} onClick={() => setEditOpen(true)}>
            Edit these details
          </button>
        </div>
      )}

      {(editOpen || !hasAnyFacts) && (
        <div>
          <div className="hh-property-facts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
            {sharedFactAwareness.price?.eligibleForSharedFactCapture && (
              <CompactField label={priceLabel} value={form.price} isCurrency onChange={(v) => set('price', v)} placeholder={`Add ${priceLabel.toLowerCase()}`} must={priorities.budget?.tier === 'must'} coBuyerOnly={sharedFactAwareness.price.coBuyerOnly} />
            )}
            {!showsRentalFacts && <CompactField label="Est. monthly pmt" value={form.estMonthly} isCurrency onChange={(v) => set('estMonthly', v)} placeholder="Add est. payment" />}
            {sharedFactAwareness.beds?.eligibleForSharedFactCapture && (
              <CompactField label="Beds" value={form.beds} onChange={(v) => set('beds', v)} placeholder="Add beds" must={priorities.bedsMin?.tier === 'must'} coBuyerOnly={sharedFactAwareness.beds.coBuyerOnly} />
            )}
            {sharedFactAwareness.baths?.eligibleForSharedFactCapture && (
              <CompactField label="Baths" value={form.baths} onChange={(v) => set('baths', v)} placeholder="Add baths" must={priorities.bathsMin?.tier === 'must'} coBuyerOnly={sharedFactAwareness.baths.coBuyerOnly} />
            )}
            {sharedFactAwareness.sqft?.eligibleForSharedFactCapture && (
              <CompactField label="Sq ft" value={form.sqft} onChange={(v) => set('sqft', v)} placeholder="Add sq ft" must={priorities.sqftTarget?.tier === 'must'} coBuyerOnly={sharedFactAwareness.sqft.coBuyerOnly} />
            )}
            {sharedFactAwareness.lotSize?.eligibleForSharedFactCapture && (
              <CompactField label="Lot size" value={form.lotSize} onChange={(v) => set('lotSize', v)} placeholder="0.25 acres" must={priorities.lotSizeTarget?.tier === 'must'} coBuyerOnly={sharedFactAwareness.lotSize.coBuyerOnly} />
            )}
            <CompactField label="Garage" value={form.garageSpaces} onChange={(v) => set('garageSpaces', v)} placeholder="Add garage" coBuyerOnly={sharedFactAwareness.garageSpaces?.coBuyerOnly} />
            <CompactField label="Year built" value={form.yearBuilt} onChange={(v) => set('yearBuilt', v)} placeholder="Add year" />
            <CompactField label="Days on mkt" value={form.daysOnMarket} onChange={(v) => set('daysOnMarket', v)} placeholder="Add DOM" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="hh-label" htmlFor="home-property-type">Property Type</label>
            <select id="home-property-type" className="hh-input" value={form.propertyType ?? ''} onChange={(e) => set('propertyType', e.target.value || null)}>
              <option value="">Unknown / not specified</option>
              {HOME_PROPERTY_TYPE_OPTIONS.map((value) => <option key={value} value={value}>{PROPERTY_TYPE_LABELS[value]}</option>)}
            </select>
          </div>
          {showsRentalFacts && <section style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
            <div className="hh-label" style={{ marginBottom: 10 }}>Rental details</div>
            <div className="hh-property-facts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <div><label className="hh-label" htmlFor="available-on" style={{ fontSize: 10.5, marginBottom: 3 }}>Available On</label><input id="available-on" type="date" className="hh-input" value={form.availableOn ?? ''} onChange={(e) => set('availableOn', e.target.value || null)} /></div>
              <TriStateField label="Pets Allowed" value={form.petsAllowed} onChange={(v) => set('petsAllowed', v)} />
              <TriStateField label="Utilities Included" value={form.utilitiesIncluded} onChange={(v) => set('utilitiesIncluded', v)} />
              <TriStateField label="In-Unit Laundry" value={form.inUnitLaundry} onChange={(v) => set('inUnitLaundry', v)} />
            </div>
          </section>}
          {hasAnyFacts && (
            <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => setEditOpen(false)}>
              Show summary
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function HomeModal({ initial, priorities, sharedFactAwareness = {}, isCollaborative = false, onSave, onClose, userId, onWantToTour, onArchiveRequest, presentation = 'modal' }) {
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

  // Secondary property details stay available without making the edit form feel
  // like homework. Stored answers remain untouched while this disclosure is closed.
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
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
  const [saveErrorMsg, setSaveErrorMsg] = useState('');
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
    setSaveErrorMsg('');
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

      try {
        await onSave({ ...form, photoUrl: finalPhotoUrl });
      } catch (saveErr) {
        // TEMPORARY DIAGNOSTIC (requested explicitly) — surfaces the raw error
        // to confirm/rule out a PostgREST schema-cache staleness hypothesis
        // for the new Property Details columns. Revert to the friendly-only
        // message once confirmed — do not ship this to real users long-term.
        console.error('Save home failed', saveErr);
        const detail = saveErr?.message || saveErr?.code || '';
        setSaveErrorMsg(
          "We couldn't save this home. Please try again — your changes here haven't been lost."
          + (detail ? ` (${detail})` : '')
        );
        setSaving(false);
        return;
      }

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
  // Explicit three-state setter: true = Yes, 'no' = No, undefined = clear back
  // to Unknown. Setting a key to `undefined` here is intentional and safe —
  // JSON serialization naturally drops undefined-valued keys, so this cleanly
  // returns the criterion to "absent" (Unknown) without needing a separate
  // delete path.
  const setCheckItem = (cat, label, value) => setForm((f) => {
    const k = nsKey(cat, label);
    const next = { ...f.checks };
    if (value === undefined) delete next[k];
    else next[k] = value;
    return { ...f, checks: next };
  });
  const toggleMulti = (catKey, opt) => setForm((f) => {
    const current = f[catKey] || [];
    return { ...f, [catKey]: current.includes(opt) ? current.filter((x) => x !== opt) : [...current, opt] };
  });

  const runAutofill = () => {
    const parsed = parseListingText(pasteText, priorities.searchType);
    const additions = Object.entries(parsed).filter(([k, v]) =>
      v !== null && v !== undefined && v !== '' && (form[k] === null || form[k] === undefined || form[k] === '')
    );
    setForm((f) => {
      const next = { ...f };
      additions.forEach(([k, v]) => { next[k] = v; });
      return next;
    });
    setImportPhase('error'); // reveal the reviewable manual form without claiming a provider result
    setParseMsg(additions.length > 0 ? `Filled in ${additions.length} field${additions.length === 1 ? '' : 's'} from what you pasted — double-check before saving.` : `Couldn't find anything usable in that text — try filling fields in manually.`);
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
  const cardFacts = showCompactCard ? formatFoundCardFacts(importResult.fields, priorities.searchType) : null;
  // On a new home, the manual field grid only appears once there's something to
  // resolve manually (no data found / lookup failed) or the user asks to edit an
  // import — never during idle/loading, so idle Add Home shows only the Find bar.
  const showObjectiveGrid = !isNewHome || importPhase === 'empty' || importPhase === 'error' || (importPhase === 'success' && editDetailsOpen);

  const visibleMultiselect = MULTISELECT_CATEGORIES.filter((def) => sharedFactAwareness[def.key]?.eligibleForSharedFactCapture);
  const visibleSingleselect = SINGLESELECT_CATEGORIES.filter((d) => sharedFactAwareness[d.key]?.eligibleForSharedFactCapture);

  return (
    <div className={`hh-modal-backdrop ${presentation === 'detail-panel' ? 'hh-detail-editor-backdrop' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`hh-modal hh-corner ${presentation === 'detail-panel' ? 'hh-detail-editor-panel' : ''}`} role="dialog" aria-modal="true" aria-label={presentation === 'detail-panel' ? 'Edit home information' : undefined}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: isNewHome ? 14 : 18 }}>
          <h2 className="hh-serif" style={{ fontSize: 20, margin: 0, fontWeight: 600 }}>{isNewHome ? 'Add a home' : 'Edit home'}</h2>
          <button type="button" className="hh-btn hh-btn-ghost" style={{ padding: 6 }} onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /></button>
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
            <div className="hh-find-home-row" style={{ display: 'flex', gap: 8 }}>
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
                <div className="hh-find-home-row" style={{ display: 'flex', gap: 8 }}>
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

        {isNewHome && <details className="hh-details" style={{ marginTop: 14 }}>
          <summary>Can't find the home? Paste listing details instead</summary>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '8px 0' }}>Copy the property description or listing details from the listing page and paste them here. We'll try to recognize price, beds, baths, square footage, and other details.</p>
          <textarea className="hh-textarea" style={{ minHeight: 90 }} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the full listing text here..." />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: parseMsg.startsWith("Couldn't") ? 'var(--brick)' : 'var(--moss)' }}>{parseMsg}</span>
            <button type="button" className="hh-btn hh-btn-ghost" onClick={runAutofill} disabled={!pasteText.trim()}>Fill in fields</button>
          </div>
        </details>}

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
            {!searchIntentCapabilities(priorities.searchType).showsRentalFacts && cardFacts.hoaTaxLine && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>{cardFacts.hoaTaxLine}</div>}
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
              {isNewHome && <details className="hh-details">
                <summary>More location details</summary>
                <div style={{ marginTop: 10 }}>
                  <label className="hh-label">Nearby cross streets</label>
                  <input className="hh-input" value={form.crossroads} onChange={(e) => set('crossroads', e.target.value)} placeholder="Main & 5th" />
                </div>
              </details>}
            </div>

            {isArchivedStatus(form.status) && (
              <div style={{ marginBottom: 14 }}>
                <label className="hh-label">Why did you rule this one out?</label>
                <input className="hh-input" value={form.rejectionReason} onChange={(e) => set('rejectionReason', e.target.value)} placeholder="e.g. Too expensive, wrong location, missing a must-have" />
              </div>
            )}

            {Object.values(sharedFactAwareness).some((fact) => fact?.coBuyerOnly) && (
              <p className="hh-shared-note"><Users size={13} /> Some details are highlighted because they matter to either of you.</p>
            )}
            <PropertyFacts form={form} set={set} priorities={priorities} sharedFactAwareness={sharedFactAwareness} />
          </div>
        )}

        {/* -------------------------- Photo -------------------------- */}
        {(() => {
          const currentPreviewSrc = photoFile ? photoPreviewUrl : (form.photoUrl || null);
          const urlInputVisible = !photoFile && (showPhotoUrlInput || !!form.photoUrl);
          return (
            <div className="hh-home-photo"
              style={{
                background: 'rgba(198,146,69,0.08)',
                border: '1px solid rgba(198,146,69,0.28)',
                borderRadius: 16,
                padding: '14px 16px 16px',
                margin: '14px 0',
              }}
            >
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 3px' }}>{currentPreviewSrc ? 'Home photo' : 'Add a photo'}</h3>
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
                  <div className="hh-home-photo-preview">
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

        {/* -------------------------- After your tour (post-tour, optional) -------------------------- */}
        {hasToured(form) && (() => {
          const subjectiveItems = selectedSubjectiveCriteria(priorities);
          return (
            <section className="hh-after-tour">
              <div className="hh-section-kicker">After your tour</div>
              <p>How did this home feel in person?</p>
              <button
                type="button"
                className="hh-btn hh-btn-ghost"
                style={{ fontSize: 13, borderColor: 'rgba(193,89,47,0.4)', color: 'var(--brick)' }}
                onClick={() => setTourFeelOpen((v) => !v)}
              >
                {tourFeelOpen ? '− Hide evaluation' : 'Add your evaluation →'}
              </button>

              {tourFeelOpen && (
                <div style={{ marginTop: 12, background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
                  <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '0 0 12px' }}>Things you can only really know after seeing it in person. Optional — skip anything you're not sure about.</p>

                  <div style={{ marginBottom: subjectiveItems.length ? 14 : 0 }}>
                    <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '0 0 3px' }}>Forget the checklist for a second.</p>
                    <label className="hh-label" style={{ marginBottom: 6 }}>How did this home feel?</label>
                    <StarInput value={form.ratings[TOUR_RATING_KEY] || 0} onChange={(v) => setRatingItem('tour', 'overall', v)} size={20} />
                  </div>

                  {subjectiveItems.length > 0 && (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {subjectiveItems.map((item) => {
                        const must = priorities[item.categoryKey]?.tiers?.[item.label] === 'must';
                        return (
                          <div key={`${item.categoryKey}:${item.label}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 13, color: must ? 'var(--brick)' : 'var(--ink)', fontWeight: must ? 700 : 400 }}>{criterionDisplayLabel(item.categoryKey, item.label)}</span>
                            <LikeDislikeInput value={form.ratings[nsKey(item.categoryKey, item.label)] || 0} onChange={(v) => setRatingItem(item.categoryKey, item.label, v)} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })()}

        {/* -------------------------- Add more details (optional, collapsed by default) -------------------------- */}
        <div style={{ marginTop: 20, marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => setMoreDetailsOpen((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
              background: 'var(--paper)', border: 0, borderRadius: 12,
              padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{moreDetailsOpen ? '− Hide home details' : '+ More home details'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>Layout, condition, features & more</div>
            </div>
          </button>

          {moreDetailsOpen && (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 14px' }}>Optional — add anything else you already know. You can always come back to this later.</p>
              <div className="hh-property-facts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 18 }}>
                <CompactField label="Basement" value={form.basementNotes} onChange={(v) => set('basementNotes', v)} placeholder="e.g. Finished walkout" coBuyerOnly={sharedFactAwareness.basementNotes?.coBuyerOnly} />
                <CompactField label="School details" value={form.schoolsNotes} onChange={(v) => set('schoolsNotes', v)} placeholder="Add school-related notes" coBuyerOnly={sharedFactAwareness.schoolsNotes?.coBuyerOnly} />
                <CompactField label="Condition notes" value={form.conditionNotes} onChange={(v) => set('conditionNotes', v)} placeholder="e.g. Roof 3 years old" coBuyerOnly={sharedFactAwareness.homeCondition?.coBuyerOnly} />
              </div>

              {visibleMultiselect.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {visibleMultiselect.map((def) => (
                    <div key={def.key} style={{ marginBottom: 16 }}>
                      <label className="hh-label">{def.title}{priorities[def.key]?.tier === 'must' && <span className="hh-must-badge">MUST</span>}{sharedFactAwareness[def.key]?.coBuyerOnly && <CoBuyerOnlyHelper />}</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {def.options.filter((o) => o !== 'No Preference').map((o) => <button type="button" key={o} className={`hh-chip ${form[def.key]?.includes(o) ? 'on' : ''}`} aria-pressed={form[def.key]?.includes(o)} onClick={() => toggleMulti(def.key, o)}>{o}</button>)}
                      </div>
                      {def.key === 'homeLayout' && visibleSingleselect.length > 0 && (
                        <div style={{ marginTop: 12, paddingLeft: 14, borderLeft: '2px solid var(--line)' }}>
                          {visibleSingleselect.map((d) => (
                            <div key={d.key} style={{ marginBottom: 10 }}>
                              <label className="hh-label">{d.title}{priorities[d.key]?.tier === 'must' && <span className="hh-must-badge">MUST</span>}{sharedFactAwareness[d.key]?.coBuyerOnly && <CoBuyerOnlyHelper />}</label>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {d.options.filter((o) => o !== 'No Preference').map((o) => <button type="button" key={o} className={`hh-chip ${form[d.key] === o ? 'on' : ''}`} aria-pressed={form[d.key] === o} onClick={() => setForm((f) => ({ ...f, [d.key]: f[d.key] === o ? '' : o }))}>{o}</button>)}
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
                const tierOf = (item) => priorities[def.key]?.tiers?.[item.label] || 'dontcare';
                const sorted = [...visible].sort((a, b) => TIER_ORDER.indexOf(tierOf(a)) - TIER_ORDER.indexOf(tierOf(b)));
                const mustCount = visible.filter((i) => tierOf(i) === 'must').length;
                return (
                  <details key={def.key} open={mustCount > 0} className="hh-details" style={{ marginBottom: 10 }}>
                    <summary>{def.title}</summary>
                    {mustCount > 0 && (
                      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--brick)', margin: '10px 0 4px' }}>
                        Your Must-Have {mustCount === 1 ? 'Feature' : 'Features'}
                      </p>
                    )}
                    <div style={{ display: 'grid', gap: 2, marginTop: 10 }}>
                      {sorted.map((item) => {
                        const must = priorities[def.key]?.tiers?.[item.label] === 'must';
                        const value = form.checks[nsKey(def.key, item.label)];
                        const isYes = value === true;
                        const isNo = value === 'no';
                        // Schools gets one narrowly-scoped exception: showing the
                        // user's own saved preference note as context so "Yes"/"No"
                        // actually means something while deciding. This note comes
                        // from priorities (personal, per-user) — never from the
                        // shared homes.schools_notes field, and never duplicated
                        // into it.
                        const schoolsNote = def.key === 'location' && item.label === 'Schools'
                          ? priorities.location?.notes?.Schools : null;
                        return (
                          <div key={item.label} style={{ padding: '6px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                              <span style={{ fontSize: 13.5, fontWeight: must ? 700 : 400, color: must ? 'var(--brick)' : 'var(--ink)' }}>
                                {criterionDisplayLabel(def.key, item.label)}
                              </span>
                              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={() => setCheckItem(def.key, item.label, isYes ? undefined : true)}
                                  className="hh-chip"
                                  style={{ fontSize: 11.5, padding: '4px 10px', borderColor: 'var(--moss)', background: isYes ? 'var(--moss)' : 'transparent', color: isYes ? '#fff' : 'var(--moss)' }}
                                >
                                  Yes
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCheckItem(def.key, item.label, isNo ? undefined : 'no')}
                                  className="hh-chip"
                                  style={{ fontSize: 11.5, padding: '4px 10px', borderColor: 'var(--brick)', background: isNo ? 'var(--brick)' : 'transparent', color: isNo ? '#fff' : 'var(--brick)' }}
                                >
                                  No
                                </button>
                              </div>
                            </div>
                            {schoolsNote && (
                              <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontStyle: 'italic', margin: '2px 0 0' }}>
                                &ldquo;{schoolsNote}&rdquo;
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })}

            </div>
          )}
        </div>

        <section className="hh-thoughts">
          <h3 className="hh-serif">{isCollaborative ? 'Shared notes' : 'Your thoughts'}</h3>
          {isCollaborative && <p className="hh-detail-context">Pros, cons, and notes are visible to both of you.</p>}
          <p>{isCollaborative ? 'Keep the details both of you want to remember in one place.' : 'Keep the personal side of this home separate from the listing facts.'}</p>
          <div className="hh-thoughts-grid">
            <div><label className="hh-label">Pros</label><textarea className="hh-textarea" value={form.pros} onChange={(e) => set('pros', e.target.value)} /></div>
            <div><label className="hh-label">Cons</label><textarea className="hh-textarea" value={form.cons} onChange={(e) => set('cons', e.target.value)} /></div>
          </div>
          <div><label className="hh-label">Notes</label><textarea className="hh-textarea" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything else worth remembering..." /></div>
        </section>

        {!isNewHome && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            {form.listingUrl && (
              <a href={form.listingUrl} target="_blank" rel="noreferrer" className="hh-btn hh-btn-ghost" style={{ padding: '5px 8px' }} title="Open listing">
                <ExternalLink size={13} />
              </a>
            )}
            {onArchiveRequest && !isArchivedStatus(form.status) && (
              <button
                type="button"
                className="hh-btn hh-btn-ghost"
                style={{ padding: '5px 8px' }}
                onClick={() => { onArchiveRequest(form); onClose(); }}
                title="Archive"
              >
                <ArchiveIcon size={13} />
              </button>
            )}
            {onWantToTour && form.status !== 'Want to Tour' && !hasToured(form) && !isArchivedStatus(form.status) && (
              <button
                type="button"
                className="hh-btn"
                style={{ fontSize: 12.5, padding: '6px 12px' }}
                onClick={() => onWantToTour(form)}
              >
                <Footprints size={13} /> Want to tour
              </button>
            )}
            {form.status === 'Want to Tour' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>
                <Check size={13} color="var(--moss)" /> Want to tour
              </div>
            )}
          </div>
        )}

        {saveErrorMsg && (
          <div style={{ background: 'rgba(193,89,47,0.09)', border: '1px solid var(--brick)', color: 'var(--brick)', fontSize: 12.5, padding: '9px 14px', borderRadius: 12, marginTop: 16 }}>
            {saveErrorMsg}
          </div>
        )}

        <div className="hh-modal-actions">
          <button className="hh-btn hh-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="hh-btn" onClick={submit} disabled={!form.address.trim() || saving}>{saving ? 'Saving...' : 'Save home'}</button>
        </div>
      </div>
    </div>
  );
}
