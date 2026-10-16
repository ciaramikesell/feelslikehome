'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ExternalLink, House, Link2, Pencil, Sparkles, Upload, X } from 'lucide-react';
import {
  BASEMENT_CONDITION_CHOICES, BASEMENT_STYLE_CHOICES, CONDITION_FACT_CHOICES, FIRST_FLOOR_PRIMARY, GARAGE_SPACE_CHOICES,
  GARAGE_TYPE_CHOICES, LAYOUT_FACT_CHOICES, PROPERTY_TYPE_CHOICES, conditionLabel, fromListingLine, garageSpacesChoice,
  homeFactSections, homeFactsAvailability, homeFactsDraft, homeFactsHeader, homeFactsPatch, homeFactsWelcome,
  layoutLabel, listingSays, normalizeLotSizeInput, propertyTypeLabel,
} from '@/lib/homeFacts';
import { fieldProvenance } from '@/lib/homeProvenance';
import { homeIdentity } from '@/lib/homePresentation';
import { photoFileError, uploadHomePhoto } from '@/lib/homePhoto';
import { formatCurrencyDisplay } from '@/lib/homeDisplay';
import { searchIntentCapabilities } from '@/lib/searchIntent';
import { createClient } from '@/lib/supabase/client';

// Home Facts — "We found your home. Here's what we know." What the property IS,
// in a few calm groups. Every edit writes shared home fields through onSaveFacts
// (the same shared-home save path as Edit Home), so co-buyers see the same facts
// and Match keeps evaluating them exactly as before. Personal answers live in
// Match Criteria; impressions and notes live in Tour Feedback.

function FromListing({ provenance }) {
  return provenance === 'listing' ? <span className="flh-hf-source">From listing</span> : null;
}

// One choice per group, plus Unknown. Selecting the current choice again clears
// it back to Unknown. A saved value that isn't offered stays visible.
function Choices({ id, label, choices, value, onChange, multiple = false }) {
  const selected = multiple ? (Array.isArray(value) ? value : []) : value;
  const isOn = (key) => (multiple ? selected.includes(key) : selected === key);
  const toggle = (key) => {
    if (multiple) onChange(isOn(key) ? selected.filter((entry) => entry !== key) : [...selected, key]);
    else onChange(isOn(key) ? '' : key);
  };
  const unknown = multiple ? !selected.length : !selected;
  return <div className="flh-hf-field">
    <span className="flh-hf-label" id={id}>{label}</span>
    <div className="flh-hf-choices" role="group" aria-labelledby={id}>
      {choices.map(([key, text]) => <button type="button" key={key} className={`hh-chip ${isOn(key) ? 'on' : ''}`} aria-pressed={isOn(key)} onClick={() => toggle(key)}>{text}</button>)}
      <button type="button" className={`hh-chip is-unknown ${unknown ? 'on' : ''}`} aria-pressed={unknown} onClick={() => onChange(multiple ? [] : '')}>Unknown</button>
    </div>
  </div>;
}

function TextField({ id, label, value, onChange, placeholder = 'Unknown', inputMode, hint, provenance }) {
  return <div className="flh-hf-field">
    <label className="flh-hf-label" htmlFor={id}>{label}<FromListing provenance={provenance} /></label>
    <input id={id} className="hh-input flh-hf-input" value={value} inputMode={inputMode} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    {hint && <small className="flh-hf-hint">{hint}</small>}
  </div>;
}

const withSaved = (choices, saved, labelOf) => (saved && !choices.some(([key]) => key === saved) ? [...choices, [saved, labelOf(saved)]] : choices);

function EditorShell({ title, saving, error, onCancel, onSave, children }) {
  return <div className="flh-hf-editor" role="group" aria-label={`Edit ${title}`}>
    {children}
    {error && <p className="hh-save-error" role="alert">{error}</p>}
    <div className="flh-hf-editor-actions">
      <button type="button" className="hh-btn hh-btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
      <button type="button" className="hh-btn" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : `Save ${title.toLowerCase()}`}</button>
    </div>
  </div>;
}

// Shared save mechanics: one save at a time, only changed fields, errors kept
// beside the form with the buyer's input intact.
function useGroupSave(home, group, onSaveFacts, onDone) {
  const [draft, setDraft] = useState(() => homeFactsDraft(home, group));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const set = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const save = async (extra = null) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const patch = { ...homeFactsPatch(home, group, draft), ...(extra ? await extra() : {}) };
      if (Object.keys(patch).length) await onSaveFacts(patch);
      onDone();
    } catch {
      setError('We couldn’t save these details. Please try again — your changes are still here.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return { draft, set, setDraft, saving, error, setError, save };
}

function HeaderEditor({ home, priorities, userId, onSaveFacts, onDone }) {
  const { draft, set, saving, error, setError, save } = useGroupSave(home, 'header', onSaveFacts, onDone);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const snapshot = home.listingImport;
  const prov = (field) => fieldProvenance(draft[field], snapshot, field);
  const { showsRentalFacts } = searchIntentCapabilities(priorities.searchType);
  const choose = (event) => {
    const next = event.target.files?.[0];
    event.target.value = '';
    if (!next) return;
    const problem = photoFileError(next);
    if (problem) { setError(problem); return; }
    setError('');
    setFile(next);
    setPreview(URL.createObjectURL(next));
  };
  const shown = file ? preview : draft.photoUrl;
  const lotPreview = draft.lotSize && normalizeLotSizeInput(draft.lotSize) !== draft.lotSize.trim() ? `Saves as ${normalizeLotSizeInput(draft.lotSize)}` : 'Acres — or type sq ft, sq m, or hectares and FLH converts it.';
  const onSave = () => {
    if (!String(draft.address || '').trim()) { setError('An address is required.'); return; }
    save(file ? async () => ({ photoUrl: await uploadHomePhoto(createClient(), userId, file) }) : null);
  };
  return <EditorShell title="Property" saving={saving} error={error} onCancel={onDone} onSave={onSave}>
    <div className="flh-hf-photo-edit">
      <div className="flh-hf-photo-preview">{shown ? <img src={shown} alt="" /> : <House size={26} aria-hidden="true" />}</div>
      <div className="flh-hf-photo-actions">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} hidden />
        <button type="button" className="hh-btn hh-btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={14} aria-hidden="true" /> {shown ? 'Change photo' : 'Upload photo'}</button>
        {!file && <button type="button" className="hh-btn hh-btn-ghost" aria-expanded={urlOpen} onClick={() => setUrlOpen((open) => !open)}><Link2 size={14} aria-hidden="true" /> Photo URL</button>}
        {shown && <button type="button" className="hh-btn hh-btn-ghost" onClick={() => { setFile(null); setPreview(null); set('photoUrl', ''); }}>Remove</button>}
      </div>
      {!file && urlOpen && <TextField id="hf-photo-url" label="Photo URL" value={draft.photoUrl} onChange={(value) => set('photoUrl', value)} placeholder="https://…" />}
    </div>
    <div className="flh-hf-grid">
      <TextField id="hf-price" label={showsRentalFacts ? 'Monthly rent' : 'Asking price'} value={draft.price ? formatCurrencyDisplay(draft.price) : ''} onChange={(value) => set('price', value.replace(/[^0-9]/g, ''))} inputMode="numeric" provenance={prov('price')} />
      <div className="flh-hf-span"><TextField id="hf-address" label="Address" value={draft.address} onChange={(value) => set('address', value)} placeholder="Street, city, state" /></div>
      <TextField id="hf-beds" label="Beds" value={draft.beds} onChange={(value) => set('beds', value)} inputMode="decimal" provenance={prov('beds')} />
      <TextField id="hf-baths" label="Baths" value={draft.baths} onChange={(value) => set('baths', value)} inputMode="decimal" provenance={prov('baths')} />
      <TextField id="hf-sqft" label="Square footage" value={draft.sqft} onChange={(value) => set('sqft', value)} inputMode="numeric" provenance={prov('sqft')} />
      <TextField id="hf-lot" label="Lot size (acres)" value={draft.lotSize} onChange={(value) => set('lotSize', value)} provenance={prov('lotSize')} hint={lotPreview} />
      <div className="flh-hf-span"><TextField id="hf-listing" label="Original listing link" value={draft.listingUrl} onChange={(value) => set('listingUrl', value)} placeholder="https://…" inputMode="url" /></div>
    </div>
  </EditorShell>;
}

function BasicEditor({ home, priorities, onSaveFacts, onDone }) {
  const { draft, set, saving, error, save } = useGroupSave(home, 'basic', onSaveFacts, onDone);
  const { showsRentalFacts } = searchIntentCapabilities(priorities.searchType);
  const prov = (field) => fieldProvenance(draft[field], home.listingImport, field);
  const money = (field) => (draft[field] ? formatCurrencyDisplay(draft[field]) : '');
  return <EditorShell title="Basic details" saving={saving} error={error} onCancel={onDone} onSave={() => save()}>
    <div className="flh-hf-grid">
      {!showsRentalFacts && <TextField id="hf-est" label="Est. monthly payment" value={money('estMonthly')} onChange={(value) => set('estMonthly', value.replace(/[^0-9]/g, ''))} inputMode="numeric" hint="Your own estimate — FLH never calculates it." />}
      <TextField id="hf-listing-id" label="Listing ID" value={draft.listingId} onChange={(value) => set('listingId', value)} provenance={prov('listingId')} />
      <TextField id="hf-year" label="Year built" value={draft.yearBuilt} onChange={(value) => set('yearBuilt', value)} inputMode="numeric" provenance={prov('yearBuilt')} />
      {!showsRentalFacts && <TextField id="hf-hoa" label="HOA fee (monthly)" value={money('hoaFeeMonthly')} onChange={(value) => set('hoaFeeMonthly', value.replace(/[^0-9]/g, ''))} inputMode="numeric" provenance={prov('hoaFeeMonthly')} />}
      {!showsRentalFacts && <TextField id="hf-tax" label="Property taxes (yearly)" value={money('propertyTaxAnnual')} onChange={(value) => set('propertyTaxAnnual', value.replace(/[^0-9]/g, ''))} inputMode="numeric" provenance={prov('propertyTaxAnnual')} />}
    </div>
  </EditorShell>;
}

function DetailsEditor({ home, available, onSaveFacts, onDone }) {
  const { draft, set, saving, error, save } = useGroupSave(home, 'details', onSaveFacts, onDone);
  const prov = (field) => fieldProvenance(draft[field], home.listingImport, field);
  // First-Floor Primary is primary_bedroom_location = 'Main Floor'; turning it
  // off restores whatever was stored before (e.g. 'Upstairs'), never invents.
  const layoutValue = [...draft.homeLayout, ...(draft.primaryBedroomLocation === 'Main Floor' ? [FIRST_FLOOR_PRIMARY] : [])];
  const setLayout = (next) => {
    set('homeLayout', next.filter((value) => value !== FIRST_FLOOR_PRIMARY));
    const primary = next.includes(FIRST_FLOOR_PRIMARY);
    set('primaryBedroomLocation', primary ? 'Main Floor' : (home.primaryBedroomLocation === 'Main Floor' ? '' : home.primaryBedroomLocation || ''));
  };
  const savedLayouts = draft.homeLayout.filter((value) => !LAYOUT_FACT_CHOICES.some(([key]) => key === value)).map((value) => [value, layoutLabel(value)]);
  const savedConditions = draft.homeCondition.filter((value) => !CONDITION_FACT_CHOICES.some(([key]) => key === value)).map((value) => [value, conditionLabel(value)]);
  return <EditorShell title="Home details" saving={saving} error={error} onCancel={onDone} onSave={() => save()}>
    {available.propertyType && <Choices id="hf-type" label="Property type" choices={withSaved(PROPERTY_TYPE_CHOICES, draft.propertyType, propertyTypeLabel)} value={draft.propertyType} onChange={(value) => set('propertyType', value)} />}
    {available.layout && <Choices id="hf-layout" label="Home layout · choose any that apply" multiple choices={[...LAYOUT_FACT_CHOICES, ...savedLayouts]} value={layoutValue} onChange={setLayout} />}
    {available.condition && <Choices id="hf-condition" label="Home condition · choose any that apply" multiple choices={[...CONDITION_FACT_CHOICES, ...savedConditions]} value={draft.homeCondition} onChange={(value) => set('homeCondition', value)} />}
    <div className="flh-hf-grid">
      {[['heating', 'Heating', 'e.g. Forced air'], ['cooling', 'Cooling', 'e.g. Central air'], ['exterior', 'Exterior', 'e.g. Vinyl siding'], ['roof', 'Roof', 'e.g. Asphalt shingle']].map(([field, label, placeholder]) => (
        <TextField key={field} id={`hf-${field}`} label={label} value={draft[field]} onChange={(value) => set(field, value)} placeholder={placeholder} provenance={prov(field)} hint={draft[field] ? null : listingSays(home, field)} />
      ))}
    </div>
  </EditorShell>;
}

function SchoolsEditor({ home, onSaveFacts, onDone }) {
  const { draft, set, saving, error, save } = useGroupSave(home, 'schools', onSaveFacts, onDone);
  return <EditorShell title="School details" saving={saving} error={error} onCancel={onDone} onSave={() => save()}>
    <div className="flh-hf-grid">
      <div className="flh-hf-span"><TextField id="hf-district" label="District" value={draft.schoolDistrict} onChange={(value) => set('schoolDistrict', value)} /></div>
      <TextField id="hf-elementary" label="Elementary" value={draft.elementarySchool} onChange={(value) => set('elementarySchool', value)} />
      <TextField id="hf-middle" label="Middle" value={draft.middleSchool} onChange={(value) => set('middleSchool', value)} />
      <TextField id="hf-high" label="High" value={draft.highSchool} onChange={(value) => set('highSchool', value)} />
      {home.schoolsNotes && <div className="flh-hf-span"><TextField id="hf-school-notes" label="School notes" value={draft.schoolsNotes} onChange={(value) => set('schoolsNotes', value)} /></div>}
    </div>
  </EditorShell>;
}

function GarageEditor({ home, onSaveFacts, onDone }) {
  const { draft, set, setDraft, saving, error, save } = useGroupSave(home, 'garage', onSaveFacts, onDone);
  // "None" means no garage either way; the other field follows, visibly.
  const setType = (value) => setDraft((current) => ({ ...current, garageType: value, ...(value === 'none' ? { garageSpaces: '0' } : current.garageSpaces === '0' && value ? { garageSpaces: '' } : {}) }));
  const setSpaces = (value) => setDraft((current) => ({ ...current, garageSpaces: value, ...(value === '0' ? { garageType: 'none' } : current.garageType === 'none' && value ? { garageType: '' } : {}) }));
  const spacesChoice = garageSpacesChoice(draft.garageSpaces);
  // A stored '4' shows as 3+ without being rewritten unless a chip is chosen.
  const spacesValue = spacesChoice || draft.garageSpaces;
  const spaceChoices = withSaved(GARAGE_SPACE_CHOICES, spacesChoice ? null : draft.garageSpaces || null, (value) => value);
  return <EditorShell title="Garage" saving={saving} error={error} onCancel={onDone} onSave={() => save()}>
    <Choices id="hf-garage-type" label="Type" choices={GARAGE_TYPE_CHOICES} value={draft.garageType} onChange={setType} />
    <Choices id="hf-garage-spaces" label="Spaces" choices={spaceChoices} value={spacesValue} onChange={setSpaces} />
  </EditorShell>;
}

function BasementEditor({ home, onSaveFacts, onDone }) {
  const { draft, setDraft, saving, error, save } = useGroupSave(home, 'basement', onSaveFacts, onDone);
  const setStyle = (value) => setDraft((current) => ({ ...current, basementStyle: value, ...(value === 'none' ? { basementCondition: 'none' } : current.basementCondition === 'none' && value ? { basementCondition: '' } : {}) }));
  const setCondition = (value) => setDraft((current) => ({ ...current, basementCondition: value, ...(value === 'none' ? { basementStyle: 'none' } : current.basementStyle === 'none' && value ? { basementStyle: '' } : {}) }));
  return <EditorShell title="Basement" saving={saving} error={error} onCancel={onDone} onSave={() => save()}>
    <Choices id="hf-basement-style" label="Style" choices={BASEMENT_STYLE_CHOICES} value={draft.basementStyle} onChange={setStyle} />
    <Choices id="hf-basement-condition" label="Condition" choices={BASEMENT_CONDITION_CHOICES} value={draft.basementCondition} onChange={setCondition} />
    {home.basementNotes && <p className="flh-hf-hint">Earlier note kept as is: “{home.basementNotes}”.</p>}
  </EditorShell>;
}

const EDITORS = { basic: BasicEditor, details: DetailsEditor, schools: SchoolsEditor, garage: GarageEditor, basement: BasementEditor };

function FactGroup({ section, readOnly, editing, onEdit, children }) {
  const headingId = `hf-${section.key}-title`;
  return <section className={`flh-hf-group is-${section.key}`} aria-labelledby={headingId}>
    <div className="flh-hf-group-head">
      <h3 id={headingId} className="hh-serif">{section.title}</h3>
      {!readOnly && !editing && <button type="button" className="flh-hf-edit" onClick={onEdit}><Pencil size={13} aria-hidden="true" /> Edit<span className="sr-only"> {section.title.toLowerCase()}</span></button>}
    </div>
    {editing ? children : <dl className="flh-hf-rows">{section.rows.map((row) => <div key={row.key} className={row.value ? '' : 'is-unknown'}>
      <dt>{row.label}</dt>
      <dd><span>{row.value || 'Unknown'}</span><FromListing provenance={row.provenance} />{row.hint && <small className="flh-hf-hint">{row.hint}</small>}</dd>
    </div>)}</dl>}
  </section>;
}

export default function HomeFacts({ home, priorities, vocabulary, readOnly = false, justAdded = null, userId = null, onSaveFacts, onNext = null, nextLabel = 'Next: Match Criteria', onEditAll = null }) {
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [editing, setEditing] = useState(null);
  const apartment = vocabulary.apartment;
  const available = homeFactsAvailability(priorities, { apartment });
  const sections = homeFactSections(home, priorities, { apartment });
  const header = homeFactsHeader(home, priorities);
  const identity = homeIdentity(home, priorities);
  const welcome = welcomeDismissed ? null : homeFactsWelcome(home, justAdded);
  const listingLine = fromListingLine(header.fromListing);
  const done = () => setEditing(null);

  return (
    <section className="flh-home-facts flh-hf" aria-label="Home facts">
      {welcome && <div className="flh-hf-welcome" role="status">
        <span className="flh-hf-welcome-icon" aria-hidden="true"><Sparkles size={17} /></span>
        <div><strong className="hh-serif">{welcome.title}</strong><p>{welcome.body}</p></div>
        <button type="button" className="flh-hf-dismiss" onClick={() => setWelcomeDismissed(true)} aria-label="Dismiss welcome message"><X size={16} aria-hidden="true" /></button>
      </div>}

      {/* Property header: the photo and the facts a buyer recognizes it by. */}
      <section className="flh-hf-header" aria-labelledby="hf-property-title">
        <div className="flh-hf-photo">{home.photoUrl ? <img src={home.photoUrl} alt={`${identity.accessible} ${vocabulary.singularLower} photo`} /> : <House size={40} aria-hidden="true" />}</div>
        <div className="flh-hf-identity">
          <div className="flh-hf-group-head">
            <strong className="flh-hf-price">{header.price || 'Price unknown'}</strong>
            {!readOnly && editing !== 'header' && <button type="button" className="flh-hf-edit" onClick={() => setEditing('header')}><Pencil size={13} aria-hidden="true" /> Edit<span className="sr-only"> property</span></button>}
          </div>
          <h2 id="hf-property-title" className="hh-serif">{identity.primary}</h2>
          {identity.supporting && <p className="flh-hf-locality">{identity.supporting}</p>}
          {header.facts.length > 0 && <ul className="flh-hf-facts">{header.facts.map((fact) => <li key={fact.field}>{fact.text}</li>)}</ul>}
          {header.missing.length > 0 && <p className="flh-hf-missing">Unknown: {header.missing.join(', ')}</p>}
          <div className="flh-hf-meta">
            {listingLine && <span className="flh-hf-source-line">{listingLine}</span>}
            {home.listingUrl && <a className="flh-hf-link" href={home.listingUrl} target="_blank" rel="noreferrer">View original listing <ExternalLink size={13} aria-hidden="true" /></a>}
          </div>
          {home.suggestedBy && <span className="hh-provenance">Suggested by {home.suggestedBy}</span>}
        </div>
        {editing === 'header' && <div className="flh-hf-header-editor"><HeaderEditor home={home} priorities={priorities} userId={userId} onSaveFacts={onSaveFacts} onDone={done} /></div>}
      </section>

      <div className="flh-hf-groups">
        {sections.map((section) => {
          const Editor = EDITORS[section.key];
          return <FactGroup key={section.key} section={section} readOnly={readOnly} editing={editing === section.key} onEdit={() => setEditing(section.key)}>
            <Editor home={home} priorities={priorities} available={available} onSaveFacts={onSaveFacts} onDone={done} />
          </FactGroup>;
        })}
      </div>

      <footer className="flh-hf-next">
        <p>{readOnly ? 'See how this home lines up with the buyer’s priorities.' : 'Now let’s see whether it matches what matters to you.'}</p>
        <div className="flh-hf-next-actions">
          {!readOnly && onEditAll && <button type="button" className="hh-btn hh-btn-ghost" onClick={onEditAll}>More {vocabulary.singularLower} details</button>}
          {onNext && <button type="button" className="hh-btn flh-hf-next-button" onClick={onNext}>{nextLabel} <ArrowRight size={16} aria-hidden="true" /></button>}
        </div>
      </footer>
    </section>
  );
}
