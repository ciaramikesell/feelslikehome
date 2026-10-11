'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import { ChoiceChip } from '@/components/MobileSystem';
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

// Short labels for the compact search-type control; the stored keys and the
// full names (src/lib/onboarding.js) are unchanged.
const SEARCH_TYPE_LABELS = { home_buy: 'Home to buy', home_rent: 'Home to rent', apartment_rent: 'Apartment' };

function OptionalTag() {
  return <span className="flh-ob-optional">Optional</span>;
}

// The required kind of search, kept as a quiet segmented control above the
// approved card. Native radios give arrow-key navigation; nothing is preselected.
function SearchTypeControl({ choice, onChoose }) {
  const name = useId();
  return (
    <fieldset className="flh-ob-searchtype">
      <legend className="flh-ob-label">I’m looking for</legend>
      <div className="flh-ob-segmented">
        {NEW_SEARCH_CHOICES.map((option) => (
          <label key={option.key} className={choice === option.key ? 'is-selected' : ''}>
            <input type="radio" className="sr-only" name={name} value={option.key} checked={choice === option.key} onChange={() => onChoose(option.key)} aria-label={option.label} />
            <span aria-hidden="true">{SEARCH_TYPE_LABELS[option.key]}</span>
          </label>
        ))}
      </div>
      {!choice && <p className="flh-ob-hint">Choose one to continue. It decides which details apply.</p>}
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
            <input type="radio" className="sr-only" name={name} value={option.key} checked={value === option.key} onChange={() => onChange(option.key)} />
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

function OptionGroup({ legend, options, selected, onToggle }) {
  return (
    <fieldset className="flh-ob-pills">
      <legend className="flh-ob-sublabel">{legend}</legend>
      <div className="flh-chip-row">
        {options.map((option) => <ChoiceChip key={option.value} selected={selected.includes(option.value)} onClick={() => onToggle(option.value)}>{option.label}</ChoiceChip>)}
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
