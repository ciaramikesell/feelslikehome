'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Upload, Link2, Footprints, Archive as ArchiveIcon, ExternalLink, Check, Users, Search, ClipboardPaste, Camera, MessageSquareText, House, ChevronDown } from 'lucide-react';
import { StarInput } from '@/components/ui';
import {
  MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, terminology, getItemlistCategories,
  isArchivedStatus, isRentalType, TOUR_RATING_KEY, criterionDisplayLabel, TIER_ORDER, foldLegacyCheckAliases,
  qualifierFactRows,
} from '@/lib/constants';
import { visibleOrderedItems, parseListingTextFindings, selectedSubjectiveCriteria, computeMatch } from '@/lib/matching';
import { extractAddressFromListingUrl, extractApartmentIdentityFromListingUrl, isLikelyListingUrl } from '@/lib/listingUrl';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { mergeImportFields, resolveImport } from '@/lib/importDomain';
import { appendAllSuggestions, appendSuggestionToNotes, derivePriorityCheckPatch, extractEnrichmentSuggestions } from '@/lib/importReview';
import { splitAddressLines, formatFoundCardFacts, formatCurrencyDisplay, digitsOnly, formatLotSizeDisplay } from '@/lib/homeDisplay';
import { createClient } from '@/lib/supabase/client';
import { hasToured } from '@/lib/lifecycle';
import { HOME_PROPERTY_TYPE_OPTIONS, PROPERTY_TYPE_LABELS, searchIntentCapabilities } from '@/lib/searchIntent';
import { homeVocabulary } from '@/lib/homePresentation';
import { EXISTING_STRUCTURED_FACT_VALUE, structuredFactSelectValue, structuredFactValueFromSelect } from '@/lib/homeStructuredFacts';
import { countListingDetails, groupListingFacts } from '@/lib/listingFacts';

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

// The compact "Property details" area: a settled, scannable summary of what's
// known by default, with an explicit toggle to reveal small editable fields —
// replacing what used to be nine equally-prominent form boxes. Filled vs. empty
// fields are visually distinct so it's obvious at a glance what's known vs. what's
// merely optional to add.
function PropertyFacts({ form, set, priorities, sharedFactAwareness }) {
  const apartment = homeVocabulary(priorities).apartment;
  const [editOpen, setEditOpen] = useState(() => !(form.price || form.beds || form.baths || form.sqft));
  const { showsRentalFacts } = searchIntentCapabilities(priorities.searchType);
  const priceLabel = showsRentalFacts ? 'Monthly Rent' : terminology(priorities.searchType).priceFieldLabel;

  const facts = formatFoundCardFacts({
    price: apartment ? null : form.price, beds: apartment ? null : form.beds, baths: apartment ? null : form.baths, sqft: apartment ? null : form.sqft,
    yearBuilt: form.yearBuilt, garageSpaces: form.garageSpaces,
    lotSize: form.lotSize, daysOnMarket: form.daysOnMarket,
    hoaFeeMonthly: form.hoaFeeMonthly, propertyTaxAnnual: form.propertyTaxAnnual, propertyTaxYear: form.propertyTaxYear,
  }, priorities.searchType);
  const hasAnyFacts = !!(facts.priceLine || facts.bedsBathsSqft || facts.secondaryFacts);

  return (
    <div style={{ marginBottom: 16 }}>
      <label className="hh-label" style={{ marginBottom: 8 }}>{apartment ? 'What do we know about it?' : 'Property details'}</label>
      {apartment && <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '-3px 0 10px' }}>Reliable details about the property, when available.</p>}

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
            {!apartment && sharedFactAwareness.price?.eligibleForSharedFactCapture && (
              <CompactField label={priceLabel} value={form.price} isCurrency onChange={(v) => set('price', v)} placeholder={`Add ${priceLabel.toLowerCase()}`} must={priorities.budget?.tier === 'must'} coBuyerOnly={sharedFactAwareness.price.coBuyerOnly} />
            )}
            {!showsRentalFacts && <CompactField label="Est. monthly pmt" value={form.estMonthly} isCurrency onChange={(v) => set('estMonthly', v)} placeholder="Add est. payment" />}
            {!apartment && sharedFactAwareness.beds?.eligibleForSharedFactCapture && (
              <CompactField label="Beds" value={form.beds} onChange={(v) => set('beds', v)} placeholder="Add beds" must={priorities.bedsMin?.tier === 'must'} coBuyerOnly={sharedFactAwareness.beds.coBuyerOnly} />
            )}
            {!apartment && sharedFactAwareness.baths?.eligibleForSharedFactCapture && (
              <CompactField label="Baths" value={form.baths} onChange={(v) => set('baths', v)} placeholder="Add baths" must={priorities.bathsMin?.tier === 'must'} coBuyerOnly={sharedFactAwareness.baths.coBuyerOnly} />
            )}
            {!apartment && sharedFactAwareness.sqft?.eligibleForSharedFactCapture && (
              <CompactField label="Sq ft" value={form.sqft} onChange={(v) => set('sqft', v)} placeholder="Add sq ft" must={priorities.sqftTarget?.tier === 'must'} coBuyerOnly={sharedFactAwareness.sqft.coBuyerOnly} />
            )}
            {sharedFactAwareness.lotSize?.eligibleForSharedFactCapture && (
              <CompactField label="Lot size" value={form.lotSize} onChange={(v) => set('lotSize', v)} placeholder="0.25 acres" must={priorities.lotSizeTarget?.tier === 'must'} coBuyerOnly={sharedFactAwareness.lotSize.coBuyerOnly} />
            )}
            {!apartment && <CompactField label="Garage" value={form.garageSpaces} onChange={(v) => set('garageSpaces', v)} placeholder="Add garage" coBuyerOnly={sharedFactAwareness.garageSpaces?.coBuyerOnly} />}
            <CompactField label="Year built" value={form.yearBuilt} onChange={(v) => set('yearBuilt', v)} placeholder="Add year" />
            {!apartment && <CompactField label="Days on mkt" value={form.daysOnMarket} onChange={(v) => set('daysOnMarket', v)} placeholder="Add DOM" />}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="hh-label" htmlFor="home-property-type">Property Type</label>
            <select id="home-property-type" className="hh-input" value={form.propertyType ?? ''} onChange={(e) => set('propertyType', e.target.value || null)}>
              <option value="">Unknown / not specified</option>
              {HOME_PROPERTY_TYPE_OPTIONS.map((value) => <option key={value} value={value}>{PROPERTY_TYPE_LABELS[value]}</option>)}
            </select>
          </div>
          {/* Capability gate retained for home rentals: showsRentalFacts && <section */}
          {showsRentalFacts && <>{!apartment && <section style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
            <div className="hh-label" style={{ marginBottom: 10 }}>Rental details</div>
            <div className="hh-property-facts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <div><label className="hh-label" htmlFor="available-on" style={{ fontSize: 10.5, marginBottom: 3 }}>Available On</label><input id="available-on" type="date" className="hh-input" value={form.availableOn ?? ''} onChange={(e) => set('availableOn', e.target.value || null)} /></div>
              <TriStateField label="Pets Allowed" value={form.petsAllowed} onChange={(v) => set('petsAllowed', v)} />
              <TriStateField label="Utilities Included" value={form.utilitiesIncluded} onChange={(v) => set('utilitiesIncluded', v)} />
              <TriStateField label="In-Unit Laundry" value={form.inUnitLaundry} onChange={(v) => set('inUnitLaundry', v)} />
            </div>
          </section>}</>}
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

function EditHomeEditor({ mode = 'edit', form, set, priorities, sharedFactAwareness, isCollaborative, vocabulary, photoFile, photoPreviewUrl, photoInputRef, handlePhotoFileChange, handleRemovePhoto, photoError, showPhotoUrlInput, setShowPhotoUrlInput, setCheckItem, saving, submit, saveErrorMsg, onClose, dialogRef, titleRef, importResult = null, presentation = 'modal', matchPerspectives = [] }) {
  const [allCriteriaOpen, setAllCriteriaOpen] = useState(false);
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
  // See foldLegacyCheckAliases: a fact recorded on this home under a pre-taxonomy-
  // unification legacy label (e.g. 'features:Home Office') stays visible here once the
  // search's own priority has folded onto the canonical label.
  const foldedChecks = foldLegacyCheckAliases(form.checks, priorities.searchType);
  const criteria = getItemlistCategories(priorities.searchType).flatMap((category) =>
    visibleOrderedItems(category, priorities)
      // Garage's base "any garage" fact is already collected by the Garage field
      // in Key details (garageSpaces) — showing a second, redundant manual
      // yes/no/unknown row here would be confusing since it plays no part in
      // Match. Its Attached/Detached qualifier facts (below) still need one.
      .filter((item) => item.kind === 'check' && !(category.key === 'exterior' && item.label === 'Garage'))
      .flatMap((item) => {
        const tier = priorities[category.key]?.tiers?.[item.label] || 'dontcare';
        const base = { ...item, categoryKey: category.key, tier };
        const qualifierRows = qualifierFactRows(category.key, item.label, priorities).map((row) => ({ ...row, tier }));
        return [base, ...qualifierRows];
      }),
  ).sort((a, b) => {
    const aKnown = foldedChecks[`${a.categoryKey}:${a.label}`] !== undefined;
    const bKnown = foldedChecks[`${b.categoryKey}:${b.label}`] !== undefined;
    return (aKnown - bKnown) || (TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  });
  const shownCriteria = allCriteriaOpen ? criteria : criteria.slice(0, 6);
  const currentPreviewSrc = photoFile ? photoPreviewUrl : (form.photoUrl || null);
  const priorityLabel = (item) => item.tier === 'must' ? 'Must Have' : item.tier === 'important' ? 'Important' : item.tier === 'nice' ? 'Nice to Have' : item.categoryKey === 'location' ? 'Location Preference' : 'Preference';

  return <div className={`hh-modal-backdrop hh-edit-home-backdrop ${presentation === 'detail-panel' ? 'hh-detail-editor-backdrop' : ''}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div ref={dialogRef} className={`hh-modal hh-corner hh-edit-home-modal ${presentation === 'detail-panel' ? 'hh-detail-editor-panel' : ''}`} role="dialog" aria-modal="true" aria-labelledby="edit-home-title">
      <header className="hh-edit-home-header">
        <div><h1 ref={titleRef} id="edit-home-title" className="hh-serif" tabIndex={-1}>{mode === 'add' ? 'Add a home' : 'Edit home'}</h1><p>{mode === 'add' ? (importResult ? 'Review what we found, fill in anything that matters, and save this contender.' : 'Review the property details before adding this home to your search.') : "Update this home's details. Changes to shared property information are visible to everyone in this search."}</p>{hasInspector && <button type="button" className="hh-listing-inspector-entry" aria-controls="flh-listing-details" onClick={showInspector}><Check size={14} /> {inspectorCount} listing detail{inspectorCount === 1 ? '' : 's'} found <span>View →</span></button>}</div>
        <button type="button" className="hh-btn hh-btn-ghost hh-edit-home-close" onClick={onClose} aria-label={mode === 'add' ? 'Close add home' : 'Close edit home'}><X size={18} aria-hidden="true" /></button>
      </header>

      <div className={`hh-workspace-shell ${inspectorOpen && hasInspector ? 'has-inspector' : ''}`}><div className="hh-edit-home-columns">
        <div className="hh-edit-home-column">
          <section className="hh-edit-home-card" aria-labelledby="property-address-heading">
            <h2 id="property-address-heading" className="hh-serif">Property address</h2>
            {apartment && <div><label className="hh-label">Property name</label><input className="hh-input" value={form.propertyName || ''} onChange={(e) => set('propertyName', e.target.value)} /></div>}
            <div><label className="hh-label">Address *</label><AddressAutocomplete value={form.address} onChange={(value) => set('address', value)} onSelect={(value) => set('address', value)} placeholder="123 Maple St, Ann Arbor, MI" /></div>
            <div><label className="hh-label">Original listing URL</label><input className="hh-input" type="url" value={form.listingUrl || ''} onChange={(e) => set('listingUrl', e.target.value)} placeholder="https://…" /></div>
          </section>

          <section className="hh-edit-home-card" aria-labelledby="home-photo-heading">
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

          <section className="hh-edit-home-card" aria-labelledby="key-details-heading">
            <h2 id="key-details-heading" className="hh-serif">Key details</h2>
            <div className="hh-edit-fields-grid">
              <CompactField label={showsRentalFacts ? 'Monthly rent' : 'Price'} value={form.price} isCurrency onChange={(value) => set('price', value)} placeholder="Unknown" />
              {!showsRentalFacts && <CompactField label="Est. monthly payment" value={form.estMonthly} isCurrency onChange={(value) => set('estMonthly', value)} placeholder="Unknown" />}
              <CompactField label="Beds" value={form.beds} onChange={(value) => set('beds', value)} placeholder="Unknown" />
              <CompactField label="Baths" value={form.baths} onChange={(value) => set('baths', value)} placeholder="Unknown" />
              <CompactField label="Square footage" value={form.sqft} onChange={(value) => set('sqft', value)} placeholder="Unknown" />
              <CompactField label="Lot size" value={form.lotSize} onChange={(value) => set('lotSize', value)} placeholder="Unknown" />
              <CompactField label="Year built" value={form.yearBuilt} onChange={(value) => set('yearBuilt', value)} placeholder="Unknown" />
              <CompactField label="Garage" value={form.garageSpaces} onChange={(value) => set('garageSpaces', value)} placeholder="Unknown" />
            </div>
          </section>
        </div>

        <div className="hh-edit-home-column">
          <section className="hh-edit-home-card" aria-labelledby="home-details-heading">
            <h2 id="home-details-heading" className="hh-serif">Home details</h2>
            <div className="hh-edit-fields-grid">
              <CompactField label="Basement" value={form.basementNotes} onChange={(value) => set('basementNotes', value)} placeholder="Unknown" />
              <CompactField label="School details" value={form.schoolsNotes} onChange={(value) => set('schoolsNotes', value)} placeholder="Unknown" />
              {MULTISELECT_CATEGORIES.filter((definition) => sharedFactAwareness[definition.key]?.eligibleForSharedFactCapture).map((definition) => <StructuredFactSelect key={definition.key} definition={definition} value={form[definition.key]} onChange={(value) => set(definition.key, value)} />)}
              {SINGLESELECT_CATEGORIES.filter((definition) => sharedFactAwareness[definition.key]?.eligibleForSharedFactCapture).map((definition) => <div key={definition.key}><label className="hh-label">{definition.title}</label><select className="hh-input" value={form[definition.key] || ''} onChange={(e) => set(definition.key, e.target.value)}><option value="">Unknown / not specified</option>{definition.options.filter((option) => option !== 'No Preference').map((option) => <option key={option}>{option}</option>)}</select></div>)}
            </div>
          </section>

          <section className="hh-edit-home-card" aria-labelledby="personalized-matches-heading">
            <div className="hh-edit-heading-row"><h2 id="personalized-matches-heading" className="hh-serif">Personalized Match</h2><span>Used in Match Score</span></div>
            <p className="hh-edit-context">Correct the known property facts that matter to your configured criteria. Unknown is never treated as No.</p>
            {shownCriteria.length ? <div className="hh-edit-criteria">{shownCriteria.map((item) => {
              const key = `${item.categoryKey}:${item.label}`;
              const value = foldedChecks[key];
              const displayLabel = item.qualifierDisplayLabel || criterionDisplayLabel(item.categoryKey, item.label);
              return <div className="hh-edit-criterion" key={key}><div><b>{displayLabel}</b><span>{priorityLabel(item)}</span></div><div className="hh-edit-tristate" role="group" aria-label={`${displayLabel} property fact`}>
                {[['yes', 'Yes', true], ['no', 'No', 'no'], ['unknown', 'Unknown', undefined]].map(([id, label, next]) => { const selected = next === undefined ? value === undefined : value === next; return <button type="button" key={id} className={`hh-chip is-${id} ${selected ? 'on' : ''}`} aria-pressed={selected} onClick={() => setCheckItem(item.categoryKey, item.label, next)}>{label}</button>; })}
              </div></div>;
            })}</div> : <p className="hh-edit-empty">No Match criteria are configured for this search.</p>}
            {criteria.length > 6 && <button type="button" className="hh-btn hh-btn-ghost hh-edit-disclosure" aria-expanded={allCriteriaOpen} onClick={() => setAllCriteriaOpen((value) => !value)}>{allCriteriaOpen ? 'Show prioritized criteria' : 'View all Match criteria'}</button>}
          </section>

          <section className="hh-edit-home-card" aria-labelledby="shared-notes-heading">
            <h2 id="shared-notes-heading" className="hh-serif">Shared notes</h2>
            <p className="hh-edit-context">{isCollaborative ? 'Pros, cons, and notes are visible to everyone in this search.' : 'Keep the details you want to remember about this home.'}</p>
            {/* Directly editable — no separate "Edit notes" click, since adding
                or editing this home is already an editing workflow. Pros/Cons/
                Notes are plain optional fields on the home row (see
                database-privacy-enforcement's SHARED_FIELDS), saved through the
                exact same submit() as everything else in this form. */}
            <div className="hh-edit-notes-fields">
              <div><label className="hh-label" htmlFor="edit-home-pros">Pros</label><textarea id="edit-home-pros" className="hh-textarea" value={form.pros || ''} onChange={(e) => set('pros', e.target.value)} placeholder="What do you like?" /></div>
              <div><label className="hh-label" htmlFor="edit-home-cons">Cons</label><textarea id="edit-home-cons" className="hh-textarea" value={form.cons || ''} onChange={(e) => set('cons', e.target.value)} placeholder="Anything giving you pause?" /></div>
              <div><label className="hh-label" htmlFor="edit-home-notes">Notes</label><textarea id="edit-home-notes" className="hh-textarea" value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="Anything else you want to remember?" /></div>
            </div>
          </section>
          {matchPerspectives.length > 0 && form.address.trim() && <section className="hh-edit-home-card hh-suggestion-match-preview" aria-label="Buyer Match preview"><h2 className="hh-serif">How this lines up</h2><p>Based only on currently known property facts. Unknown details are not counted as misses.</p>{matchPerspectives.map((perspective) => { const match = computeMatch(form, perspective.priorities); return <div key={perspective.userId}><b>{perspective.name}</b><span>{match?.pct == null ? 'Match needs more known facts' : `${match.pct}% Match`}</span><small>{match?.allSelected?.filter((item) => !item.evaluated).slice(0, 3).map((item) => `${item.label} — Unknown`).join(' · ')}</small></div>; })}</section>}
        </div>
      </div>

      {inspectorOpen && hasInspector && <div className="hh-workspace-inspector"><button type="button" className="hh-btn hh-btn-ghost hh-inspector-close" onClick={() => setInspectorOpen(false)} aria-label="Close listing details"><X size={16} /></button><WhatFlhFound panelRef={inspectorRef} result={inspectorResult} listingUrl={form.listingUrl} /></div>}</div>
      {saveErrorMsg && <div className="hh-edit-save-error" role="alert">{saveErrorMsg}</div>}
      <footer className="hh-edit-home-footer"><button type="button" className="hh-btn hh-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="hh-btn" onClick={submit} disabled={!form.address.trim() || saving}>{saving ? 'Saving…' : mode === 'add' ? 'Save home' : 'Save changes'}</button></footer>
    </div>
  </div>;
}

export default function HomeModal({ initial, priorities, sharedFactAwareness = {}, isCollaborative = false, onSave, onClose, userId, onWantToTour, onArchiveRequest, presentation = 'modal', autoFindOnMount = false, matchPerspectives = [], saveLabel = null }) {
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
        <div><h1 ref={titleRef} id="add-home-title" className="hh-serif" tabIndex={-1}>Add a home</h1><p>Introduce a new contender to analyze compatibility.</p></div>
        <button type="button" className="hh-btn hh-btn-ghost hh-edit-home-close" onClick={onClose} aria-label="Close add home"><X size={18} /></button>
      </header>
      <section className="hh-import-listing">
        <AddSectionHeading icon={Search} title="Import a listing">Paste a listing link or enter an address. We&apos;ll fill in what we can.</AddSectionHeading>
        <label className="hh-label">Listing link or address</label>
        <div className="hh-find-home-row">
          <input className="hh-input" value={findInput} onChange={(event) => setFindInput(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && handleFind()} placeholder="Listing link or address" />
          <button type="button" className="hh-btn" onClick={handleFind} disabled={!findInput.trim() || importPhase === 'loading'}>{importPhase === 'loading' ? 'Finding…' : 'Find this home'}</button>
        </div>
        {importPhase === 'identity' && apartmentIdentity && <div className="hh-manual-address"><p>We found {apartmentIdentity.propertyName}. Add its street address to continue.</p><AddressAutocomplete value={fallbackAddressInput} onChange={setFallbackAddressInput} onSelect={setFallbackAddressInput} /><button type="button" className="hh-btn" onClick={handleFallbackAddressLookup}>Use address</button></div>}
        {urlFallbackMsg && <p className="hh-edit-error">{urlFallbackMsg}</p>}
      </section>
      <details className="hh-details hh-manual-fallback">
        <summary><span className="hh-accordion-icon"><ClipboardPaste size={24} /></span><span>Can&apos;t find the home? Paste listing details instead<small>Enter the details manually when a link isn&apos;t available.</small></span><ChevronDown className="hh-accordion-chevron" size={20} /></summary>
        <textarea className="hh-textarea" value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="Paste listing details (optional)" />
        {parseMsg && <p className="hh-edit-context">{parseMsg}</p>}
        <div className="hh-modal-actions"><button type="button" className="hh-btn hh-btn-ghost" onClick={() => setImportPhase('empty')}>Enter manually</button><button type="button" className="hh-btn" onClick={runAutofill} disabled={!pasteText.trim()}>Fill in details</button></div>
      </details>
    </div>
  </div>;
}
