'use client';

import HomePhoto from '@/components/HomePhoto';
import PhotoPositioner from '@/components/PhotoPositioner';
import { parsePhotoUrl, validatePhotoUrl } from '@/lib/photoFraming';

import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, House, Link2, Pencil, Upload } from 'lucide-react';
import {
  BASEMENT_SUGGESTIONS, GARAGE_SPACE_CHOICES,
  GARAGE_TYPE_CHOICES, LAUNDRY_LOCATION_CHOICES,
  basementDescriptionPatch, basementFieldValue, basementMatchReading, describeBasement, editHoaFee, formatHoaFee, garagePatch, garageSpacesSelectValue,
  hoaConflict, homeFactsAvailability,
  normalizeLotSizeInput,
} from '@/lib/homeFacts';
import { photoFileError, PHOTO_BUCKET, storagePathFromPublicUrl, uploadHomePhoto } from '@/lib/homePhoto';
import { digitsOnly, formatCurrencyDisplay, formatDateOnly, formatLotSizeDisplay, formatTriState, noteEntries, splitAddressLines } from '@/lib/homeDisplay';
import { homeIdentity } from '@/lib/homePresentation';
import { isUnitlessLotSize } from '@/lib/lotSize';
import { parseNum } from '@/lib/matching';
import { searchIntentCapabilities } from '@/lib/searchIntent';
import { pendingOfferedFacts } from '@/lib/listingTextHomeFacts';
import { countyRecordContext, formatShortDate, listingContextSummary, listingSnapshotContext, listingSnapshotLines, listingTypeYearNote } from '@/lib/listingContext';
import Sheet from '@/components/Sheet';
import { OfferedFactsSheet } from '@/components/FactChecklist';
import { createClient } from '@/lib/supabase/client';
import { QuietInput, SelectField } from '@/components/FactFields';
import { NOTE_LIST_FIELDS, noteListHint } from '@/components/NoteListFields';

// Home Facts — everything FLH knows about the property, directly editable.
// No Edit buttons and no Save: each change is handed to `editor.saveShared`,
// which applies it at once and autosaves only the changed shared fields
// (src/lib/useHomeAutosave.js). Imported values look like any other value;
// missing ones stay neutral; only unanswered priorities get a subtle cue. Personal answers
// live in Match Criteria. Pros / Cons are editable here (below Basement and
// Laundry) as well as in Tour Feedback: the same shared fields.
//
// PR #187: Basement is one description ("Finished Walkout") over the two
// facts Match reads; Laundry sits after Basement; School Details is one
// freeform field beside the district; the generic Notes box is gone — Notes
// already written (typed, after a tour, or added from a pasted listing) stay
// shown and editable until they're cleared, and are never deleted here.
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

// Context from the RentCast lookup made when the home was added (phase 3,
// listingContext.js): the listing as it was then, dated, and what the county
// record says about features with no Home Facts field. Read-only; never a
// value, never a Match answer.
//
// Phase 6: one dated summary line near the top, with Details opening the full
// context in a sheet (Home Facts has no inline fold-outs), so the listing's
// history no longer crowds the price, address and size.
function ListingContext({ context, features, yearBuilt }) {
  const [open, setOpen] = useState(false);
  const lines = listingSnapshotLines(context);
  if (!lines.length && !features.length) return null;
  const asOf = formatShortDate(context?.asOf);
  return <>
    <p className="flh-hf2-context-row">
      {/* Each segment stays whole ("listed as New Construction" never splits mid-phrase). */}
      <span>{listingContextSummary(context, features.length > 0).split(' · ').map((part, i) => <Fragment key={part}>{i ? ' · ' : ''}<span className="flh-hf2-context-part">{part}</span></Fragment>)}</span>
      <button type="button" className="flh-offered-review" onClick={() => setOpen(true)} aria-haspopup="dialog">Details<span className="sr-only"> about the listing and county records</span></button>
    </p>
    <Sheet open={open} onClose={() => setOpen(false)} title="Found when this home was added" size="compact" className="flh-context-sheet">
      <p className="flh-offered-intro">From the listing and the county property record FLH looked up when this home was added{asOf ? ` on ${asOf}` : ''}. It isn’t refreshed after that and can be out of date. None of it changes Home Facts or your Match.</p>
      <div className="flh-hf2-context" aria-label="Found when this home was added">
        {lines.map((line) => <p key={line}>{line}</p>)}
        {features.length > 0 && <p>County records: {features.join(' · ')}</p>}
      </div>
      {listingTypeYearNote(context, yearBuilt) && <p className="flh-offered-intro">{listingTypeYearNote(context, yearBuilt)}</p>}
    </Sheet>
  </>;
}

function Row({ label, htmlFor, hint, children }) {
  return <div className="flh-hf-row">
    {htmlFor ? <label className="flh-hf-row-label" htmlFor={htmlFor}>{label}{hint && <small>{hint}</small>}</label> : <span className="flh-hf-row-label">{label}{hint && <small>{hint}</small>}</span>}
    <div className="flh-hf-row-control">{children}</div>
  </div>;
}

function Group({ id, title, children }) {
  return <section className="flh-hf-block flh-facts-group" aria-labelledby={id}>
    <h3 id={id} className="flh-hf-block-title">{title}</h3>
    <div className="flh-facts-group-body">{children}</div>
  </section>;
}

// Two separate facts side by side under one heading (Garage: Type · Spaces;
// Basement: Style · Condition). Each keeps its own label, control and save.
// The pair stacks into label-beside-control rows when the column is narrow.
function Pair({ children }) {
  return <div className="flh-hf-pair">{children}</div>;
}
function PairField({ label, htmlFor, children }) {
  return <div className="flh-hf-pair-field">
    <label className="flh-hf-row-label" htmlFor={htmlFor}>{label}</label>
    <div className="flh-hf-row-control">{children}</div>
  </div>;
}

const NOTE_DEBOUNCE_MS = 900;

// One shared note field (notes / pros / cons), saved as typed: after a typing
// pause, on leaving the field, or on Close (registerDraft). One entry per line.
function NoteTextField({ id, label, marker, placeholder, value, readOnly, failed, registerDraft, onCommit }) {
  const [draft, setDraft] = useState(null);
  const timer = useRef(null);
  const latest = useRef({ draft: null, value, onCommit });
  latest.current = { draft, value, onCommit };
  const commit = () => {
    clearTimeout(timer.current);
    const { draft: text, value: stored, onCommit: save } = latest.current;
    registerDraft?.(id, null);
    if (text !== null && text !== (stored ?? '')) save(text);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => { clearTimeout(timer.current); commitRef.current(); }, []);
  const shown = draft ?? (value ?? '');
  const hintId = `${id}-hint`;
  if (readOnly) {
    const entries = noteEntries(value);
    return <div className={`flh-hf-note is-read is-${id.replace('hf-', '')}`}>
      <span className="flh-hf-row-label">{marker}{label}</span>
      {entries.length ? <ul>{entries.map((entry, i) => <li key={`${i}-${entry}`}>{entry}</li>)}</ul> : <span className="flh-fact-text is-unknown">None yet</span>}
    </div>;
  }
  return <div className={`flh-hf-note is-${id.replace('hf-', '')}`}>
    <label className="flh-hf-note-label" htmlFor={id}>{marker}{label}<span id={hintId}>{noteListHint(shown)}</span></label>
    <textarea
      id={id} className={`flh-hf-note-input ${failed ? 'is-failed' : ''}`} value={shown} placeholder={placeholder}
      rows={Math.min(3, Math.max(2, shown.split('\n').length))} aria-describedby={hintId} aria-invalid={failed || undefined}
      onChange={(event) => {
        setDraft(event.target.value);
        latest.current.draft = event.target.value;
        registerDraft?.(id, () => commitRef.current());
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commitRef.current(), NOTE_DEBOUNCE_MS);
      }}
      onBlur={() => { commitRef.current(); setDraft(null); }}
    />
  </div>;
}

function PhotoControls({ home, readOnly, editor, userId, alt }) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [framing, setFraming] = useState(null);
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
    ? <HomePhoto src={home.photoUrl} alt={alt} onError={() => setBroken(true)} />
    : <span className="flh-hf2-photo-empty"><House size={34} aria-hidden="true" /><small>{home.photoUrl ? 'Photo couldn’t load' : 'No photo yet'}</small></span>;
  return <div className="flh-hf2-photo-wrap">
    <div className="flh-hf2-photo">{photo}</div>
    {!readOnly && <div className="flh-hf-photo-controls" role="group" aria-label="Photo options">
      <div className="flh-hf2-photo-actions">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} aria-label="Upload property photo" hidden />
        <button type="button" className="flh-hf2-photo-action is-primary" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={13} aria-hidden="true" /> {uploading ? 'Uploading…' : home.photoUrl ? 'Change photo' : 'Upload photo'}</button>
        <button type="button" className="flh-hf2-photo-action" aria-expanded={urlOpen} onClick={() => setUrlOpen((open) => !open)}><Link2 size={13} aria-hidden="true" /> Photo URL</button>
        {parsePhotoUrl(home.photoUrl).editable && editor.savePhotoFrame && <button type="button" className="flh-hf2-photo-action" disabled={uploading || broken} onClick={() => setFraming(home.photoUrl)}>Position photo</button>}
        {home.photoUrl && <button type="button" className="flh-hf2-photo-action" onClick={() => editor.saveShared({ photoUrl: '' })}>Remove photo</button>}
      </div>
      {urlOpen && <div className="flh-hf2-photo-url">
        <QuietInput id="hf-photo-url" label="Photo URL" labelHidden={false} value={parsePhotoUrl(home.photoUrl).source} placeholder="https://…" inputMode="url" registerDraft={editor.registerDraft} failed={editor.failed.includes('photoUrl')}
          parse={validatePhotoUrl}
          onCommit={(photoUrl) => editor.saveShared({ photoUrl })} />
        <small>Use an image link you have the right to use. FLH never copies listing-site photos.</small>
      </div>}
      {error && <p className="hh-save-error" role="alert">{error}</p>}
    </div>}
    {framing && <PhotoPositioner src={framing} onSave={editor.savePhotoFrame} onClose={() => setFraming(null)} />}
  </div>;
}

function ListingLink({ home, readOnly, editor }) {
  const [editing, setEditing] = useState(false);
  const field = <QuietInput id="hf-listing-url" label="Original listing link" value={home.listingUrl} placeholder="Add listing link" inputMode="url" registerDraft={editor?.registerDraft} failed={editor?.failed.includes('listingUrl')}
    parse={(text) => { const url = text.trim(); if (!url) return ''; try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.toString() : undefined; } catch { return undefined; } }}
    onCommit={(listingUrl) => { editor.saveShared({ listingUrl }); setEditing(false); }} className="is-link" />;
  if (readOnly) return home.listingUrl ? <a className="flh-hf-listing" href={home.listingUrl} target="_blank" rel="noreferrer">View listing <ArrowUpRight size={13} aria-hidden="true" /></a> : null;
  if (editing) return <div className="flh-hf-listing-edit">{field}</div>;
  if (!home.listingUrl) return <button type="button" className="flh-hf-add-link" onClick={() => setEditing(true)}>Add listing link</button>;
  return <div className="flh-hf-listing-row">
    <a className="flh-hf-listing" href={home.listingUrl} target="_blank" rel="noreferrer">View listing <ArrowUpRight size={13} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
    <button type="button" className="flh-hf-link-edit" onClick={() => setEditing(true)} aria-label="Change listing link"><Pencil size={12} aria-hidden="true" /></button>
  </div>;
}

// Facts the pasted listing offered when this home was added that nobody added
// yet (homes.listing_import.offeredFacts): one quiet row, not an inline
// fold-out (Home Facts has none). Review opens the shared checklist in a sheet
// (OfferedFactsSheet). The row is gone once every offered field is filled.
function OfferedFactsEntry({ home, onAdd }) {
  const count = pendingOfferedFacts(home).length;
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return <>
    <p className="flh-offered-row">
      <span>From the listing · {count} detail{count === 1 ? '' : 's'} not added yet</span>
      <button type="button" className="flh-offered-review" onClick={() => setOpen(true)} aria-haspopup="dialog">Review</button>
    </p>
    <OfferedFactsSheet home={home} open={open} onClose={() => setOpen(false)} onAdd={onAdd} />
  </>;
}

export default function HomeFacts({ home, priorities, vocabulary, readOnly = false, editor = null, userId = null, onEditAll = null, showHeading = true, isCollaborative = false, matchShortcut = null, matchOverview = null, priorityFields = [] }) {
  const isReadOnly = readOnly || !editor;
  const apartment = vocabulary.apartment;
  const available = homeFactsAvailability(priorities, { apartment });
  const { showsRentalFacts } = searchIntentCapabilities(priorities.searchType);
  const identity = homeIdentity(home, priorities);
  const priorityIds = new Set(priorityFields);
  const failed = (field) => editor?.failed.includes(field) || false;
  const save = (patch) => editor.saveShared(patch);
  const record = countyRecordContext(home.listingImport);
  const text = (field, label, { parse = parseText, ...rest } = {}) => <QuietInput id={`hf-${field}`} label={label} value={home[field]} readOnly={isReadOnly} failed={failed(field)} registerDraft={editor?.registerDraft} parse={parse} onCommit={(value) => save({ [field]: value })} className={`is-boxed${priorityIds.has(`hf-${field}`) ? ' is-priority-unknown' : ''}`} {...rest} />;
  const select = (field, label, choices, onCommit = (value) => save({ [field]: value })) => <SelectField id={`hf-${field}`} label={label} value={home[field]} choices={choices} readOnly={isReadOnly} failed={failed(field)} priority={priorityIds.has(`hf-${field}`)} onCommit={onCommit} />;
  const { line2 } = splitAddressLines(home.address);
  const priceLabel = showsRentalFacts ? 'Monthly rent' : 'Asking price';
  const laundryKnownToDatabase = home.laundryLocation !== undefined;
  const basement = basementFieldValue(home);
  // Phase 6: the dated listing summary (Details opens the sheet) and a quiet way
  // down to Your Match (HomeOverlay). Rendered in the identity column on wider
  // screens and full width on phones (CSS shows one of the two).
  const aside = <>
    <ListingContext context={listingSnapshotContext(home.listingImport)} yearBuilt={home.yearBuilt} features={[
      record.fireplace && `fireplace${record.fireplace.type ? ` (${record.fireplace.type})` : ''}`,
      record.pool && `pool${record.pool.type ? ` (${record.pool.type})` : ''}`,
      record.view && `${record.view} view`,
    ].filter(Boolean)} />
    {!isReadOnly && matchShortcut}
  </>;
  // The generic Notes box is shown only while it holds something (PR #187): it
  // is where post-tour notes and "add to notes" listing details were written,
  // so existing text is never hidden; an empty one isn't offered.
  // Once shown it stays for this visit, so clearing it never unmounts the field mid-edit.
  const notesShown = useRef(false);
  if (String(home.notes ?? '').trim()) notesShown.current = true;
  const noteFields = NOTE_LIST_FIELDS.filter(({ key }) => key !== 'notes' || notesShown.current);
  // Read-only viewers (a Realtor) see the section only when something is written.
  const showNotes = !isReadOnly || noteFields.some(({ key }) => noteEntries(home[key]).length > 0);

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
          {record.subdivision && <p className="flh-hf2-locality flh-hf2-record">Subdivision: {record.subdivision} · county records</p>}
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
          {(home.yearBuilt || (!showsRentalFacts && home.propertyTaxAnnual != null)) && <p className="flh-hf2-history">
            {home.yearBuilt ? `Built ${home.yearBuilt}` : ''}
            {home.yearBuilt && !showsRentalFacts && home.propertyTaxAnnual != null ? ' · ' : ''}
            {!showsRentalFacts && home.propertyTaxAnnual != null ? `Taxes ${money(home.propertyTaxAnnual)}/yr${home.propertyTaxYear ? ` (${home.propertyTaxYear})` : ''}` : ''}
          </p>}
          {matchOverview}
          <ListingLink home={home} readOnly={isReadOnly} editor={editor} />

          {home.suggestedBy && <span className="hh-provenance">Suggested by {home.suggestedBy}</span>}
        </div>
        {/* Dated listing context stays available once, below the property summary. */}
        <div className="flh-hf2-aside is-phone">{aside}</div>


      </section>


      <section className="flh-hf2-facts" aria-labelledby="hf-title">
        <header className={`flh-hf2-section-head ${showHeading ? '' : 'sr-only'}`}>
          <h2 id="hf-title" className="flh-overlay-heading">Home Facts</h2>
          <span>{isReadOnly ? 'From the listing and the buyers' : 'Add or update key details to keep your Match accurate.'}</span>
        </header>
        {/* Phase 6: what the warm Unknown fields mean, said once. */}
        {!isReadOnly && <p className="flh-hf2-legend">Unknown isn’t No. Terracotta outlines mark unanswered priorities. All details are optional.</p>}
        {!isReadOnly && <OfferedFactsEntry home={home} onAdd={save} />}
        <div className="flh-hf2-columns">
          <div className="flh-hf2-column">
            <Group id="hf-basic-title" title="Basic Details">
              {!showsRentalFacts && <Row label="Estimated monthly payment" hint="your estimate" htmlFor="hf-estMonthly">{text('estMonthly', null, { parse: parseMoney, format: (value) => (value ? `${money(value)}/mo` : ''), edit: (value) => money(value), inputMode: 'numeric', placeholder: 'Add your estimate' })}</Row>}
              {/* An existing Match input with no other home here: shown when it's
                  part of this search or already has a value. */}
              {!apartment && (home.secondaryBedroomLocation || (priorities.secondaryBedroomLocation?.value && priorities.secondaryBedroomLocation.tier !== 'dontcare')) && <Row label="Secondary bedrooms" htmlFor="hf-secondaryBedroomLocation">{select('secondaryBedroomLocation', null, SECONDARY_BEDROOM_CHOICES, (value) => save({ secondaryBedroomLocation: value || '' }))}</Row>}
              {/* Always offered for a home to buy: blank is Unknown, 0 is a confirmed $0 monthly fee
                  (not proof there's no HOA). */}
              {/* Stored HOA status still feeds Match; the fee never infers it. */}
              {!showsRentalFacts && <Row label="HOA fee / month" hint={isReadOnly ? null : 'Enter 0 for a $0 monthly fee'} htmlFor="hf-hoaFeeMonthly">{text('hoaFeeMonthly', null, { parse: parseMoneyNumber, format: formatHoaFee, edit: editHoaFee, inputMode: 'numeric' })}</Row>}
              {!showsRentalFacts && hoaConflict(home) && <p className="flh-hf2-note" role="note">The fee says there’s an HOA, but HOA is set to No. No HOA stays Unknown in Match until they agree.</p>}
              {showsRentalFacts && home.availableOn && <Row label="Available on"><span className="flh-fact-text">{formatDateOnly(home.availableOn)}</span></Row>}
              {showsRentalFacts && [['petsAllowed', 'Pets allowed'], ['utilitiesIncluded', 'Utilities included'], ['inUnitLaundry', 'In-unit laundry']].map(([field, label]) => (
                home[field] == null ? null : <Row key={field} label={label}><span className="flh-fact-text">{formatTriState(home[field])}</span></Row>
              ))}
              {!isReadOnly && onEditAll && <button type="button" className="flh-hf2-more" onClick={onEditAll}>More {vocabulary.singularLower} details</button>}
            </Group>

            {/* One freeform School Details field (homes.schools_notes) beside the district.
                Legacy school-name columns stay stored, but are never substituted
                into these two fields after clearing or refresh. No lookup. */}
            {available.schools && <div className="flh-hf2-schools">
              <Group id="hf-schools-title" title="Schools">
                <Row label="District" htmlFor="hf-schoolDistrict">{text('schoolDistrict')}</Row>
                <div className="flh-hf-row is-stacked">
                  <label className="flh-hf-row-label" htmlFor="hf-schoolsNotes">Notes</label>
                  <div className="flh-hf-row-control">{text('schoolsNotes', null, { parse: parseLegacyText, multiline: true, placeholder: isReadOnly ? 'Unknown' : 'Schools, bus routes, boundary or enrollment notes…' })}</div>
                </div>
              </Group>
            </div>}
          </div>

          {(available.garage || available.basement || laundryKnownToDatabase) && <div className="flh-hf2-column flh-hf2-column-side">
            {available.garage && <Group id="hf-garage-title" title="Garage" summary={[GARAGE_TYPE_CHOICES.find(([key]) => key === home.garageType)?.[1], home.garageSpaces && `${home.garageSpaces} spaces`].filter(Boolean).join(' · ') || 'Type & parking spaces'}>
              <Pair>
                <PairField label="Type" htmlFor="hf-garageType">{select('garageType', null, GARAGE_TYPE_CHOICES, (value) => save(garagePatch(home, 'garageType', value)))}</PairField>
                <PairField label="Spaces" htmlFor="hf-garageSpaces"><SelectField priority={priorityIds.has('hf-garageSpaces')} id="hf-garageSpaces" value={garageSpacesSelectValue(home.garageSpaces)} choices={GARAGE_SPACE_CHOICES} readOnly={isReadOnly} failed={failed('garageSpaces')} onCommit={(value) => save(garagePatch(home, 'garageSpaces', value))} /></PairField>
              </Pair>
            </Group>}
            {/* Basement: one description over the two facts Match reads
                (basementDescriptionPatch). "Match reads" says what was understood. */}
            {available.basement && <Group id="hf-basement-title" title="Basement" summary={basement.text || 'Style & condition'}>
              <div className="flh-hf-basement">
                <QuietInput id="hf-basement" label="Basement description" value={basement.text} readOnly={isReadOnly} failed={failed('basementCondition') || failed('basementStyle') || failed('basementNotes')}
                  registerDraft={editor?.registerDraft} list="hf-basement-options" placeholder="Unknown — e.g. Finished Walkout" parse={(value) => value.trim()}
                  onCommit={(value) => { const patch = basementDescriptionPatch(home, value); if (Object.keys(patch).length) save(patch); }} className={`is-boxed${priorityIds.has('hf-basement') ? ' is-priority-unknown' : ''}`} />
                {!isReadOnly && <datalist id="hf-basement-options">{BASEMENT_SUGGESTIONS.map((value) => <option key={value} value={value} />)}</datalist>}
                {(home.basementCondition || home.basementStyle) && <small className="flh-hf2-hint flh-hf-basement-reading">{basementMatchReading(home.basementCondition, home.basementStyle)}</small>}
                {basement.source === 'earlier_note' && <small className="flh-hf2-hint">{basement.offer && !isReadOnly
                  ? <>Earlier note, not yet read for Match. <button type="button" className="flh-offered-review" onClick={() => save(Object.fromEntries(Object.entries(basement.offer).filter(([, value]) => value)))}>Use as {describeBasement(basement.offer.basementCondition, basement.offer.basementStyle)}<span className="sr-only"> for Match</span></button></>
                  : 'Earlier note, not read for Match.'}</small>}
              </div>
              {basement.earlierNote && <p className="flh-hf2-note">Earlier note: “{basement.earlierNote}”</p>}
              {/* Context only: a foundation type never says a basement's style or condition. */}
              {!home.basementStyle && !home.basementCondition && record.foundation && <p className="flh-hf2-note">County records: {record.foundation} foundation. Not proof of a basement’s style or condition.</p>}
            </Group>}
            {/* Laundry, after Basement (moved from the photo summary). Main Floor answers the
                Main Floor Laundry priority; no location is ever read as "No". */}
            {laundryKnownToDatabase && !apartment && <Group id="hf-laundry-title" title="Laundry" summary={LAUNDRY_LOCATION_CHOICES.find(([key]) => key === home.laundryLocation)?.[1] || 'Laundry location'}>
              <Row label="Location" htmlFor="hf-laundryLocation" hint={!isReadOnly && home.laundryLocation === 'first_floor' ? 'Counts for Main Floor Laundry' : null}>{select('laundryLocation', null, LAUNDRY_LOCATION_CHOICES)}</Row>
            </Group>}
            {/* The shared notes / pros / cons (the same fields as Tour Feedback and
                the Home Card previews), saved like every other fact here. */}

          </div>}
        </div>
      </section>
      <div className="flh-hf-evaluation">
            {showNotes && <Group id="hf-notes-title" title={noteFields.some(({ key }) => key === 'notes') ? 'Pros, Cons & Notes' : 'Pros & Cons'} summary={`${noteFields.reduce((count, { key }) => count + noteEntries(home[key]).length, 0)} saved impressions`}>
              {isCollaborative && !isReadOnly && <p className="flh-hf-notes-context">Shared with this search</p>}
              {[...noteFields.filter(({ key }) => key !== 'notes'), ...noteFields.filter(({ key }) => key === 'notes')].map(({ key, label, marker, placeholder }) => <NoteTextField key={key} id={`hf-${key}`} label={label} marker={marker} placeholder={placeholder}
                value={home[key]} readOnly={isReadOnly} failed={failed(key)} registerDraft={editor?.registerDraft} onCommit={(text) => save({ [key]: text })} />)}
            </Group>}
      </div>
    </div>
  );
}
