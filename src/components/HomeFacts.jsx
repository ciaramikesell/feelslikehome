'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, House, Link2, Pencil, Upload } from 'lucide-react';
import {
  BASEMENT_CONDITION_CHOICES, BASEMENT_STYLE_CHOICES, CONDITION_FACT_CHOICES, COOLING_SUGGESTIONS, GARAGE_SPACE_CHOICES,
  GARAGE_TYPE_CHOICES, HEATING_SUGGESTIONS, LAUNDRY_LOCATION_CHOICES, LAYOUT_FACT_CHOICES, PROPERTY_TYPE_CHOICES,
  basementPatch, editHoaFee, formatHoaFee, garagePatch, garageSpacesSelectValue, homeFactsAvailability, layoutPatch, layoutValues,
  listingSays, normalizeLotSizeInput, parseTaxYear, propertyTaxPatch,
} from '@/lib/homeFacts';
import { photoFileError, PHOTO_BUCKET, storagePathFromPublicUrl, uploadHomePhoto } from '@/lib/homePhoto';
import { digitsOnly, formatCurrencyDisplay, formatDateOnly, formatLotSizeDisplay, formatTriState, splitAddressLines } from '@/lib/homeDisplay';
import { homeIdentity } from '@/lib/homePresentation';
import { isUnitlessLotSize } from '@/lib/lotSize';
import { parseNum } from '@/lib/matching';
import { searchIntentCapabilities } from '@/lib/searchIntent';
import { createClient } from '@/lib/supabase/client';
import { MultiSelectField, PhoneCollapse, QuietInput, SelectField } from '@/components/FactFields';

// Home Facts — everything FLH knows about the property, directly editable.
// No Edit buttons and no Save: each change is handed to `editor.saveShared`,
// which applies it at once and autosaves only the changed shared fields
// (src/lib/useHomeAutosave.js). Imported values look like any other value;
// missing ones stay visible as Unknown with a warm highlight. Personal answers
// live in Match Criteria; impressions and notes live in Tour Feedback.
//
// Not shown here (still stored, never deleted): Listing ID, Exterior, Roof,
// days on market and every other listing-snapshot fact.

const SECONDARY_BEDROOM_CHOICES = [['Same Floor', 'Same floor'], ['Split Between Floors', 'Split between floors']];
const money = (value) => formatCurrencyDisplay(value);
const parseMoney = (text) => digitsOnly(text);
const parseMoneyNumber = (text) => { const digits = digitsOnly(text); return digits ? Number(digits) : null; };
const parseText = (text) => text.trim() || null;
const parseLegacyText = (text) => text.trim();
const plural = (value, one, many) => (Number(value) === 1 ? one : many);

function Row({ label, htmlFor, hint, children }) {
  return <div className="flh-hf-row">
    {htmlFor ? <label className="flh-hf-row-label" htmlFor={htmlFor}>{label}{hint && <small>{hint}</small>}</label> : <span className="flh-hf-row-label">{label}{hint && <small>{hint}</small>}</span>}
    <div className="flh-hf-row-control">{children}</div>
  </div>;
}

function Group({ id, title, children }) {
  return <section className="flh-hf-block" aria-labelledby={id}>
    <h3 id={id} className="flh-hf-block-title">{title}</h3>
    {children}
  </section>;
}

function PhotoControls({ home, readOnly, editor, userId, alt }) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [broken, setBroken] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => setBroken(false), [home.photoUrl]);
  const choose = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = photoFileError(file);
    if (problem) { setError(problem); return; }
    setError('');
    setUploading(true);
    const previous = home.photoUrl;
    try {
      const photoUrl = await uploadHomePhoto(createClient(), userId, file);
      editor.saveShared({ photoUrl });
      // Our own replaced upload is removed only once the new URL is saved.
      const oldPath = previous ? storagePathFromPublicUrl(previous) : null;
      if (oldPath) editor.settle().then((ok) => { if (ok) createClient().storage.from(PHOTO_BUCKET).remove([oldPath]).catch(() => {}); });
    } catch {
      setError('We couldn’t upload that photo. Try again, or use a photo URL.');
    } finally {
      setUploading(false);
    }
  };
  const photo = home.photoUrl && !broken
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={home.photoUrl} alt={alt} onError={() => setBroken(true)} />
    : <span className="flh-hf2-photo-empty"><House size={34} aria-hidden="true" /><small>{home.photoUrl ? 'Photo couldn’t load' : 'No photo yet'}</small></span>;
  return <div className="flh-hf2-photo-wrap">
    <div className="flh-hf2-photo">{photo}</div>
    {!readOnly && <PhoneCollapse id={`hf-photo-options-${home.id}`} title="Photo options" className="is-photo">
      <div className="flh-hf2-photo-actions">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} hidden />
        <button type="button" className="flh-hf2-photo-action is-primary" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={13} aria-hidden="true" /> {uploading ? 'Uploading…' : home.photoUrl ? 'Change photo' : 'Upload photo'}</button>
        <button type="button" className="flh-hf2-photo-action" aria-expanded={urlOpen} onClick={() => setUrlOpen((open) => !open)}><Link2 size={13} aria-hidden="true" /> Photo URL</button>
        {home.photoUrl && <button type="button" className="flh-hf2-photo-action" onClick={() => editor.saveShared({ photoUrl: '' })}>Remove</button>}
      </div>
      {urlOpen && <div className="flh-hf2-photo-url">
        <QuietInput id="hf-photo-url" label="Photo URL" labelHidden={false} value={home.photoUrl} placeholder="https://…" inputMode="url" registerDraft={editor.registerDraft} failed={editor.failed.includes('photoUrl')}
          parse={(text) => { const url = text.trim(); if (!url) return ''; try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.toString() : undefined; } catch { return undefined; } }}
          onCommit={(photoUrl) => editor.saveShared({ photoUrl })} />
        <small>Use an image link you have the right to use. FLH never copies listing-site photos.</small>
      </div>}
      {error && <p className="hh-save-error" role="alert">{error}</p>}
    </PhoneCollapse>}
  </div>;
}

function ListingLink({ home, readOnly, editor }) {
  const [editing, setEditing] = useState(false);
  const field = <QuietInput id="hf-listing-url" label="Original listing link" value={home.listingUrl} placeholder="Add listing link" inputMode="url" registerDraft={editor?.registerDraft} failed={editor?.failed.includes('listingUrl')}
    parse={(text) => { const url = text.trim(); if (!url) return ''; try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.toString() : undefined; } catch { return undefined; } }}
    onCommit={(listingUrl) => { editor.saveShared({ listingUrl }); setEditing(false); }} className="is-link" />;
  if (readOnly) return home.listingUrl ? <a className="flh-hf-listing" href={home.listingUrl} target="_blank" rel="noreferrer">View listing <ArrowUpRight size={13} aria-hidden="true" /></a> : null;
  if (!home.listingUrl || editing) return <div className="flh-hf-listing-edit">{field}</div>;
  return <div className="flh-hf-listing-row">
    <a className="flh-hf-listing" href={home.listingUrl} target="_blank" rel="noreferrer">View listing <ArrowUpRight size={13} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
    <button type="button" className="flh-hf-link-edit" onClick={() => setEditing(true)} aria-label="Change listing link"><Pencil size={12} aria-hidden="true" /></button>
  </div>;
}

export default function HomeFacts({ home, priorities, vocabulary, readOnly = false, editor = null, userId = null, onEditAll = null, showHeading = true }) {
  const isReadOnly = readOnly || !editor;
  const apartment = vocabulary.apartment;
  const available = homeFactsAvailability(priorities, { apartment });
  const { showsRentalFacts } = searchIntentCapabilities(priorities.searchType);
  const identity = homeIdentity(home, priorities);
  const failed = (field) => editor?.failed.includes(field) || false;
  const save = (patch) => editor.saveShared(patch);
  const text = (field, label, { parse = parseText, ...rest } = {}) => <QuietInput id={`hf-${field}`} label={label} value={home[field]} readOnly={isReadOnly} failed={failed(field)} registerDraft={editor?.registerDraft} parse={parse} onCommit={(value) => save({ [field]: value })} className="is-boxed" {...rest} />;
  const select = (field, label, choices, onCommit = (value) => save({ [field]: value })) => <SelectField id={`hf-${field}`} label={label} value={home[field]} choices={choices} readOnly={isReadOnly} failed={failed(field)} onCommit={onCommit} />;
  const { line2 } = splitAddressLines(home.address);
  const priceLabel = showsRentalFacts ? 'Monthly rent' : 'Asking price';
  const laundryKnownToDatabase = home.laundryLocation !== undefined;
  const utilitiesSummary = [home.yearBuilt, !showsRentalFacts && home.propertyTaxAnnual ? `${money(home.propertyTaxAnnual)}/yr` : null, home.heating || home.cooling ? 'Heating & cooling' : null].filter(Boolean).join(' · ');
  const schoolCount = ['schoolDistrict', 'elementarySchool', 'middleSchool', 'highSchool'].filter((field) => home[field]).length;

  return (
    <div className="flh-hf2">
      {/* Property header: photo, price, address, size, listing link — then the
          compact secondary facts. Everything edits in place. */}
      <section className="flh-hf2-header" aria-label="Property">
        <PhotoControls home={home} readOnly={isReadOnly} editor={editor} userId={userId} alt={`${identity.accessible} ${vocabulary.singularLower} photo`} />
        <div className="flh-hf2-identity">
          <QuietInput id="hf-price" label={priceLabel} value={home.price} readOnly={isReadOnly} failed={failed('price')} registerDraft={editor?.registerDraft}
            format={(value) => (value ? `${money(value)}${showsRentalFacts ? '/mo' : ''}` : '')} edit={(value) => money(value)} parse={parseMoney} placeholder="Add price" inputMode="numeric"
            onCommit={(price) => save({ price })} className="flh-hf2-price" />
          {apartment && identity.primary !== home.address && <p className="flh-hf2-name">{identity.primary}</p>}
          {/* Floor plan · unit, edited with the property name under "More property details". */}
          {apartment && identity.option && <p className="flh-hf2-locality">{identity.option}</p>}
          <QuietInput id="hf-address" label="Address" value={home.address} readOnly={isReadOnly} failed={failed('address')} registerDraft={editor?.registerDraft}
            format={(value) => splitAddressLines(value).line1 || value} edit={(value) => value} parse={(value) => value.trim() || undefined} placeholder="Add address" multiline
            onCommit={(address) => save({ address })} className="flh-hf2-address" />
          {line2 && <p className="flh-hf2-locality">{line2}</p>}
          {!apartment && <p className="flh-hf2-specs">
            <QuietInput id="hf-beds" label="Beds" value={home.beds} readOnly={isReadOnly} failed={failed('beds')} registerDraft={editor?.registerDraft} parse={parseLegacyText} inputMode="decimal" size={3} placeholder="—" suffix={` ${plural(home.beds, 'bed', 'beds')}`} onCommit={(beds) => save({ beds })} />
            <span aria-hidden="true"> · </span>
            <QuietInput id="hf-baths" label="Baths" value={home.baths} readOnly={isReadOnly} failed={failed('baths')} registerDraft={editor?.registerDraft} parse={parseLegacyText} inputMode="decimal" size={3} placeholder="—" suffix={` ${plural(home.baths, 'bath', 'baths')}`} onCommit={(baths) => save({ baths })} />
            <span aria-hidden="true"> · </span>
            <QuietInput id="hf-sqft" label="Square footage" value={home.sqft} readOnly={isReadOnly} failed={failed('sqft')} registerDraft={editor?.registerDraft} format={(value) => (value ? parseNum(value)?.toLocaleString() ?? value : '')} parse={(value) => value.replace(/,/g, '').trim()} inputMode="numeric" size={5} placeholder="—" suffix=" sqft" onCommit={(sqft) => save({ sqft })} />
            <span aria-hidden="true"> · </span>
            {/* Acres; sq ft, sq m and hectares are converted (normalizeLotSizeInput). A saved
                number with no unit opens as the bare number; saving it confirms acres. */}
            <QuietInput id="hf-lotSize" label="Lot size in acres" value={home.lotSize} readOnly={isReadOnly} failed={failed('lotSize')} registerDraft={editor?.registerDraft} format={formatLotSizeDisplay} edit={(value) => (isUnitlessLotSize(value) ? String(value).trim() : formatLotSizeDisplay(value))} parse={normalizeLotSizeInput} size={9} placeholder="— acres" onCommit={(lotSize) => save({ lotSize })} />
          </p>}
          <ListingLink home={home} readOnly={isReadOnly} editor={editor} />
          {home.suggestedBy && <span className="hh-provenance">Suggested by {home.suggestedBy}</span>}
        </div>

        <PhoneCollapse id={`hf-utilities-${home.id}`} title="Year, taxes & utilities" summary={utilitiesSummary || 'Unknown'} className="flh-hf2-secondary">
          <div className="flh-hf2-secondary-grid">
            {!showsRentalFacts && <>
              <div className="flh-hf2-mini"><label htmlFor="hf-propertyTaxAnnual">Annual taxes</label>{text('propertyTaxAnnual', null, { parse: parseMoneyNumber, format: (value) => (value ? `${money(value)}/yr` : ''), edit: (value) => money(value), inputMode: 'numeric', onCommit: (value) => save(propertyTaxPatch(home, value)) })}</div>
              <div className="flh-hf2-mini"><label htmlFor="hf-propertyTaxYear">Tax year</label>{text('propertyTaxYear', null, { parse: parseTaxYear, inputMode: 'numeric', size: 4 })}</div>
            </>}
            <div className="flh-hf2-mini"><label htmlFor="hf-yearBuilt">Year built</label>{text('yearBuilt', null, { parse: parseLegacyText, inputMode: 'numeric', placeholder: 'Unknown' })}</div>
            {!apartment && <>
              <div className="flh-hf2-mini is-wide"><label htmlFor="hf-heating">Heating</label>{text('heating', null, { list: 'hf-heating-options' })}{!home.heating && listingSays(home, 'heating') && <small className="flh-hf2-hint">{listingSays(home, 'heating')}</small>}</div>
              <div className="flh-hf2-mini is-wide"><label htmlFor="hf-cooling">Cooling</label>{text('cooling', null, { list: 'hf-cooling-options' })}{!home.cooling && listingSays(home, 'cooling') && <small className="flh-hf2-hint">{listingSays(home, 'cooling')}</small>}</div>
              {laundryKnownToDatabase && <div className="flh-hf2-mini is-wide"><label htmlFor="hf-laundryLocation">Laundry location</label>{select('laundryLocation', null, LAUNDRY_LOCATION_CHOICES)}</div>}
              <datalist id="hf-heating-options">{HEATING_SUGGESTIONS.map((value) => <option key={value} value={value} />)}</datalist>
              <datalist id="hf-cooling-options">{COOLING_SUGGESTIONS.map((value) => <option key={value} value={value} />)}</datalist>
            </>}
          </div>
        </PhoneCollapse>
      </section>

      <section className="flh-hf2-facts" aria-labelledby="hf-title">
        <header className={`flh-hf2-section-head ${showHeading ? '' : 'sr-only'}`}>
          <h2 id="hf-title" className="flh-overlay-heading">Home Facts</h2>
          <span>{isReadOnly ? 'From the listing and the buyers' : 'All optional'}</span>
        </header>
        <div className="flh-hf2-columns">
          <div className="flh-hf2-column">
            <Group id="hf-basic-title" title="Basic Details">
              {!showsRentalFacts && <Row label="Estimated monthly payment" hint="your estimate" htmlFor="hf-estMonthly">{text('estMonthly', null, { parse: parseMoney, format: (value) => (value ? `${money(value)}/mo` : ''), edit: (value) => money(value), inputMode: 'numeric', placeholder: 'Add your estimate' })}</Row>}
              {available.propertyType && <Row label="Property type" htmlFor="hf-propertyType">{select('propertyType', null, PROPERTY_TYPE_CHOICES)}</Row>}
              {available.layout && <Row label="Home layout" htmlFor="hf-layout"><MultiSelectField id="hf-layout" label="Home layout" values={layoutValues(home)} choices={LAYOUT_FACT_CHOICES} readOnly={isReadOnly} failed={failed('homeLayout') || failed('primaryBedroomLocation')} onCommit={(next) => { const patch = layoutPatch(home, next); if (Object.keys(patch).length) save(patch); }} /></Row>}
              {available.condition && <Row label="Home condition" htmlFor="hf-homeCondition"><MultiSelectField id="hf-homeCondition" label="Home condition" values={home.homeCondition} choices={CONDITION_FACT_CHOICES} readOnly={isReadOnly} failed={failed('homeCondition')} onCommit={(homeCondition) => save({ homeCondition })} /></Row>}
              {/* An existing Match input with no other home here: shown when it's
                  part of this search or already has a value. */}
              {!apartment && (home.secondaryBedroomLocation || (priorities.secondaryBedroomLocation?.value && priorities.secondaryBedroomLocation.tier !== 'dontcare')) && <Row label="Secondary bedrooms" htmlFor="hf-secondaryBedroomLocation">{select('secondaryBedroomLocation', null, SECONDARY_BEDROOM_CHOICES, (value) => save({ secondaryBedroomLocation: value || '' }))}</Row>}
              {/* Always offered for a home to buy: blank is Unknown, 0 is a confirmed "no HOA". */}
              {!showsRentalFacts && <Row label="HOA fee" hint={isReadOnly ? null : 'Enter 0 if there’s no HOA'} htmlFor="hf-hoaFeeMonthly">{text('hoaFeeMonthly', null, { parse: parseMoneyNumber, format: formatHoaFee, edit: editHoaFee, inputMode: 'numeric' })}</Row>}
              {showsRentalFacts && home.availableOn && <Row label="Available on"><span className="flh-fact-text">{formatDateOnly(home.availableOn)}</span></Row>}
              {showsRentalFacts && [['petsAllowed', 'Pets allowed'], ['utilitiesIncluded', 'Utilities included'], ['inUnitLaundry', 'In-unit laundry']].map(([field, label]) => (
                home[field] == null ? null : <Row key={field} label={label}><span className="flh-fact-text">{formatTriState(home[field])}</span></Row>
              ))}
              {!isReadOnly && onEditAll && <button type="button" className="flh-hf2-more" onClick={onEditAll}>More {vocabulary.singularLower} details</button>}
            </Group>

            {available.schools && <PhoneCollapse id={`hf-schools-${home.id}`} title="School details" summary={`${schoolCount} of 4 fields${home.schoolDistrict ? ` · ${home.schoolDistrict}` : ''}`} className="flh-hf2-schools">
              <Group id="hf-schools-title" title="School Details">
                <Row label="District" htmlFor="hf-schoolDistrict">{text('schoolDistrict')}</Row>
                <Row label="Elementary" htmlFor="hf-elementarySchool">{text('elementarySchool')}</Row>
                <Row label="Middle" htmlFor="hf-middleSchool">{text('middleSchool')}</Row>
                <Row label="High" htmlFor="hf-highSchool">{text('highSchool')}</Row>
                {home.schoolsNotes && <Row label="School notes" htmlFor="hf-schoolsNotes">{text('schoolsNotes', null, { parse: parseLegacyText })}</Row>}
              </Group>
            </PhoneCollapse>}
          </div>

          {(available.garage || available.basement) && <div className="flh-hf2-column">
            {available.garage && <Group id="hf-garage-title" title="Garage">
              <Row label="Type" htmlFor="hf-garageType">{select('garageType', null, GARAGE_TYPE_CHOICES, (value) => save(garagePatch(home, 'garageType', value)))}</Row>
              <Row label="Spaces" htmlFor="hf-garageSpaces"><SelectField id="hf-garageSpaces" value={garageSpacesSelectValue(home.garageSpaces)} choices={GARAGE_SPACE_CHOICES} readOnly={isReadOnly} failed={failed('garageSpaces')} onCommit={(value) => save(garagePatch(home, 'garageSpaces', value))} /></Row>
            </Group>}
            {available.basement && <Group id="hf-basement-title" title="Basement">
              <Row label="Style" htmlFor="hf-basementStyle">{select('basementStyle', null, BASEMENT_STYLE_CHOICES, (value) => save(basementPatch(home, 'basementStyle', value)))}</Row>
              <Row label="Condition" htmlFor="hf-basementCondition">{select('basementCondition', null, BASEMENT_CONDITION_CHOICES, (value) => save(basementPatch(home, 'basementCondition', value)))}</Row>
              {home.basementNotes && !home.basementStyle && !home.basementCondition && <p className="flh-hf2-note">Earlier note: “{home.basementNotes}”</p>}
            </Group>}
          </div>}
        </div>
      </section>
    </div>
  );
}
