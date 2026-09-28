'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { X, Upload, Link2, Footprints, Archive as ArchiveIcon, ExternalLink, Check, Users, Search, ClipboardPaste, Camera, MessageSquareText, House, ChevronDown, ChevronLeft, Sparkles, ShieldCheck, Share, ArrowRight } from 'lucide-react';
import { StarInput } from '@/components/ui';
import {
  MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, getItemlistCategories,
  isArchivedStatus, isRentalType, TOUR_RATING_KEY, criterionDisplayLabel, TIER_ORDER, foldLegacyCheckAliases,
} from '@/lib/constants';
import { visibleOrderedItems, parseListingTextFindings, selectedSubjectiveCriteria, computeMatch } from '@/lib/matching';
import { extractAddressFromListingUrl, extractApartmentIdentityFromListingUrl, isLikelyListingUrl, findHomeByListingUrl } from '@/lib/listingUrl';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { mergeImportFields, resolveImport } from '@/lib/importDomain';
import { appendAllSuggestions, appendSuggestionToNotes, derivePriorityCheckPatch, extractEnrichmentSuggestions } from '@/lib/importReview';
import { formatCurrencyDisplay, digitsOnly, formatHomePrice } from '@/lib/homeDisplay';
import { createClient } from '@/lib/supabase/client';
import { hasToured } from '@/lib/lifecycle';
import { HOME_PROPERTY_TYPE_OPTIONS, PROPERTY_TYPE_LABELS, searchIntentCapabilities } from '@/lib/searchIntent';
import { homeIdentity, homeVocabulary } from '@/lib/homePresentation';
import { EXISTING_STRUCTURED_FACT_VALUE, structuredFactSelectValue, structuredFactValueFromSelect } from '@/lib/homeStructuredFacts';
import { countListingDetails, groupListingFacts } from '@/lib/listingFacts';
import { PROVENANCE_LABELS, fieldProvenance, hasImportSnapshot } from '@/lib/homeProvenance';
import { isNativeApp } from '@/lib/platform';

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
  return <span className="hh-shared-fact" title="This detail matters to your collaborator"><Users size={11} /> Shared</span>;
}

function ProvenanceTag({ provenance }) {
  if (!provenance) return null;
  return <span className={`flh-provenance is-${provenance}`}>{PROVENANCE_LABELS[provenance]}</span>;
}

function CompactField({ label, value, onChange, isCurrency, placeholder, must, coBuyerOnly, provenance = null }) {
  const filled = !!value;
  const shown = isCurrency ? (filled ? formatCurrencyDisplay(value) : '') : (value || '');
  return (
    <div>
      <label className="hh-label" style={{ fontSize: 10.5, marginBottom: 3 }}>{label}{must && <span className="hh-must-badge">MUST</span>}{coBuyerOnly && <CoBuyerOnlyHelper />}<ProvenanceTag provenance={provenance} /></label>
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

function StructuredFactSelect({ definition, value, onChange, must, coBuyerOnly }) {
  const choices = definition.options.filter((option) => option !== 'No Preference');
  const selected = Array.isArray(value) ? value : [];
  const currentValue = structuredFactSelectValue(selected, choices);
  return (
    <div>
      <label className="hh-label" htmlFor={`home-${definition.key}`}>{definition.title}{must && <span className="hh-must-badge">MUST</span>}{coBuyerOnly && <CoBuyerOnlyHelper />}</label>
      <select id={`home-${definition.key}`} className="hh-input" value={currentValue} onChange={(event) => onChange(structuredFactValueFromSelect(event.target.value))}>
        <option value="">Unknown / not specified</option>
        {currentValue === EXISTING_STRUCTURED_FACT_VALUE && <option value={EXISTING_STRUCTURED_FACT_VALUE} disabled>{selected.join(', ')}</option>}
        {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
      </select>
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

const FOUND_GROUP_LABELS = { basics: 'Basics', structure: 'Home & structure', parking: 'Parking', costs: 'Costs & ownership', utilities: 'Utilities', listing: 'Listing details' };

function WhatFlhFound({ result, listingUrl, mobile = false, panelRef }) {
  const fields = result?.fields || {};
  const basicFacts = [
    fields.price !== undefined && { key: 'price', label: 'Asking price', value: formatCurrencyDisplay(fields.price), group: 'basics' },
    (fields.beds || fields.baths || fields.sqft) && { key: 'size', label: 'Home', value: [fields.beds && `${fields.beds} beds`, fields.baths && `${fields.baths} baths`, fields.sqft && `${Number(fields.sqft).toLocaleString()} sq ft`].filter(Boolean).join(' · '), group: 'basics' },
    fields.yearBuilt && { key: 'yearBuilt', label: 'Built', value: fields.yearBuilt, group: 'basics' },
    fields.lotSize && { key: 'lotSize', label: 'Lot', value: fields.lotSize, group: 'basics' },
    fields.garageSpaces !== undefined && { key: 'garageSpaces', label: 'Garage spaces', value: fields.garageSpaces, group: 'parking' },
    fields.hoaFeeMonthly !== undefined && { key: 'hoaFeeMonthly', label: 'HOA fee', value: `${formatCurrencyDisplay(fields.hoaFeeMonthly)}/month`, group: 'costs' },
    fields.propertyTaxAnnual !== undefined && { key: 'propertyTaxAnnual', label: 'Property taxes', value: `${formatCurrencyDisplay(fields.propertyTaxAnnual)}/year${fields.propertyTaxYear ? ` (${fields.propertyTaxYear})` : ''}`, group: 'costs' },
    fields.daysOnMarket !== undefined && { key: 'daysOnMarket', label: 'Days on market', value: fields.daysOnMarket, group: 'listing' },
  ].filter(Boolean);
  const sections = groupListingFacts([...basicFacts, ...(result?.listingFacts || [])]);
  const features = result?.descriptionFeatures || [];
  const content = <>
    <header><span>What FLH found</span><p>From this listing</p></header>
    {sections.map((section) => <section key={section.key}><h3>{FOUND_GROUP_LABELS[section.key]}</h3>{section.facts.map((item) => <div className="hh-found-fact" key={item.key}><Check size={13} aria-hidden="true" /><span><b>{item.label}</b> — {item.value === true ? 'Yes' : item.value === false ? 'No' : Array.isArray(item.value) ? item.value.join(', ') : item.value}</span></div>)}</section>)}
    {features.length > 0 && <section><h3>Features mentioned</h3><div className="hh-found-tags">{features.map((item) => <span key={item.id}>{item.label}</span>)}</div><small>Explicitly stated in the listing description; review before relying on it.</small></section>}
    {listingUrl && <a href={listingUrl} target="_blank" rel="noreferrer">View original listing <ExternalLink size={13} /></a>}
  </>;
  if (mobile) return <details className="hh-found-mobile"><summary>View what FLH found</summary>{content}</details>;
  return <aside ref={panelRef} id="flh-listing-details" className="hh-found-panel" aria-label="What FLH found" tabIndex={-1}>{content}</aside>;
}

function AddSectionHeading({ icon: Icon, title, children, tone = 'peach' }) {
  return <div className="hh-add-section-heading"><span className={`is-${tone}`}><Icon size={24} aria-hidden="true" /></span><div><h3 className="hh-serif">{title}</h3>{children && <p>{children}</p>}</div></div>;
}

// Educational, dismissible: explains FLH's property-information model once. The
// dismissal is a per-device preference (same localStorage pattern as the mobile
// tour and install banner) — no schema, no settings system.
export const WHAT_FLH_FOUND_DISMISS_KEY = 'flh-what-flh-found-dismissed';

function WhatFlhFoundIntro() {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try { setDismissed(localStorage.getItem(WHAT_FLH_FOUND_DISMISS_KEY) === '1'); } catch { setDismissed(false); }
  }, []);
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(WHAT_FLH_FOUND_DISMISS_KEY, '1'); } catch { /* best-effort; never blocks dismissal */ }
  };
  return (
    <aside className="flh-what-found" aria-label="What FLH found">
      <span className="flh-icon-badge flh-icon-badge-sage" aria-hidden="true"><Sparkles size={16} /></span>
      <div><strong>What FLH found</strong><p>Listings don’t always tell the whole story. We filled in what we could. Update anything missing or incorrect below. Anything we can’t confirm stays Unknown — it won’t count against this home.</p></div>
      <button type="button" className="flh-icon-button flh-icon-button-plain" onClick={dismiss} aria-label="Dismiss What FLH found"><X size={16} aria-hidden="true" /></button>
    </aside>
  );
}

// The contender as it stands right now — the same identity rules as every other
// surface (an apartment's community name may lead; nothing is fabricated).
function HomeSummaryCard({ form, priorities, previewSrc }) {
  const identity = homeIdentity(form, priorities);
  const facts = [form.beds && `${form.beds} bd`, form.baths && `${form.baths} ba`, form.sqft && `${Number(String(form.sqft).replace(/[^0-9.]/g, '')).toLocaleString()} sq ft`].filter(Boolean);
  return (
    <section className="flh-edit-summary" aria-label="This home">
      <div className="flh-edit-summary-photo">{previewSrc ? <img src={previewSrc} alt="" /> : <House size={26} aria-hidden="true" />}</div>
      <div className="flh-edit-summary-copy">
        <strong className="flh-edit-summary-price">{formatHomePrice(form.price, priorities.searchType) || 'Price unknown'}</strong>
        <span className="flh-edit-summary-address">{identity.primary}</span>
        {identity.supporting && <span className="flh-edit-summary-sub">{identity.supporting}</span>}
        {facts.length > 0 && <span className="flh-edit-summary-sub">{facts.join(' · ')}</span>}
        {form.listingUrl && <a className="flh-edit-summary-link" href={form.listingUrl} target="_blank" rel="noreferrer">View original listing <ExternalLink size={12} aria-hidden="true" /></a>}
      </div>
    </section>
  );
}

// Shown when a pasted listing URL exactly matches a home this search already holds
// (findHomeByListingUrl — the same rule as share intake). There is deliberately no
// "Add anyway": a second row would split notes, tour state, and Match answers.
function DuplicateHomeView({ home, priorities, userId, isCollaborative, vocabulary, dialogRef, titleRef, onClose, onBack }) {
  const identity = homeIdentity(home, priorities);
  const archived = isArchivedStatus(home.status);
  const addedByOther = isCollaborative && home.userId && userId && home.userId !== userId;
  return <div className="hh-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div ref={dialogRef} className="hh-modal hh-corner hh-add-home-modal flh-duplicate-home" role="dialog" aria-modal="true" aria-labelledby="duplicate-home-title">
      <header className="hh-edit-home-header">
        <div><p className="flh-eyebrow">Already saved</p><h1 ref={titleRef} id="duplicate-home-title" className="hh-serif" tabIndex={-1}>This {vocabulary.singularLower} is already here</h1><p>{addedByOther ? 'Someone in this search already added this listing.' : 'You’ve already added this listing to this search.'}</p></div>
        <button type="button" className="hh-btn hh-btn-ghost hh-edit-home-close" onClick={onClose} aria-label="Close add home"><X size={18} /></button>
      </header>
      <div className="flh-duplicate-card">
        {home.photoUrl ? <img src={home.photoUrl} alt="" /> : <span className="flh-duplicate-photo" aria-hidden="true"><House size={22} /></span>}
        <div><strong>{identity.primary}</strong>{identity.supporting && <span>{identity.supporting}</span>}<span>{formatHomePrice(home.price, priorities.searchType) || 'Price unknown'}</span></div>
      </div>
      <ul className="flh-duplicate-notes">
        {archived && <li>It’s in your archive. Open it to restore it.</li>}
        {addedByOther && <li>Your Yes / No / Unknown answers and Match stay your own. Pros, cons, and notes on it are shared with everyone in this search.</li>}
        <li>Its original listing link is kept exactly as it was saved.</li>
      </ul>
      <div className="hh-modal-actions">
        <button type="button" className="hh-btn hh-btn-ghost" onClick={onBack}>Use a different link</button>
        <Link className="hh-btn" href={`/homes/${encodeURIComponent(home.id)}`} onClick={onClose}>Open existing {vocabulary.singularLower} <ArrowRight size={15} aria-hidden="true" /></Link>
      </div>
    </div>
  </div>;
}

function EditHomeEditor({ mode = 'edit', form, set, priorities, sharedFactAwareness, isCollaborative, vocabulary, photoFile, photoPreviewUrl, photoInputRef, handlePhotoFileChange, handleRemovePhoto, photoError, showPhotoUrlInput, setShowPhotoUrlInput, setCheckItem, saving, submit, saveErrorMsg, onClose, dialogRef, titleRef, importResult = null, presentation = 'modal', matchPerspectives = [] }) {
  const [allCriteriaOpen, setAllCriteriaOpen] = useState(false);
  // Add Home on a phone is two steps — review what came through, then how it fits
  // you. Presentation only (see .hh-edit-steps in globals.css): desktop keeps the
  // one-page workspace, and both steps edit the same form and save the same way.
  const [step, setStep] = useState('review');
  const shellRef = useRef(null);
  const goToStep = (next) => { setStep(next); shellRef.current?.scrollTo?.({ top: 0 }); };
  const [inspectorOpen, setInspectorOpen] = useState(() => mode === 'add' && !!importResult);
  const inspectorRef = useRef(null);
  const inspectorResult = importResult || form.listingImport || null;
  const inspectorCount = inspectorResult ? countListingDetails(inspectorResult.fields, inspectorResult.listingFacts, inspectorResult.descriptionFeatures) : 0;
  const hasInspector = !!(form.listingUrl && inspectorResult && inspectorCount > 0);
  const showInspector = () => {
    setInspectorOpen(true);
    requestAnimationFrame(() => {
      inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      inspectorRef.current?.focus({ preventScroll: true });
    });
  };
  const apartment = vocabulary.apartment;
  const { showsRentalFacts } = searchIntentCapabilities(priorities.searchType);
  // Provenance is only claimed when the listing snapshot proves it (homeProvenance).
  const importSnapshot = importResult || form.listingImport || null;
  const snapshotAvailable = hasImportSnapshot(importSnapshot);
  const provenanceOf = (field) => fieldProvenance(form[field], importSnapshot, field);
  // See foldLegacyCheckAliases: a fact recorded on this home under a pre-taxonomy-
  // unification legacy label (e.g. 'features:Home Office') stays visible here once the
  // search's own priority has folded onto the canonical label.
  const foldedChecks = foldLegacyCheckAliases(form.checks, priorities.searchType);
  const criteria = getItemlistCategories(priorities.searchType).flatMap((category) =>
    visibleOrderedItems(category, priorities).filter((item) => item.kind === 'check').map((item) => ({
      ...item,
      categoryKey: category.key,
      tier: priorities[category.key]?.tiers?.[item.label] || 'dontcare',
    })),
  ).sort((a, b) => {
    const aKnown = foldedChecks[`${a.categoryKey}:${a.label}`] !== undefined;
    const bKnown = foldedChecks[`${b.categoryKey}:${b.label}`] !== undefined;
    return (aKnown - bKnown) || (TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  });
  const shownCriteria = allCriteriaOpen ? criteria : criteria.slice(0, 6);
  const currentPreviewSrc = photoFile ? photoPreviewUrl : (form.photoUrl || null);
  const priorityLabel = (item) => item.tier === 'must' ? 'Must Have' : item.tier === 'important' ? 'Important' : item.tier === 'nice' ? 'Nice to Have' : item.categoryKey === 'location' ? 'Location Preference' : 'Preference';
  const adding = mode === 'add';

  return <div className={`hh-modal-backdrop hh-edit-home-backdrop ${presentation === 'detail-panel' ? 'hh-detail-editor-backdrop' : ''}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div ref={dialogRef} className={`hh-modal hh-corner hh-edit-home-modal ${presentation === 'detail-panel' ? 'hh-detail-editor-panel' : ''}`} role="dialog" aria-modal="true" aria-labelledby="edit-home-title">
      <header className="hh-edit-home-header">
        <div>
          <p className="flh-eyebrow">{adding ? <>Review imported {vocabulary.singularLower}<span className="flh-step-count"> · Step {step === 'review' ? 1 : 2} of 2</span></> : `Edit ${vocabulary.singularLower}`}</p>
          <h1 ref={titleRef} id="edit-home-title" className="hh-serif" tabIndex={-1}>{adding ? (step === 'review' ? 'Check what came through.' : 'How this home fits you.') : 'Refine what FLH knows.'}</h1>
          <p>{adding
            ? (step === 'review' ? 'Imported listing details can be incomplete. Correct only what you actually know — anything missing stays Unknown.' : 'These are the priorities you set in My Search. Confirm what’s true for this home — don’t re-rank them here.')
            : 'Correct the listing, add what you know, and keep your perspective current. Changes to shared property information are visible to everyone in this search.'}</p>
          {hasInspector && !(adding && step === 'match') && <button type="button" className="hh-listing-inspector-entry" aria-controls="flh-listing-details" onClick={showInspector}><Check size={14} /> {inspectorCount} listing detail{inspectorCount === 1 ? '' : 's'} found <span>View →</span></button>}
        </div>
        <button type="button" className="hh-btn hh-btn-ghost hh-edit-home-close" onClick={onClose} aria-label={mode === 'add' ? 'Close add home' : 'Close edit home'}><X size={18} aria-hidden="true" /></button>
      </header>

      <div ref={shellRef} className={`hh-workspace-shell hh-edit-steps ${adding ? `is-adding is-step-${step}` : ''} ${inspectorOpen && hasInspector ? 'has-inspector' : ''}`}><div className="hh-edit-home-columns">
        <div className="hh-edit-home-column">
          <div data-step="review"><WhatFlhFoundIntro /></div>
          <div data-step="review"><HomeSummaryCard form={form} priorities={priorities} previewSrc={currentPreviewSrc} /></div>
          <section className="hh-edit-home-card" data-step="review" aria-labelledby="property-address-heading">
            <h2 id="property-address-heading" className="hh-serif">Property address</h2>
            {apartment && <div><label className="hh-label">Property name</label><input className="hh-input" value={form.propertyName || ''} onChange={(e) => set('propertyName', e.target.value)} /></div>}
            <div><label className="hh-label">Address *</label><AddressAutocomplete value={form.address} onChange={(value) => set('address', value)} onSelect={(value) => set('address', value)} placeholder="123 Maple St, Ann Arbor, MI" /></div>
            <div><label className="hh-label">Original listing URL</label><input className="hh-input" type="url" value={form.listingUrl || ''} onChange={(e) => set('listingUrl', e.target.value)} placeholder="https://…" /></div>
          </section>

          <section className="hh-edit-home-card" data-step="review" aria-labelledby="home-photo-heading">
            <h2 id="home-photo-heading" className="hh-serif">Home photo</h2>
            <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoFileChange} hidden />
            {currentPreviewSrc ? <div className="hh-edit-photo-frame"><img src={currentPreviewSrc} alt="Current home" /></div> : <div className="hh-edit-photo-empty"><Upload size={22} aria-hidden="true" /><span>No photo added</span></div>}
            <div className="hh-edit-photo-actions">
              <button type="button" className="hh-btn hh-btn-ghost" onClick={() => photoInputRef.current?.click()}>{currentPreviewSrc ? 'Change photo' : 'Upload photo'}</button>
              {!photoFile && <button type="button" className="hh-btn hh-btn-ghost" onClick={() => setShowPhotoUrlInput((value) => !value)}><Link2 size={14} /> Paste by URL</button>}
              {currentPreviewSrc && <button type="button" className="hh-btn hh-btn-danger" onClick={handleRemovePhoto}>Remove</button>}
            </div>
            {!photoFile && showPhotoUrlInput && <div><label className="hh-label">Photo URL</label><input className="hh-input" type="url" value={form.photoUrl || ''} onChange={(e) => set('photoUrl', e.target.value)} /></div>}
            {photoError && <p className="hh-edit-error" role="alert">{photoError}</p>}
          </section>

          <section className="hh-edit-home-card" data-step="review" aria-labelledby="key-details-heading">
            <h2 id="key-details-heading" className="hh-serif">Key details</h2>
            {snapshotAvailable && <p className="flh-provenance-legend" aria-label="Provenance key"><span className="flh-provenance is-listing">From listing</span><span className="flh-provenance is-you">Added by you</span><span className="flh-provenance is-unknown">Unknown</span></p>}
            <div className="hh-edit-fields-grid">
              <CompactField label={showsRentalFacts ? 'Monthly rent' : 'Price'} value={form.price} isCurrency onChange={(value) => set('price', value)} placeholder="Unknown" provenance={provenanceOf('price')} />
              {!showsRentalFacts && <CompactField label="Est. monthly payment" value={form.estMonthly} isCurrency onChange={(value) => set('estMonthly', value)} placeholder="Unknown" provenance={provenanceOf('estMonthly')} />}
              <CompactField label="Beds" value={form.beds} onChange={(value) => set('beds', value)} placeholder="Unknown" provenance={provenanceOf('beds')} />
              <CompactField label="Baths" value={form.baths} onChange={(value) => set('baths', value)} placeholder="Unknown" provenance={provenanceOf('baths')} />
              <CompactField label="Square footage" value={form.sqft} onChange={(value) => set('sqft', value)} placeholder="Unknown" provenance={provenanceOf('sqft')} />
              <CompactField label="Lot size" value={form.lotSize} onChange={(value) => set('lotSize', value)} placeholder="Unknown" provenance={provenanceOf('lotSize')} />
              <CompactField label="Year built" value={form.yearBuilt} onChange={(value) => set('yearBuilt', value)} placeholder="Unknown" provenance={provenanceOf('yearBuilt')} />
              <CompactField label="Garage" value={form.garageSpaces} onChange={(value) => set('garageSpaces', value)} placeholder="Unknown" provenance={provenanceOf('garageSpaces')} />
              <div>
                <label className="hh-label" htmlFor="home-property-type" style={{ fontSize: 10.5, marginBottom: 3 }}>{apartment ? 'Property type' : 'Home type'}<ProvenanceTag provenance={provenanceOf('propertyType')} /></label>
                <select id="home-property-type" className="hh-input" value={form.propertyType ?? ''} onChange={(e) => set('propertyType', e.target.value || null)}>
                  <option value="">Unknown / not specified</option>
                  {HOME_PROPERTY_TYPE_OPTIONS.map((value) => <option key={value} value={value}>{PROPERTY_TYPE_LABELS[value]}</option>)}
                </select>
              </div>
            </div>
            {/* Shared rental facts. Match reads these directly (Pets Allowed,
                Utilities Included, In-Unit Laundry), so every rental — home or
                apartment — needs a way to record them. Unknown clears to null. */}
            {showsRentalFacts && <section className="flh-rental-facts" aria-label="Rental details">
              <div className="hh-edit-fields-grid">
                <div><label className="hh-label" htmlFor="available-on" style={{ fontSize: 10.5, marginBottom: 3 }}>Available On<ProvenanceTag provenance={provenanceOf('availableOn')} /></label><input id="available-on" type="date" className="hh-input" value={form.availableOn ?? ''} onChange={(e) => set('availableOn', e.target.value || null)} /></div>
                <TriStateField label="Pets Allowed" value={form.petsAllowed} onChange={(v) => set('petsAllowed', v)} />
                <TriStateField label="Utilities Included" value={form.utilitiesIncluded} onChange={(v) => set('utilitiesIncluded', v)} />
                <TriStateField label="In-Unit Laundry" value={form.inUnitLaundry} onChange={(v) => set('inUnitLaundry', v)} />
              </div>
            </section>}
            <p className="flh-unknown-helper"><ShieldCheck size={14} aria-hidden="true" /> Unknown is neutral. Leave a field alone when the listing doesn’t support a reliable answer.</p>
          </section>
        </div>

        <div className="hh-edit-home-column">
          <section className="hh-edit-home-card" data-step="review" aria-labelledby="home-details-heading">
            <h2 id="home-details-heading" className="hh-serif">Home details</h2>
            <div className="hh-edit-fields-grid">
              <CompactField label="Basement" value={form.basementNotes} onChange={(value) => set('basementNotes', value)} placeholder="Unknown" />
              <CompactField label="School details" value={form.schoolsNotes} onChange={(value) => set('schoolsNotes', value)} placeholder="Unknown" />
              {MULTISELECT_CATEGORIES.filter((definition) => sharedFactAwareness[definition.key]?.eligibleForSharedFactCapture).map((definition) => <StructuredFactSelect key={definition.key} definition={definition} value={form[definition.key]} onChange={(value) => set(definition.key, value)} />)}
              {SINGLESELECT_CATEGORIES.filter((definition) => sharedFactAwareness[definition.key]?.eligibleForSharedFactCapture).map((definition) => <div key={definition.key}><label className="hh-label">{definition.title}</label><select className="hh-input" value={form[definition.key] || ''} onChange={(e) => set(definition.key, e.target.value)}><option value="">Unknown / not specified</option>{definition.options.filter((option) => option !== 'No Preference').map((option) => <option key={option}>{option}</option>)}</select></div>)}
            </div>
          </section>

          <section className="hh-edit-home-card" data-step="match" aria-labelledby="personalized-matches-heading">
            <div className="hh-edit-heading-row"><h2 id="personalized-matches-heading" className="hh-serif">Personalized Match</h2><span>{criteria.length} applicable</span></div>
            <p className="hh-edit-context">Confirm what’s true for this {vocabulary.singularLower}. Priority levels come from My Search. Unknown is never treated as No — it won’t count against this {vocabulary.singularLower}.</p>
            {shownCriteria.length ? <div className="hh-edit-criteria">{shownCriteria.map((item) => {
              const key = `${item.categoryKey}:${item.label}`;
              const value = foldedChecks[key];
              return <div className="hh-edit-criterion" key={key}><div><b>{criterionDisplayLabel(item.categoryKey, item.label)}</b><span className={`flh-tier-label is-${item.tier}`}>{priorityLabel(item)}</span>{value === undefined && <span className="flh-provenance is-unknown">Not confirmed</span>}</div><div className="hh-edit-tristate" role="group" aria-label={`${criterionDisplayLabel(item.categoryKey, item.label)} property fact`}>
                {[['yes', 'Yes', true], ['no', 'No', 'no'], ['unknown', 'Unknown', undefined]].map(([id, label, next]) => { const selected = next === undefined ? value === undefined : value === next; return <button type="button" key={id} className={`hh-chip is-${id} ${selected ? 'on' : ''}`} aria-pressed={selected} onClick={() => setCheckItem(item.categoryKey, item.label, next)}>{label}</button>; })}
              </div></div>;
            })}</div> : <p className="hh-edit-empty">No Match criteria are configured for this search.</p>}
            {criteria.length > 6 && <button type="button" className="hh-btn hh-btn-ghost hh-edit-disclosure" aria-expanded={allCriteriaOpen} onClick={() => setAllCriteriaOpen((value) => !value)}>{allCriteriaOpen ? 'Show prioritized criteria' : 'View all Match criteria'}</button>}
            <p className="flh-basics-note">Search Basics — budget, beds, baths, size, lot, home type, layout, and condition — live in <Link href="/search">My Search</Link>. They define your search and appear as facts on this {vocabulary.singularLower}; they aren’t weighted in Match.</p>
          </section>

          {/* Pros, cons, and notes are stored on the shared home (see SHARED_FIELDS in
              collaboration.js), so they are labeled truthfully: private to you in a
              solo search, visible to everyone in a shared one. Your Yes/No/Unknown
              answers above are the part that stays yours. */}
          <section className="hh-edit-home-card" data-step="match" aria-labelledby="shared-notes-heading">
            <h2 id="shared-notes-heading" className="hh-serif">{isCollaborative ? 'Shared notes' : 'Your perspective'}</h2>
            <p className="hh-edit-context">{isCollaborative ? 'Pros, cons, and notes are visible to everyone in this search.' : 'Your impressions — not verified property facts.'}{isCollaborative && ' Your Yes / No / Unknown answers and Match stay your own.'}</p>
            <div className="hh-edit-notes-fields">
              <div><label className="hh-label" htmlFor="edit-home-pros">+ Pros</label><textarea id="edit-home-pros" className="hh-textarea" value={form.pros || ''} onChange={(e) => set('pros', e.target.value)} placeholder="Bright front room, dedicated office…" /></div>
              <div><label className="hh-label" htmlFor="edit-home-cons">− Cons</label><textarea id="edit-home-cons" className="hh-textarea" value={form.cons || ''} onChange={(e) => set('cons', e.target.value)} placeholder="Backyard fencing is unclear…" /></div>
              <div><label className="hh-label" htmlFor="edit-home-notes">Notes</label><textarea id="edit-home-notes" className="hh-textarea" value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="HOA details, sewer/water, financing options, recent updates, listing terms, or anything else worth noting." /></div>
            </div>
          </section>
          {matchPerspectives.length > 0 && form.address.trim() && <section className="hh-edit-home-card hh-suggestion-match-preview" data-step="match" aria-label="Buyer Match preview"><h2 className="hh-serif">How this lines up</h2><p>Based only on currently known property facts. Unknown details are not counted as misses.</p>{matchPerspectives.map((perspective) => { const match = computeMatch(form, perspective.priorities); return <div key={perspective.userId}><b>{perspective.name}</b><span>{match?.pct == null ? 'Match needs more known facts' : `${match.pct}% Match`}</span><small>{match?.allSelected?.filter((item) => !item.evaluated).slice(0, 3).map((item) => `${item.label} — Unknown`).join(' · ')}</small></div>; })}</section>}
        </div>
      </div>

      {inspectorOpen && hasInspector && <div className="hh-workspace-inspector" data-step="review"><button type="button" className="hh-btn hh-btn-ghost hh-inspector-close" onClick={() => setInspectorOpen(false)} aria-label="Close listing details"><X size={16} /></button><WhatFlhFound panelRef={inspectorRef} result={inspectorResult} listingUrl={form.listingUrl} /></div>}</div>
      {saveErrorMsg && <div className="hh-edit-save-error" role="alert">{saveErrorMsg}</div>}
      <footer className={`hh-edit-home-footer hh-edit-steps-footer ${adding ? `is-adding is-step-${step}` : ''}`}>
        {adding && step === 'match'
          ? <button type="button" className="hh-btn hh-btn-ghost flh-step-back" onClick={() => goToStep('review')}><ChevronLeft size={16} aria-hidden="true" /> Back</button>
          : <button type="button" className="hh-btn hh-btn-ghost" onClick={onClose}>Cancel</button>}
        {adding && <button type="button" className="hh-btn flh-step-next" onClick={() => goToStep('match')} disabled={!form.address.trim()}>Review Match <ArrowRight size={15} aria-hidden="true" /></button>}
        <button type="button" className="hh-btn flh-step-save" onClick={submit} disabled={!form.address.trim() || saving}>{saving ? 'Saving…' : mode === 'add' ? 'Save home' : 'Save changes'}</button>
      </footer>
    </div>
  </div>;
}

export default function HomeModal({ initial, priorities, sharedFactAwareness = {}, isCollaborative = false, onSave, onClose, userId, onWantToTour, onArchiveRequest, presentation = 'modal', autoFindOnMount = false, matchPerspectives = [], saveLabel = null, existingHomes = [] }) {
  const [form, setForm] = useState(initial);
  const vocabulary = homeVocabulary(priorities);
  const [pasteText, setPasteText] = useState('');
  const [parseMsg, setParseMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Find-a-home flow: one input that accepts a listing URL or a plain address.
  const [findInput, setFindInput] = useState(initial.listingUrl || initial.address || '');
  const [importPhase, setImportPhase] = useState('idle'); // idle | identity | loading | success | text-success | empty | error
  const [importResult, setImportResult] = useState(null); // { fields, searchedAddress }
  const [acceptedSuggestionIds, setAcceptedSuggestionIds] = useState([]);
  const [importErrorMsg, setImportErrorMsg] = useState('');
  const [urlFallbackMsg, setUrlFallbackMsg] = useState('');
  const [fallbackAddressInput, setFallbackAddressInput] = useState('');
  const [apartmentIdentity, setApartmentIdentity] = useState(null);
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
  const [duplicateHome, setDuplicateHome] = useState(null);
  const [showPhotoUrlInput, setShowPhotoUrlInput] = useState(false);
  const photoInputRef = useRef(null);
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  }, [photoPreviewUrl]);

  useEffect(() => {
    if (!initial.address) return undefined;
    const previouslyFocused = document.activeElement;
    titleRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [initial.address]);

  // Apartment to Rent has no "Unknown / not specified" property-type step in
  // Add Property — the search type already tells us it's an apartment, so a
  // brand-new record defaults to that instead of asking the user to pick it.
  // Runs once, only for a new (addressless) apartment record with no type set
  // yet — never touches an already-loaded/edited value, so this never
  // overwrites a collaborator's saved selection.
  useEffect(() => {
    if (vocabulary.apartment && !initial.address && !initial.propertyType) {
      setForm((f) => (f.propertyType ? f : { ...f, propertyType: 'apartment' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!form.address.trim() || savingRef.current) return;
    savingRef.current = true;
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
        await onSave({ ...form, photoUrl: finalPhotoUrl, ...(importResult ? { listingImport: { fields: importResult.fields || {}, listingFacts: importResult.listingFacts || [], descriptionFeatures: importResult.descriptionFeatures || [] } } : {}) });
      } catch (saveErr) {
        console.error('Save home failed', saveErr);
        // If the shared home row was already persisted before this failure
        // (see saveHomePersonalAndShared's partialHomeId), adopt its id now —
        // otherwise clicking Save again on this still-open modal would upsert
        // with no id and create a second, orphaned home.
        if (saveErr?.partialHomeId && !form.id) set('id', saveErr.partialHomeId);
        setSaveErrorMsg("We couldn't save this home. Please try again — your changes here haven't been lost.");
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
      savingRef.current = false;
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
  const runAutofill = () => {
    const findings = parseListingTextFindings(pasteText, priorities.searchType);
    const result = resolveImport(findings, form);
    const canonicalAdditions = Object.keys(result.fieldPatch);
    const merged = mergeImportFields(form, result.fieldPatch);
    const checkPatch = derivePriorityCheckPatch(pasteText, priorities, form.checks);
    const next = { ...merged, checks: { ...form.checks, ...checkPatch } };
    const suggestions = extractEnrichmentSuggestions(pasteText, next, { acceptedIds: acceptedSuggestionIds });
    const foundCount = canonicalAdditions.length + Object.keys(checkPatch).length + suggestions.length;
    const additions = Array.from({ length: foundCount });
    setForm(next);
    setImportResult({ ...result, fields: result.fieldPatch, suggestions, source: 'raw-text' });
    setEditDetailsOpen(true);
    setImportPhase(additions.length > 0 ? 'text-success' : 'empty');
    setParseMsg(foundCount > 0 ? `Found ${foundCount} useful detail${foundCount === 1 ? '' : 's'} from what you pasted — double-check before saving.` : `Couldn't find anything usable in that text — try filling fields in manually.`);
  };

  const addSuggestion = (suggestion) => {
    setForm((f) => ({ ...f, notes: appendSuggestionToNotes(f.notes, suggestion) }));
    setAcceptedSuggestionIds((ids) => ids.includes(suggestion.id) ? ids : [...ids, suggestion.id]);
    setImportResult((result) => result ? { ...result, suggestions: result.suggestions.filter((item) => item.id !== suggestion.id) } : result);
  };

  const addAllSuggestions = () => {
    const suggestions = importResult?.suggestions || [];
    setForm((f) => ({ ...f, notes: appendAllSuggestions(f.notes, suggestions) }));
    setAcceptedSuggestionIds((ids) => [...new Set([...ids, ...suggestions.map((item) => item.id)])]);
    setImportResult((result) => result ? { ...result, suggestions: [] } : result);
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
        body: JSON.stringify({ address, mode: vocabulary.apartment ? 'apartment' : isRentalType(priorities.searchType) ? 'rental' : 'sale' }),
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

      setImportResult({ fields: data.fields || {}, findings: data.findings || [], resolutions: data.resolutions || [], listingFacts: data.listingFacts || [], descriptionFeatures: data.descriptionFeatures || [], searchedAddress: address });
      setEditDetailsOpen(false);
      setImportPhase('success');
      setForm((f) => mergeImportFields(f, data.fields || {}));
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
    const looksLikeUrl = isLikelyListingUrl(raw);

    if (looksLikeUrl) {
      // The same exact-URL rule the share intake uses (HomesBoard): a listing this
      // search already holds is opened, never imported a second time.
      const existing = findHomeByListingUrl(existingHomes, raw);
      if (existing) { setDuplicateHome(existing); return; }
      const result = extractAddressFromListingUrl(raw);
      if (result?.address) {
        setApartmentIdentity(null);
        setUrlFallbackMsg('');
        lookupAddress(result.address, { listingUrl: raw });
      } else {
        const identity = vocabulary.apartment ? extractApartmentIdentityFromListingUrl(raw) : null;
        setApartmentIdentity(identity);
        setImportPhase(identity ? 'identity' : 'empty');
        setImportResult(null);
        setUrlFallbackMsg(identity ? '' : "We couldn't get much from that link, but you can still add the property.");
        setFallbackAddressInput(identity ? `${identity.propertyName}${identity.locality ? `, ${identity.locality}` : ''}` : '');
        setForm((current) => ({
          ...current,
          listingUrl: raw,
          propertyName: current.propertyName || identity?.propertyName || '',
        }));
      }
    } else if (vocabulary.apartment && !/\d/.test(raw)) {
      // A community name is valid discovery input, but must never be copied into
      // the canonical address used by maps, geocoding, commute, and RentCast.
      set('propertyName', raw);
      setImportPhase('empty');
      setImportResult(null);
      setUrlFallbackMsg('');
    } else {
      setUrlFallbackMsg('');
      lookupAddress(raw);
    }
  };

  // Share-to-FLH preparation: when Add Home is opened pre-filled from a
  // shared/linked listing URL (see /homes?url= in HomesBoard.jsx) rather than
  // pasted by hand, run the exact same Find-a-home lookup automatically once
  // — no separate import path, just triggering the existing one for the user.
  useEffect(() => {
    if (autoFindOnMount && findInput.trim()) handleFind();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFallbackAddressLookup = () => {
    const address = fallbackAddressInput.trim();
    if (!address) return;
    setUrlFallbackMsg('');
    lookupAddress(address, { listingUrl: form.listingUrl });
  };

  const isNewHome = !initial.address;
  if (isNewHome && duplicateHome) return <DuplicateHomeView home={duplicateHome} priorities={priorities} userId={userId} isCollaborative={isCollaborative} vocabulary={vocabulary} dialogRef={dialogRef} titleRef={titleRef} onClose={onClose} onBack={() => setDuplicateHome(null)} />;
  const workspaceReady = !isNewHome || ['success', 'text-success', 'empty', 'error'].includes(importPhase);

  if (workspaceReady) return <EditHomeEditor
    mode={isNewHome ? 'add' : 'edit'} form={form} set={set} priorities={priorities}
    sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative} vocabulary={vocabulary}
    photoFile={photoFile} photoPreviewUrl={photoPreviewUrl} photoInputRef={photoInputRef}
    handlePhotoFileChange={handlePhotoFileChange} handleRemovePhoto={handleRemovePhoto} photoError={photoError}
    showPhotoUrlInput={showPhotoUrlInput} setShowPhotoUrlInput={setShowPhotoUrlInput} setCheckItem={setCheckItem}
    saving={saving} submit={submit} saveErrorMsg={saveErrorMsg} onClose={onClose} dialogRef={dialogRef}
    titleRef={titleRef} importResult={importResult} presentation={presentation} matchPerspectives={matchPerspectives}
  />;

  return <div className="hh-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div ref={dialogRef} className="hh-modal hh-corner hh-add-home-modal hh-add-home-discovery" role="dialog" aria-modal="true" aria-labelledby="add-home-title">
      <header className="hh-edit-home-header">
        <div><p className="flh-eyebrow">Add a {vocabulary.singularLower}</p><h1 ref={titleRef} id="add-home-title" className="hh-serif" tabIndex={-1}>Bring in a {vocabulary.singularLower} you found.</h1><p>You found the {vocabulary.singularLower}. Feels Like Home helps you evaluate it.</p></div>
        <button type="button" className="hh-btn hh-btn-ghost hh-edit-home-close" onClick={onClose} aria-label="Close add home"><X size={18} /></button>
      </header>
      <section className="hh-import-listing">
        <AddSectionHeading icon={Search} title="Listing URL">Paste a link from Zillow, Redfin, Realtor.com, or any listing site — or an address.</AddSectionHeading>
        <label className="hh-label" htmlFor="add-home-find">Listing link or address</label>
        <div className="hh-find-home-row">
          <input id="add-home-find" className="hh-input" inputMode="url" autoCapitalize="none" autoCorrect="off" value={findInput} onChange={(event) => setFindInput(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && handleFind()} placeholder="https://www.zillow.com/homedetails/…" />
          <button type="button" className="hh-btn" onClick={handleFind} disabled={!findInput.trim() || importPhase === 'loading'}>{importPhase === 'loading' ? 'Finding…' : `Review this ${vocabulary.singularLower}`}</button>
        </div>
        <p className="flh-source-note">The original listing stays the source of truth. FLH keeps its link and never invents details it didn’t find.</p>
        {importPhase === 'identity' && apartmentIdentity && <div className="hh-manual-address"><p>We found {apartmentIdentity.propertyName}. Add its street address to continue.</p><AddressAutocomplete value={fallbackAddressInput} onChange={setFallbackAddressInput} onSelect={setFallbackAddressInput} /><button type="button" className="hh-btn" onClick={handleFallbackAddressLookup}>Use address</button></div>}
        {urlFallbackMsg && <p className="hh-edit-error">{urlFallbackMsg}</p>}
      </section>
      {isNativeApp() && <aside className="flh-share-callout" aria-label="Add from the Share Sheet"><Share size={18} aria-hidden="true" /><div><strong>Faster from your listing app</strong><p>Tap Share on any listing, then choose Feels Like Home. It opens right here, ready to review.</p></div></aside>}
      <details className="hh-details hh-manual-fallback">
        <summary><span className="hh-accordion-icon"><ClipboardPaste size={24} /></span><span>Can&apos;t find the home? Paste listing details instead<small>Enter the details manually when a link isn&apos;t available.</small></span><ChevronDown className="hh-accordion-chevron" size={20} /></summary>
        <textarea className="hh-textarea" value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="Paste listing details (optional)" />
        {parseMsg && <p className="hh-edit-context">{parseMsg}</p>}
        <div className="hh-modal-actions"><button type="button" className="hh-btn hh-btn-ghost" onClick={() => setImportPhase('empty')}>Enter manually</button><button type="button" className="hh-btn" onClick={runAutofill} disabled={!pasteText.trim()}>Fill in details</button></div>
      </details>
    </div>
  </div>;
}
