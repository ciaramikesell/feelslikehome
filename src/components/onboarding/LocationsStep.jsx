'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Building2, LocateFixed, Plus, Search, Trash2, X } from 'lucide-react';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { OnboardingAction } from '@/components/onboarding/OnboardingShell';
import { AREA_TYPES, MAX_SEARCH_AREAS, addSearchArea, removeSearchArea, searchAreasOf } from '@/lib/searchAreas';

// Step 2 of Onboarding V2: "Where are you looking?" (approved Figma design).
//
// Areas of interest live on the participant's own preferences document
// (priorities.searchAreas) and are alternatives: a home in any one of them
// fits. They create no Must-Have and no Match criterion.
// Places That Matter are the existing commute destinations (one row per
// person per search); onboarding saves them without a maximum drive time, so
// they add distance context only and never become requirements.

const MIN_QUERY = 2;
const PLACE_PRESETS = ['Work', 'Family'];

function AreaTypeTag({ type }) {
  return <span className={`flh-ob-area-type is-${type}`}>{AREA_TYPES[type]}</span>;
}

// One combobox for cities, neighborhoods, school districts and ZIP codes.
// Results come only from the area-search service (Google Places in the app);
// nothing is invented, and a provider failure is shown as such.
function AreaSearch({ priorities, onAdd, searchAreas }) {
  const id = useId();
  const listId = `${id}-list`;
  const rootRef = useRef(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | results | empty | error
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [schoolDistricts, setSchoolDistricts] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  const full = searchAreasOf(priorities).length >= MAX_SEARCH_AREAS;

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY) { setStatus('idle'); setResults([]); setOpen(false); return undefined; }
    const current = ++requestRef.current;
    setStatus('loading');
    setOpen(true);
    const timer = setTimeout(async () => {
      try {
        const { results: found = [], schoolDistricts: districts = true } = await searchAreas(term);
        if (current !== requestRef.current) return;
        setResults(found);
        setSchoolDistricts(districts);
        setActive(found.length ? 0 : -1);
        setStatus(found.length ? 'results' : 'empty');
      } catch {
        if (current !== requestRef.current) return;
        setResults([]);
        setActive(-1);
        setStatus('error');
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, searchAreas]);

  useEffect(() => {
    const dismiss = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);

  const choose = (result) => {
    if (!result) return;
    const already = searchAreasOf(priorities).some((area) => area.placeId === result.placeId);
    if (!already) onAdd(result);
    setAnnouncement(already ? `${result.name} is already one of your areas.` : `Added ${result.name}, ${AREA_TYPES[result.type]}.`);
    requestRef.current += 1;
    setQuery('');
    setResults([]);
    setStatus('idle');
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (!open || status !== 'results') return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + step + results.length) % results.length);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(results[active]);
    }
  };

  const selectedIds = new Set(searchAreasOf(priorities).map((area) => area.placeId));
  return (
    <div ref={rootRef} className="flh-ob-area-search">
      <label className="flh-ob-label" htmlFor={id}>Areas of interest</label>
      <span className="flh-ob-input flh-ob-search-input">
        <Search size={18} strokeWidth={2} aria-hidden="true" />
        <input
          id={id}
          value={query}
          disabled={full}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => { if (query.trim().length >= MIN_QUERY) setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder={full ? `You’ve added ${MAX_SEARCH_AREAS} areas` : 'City, neighborhood, district, or ZIP'}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && status === 'results' && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={`${id}-help`}
        />
      </span>
      <span id={`${id}-help`} className="sr-only">Type at least two letters, then choose a city, neighborhood, school district or ZIP code with the arrow keys and Enter.</span>
      {open && (
        <div className="flh-ob-area-menu">
          {status === 'loading' && <p className="flh-ob-area-status" role="status">Searching…</p>}
          {status === 'empty' && <p className="flh-ob-area-status" role="status">No matching cities, neighborhoods, school districts or ZIP codes.</p>}
          {status === 'error' && <p className="flh-ob-area-status is-error" role="alert">Area search isn’t available right now. You can add areas later in My Search.</p>}
          {status === 'results' && (
            <ul id={listId} role="listbox" aria-label="Matching areas">
              {results.map((result, index) => {
                const added = selectedIds.has(result.placeId);
                return (
                  <li
                    key={result.placeId}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    aria-disabled={added || undefined}
                    className={`${index === active ? 'is-active' : ''} ${added ? 'is-added' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(result)}
                  >
                    <span className="flh-ob-area-copy">
                      <span className="flh-ob-area-name">{result.name}</span>
                      {result.secondary && <span className="flh-ob-area-secondary">{result.secondary}</span>}
                    </span>
                    {added ? <span className="flh-ob-area-added">Added</span> : <AreaTypeTag type={result.type} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {!schoolDistricts && <p className="flh-ob-help">School districts aren’t available in area search yet.</p>}
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </div>
  );
}

function SelectedAreas({ priorities, onRemove }) {
  const areas = searchAreasOf(priorities);
  if (!areas.length) return null;
  return (
    <ul className="flh-ob-areas" aria-label="Your areas">
      {areas.map((area) => (
        <li key={area.placeId} className="flh-ob-area-chip">
          <span className="flh-ob-area-copy">
            <span className="flh-ob-area-name">{area.name}</span>
            <AreaTypeTag type={area.type} />
          </span>
          <button type="button" onClick={() => onRemove(area)} aria-label={`Remove ${area.name}, ${AREA_TYPES[area.type]}`}>
            <X size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function PlaceForm({ onSave, onCancel, saving, error }) {
  const id = useId();
  const firstRef = useRef(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  const [preset, setPreset] = useState('Work');
  const [custom, setCustom] = useState('');
  const [address, setAddress] = useState('');
  const label = preset === 'custom' ? custom.trim() : preset;
  const valid = label.length > 0 && label.length <= 80 && address.trim().length > 0;
  return (
    <form className="flh-ob-place-form" onSubmit={(event) => { event.preventDefault(); if (valid && !saving) onSave({ label, address: address.trim() }); }}>
      <fieldset className="flh-ob-pills">
        <legend className="flh-ob-sublabel">What is it?</legend>
        <div className="flh-chip-row">
          {[...PLACE_PRESETS, 'custom'].map((key) => (
            <label key={key} className={`flh-ob-pill ${preset === key ? 'is-selected' : ''}`}>
              <input ref={key === PLACE_PRESETS[0] ? firstRef : undefined} type="radio" className="flh-ob-pill-input" name={`${id}-kind`} value={key} checked={preset === key} onChange={() => setPreset(key)} />
              <span>{key === 'custom' ? 'Something else' : key}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {preset === 'custom' && (
        <div className="flh-ob-field">
          <label className="flh-ob-sublabel" htmlFor={`${id}-label`}>Name</label>
          <span className="flh-ob-input"><input id={`${id}-label`} maxLength={80} value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="e.g. School, Gym, Mom’s" /></span>
        </div>
      )}
      <div className="flh-ob-field">
        <span className="flh-ob-sublabel" aria-hidden="true">Address</span>
        <div className="flh-ob-place-address">
          <AddressAutocomplete value={address} onChange={setAddress} onSelect={setAddress} placeholder="Street address" />
        </div>
      </div>
      {error && <p className="flh-field-error" role="alert">{error}</p>}
      <div className="flh-ob-place-actions">
        <button type="button" className="flh-text-action" onClick={onCancel}>Cancel</button>
        <button type="submit" className="flh-button flh-button-primary flh-button-small" disabled={!valid || saving}>{saving ? 'Saving…' : 'Save place'}</button>
      </div>
    </form>
  );
}

function PlacesThatMatter({ places, placesError, onCreate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);
  const addRef = useRef(null);
  const close = () => { setOpen(false); setTimeout(() => addRef.current?.focus(), 0); };

  const save = async (place) => {
    setSaving(true);
    setError('');
    try {
      await onCreate(place);
      close();
    } catch {
      setError('Couldn’t save this place. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  const remove = async (place) => {
    setRemoving(place.id);
    setError('');
    try { await onDelete(place); setTimeout(() => addRef.current?.focus(), 0); } catch { setError(`Couldn’t remove ${place.label}. Please try again.`); } finally { setRemoving(null); }
  };

  return (
    <section className="flh-card flh-ob-places" aria-labelledby="flh-ob-places-title">
      <div className="flh-ob-places-head">
        <span className="flh-ob-places-icon" aria-hidden="true"><LocateFixed size={20} strokeWidth={1.9} /></span>
        <div>
          <h2 id="flh-ob-places-title" className="flh-ob-places-title">What places matter to you?</h2>
          <p className="flh-ob-places-copy">Add the places you visit most. We’ll show you how far they are from each home.</p>
        </div>
      </div>
      {placesError && <p className="flh-field-error" role="alert">{placesError}</p>}
      {places.length > 0 && (
        <ul className="flh-ob-place-list" aria-label="Your places">
          {places.map((place) => (
            <li key={place.id} className="flh-ob-place-row">
              <span className="flh-ob-area-copy">
                <span className="flh-ob-area-name">{place.label}</span>
                <span className="flh-ob-area-secondary">{place.address}</span>
              </span>
              <button type="button" onClick={() => remove(place)} disabled={removing === place.id} aria-label={`Remove ${place.label}`}>
                <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <PlaceForm onSave={save} onCancel={() => { close(); setError(''); }} saving={saving} error={error} />
      ) : (
        <>
          {error && <p className="flh-field-error" role="alert">{error}</p>}
          <button ref={addRef} type="button" className="flh-ob-add-place" onClick={() => setOpen(true)} disabled={Boolean(placesError)}>
            <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
            <span>{places.length ? 'Add another place' : 'Add a place'}</span>
            <span className="flh-ob-optional-tag">Optional</span>
          </button>
        </>
      )}
      <p className="flh-ob-places-note">Places add helpful distance context. They won’t become hard requirements.</p>
    </section>
  );
}

export default function LocationsStep({ header, priorities, patch, searchAreas, places, placesError, onCreatePlace, onDeletePlace, onNext }) {
  const areas = searchAreasOf(priorities);
  const cardRef = useRef(null);
  // After a chip is removed, keep keyboard focus in place: the next chip's
  // remove button, else the previous one, else the search field.
  const removeArea = (area) => {
    const index = areas.findIndex((entry) => entry.placeId === area.placeId);
    patch((next) => removeSearchArea(next, area.placeId));
    setTimeout(() => {
      const buttons = cardRef.current?.querySelectorAll('.flh-ob-area-chip button') || [];
      (buttons[Math.min(index, buttons.length - 1)] || cardRef.current?.querySelector('input'))?.focus();
    }, 0);
  };
  return (
    <div className="flh-onboarding-step flh-ob-locations">
      {header}
      <section ref={cardRef} className="flh-card flh-ob-areas-card" aria-label="Areas of interest">
        <AreaSearch priorities={priorities} searchAreas={searchAreas} onAdd={(area) => patch((next) => addSearchArea(next, area))} />
        <SelectedAreas priorities={priorities} onRemove={removeArea} />
        <div className="flh-ob-area-hint">
          <span className="flh-ob-area-hint-icon" aria-hidden="true"><Building2 size={18} strokeWidth={1.9} /></span>
          <span>
            {areas.length > 1
              ? <><strong>Any of these can fit</strong><span>A home only needs to be in one of your areas.</span></>
              : <><strong>Start with any area</strong><span>City and school district selections can be added independently.</span></>}
          </span>
        </div>
      </section>
      <PlacesThatMatter places={places} placesError={placesError} onCreate={onCreatePlace} onDelete={onDeletePlace} />
      <nav className="flh-onboarding-actions">
        <OnboardingAction onClick={onNext}>Continue</OnboardingAction>
      </nav>
    </div>
  );
}
