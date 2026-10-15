'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, House, KeyRound, Minus, Plus } from 'lucide-react';
import { NEW_SEARCH_CHOICES } from '@/lib/onboarding';
import { basicsFieldsFor, sanitizeNumericInput } from '@/lib/searchProfile';
import { STEPPERS, editFormattedNumber, formatThousands, isUnset, stepDown, stepUp } from '@/lib/onboardingBasics';
import { homePreferenceRows, homePreferencesSummary, toggleHomePreference } from '@/lib/homePreferences';
import { switchSearchType } from '@/lib/whatMattersCatalog';
import { OnboardingAction } from '@/components/onboarding/OnboardingShell';

// Step 1: "The Basics of Your Search". Every field reads and writes the same
// priorities document My Search uses; an empty value is "not set" and never
// scores as 0 or as a confirmed miss.

// How each kind of search reads in the change note; the stored keys and the
// full names (src/lib/onboarding.js) are unchanged.
const SEARCH_TYPE_PHRASES = { home_buy: 'a home to buy', home_rent: 'a home to rent', apartment_rent: 'an apartment to rent' };
const SEARCH_TYPE_OPTIONS = Object.freeze({
  home_buy: { title: 'Home to Buy', note: 'Purchase budget', icon: House },
  home_rent: { title: 'Home to Rent', note: 'Monthly rent', icon: KeyRound },
  apartment_rent: { title: 'Apartment to Rent', note: 'Monthly rent', icon: Building2 },
});

function OptionalTag() {
  return <span className="flh-ob-optional">Optional</span>;
}

// The one required answer, shown as three visible choices (a radio group, so
// arrow keys move between them). Nothing is preselected for a new search; a
// saved choice is shown as chosen. Continuing without one explains why inline.
function SearchTypeControl({ choice, onChoose, invalid, groupRef }) {
  const id = useId();
  return (
    <fieldset className={`flh-ob-searchtype${choice ? '' : ' is-unset'}${invalid ? ' is-invalid' : ''}`} aria-describedby={invalid ? `${id}-error` : `${id}-hint`} aria-invalid={invalid || undefined}>
      <legend className="flh-ob-searchtype-label">I’m looking for</legend>
      <div className="flh-ob-searchtype-track" ref={groupRef}>
        {NEW_SEARCH_CHOICES.map((option) => {
          const copy = SEARCH_TYPE_OPTIONS[option.key];
          const Icon = copy.icon;
          const selected = choice === option.key;
          return (
            <label key={option.key} className={`flh-ob-searchtype-option${selected ? ' is-selected' : ''}`}>
              <input type="radio" className="flh-ob-pill-input" name={`${id}-type`} value={option.key} checked={selected} onChange={() => onChoose(option.key)} />
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span className="flh-ob-searchtype-copy"><span className="flh-ob-searchtype-title">{copy.title}</span><span className="flh-ob-searchtype-note">{copy.note}</span></span>
            </label>
          );
        })}
      </div>
      {invalid
        ? <p id={`${id}-error`} className="flh-ob-searchtype-error" role="alert">Choose what you’re looking for to continue—it decides which details apply.</p>
        : <p id={`${id}-hint`} className="flh-ob-searchtype-hint">{choice ? 'You can change this anytime.' : 'Required. It decides which details apply.'}</p>}
    </fieldset>
  );
}

// Directly editable currency: digits are stored, commas are shown, and the caret
// stays where the person is typing.
function FormattedNumberInput({ id, value, onChange, placeholder, describedBy }) {
  const inputRef = useRef(null);
  const caretRef = useRef(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (caretRef.current === null || !input || document.activeElement !== input) return;
    input.setSelectionRange(caretRef.current, caretRef.current);
    caretRef.current = null;
  });
  return (
    <input
      ref={inputRef}
      id={id}
      inputMode="numeric"
      autoComplete="off"
      value={formatThousands(value)}
      placeholder={placeholder}
      aria-describedby={describedBy}
      onChange={(event) => {
        const { digits, caret } = editFormattedNumber(event.target.value, event.target.selectionStart ?? event.target.value.length);
        caretRef.current = caret;
        onChange(digits);
      }}
    />
  );
}

function BudgetField({ label, rent, value, onChange }) {
  const id = useId();
  return (
    <div className="flh-ob-field">
      <label className="flh-ob-label" htmlFor={id}>{label}</label>
      <span className="flh-ob-input flh-ob-input-currency">
        <span className="flh-ob-currency" aria-hidden="true">$</span>
        <FormattedNumberInput id={id} value={value} onChange={onChange} placeholder={rent ? 'Enter your monthly rent' : 'Enter your budget'} describedBy={`${id}-help`} />
      </span>
      <p id={`${id}-help`} className="flh-ob-help">{rent ? 'What’s the most you’d want to pay each month?' : 'What’s the most you’d feel comfortable spending?'}</p>
    </div>
  );
}

// A genuine unset state: "—  not set" until the first +, and − at the minimum
// clears the answer instead of inventing a smaller number.
function Stepper({ label, noun, value, onChange, rule }) {
  const id = useId();
  const unset = isUnset(value);
  const atMax = !unset && Number(value) >= rule.max;
  const atMin = !unset && Number(value) <= rule.min;
  return (
    <div className="flh-ob-field" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="flh-ob-label">{label}</span>
      <div className="flh-ob-stepper">
        <button type="button" disabled={unset} onClick={() => onChange(stepDown(value, rule))} aria-label={atMin ? `Clear ${noun}` : `Fewer ${noun}`}>
          <Minus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <output aria-live="polite" aria-label={unset ? `${label}: not set` : `${label}: at least ${value}`}>
          {unset
            ? <><span className="flh-ob-stepper-value is-unset" aria-hidden="true">—</span><span className="flh-ob-stepper-note" aria-hidden="true">not set</span></>
            : <><span className="flh-ob-stepper-value" aria-hidden="true">{value}</span><span className="flh-ob-stepper-note" aria-hidden="true">or more</span></>}
        </output>
        <button type="button" disabled={atMax} onClick={() => onChange(stepUp(value, rule))} aria-label={`More ${noun}`}>
          <Plus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function UnitField({ label, unit, value, onChange, decimal = false }) {
  const id = useId();
  return (
    <div className="flh-ob-field">
      <label className="flh-ob-label" htmlFor={id}>{label}<OptionalTag /></label>
      <span className="flh-ob-input flh-ob-input-unit">
        {decimal
          ? <input id={id} inputMode="decimal" autoComplete="off" value={value ?? ''} placeholder="Not set" onChange={(event) => onChange(sanitizeNumericInput(event.target.value, { decimal: true }))} />
          : <FormattedNumberInput id={id} value={value} onChange={onChange} placeholder="Not set" />}
        <span className="flh-ob-unit" aria-hidden="true">{unit}</span>
      </span>
    </div>
  );
}

// One compact row per topic: the label on the left, the options on the right
// (wrapping, then stacking, on narrow screens). Rows are checkboxes — a row
// whose options can't combine (Garage) is a radio group, with a tap on the
// chosen option clearing it so "not set" is always reachable.
function PreferenceRow({ row, onToggle }) {
  const name = useId();
  const single = row.mode === 'one';
  return (
    <fieldset className="flh-ob-pref-row">
      <legend className="flh-ob-pref-label">{row.label}</legend>
      <div className="flh-ob-pref-options">
        {row.options.map((option) => (
          <label key={option.id} className={`flh-ob-pill flh-ob-pill-compact${option.selected ? ' is-selected' : ''}`}>
            <input
              type={single ? 'radio' : 'checkbox'}
              className="flh-ob-pill-input"
              name={single ? name : undefined}
              checked={option.selected}
              onChange={() => onToggle(option)}
              onClick={single && option.selected ? () => onToggle(option) : undefined}
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Optional and collapsed by default: a quick person skips it entirely, a
// meticulous one opens one section. Everything chosen here starts as Important
// and is ranked with the rest on Rank Priorities; nothing chosen stays unset.
function HomePreferences({ priorities, patch }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rows = homePreferenceRows(priorities);
  const summary = homePreferencesSummary(priorities);
  const garageChosen = rows.some((row) => row.key === 'garage' && row.options.some((option) => option.selected && option.value !== 'any'));
  return (
    <div className={`flh-ob-disclosure flh-ob-home-prefs${open ? ' is-open' : ''}`}>
      <button type="button" className="flh-ob-disclosure-toggle" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((value) => !value)}>
        <span className="flh-ob-disclosure-copy">
          <span className="flh-ob-disclosure-title">Home preferences <OptionalTag /></span>
          <span className="flh-ob-disclosure-summary">{summary.count ? summary.text : 'Home type, layout, garage and more—skip if you like'}</span>
        </span>
        {summary.count > 0 && <span className="flh-ob-pref-count" aria-label={`${summary.count} chosen`}>{summary.count}</span>}
        <ChevronDown size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <div id={`${id}-panel`} className="flh-ob-disclosure-panel flh-ob-pref-panel" hidden={!open}>
        <p className="flh-ob-help">Choose only what you’d weigh. Each starts as Important—you’ll rank them with everything else.</p>
        {rows.map((row) => <PreferenceRow key={row.key} row={row} onToggle={(option) => patch((next) => toggleHomePreference(next, option))} />)}
        {garageChosen && <p className="flh-ob-help">Match checks whether a home has a garage; attached or detached is saved with your preference.</p>}
      </div>
    </div>
  );
}

// Both flows (the live three-step flow and the inactive six-step flow) use
// the same Basics. Changing the kind of search keeps what still applies and
// says what it removed, with Undo (switchSearchType); a saved kind of search is
// never replaced without the person choosing another one.
export default function BasicsStep({ header, priorities, patch, onNext }) {
  const choice = priorities.onboardingSearchType || '';
  const fields = basicsFieldsFor(choice);
  const rent = choice === 'home_rent' || choice === 'apartment_rent';
  // Before a kind of search is chosen, show the purchase-style card (the approved
  // design); lot size is hidden only once "Apartment" is actually chosen.
  const showLotSize = choice ? fields.lotSize : true;
  const [invalid, setInvalid] = useState(false);
  const typeRef = useRef(null);
  // Several switches in a row add up: the note keeps everything removed since
  // the first switch, and Undo returns to how things were before it.
  const [switched, setSwitched] = useState(null);
  const chooseType = (key) => {
    setInvalid(false);
    if (key === choice) return;
    const { priorities: next, removed } = switchSearchType(priorities, key);
    patch(() => next);
    setSwitched((earlier) => {
      const all = [...new Set([...(earlier?.removed || []), ...removed])];
      return all.length ? { removed: all, previous: earlier?.previous || priorities } : null;
    });
  };
  const undoSwitch = () => { patch(() => switched.previous); setSwitched(null); };
  const setValue = (key, value) => patch((next) => { next[key] = { ...next[key], value }; return next; });
  const proceed = () => {
    if (choice) { onNext(); return; }
    setInvalid(true);
    typeRef.current?.querySelector('input')?.focus();
  };

  return (
    <div className="flh-onboarding-step flh-ob-basics">
      {header}
      <SearchTypeControl choice={choice} onChoose={chooseType} invalid={invalid} groupRef={typeRef} />
      {switched && (
        <div className="flh-ob-switch-note" role="status">
          <p>Now looking for {SEARCH_TYPE_PHRASES[choice]}. Removed what no longer applies: {switched.removed.join(', ')}. Everything else is kept.</p>
          <button type="button" className="flh-text-action" onClick={undoSwitch}>Undo</button>
        </div>
      )}
      <section className="flh-card flh-ob-basics-card" aria-label="The basics">
        <BudgetField label={fields.budgetLabel} rent={rent} value={priorities.budget.value} onChange={(value) => setValue('budget', value)} />
        <hr className="flh-ob-divider" />
        <div className="flh-ob-pair">
          <Stepper label="Bedrooms" noun="bedrooms" value={priorities.bedsMin.value} rule={STEPPERS.bedsMin} onChange={(value) => setValue('bedsMin', value)} />
          <Stepper label="Bathrooms" noun="bathrooms" value={priorities.bathsMin.value} rule={STEPPERS.bathsMin} onChange={(value) => setValue('bathsMin', value)} />
        </div>
        <hr className="flh-ob-divider" />
        <div className="flh-ob-pair">
          <UnitField label="Ideal square footage" unit="sq ft" value={priorities.sqftTarget.value} onChange={(value) => setValue('sqftTarget', value)} />
          {showLotSize && <UnitField label="Ideal lot size" unit="acres" decimal value={priorities.lotSizeTarget.value} onChange={(value) => setValue('lotSizeTarget', value)} />}
        </div>
        {choice && homePreferenceRows(priorities).length > 0 && <div className="flh-ob-disclosures"><HomePreferences priorities={priorities} patch={patch} /></div>}
      </section>
      <nav className="flh-onboarding-actions">
        <OnboardingAction onClick={proceed}>Continue</OnboardingAction>
      </nav>
    </div>
  );
}
