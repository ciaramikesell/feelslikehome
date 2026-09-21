'use client';

import { Check } from 'lucide-react';
import { qualifierOptions, selectedQualifiers, toggleCriterionQualifier, setExclusiveQualifier, isGarageQualifierAny } from '@/lib/constants';

// Lightweight secondary refinement for the three parent/child criteria (Garage,
// Fenced Yard, First-Floor Bedroom) — shared by Onboarding and My Search so the
// qualifier semantics (which are single-select vs. independently toggleable,
// what "Any" means) never drift between the two surfaces, the same class of bug
// this pass otherwise fixes. Renders nothing for a criterion with no qualifier
// options. Garage and Fenced Yard behave as single-select with an explicit
// "Any" option — a garage really is exactly one type, so the UI never relies on
// the user inferring that no qualifier means any type; First-Floor Bedroom's
// Primary/Guest toggle independently, since a buyer may genuinely want both.
// Tiny, conversational context for each parent — never a large card or a
// persistent paragraph, just enough to answer "what does this control do"
// the moment it appears.
const QUALIFIER_HINTS = {
  'exterior:Garage': "Any garage works? Leave it as Any, or tell us if Attached or Detached matters.",
  'exterior:Fenced yard': "Any fence works? Leave it as Any, or choose Privacy Fence if that's important.",
  'features:First-Floor Bedroom': 'Who needs to be downstairs? Choose Primary, Guest, both, or leave it as Any.',
};

export default function QualifierPicker({ categoryKey, label, displayLabel, priorities, patch, chipClassName = 'hh-chip hh-chip-qualifier' }) {
  const options = qualifierOptions(categoryKey, label);
  if (!options) return null;
  const current = selectedQualifiers(priorities, categoryKey, label);
  const isGarage = categoryKey === 'exterior' && label === 'Garage';
  const exclusive = isGarage || (categoryKey === 'exterior' && label === 'Fenced yard');
  const anyLabel = isGarage ? 'Any garage' : exclusive ? 'Any fence' : 'Any first-floor bedroom';
  const anyActive = isGarage ? isGarageQualifierAny(current) : !current.length;
  const setQualifier = (qualifierKey) => patch((next) => {
    next[categoryKey] = exclusive
      ? setExclusiveQualifier(next[categoryKey], label, qualifierKey)
      : toggleCriterionQualifier(next[categoryKey], label, qualifierKey);
    return next;
  });
  return (
    <div className="hh-qualifier-block">
      <p className="hh-qualifier-hint">{QUALIFIER_HINTS[`${categoryKey}:${label}`]}</p>
      <div className="hh-qualifier-row" role="group" aria-label={`${displayLabel} refinement`}>
        <button type="button" className={`${chipClassName} ${anyActive ? 'on' : ''}`} aria-pressed={anyActive} onClick={() => setQualifier(null)}>{anyActive && <Check size={11} aria-hidden="true" />}{anyLabel}</button>
        {options.map((option) => {
          const active = current.includes(option.key);
          return <button type="button" key={option.key} className={`${chipClassName} ${active ? 'on' : ''}`} aria-pressed={active} onClick={() => setQualifier(option.key)}>{active && <Check size={11} aria-hidden="true" />}{option.label}</button>;
        })}
      </div>
    </div>
  );
}
