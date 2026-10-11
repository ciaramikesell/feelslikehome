'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import { GARAGE_PREFERENCE_OPTIONS, garagePreferenceLabel } from '@/lib/constants';
import { PROPERTY_TYPE_LABELS } from '@/lib/searchIntent';
import { NEW_SEARCH_CHOICES } from '@/lib/onboarding';
import { CONDITION_CHOICES, LAYOUT_CHOICES, basicsFieldsFor, sanitizeNumericInput, setGaragePreference } from '@/lib/searchProfile';
import {
  GARAGE_LEVELS, STEPPERS, chooseSearchType, editFormattedNumber, formatThousands, garageLevel, isUnset,
  setGarageLevel, stepDown, stepUp,
} from '@/lib/onboardingBasics';
import { OnboardingAction } from '@/components/onboarding/OnboardingShell';

// Step 1 of Onboarding V2: "The Basics of Your Search" (approved Figma design).
// Every field reads and writes the same priorities document My Search uses; an
// empty value is "not set" and never scores as 0 or as a confirmed miss.

// How each kind of search reads in "I’m looking for …"; the stored keys and the
// full names (src/lib/onboarding.js) are unchanged.
const SEARCH_TYPE_PHRASES = { home_buy: 'a home to buy', home_rent: 'a home to rent', apartment_rent: 'an apartment to rent' };

function OptionalTag() {
  return <span className="flh-ob-optional">Optional</span>;
}

// The required kind of search, as one quiet sentence above the approved card:
// "I’m looking for [choose one ▾]". A native select keeps it compact, accessible
// and familiar on phones (the system picker), and nothing is preselected — it
// starts on "choose one", so no one is assumed to be buying.
function SearchTypeControl({ choice, onChoose }) {
  const id = useId();
  return (
    <div className={`flh-ob-searchtype ${choice ? '' : 'is-unset'}`}>
      <label className="flh-ob-searchtype-label" htmlFor={id}>I’m looking for</label>
      <span className="flh-ob-searchtype-select">
        <select id={id} required value={choice} onChange={(event) => onChoose(event.target.value)} aria-describedby={choice ? undefined : `${id}-hint`}>
          {!choice && <option value="" disabled>choose one</option>}
          {NEW_SEARCH_CHOICES.map((option) => <option key={option.key} value={option.key}>{SEARCH_TYPE_PHRASES[option.key]}</option>)}
        </select>
        <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
      </span>
      {!choice && <span id={`${id}-hint`} className="sr-only">Required to continue. It decides which details apply.</span>}
    </div>
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

// An expandable row (the approved "Garage preferences" treatment): title, a
// summary of the current answer, and a chevron; the panel opens in place.
function Disclosure({ title, summary, children }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className={`flh-ob-disclosure ${open ? 'is-open' : ''}`}>
      <button type="button" className="flh-ob-disclosure-toggle" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((value) => !value)}>
        <span className="flh-ob-disclosure-copy">
          <span className="flh-ob-disclosure-title">{title}</span>
          <span className="flh-ob-disclosure-summary">{summary}</span>
        </span>
        <ChevronDown size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <div id={`${id}-panel`} className="flh-ob-disclosure-panel" hidden={!open}>{children}</div>
    </div>
  );
}

function RadioPills({ legend, options, value, onChange }) {
  const name = useId();
  return (
    <fieldset className="flh-ob-pills">
      <legend className="flh-ob-sublabel">{legend}</legend>
      <div className="flh-chip-row">
        {options.map((option) => (
          <label key={option.key} className={`flh-ob-pill ${value === option.key ? 'is-selected' : ''}`}>
            <input type="radio" className="flh-ob-pill-input" name={name} value={option.key} checked={value === option.key} onChange={() => onChange(option.key)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function GaragePreferences({ priorities, patch, choice }) {
  const level = garageLevel(priorities);
  const qualifier = garagePreferenceLabel(priorities);
  const levelLabel = GARAGE_LEVELS.find((option) => option.key === level)?.label;
  const summary = level === 'unset' ? 'Not set yet' : [levelLabel, qualifier].filter(Boolean).join(' · ');
  const setLevel = (key) => patch((next) => setGarageLevel(next, key, choice));
  return (
    <Disclosure title="Garage preferences" summary={summary}>
      <RadioPills legend="How much does a garage matter?" options={GARAGE_LEVELS} value={level} onChange={setLevel} />
      {level !== 'unset' && (
        <RadioPills legend="Garage type" options={GARAGE_PREFERENCE_OPTIONS} value={priorities.exterior?.garagePreference || 'any'} onChange={(key) => patch((next) => setGaragePreference(next, key))} />
      )}
    </Disclosure>
  );
}

// Multi-select Basics never carry "No Preference" forward once a real choice is made;
// an option retained from older data (e.g. 'Split Level', 'Townhome') stays visible
// and removable instead of silently disappearing.
const toggleValue = (values, value) => {
  const current = (values || []).filter((entry) => entry !== 'No Preference');
  return current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
};
const withRetained = (choices, values, labelFor = (value) => value) => [
  ...choices,
  ...(values || []).filter((value) => value !== 'No Preference' && !choices.some((choice) => choice.value === value)).map((value) => ({ value, label: labelFor(value) })),
];
const chosen = (values) => (values || []).filter((value) => value && value !== 'No Preference');

// Multi-select pills (checkboxes) in the same treatment as the Garage pills.
function OptionGroup({ legend, options, selected, onToggle }) {
  return (
    <fieldset className="flh-ob-pills">
      <legend className="flh-ob-sublabel">{legend}</legend>
      <div className="flh-chip-row">
        {options.map((option) => (
          <label key={option.value} className={`flh-ob-pill ${selected.includes(option.value) ? 'is-selected' : ''}`}>
            <input type="checkbox" className="flh-ob-pill-input" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Home types, layout and condition: still part of the Basics My Search keeps, so
// they stay reachable here (collapsed) rather than disappearing from onboarding.
function HomeDetails({ priorities, fields, setValues }) {
  const typeLabel = (value) => PROPERTY_TYPE_LABELS[value] || value;
  const layoutLabel = (value) => LAYOUT_CHOICES.find((option) => option.value === value)?.label || value;
  const conditionLabel = (value) => CONDITION_CHOICES.find((option) => option.value === value)?.label || value;
  const picked = [
    ...(fields.propertyTypes.length ? chosen(priorities.preferredPropertyTypes.values).map(typeLabel) : []),
    ...(fields.layout ? chosen(priorities.homeLayout.values).map(layoutLabel) : []),
    ...(fields.condition ? chosen(priorities.homeCondition.values).map(conditionLabel) : []),
  ];
  return (
    <Disclosure title="More about the home" summary={picked.length ? picked.join(', ') : 'Not set yet'}>
      {fields.propertyTypes.length > 0 && (
        <OptionGroup
          legend="Kinds of homes"
          options={withRetained(fields.propertyTypes.map((value) => ({ value, label: PROPERTY_TYPE_LABELS[value] })), priorities.preferredPropertyTypes.values, typeLabel)}
          selected={priorities.preferredPropertyTypes.values}
          onToggle={(value) => setValues('preferredPropertyTypes', value)}
        />
      )}
      {fields.layout && <OptionGroup legend="Layout" options={withRetained(LAYOUT_CHOICES, priorities.homeLayout.values)} selected={priorities.homeLayout.values} onToggle={(value) => setValues('homeLayout', value)} />}
      {fields.condition && <OptionGroup legend="Condition" options={withRetained(CONDITION_CHOICES, priorities.homeCondition.values)} selected={priorities.homeCondition.values} onToggle={(value) => setValues('homeCondition', value)} />}
    </Disclosure>
  );
}

export default function BasicsStep({ header, priorities, patch, onNext }) {
  const choice = priorities.onboardingSearchType || '';
  const fields = basicsFieldsFor(choice);
  const rent = choice === 'home_rent' || choice === 'apartment_rent';
  // Before a kind of search is chosen, show the purchase-style card (the approved
  // design); lot size is hidden only once "Apartment" is actually chosen.
  const showLotSize = choice ? fields.lotSize : true;
  const showGarage = choice !== 'apartment_rent';
  const showDetails = choice && (fields.propertyTypes.length > 0 || fields.layout || fields.condition);
  const setValue = (key, value) => patch((next) => { next[key] = { ...next[key], value }; return next; });
  const setValues = (key, value) => patch((next) => { next[key] = { ...next[key], values: toggleValue(next[key]?.values, value) }; return next; });

  return (
    <div className="flh-onboarding-step flh-ob-basics">
      {header}
      <SearchTypeControl choice={choice} onChoose={(key) => patch((next) => chooseSearchType(next, key))} />
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
        {(showGarage || showDetails) && (
          <div className="flh-ob-disclosures">
            {showGarage && <GaragePreferences priorities={priorities} patch={patch} choice={choice} />}
            {showDetails && <HomeDetails priorities={priorities} fields={fields} setValues={setValues} />}
          </div>
        )}
      </section>
      <nav className="flh-onboarding-actions">
        <OnboardingAction disabled={!choice} onClick={onNext}>Continue</OnboardingAction>
      </nav>
    </div>
  );
}
