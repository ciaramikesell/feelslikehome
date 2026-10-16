'use client';

import { useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ExternalLink, GraduationCap, House, Pencil, Sparkles, X } from 'lucide-react';
import {
  BASEMENT_FINISH_CHOICES, CONDITION_CHOICES, GARAGE_SPACE_CHOICES, HOME_FEATURE_FIELDS, LAYOUT_CHOICES,
  PRIMARY_BEDROOM_CHOICES, PRIMARY_BEDROOM_LABELS, composeBasement, conditionLabel, descriptionFeatureLabels,
  homeFactsWelcome, homeFeatureAvailability, homeFeatureSummary, homeFeaturesDraft,
  importedDetailCount, layoutLabel, listingDetailGroups, parseBasement,
} from '@/lib/homeFacts';
import { PROVENANCE_LABELS } from '@/lib/homeProvenance';

// Home Facts — what the property IS. Personal reactions, pros/cons, and the
// Yes / No / Unknown Match questions deliberately live elsewhere on the page.
// Every edit here writes existing shared home fields through the caller's
// onSaveFacts (the same shared-home save path as Edit Home), so co-buyers see
// the same facts and Match keeps evaluating them exactly as before.

function Provenance({ value }) {
  if (value !== 'listing' && value !== 'you') return null;
  return <span className={`flh-facts-source is-${value}`}>{PROVENANCE_LABELS[value]}</span>;
}

function ChoiceGroup({ id, label, hint, choices, isSelected, onToggle, labelOf = (value) => value, unknownSelected, onUnknown }) {
  return (
    <div className="flh-facts-choice">
      <span className="flh-facts-choice-label" id={id}>{label}</span>
      {hint && <span className="flh-facts-choice-hint">{hint}</span>}
      <div className="flh-facts-choice-options" role="group" aria-labelledby={id}>
        {choices.map((choice) => (
          <button type="button" key={choice} className={`hh-chip ${isSelected(choice) ? 'on' : ''}`} aria-pressed={isSelected(choice)} onClick={() => onToggle(choice)}>{labelOf(choice)}</button>
        ))}
        {onUnknown && <button type="button" className={`hh-chip is-unknown ${unknownSelected ? 'on' : ''}`} aria-pressed={unknownSelected} onClick={onUnknown}>Unknown</button>}
      </div>
    </div>
  );
}

// A value saved earlier that isn't one of today's choices (e.g. free text typed
// in Edit Home) stays visible as its own selected choice — never silently lost.
const withCurrent = (choices, current) => (current && !choices.includes(current) ? [...choices, current] : choices);

function HomeFeaturesEditor({ home, available, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => homeFeaturesDraft(home));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const basement = parseBasement(draft.basementNotes);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const toggleList = (key, value) => setDraft((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((entry) => entry !== value) : [...current[key], value] }));
  const setBasement = (next) => set('basementNotes', composeBasement({ ...basement, ...next }));
  const garageChoices = withCurrent([...GARAGE_SPACE_CHOICES], GARAGE_SPACE_CHOICES.includes(draft.garageSpaces) ? '' : draft.garageSpaces);

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const patch = Object.fromEntries(HOME_FEATURE_FIELDS.map((field) => [field, draft[field]]));
      await onSave(patch);
    } catch {
      setError('We couldn’t save these details. Please try again — your choices are still here.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="flh-facts-editor">
      {available.garage && <ChoiceGroup
        id="facts-garage" label="Garage" hint="Spaces"
        choices={garageChoices} isSelected={(value) => draft.garageSpaces === value}
        labelOf={(value) => (value === '0' ? 'No garage' : GARAGE_SPACE_CHOICES.includes(value) ? `${value} car` : value)}
        onToggle={(value) => set('garageSpaces', draft.garageSpaces === value ? '' : value)}
        unknownSelected={!draft.garageSpaces} onUnknown={() => set('garageSpaces', '')}
      />}
      {available.basement && <>
        <ChoiceGroup
          id="facts-basement" label="Basement" hint="Finish"
          choices={BASEMENT_FINISH_CHOICES} isSelected={(value) => basement.finish === value}
          onToggle={(value) => setBasement({ finish: basement.finish === value ? null : value, walkout: value === 'No basement' ? false : basement.walkout })}
          unknownSelected={!basement.finish} onUnknown={() => setBasement({ finish: null })}
        />
        {basement.finish !== 'No basement' && <ChoiceGroup
          id="facts-basement-access" label="Basement access" hint="Walkout"
          choices={['Walkout']} isSelected={() => basement.walkout}
          onToggle={() => setBasement({ walkout: !basement.walkout })}
          unknownSelected={!basement.walkout} onUnknown={() => setBasement({ walkout: false })}
        />}
        {basement.custom && <p className="flh-facts-editor-note">Saved note: “{basement.custom}”. Choosing an option above replaces it.</p>}
      </>}
      {available.layout && <>
        <ChoiceGroup
          id="facts-layout" label="Home layout" hint="Choose any that apply"
          choices={withCurrent([...LAYOUT_CHOICES], draft.homeLayout.find((value) => !LAYOUT_CHOICES.includes(value)))}
          isSelected={(value) => draft.homeLayout.includes(value)} labelOf={layoutLabel}
          onToggle={(value) => toggleList('homeLayout', value)}
          unknownSelected={!draft.homeLayout.length} onUnknown={() => set('homeLayout', [])}
        />
        <ChoiceGroup
          id="facts-primary" label="Primary bedroom"
          choices={withCurrent([...PRIMARY_BEDROOM_CHOICES], draft.primaryBedroomLocation)}
          isSelected={(value) => draft.primaryBedroomLocation === value} labelOf={(value) => PRIMARY_BEDROOM_LABELS[value] || value}
          onToggle={(value) => set('primaryBedroomLocation', draft.primaryBedroomLocation === value ? '' : value)}
          unknownSelected={!draft.primaryBedroomLocation} onUnknown={() => set('primaryBedroomLocation', '')}
        />
      </>}
      {available.condition && <ChoiceGroup
        id="facts-condition" label="Home condition" hint="Choose any that apply"
        choices={withCurrent([...CONDITION_CHOICES], draft.homeCondition.find((value) => !CONDITION_CHOICES.includes(value)))}
        isSelected={(value) => draft.homeCondition.includes(value)} labelOf={conditionLabel}
        onToggle={(value) => toggleList('homeCondition', value)}
        unknownSelected={!draft.homeCondition.length} onUnknown={() => set('homeCondition', [])}
      />}
      <p className="flh-facts-editor-note">Unknown is neutral — it never counts against this home. Changes are shared with everyone in this search.</p>
      {error && <p className="hh-save-error" role="alert">{error}</p>}
      <div className="flh-facts-editor-actions">
        <button type="button" className="hh-btn hh-btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="hh-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save home features'}</button>
      </div>
    </div>
  );
}

function SchoolDetails({ home, readOnly, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(home.schoolsNotes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const value = String(home.schoolsNotes || '').trim();
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try { await onSave({ schoolsNotes: draft.trim() }); setEditing(false); } catch { setError('We couldn’t save school details. Please try again.'); } finally { setSaving(false); }
  };
  return (
    <section className="flh-facts-panel flh-facts-schools" aria-labelledby="school-details-title">
      <div className="flh-facts-panel-head">
        <span className="flh-facts-icon" aria-hidden="true"><GraduationCap size={18} /></span>
        <h3 id="school-details-title" className="hh-serif">School details</h3>
        {!readOnly && !editing && <button type="button" className="flh-facts-edit" onClick={() => { setDraft(home.schoolsNotes || ''); setEditing(true); }}><Pencil size={13} aria-hidden="true" /> {value ? 'Edit' : 'Add'}<span className="sr-only"> school details</span></button>}
      </div>
      {editing ? <div className="flh-facts-editor">
        <label className="flh-facts-choice-label" htmlFor="facts-schools">School district or assigned schools</label>
        <textarea id="facts-schools" className="hh-textarea" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="e.g. Anchor Bay School District" />
        {error && <p className="hh-save-error" role="alert">{error}</p>}
        <div className="flh-facts-editor-actions">
          <button type="button" className="hh-btn hh-btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
          <button type="button" className="hh-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save school details'}</button>
        </div>
      </div> : value
        ? <p className="flh-facts-school-value">{value}</p>
        : <p className="flh-facts-unknown">Unknown — not added yet.</p>}
      <p className="flh-facts-fine">FLH doesn’t pull school information from listings. Confirm school assignment with the district. Your school priorities are checked separately, in Match.</p>
    </section>
  );
}

export default function HomeFacts({ home, priorities, vocabulary, readOnly = false, justAdded = null, summary = null, onSaveFacts, onEditAll, onSeeMatch }) {
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [editingFeatures, setEditingFeatures] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef(null);
  const apartment = vocabulary.apartment;
  const available = homeFeatureAvailability(priorities, { apartment });
  const hasFeatures = Object.values(available).some(Boolean);
  const features = homeFeatureSummary(home, priorities, { apartment });
  const groups = listingDetailGroups(home, priorities, { apartment });
  const mentioned = descriptionFeatureLabels(home);
  const importedCount = importedDetailCount(home.listingImport);
  const welcome = welcomeDismissed ? null : homeFactsWelcome(home, justAdded);
  const knownDetails = groups.reduce((total, group) => total + group.rows.filter((row) => row.value).length, 0);

  const seeImported = () => {
    setDetailsOpen(true);
    requestAnimationFrame(() => {
      detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      detailsRef.current?.querySelector('summary')?.focus({ preventScroll: true });
    });
  };
  const saveFeatures = async (patch) => { await onSaveFacts(patch); setEditingFeatures(false); };

  return (
    <section className="flh-home-facts" aria-label="Home facts">
      {/* Property header + imported-details acknowledgement: one calm row. The
          welcome replaces the acknowledgement the first time, never both. */}
      <div className={`flh-facts-hero ${welcome || importedCount > 0 ? '' : 'is-solo'}`}>
        {summary}
        {welcome ? <div className="flh-facts-welcome" role="status">
          <span className="flh-facts-welcome-icon" aria-hidden="true"><Sparkles size={18} /></span>
          <div>
            <strong className="hh-serif">{welcome.title}</strong>
            <p>{welcome.body}</p>
            {importedCount > 0 && <button type="button" className="flh-facts-link" onClick={seeImported}>See imported details <ArrowRight size={13} aria-hidden="true" /></button>}
          </div>
          <button type="button" className="flh-facts-dismiss" onClick={() => setWelcomeDismissed(true)} aria-label="Dismiss welcome message"><X size={16} aria-hidden="true" /></button>
        </div> : importedCount > 0 && <div className="flh-facts-ack">
          <span className="flh-facts-welcome-icon" aria-hidden="true"><Check size={18} /></span>
          <div>
            <strong className="hh-serif">FLH found {importedCount} listing detail{importedCount === 1 ? '' : 's'}.</strong>
            <p>Imported from the listing. Review them and add what you know.</p>
            <button type="button" className="flh-facts-link" onClick={seeImported}>See imported details <ArrowRight size={13} aria-hidden="true" /></button>
          </div>
        </div>}
      </div>

      <div className={`flh-facts-grid ${hasFeatures ? '' : 'is-schools-only'}`}>
        {hasFeatures && <section className="flh-facts-panel flh-facts-features" aria-labelledby="home-features-title">
          <div className="flh-facts-panel-head">
            <span className="flh-facts-icon" aria-hidden="true"><House size={18} /></span>
            <h3 id="home-features-title" className="hh-serif">Home features</h3>
            {!readOnly && !editingFeatures && <button type="button" className="flh-facts-edit" onClick={() => setEditingFeatures(true)}><Pencil size={13} aria-hidden="true" /> Edit<span className="sr-only"> home features</span></button>}
          </div>
          {editingFeatures
            ? <HomeFeaturesEditor home={home} available={available} onCancel={() => setEditingFeatures(false)} onSave={saveFeatures} />
            : <dl className="flh-facts-features-list">
              {features.map((feature) => <div key={feature.key} className={feature.value ? '' : 'is-unknown'}>
                <dt>{feature.title}</dt>
                <dd>{feature.value || 'Unknown'}<Provenance value={feature.provenance} /></dd>
                {feature.detail && <dd className="flh-facts-detail">{feature.detail}</dd>}
              </div>)}
            </dl>}
        </section>}
        <SchoolDetails home={home} readOnly={readOnly} onSave={onSaveFacts} />
      </div>

      <details ref={detailsRef} className="flh-facts-all" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary>
          <span><strong>All listing details</strong><small>{knownDetails} known · price, size, structure, systems and more</small></span>
          <ChevronDown size={18} aria-hidden="true" className="flh-facts-chevron" />
        </summary>
        <div className="flh-facts-all-body">
          {groups.map((group) => <div key={group.key} className="flh-facts-group">
            <h4>{group.title}</h4>
            <dl>{group.rows.map((row) => <div key={row.label} className={row.value ? '' : 'is-unknown'}>
              <dt>{row.label}</dt>
              <dd>{row.value || 'Unknown'}<Provenance value={row.provenance} /></dd>
            </div>)}</dl>
          </div>)}
          {mentioned.length > 0 && <div className="flh-facts-group flh-facts-mentioned">
            <h4>Mentioned in the listing description</h4>
            <div className="flh-facts-tags">{mentioned.map((label) => <span key={label}>{label}</span>)}</div>
            <p className="flh-facts-fine">Stated in the listing’s own description. Worth confirming on a tour.</p>
          </div>}
          {home.conditionNotes && <div className="flh-facts-group"><h4>Condition notes</h4><p className="flh-facts-school-value">{home.conditionNotes}</p></div>}
          <div className="flh-facts-all-actions">
            {!readOnly && <button type="button" className="hh-btn hh-btn-ghost" onClick={onEditAll}><Pencil size={14} aria-hidden="true" /> Correct details</button>}
            {home.listingUrl && <a className="flh-facts-link" href={home.listingUrl} target="_blank" rel="noreferrer">View original listing <ExternalLink size={13} aria-hidden="true" /></a>}
          </div>
        </div>
      </details>

      {onSeeMatch && <button type="button" className="flh-facts-match-link" onClick={onSeeMatch}>See how this {vocabulary.singularLower} matches your search <ArrowRight size={15} aria-hidden="true" /></button>}
    </section>
  );
}

