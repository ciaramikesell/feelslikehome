'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import Sheet from '@/components/Sheet';
import {
  BATHS_OPTIONS, BEDS_OPTIONS, EMPTY_HOME_FILTERS, PROPERTY_TYPE_OPTIONS, SHOW_CONFIRMED, SHOW_POSSIBLE,
  normalizeHomeFilters, parseThreshold, propertyTypeFilterLabel,
} from '@/lib/homeFilters';

// Filter My Homes (see src/lib/homeFilters.js). Edits a draft; nothing applies
// to the board until "Show …", and nothing is ever saved anywhere but this
// browser session. Bottom sheet on phones, a centered panel on iPad, a
// right-hand panel on desktop (.hh-refine-sheet).

function thresholdHint(raw) {
  const { state } = parseThreshold(raw);
  if (state === 'invalid') return 'Enter a number, like 1200';
  if (state === 'zero') return 'Use a number above 0';
  return null;
}

function NumberField({ label, value, onChange, prefix, placeholder, inputMode = 'numeric' }) {
  const id = useId();
  const hint = thresholdHint(value);
  return (
    <div className="hh-refine-field">
      <label htmlFor={id}>{label}</label>
      <div className={`hh-refine-input${hint ? ' is-invalid' : ''}`}>
        {prefix && <span aria-hidden="true">{prefix}</span>}
        <input
          id={id} type="text" inputMode={inputMode} autoComplete="off" placeholder={placeholder} value={value}
          onChange={(event) => onChange(event.target.value)} aria-invalid={hint ? 'true' : undefined} aria-describedby={hint ? `${id}-hint` : undefined}
        />
      </div>
      {hint && <p id={`${id}-hint`} className="hh-refine-hint" role="status">{hint}</p>}
    </div>
  );
}

// Single-choice "Any / 1+ / 2+ …" row (a radio group).
function MinimumChoices({ legend, options, value, onChange }) {
  return (
    <fieldset className="hh-refine-group">
      <legend>{legend}</legend>
      <div className="hh-refine-segments" role="radiogroup" aria-label={legend}>
        {['', ...options].map((option) => {
          const on = String(value || '') === option;
          return (
            <button key={option || 'any'} type="button" role="radio" aria-checked={on} className={`hh-refine-segment${on ? ' on' : ''}`} onClick={() => onChange(option)}>
              {option ? `${option}+` : 'Any'}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ToggleChip({ on, onClick, children }) {
  return (
    <button type="button" className={`hh-refine-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick}>
      {on && <Check size={13} strokeWidth={2.6} aria-hidden="true" />}{children}
    </button>
  );
}

export default function HomeFiltersSheet({ open, initial, criteria, vocabulary, rental, showLot, preview, onApply, onClose }) {
  const [draft, setDraft] = useState(() => normalizeHomeFilters(initial));
  // Each open starts from what is applied now.
  useEffect(() => { if (open) setDraft(normalizeHomeFilters(initial)); }, [open, initial]);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const toggle = (key, value) => setDraft((current) => ({
    ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value],
  }));

  const counts = useMemo(() => preview(draft), [preview, draft]);
  const shown = draft.show === SHOW_CONFIRMED ? counts.confirmed : counts.confirmed + counts.possible;
  const noun = (n) => (n === 1 ? vocabulary.singularLower : vocabulary.pluralLower);
  const minAboveMax = (min, max) => {
    const a = parseThreshold(min).value; const b = parseThreshold(max).value;
    return a !== null && b !== null && a > b;
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Filter my ${vocabulary.pluralLower}`} size="large" className="hh-refine-sheet">
      <p className="hh-refine-lead">
        Narrow down the {vocabulary.pluralLower} you’ve saved. Filters are just for exploring — they don’t change My Search, your priorities, or any Match score. They apply to this list only; Want to Tour and Archived always show everything.
      </p>

      <section className="hh-refine-section" aria-labelledby="hh-refine-facts">
        <h3 id="hh-refine-facts">{vocabulary.singular} facts</h3>
        <div className="hh-refine-pair">
          <NumberField label={rental ? 'Min rent' : 'Min price'} prefix="$" placeholder="No min" value={draft.priceMin} onChange={(v) => set('priceMin', v)} />
          <NumberField label={rental ? 'Max rent' : 'Max price'} prefix="$" placeholder="No max" value={draft.priceMax} onChange={(v) => set('priceMax', v)} />
        </div>
        {minAboveMax(draft.priceMin, draft.priceMax) && <p className="hh-refine-hint" role="status">The minimum is above the maximum, so nothing can match.</p>}
        <div className="hh-refine-pair">
          <NumberField label="Min sq ft" placeholder="No min" value={draft.sqftMin} onChange={(v) => set('sqftMin', v)} />
          <NumberField label="Max sq ft" placeholder="No max" value={draft.sqftMax} onChange={(v) => set('sqftMax', v)} />
        </div>
        {minAboveMax(draft.sqftMin, draft.sqftMax) && <p className="hh-refine-hint" role="status">The minimum is above the maximum, so nothing can match.</p>}
        {showLot && (
          <div className="hh-refine-pair">
            <NumberField label="Min lot size (acres)" placeholder="e.g. 0.2" inputMode="decimal" value={draft.lotMinAcres} onChange={(v) => set('lotMinAcres', v)} />
          </div>
        )}
        <MinimumChoices legend="Bedrooms" options={BEDS_OPTIONS} value={draft.bedsMin} onChange={(v) => set('bedsMin', v)} />
        <MinimumChoices legend="Bathrooms" options={BATHS_OPTIONS} value={draft.bathsMin} onChange={(v) => set('bathsMin', v)} />
        <fieldset className="hh-refine-group">
          <legend>Property type</legend>
          <div className="hh-refine-chips">
            {PROPERTY_TYPE_OPTIONS.map((type) => (
              <ToggleChip key={type} on={draft.propertyTypes.includes(type)} onClick={() => toggle('propertyTypes', type)}>{propertyTypeFilterLabel(type)}</ToggleChip>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="hh-refine-section" aria-labelledby="hh-refine-criteria">
        <h3 id="hh-refine-criteria">What matters to you</h3>
        {criteria.length ? (
          <>
            <p className="hh-refine-note">From My Search, using your own Yes / No answers for each {vocabulary.singularLower}. If you haven’t answered yet, it shows as a possible match — never as a No.</p>
            <div className="hh-refine-chips">
              {criteria.map((criterion) => (
                <ToggleChip key={criterion.key} on={draft.criteria.includes(criterion.key)} onClick={() => toggle('criteria', criterion.key)}>{criterion.label}</ToggleChip>
              ))}
            </div>
          </>
        ) : (
          <p className="hh-refine-note">Add features in <a href="/search">My Search</a> to filter by what matters to you.</p>
        )}
      </section>

      <fieldset className="hh-refine-section hh-refine-show">
        <legend>Show</legend>
        <div className="hh-refine-segments is-wide" role="radiogroup" aria-label="Which matches to show">
          <button type="button" role="radio" aria-checked={draft.show === SHOW_CONFIRMED} className={`hh-refine-segment${draft.show === SHOW_CONFIRMED ? ' on' : ''}`} onClick={() => set('show', SHOW_CONFIRMED)}>
            Confirmed only <span>{counts.confirmed}</span>
          </button>
          <button type="button" role="radio" aria-checked={draft.show === SHOW_POSSIBLE} className={`hh-refine-segment${draft.show === SHOW_POSSIBLE ? ' on' : ''}`} onClick={() => set('show', SHOW_POSSIBLE)}>
            Confirmed + possible <span>{counts.confirmed + counts.possible}</span>
          </button>
        </div>
        <p className="hh-refine-note">Possible matches have nothing ruled out, but something still unknown.</p>
      </fieldset>

      <div className="hh-refine-actions">
        <button type="button" className="hh-btn hh-btn-ghost" onClick={() => setDraft({ ...EMPTY_HOME_FILTERS })}>Clear all</button>
        <button type="button" className="hh-btn" onClick={() => onApply(draft)}>
          {counts.active ? `Show ${shown} ${noun(shown)}` : `Show all ${counts.total} ${noun(counts.total)}`}
        </button>
      </div>
    </Sheet>
  );
}
