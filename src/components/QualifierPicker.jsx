'use client';

import { Check } from 'lucide-react';
import { qualifierOptions, selectedQualifiers, toggleCriterionQualifier, setExclusiveQualifier, isGarageQualifierAny } from '@/lib/constants';

// Lightweight secondary refinement for Garage — shared by Onboarding and My Search so
// the qualifier semantics (single-select, what "Any" means) never drift between the two
// surfaces. Renders nothing for a criterion with no qualifier options (every other
// criterion, since Fenced Yard and First-Floor Bedroom's parent/qualifier models were
// reverted to plain independent criteria — see CRITERION_QUALIFIERS). Garage behaves as
// single-select with an explicit "Any" option — a garage really is exactly one type, so
// the UI never relies on the user inferring that no qualifier means any type. Tiny,
// conversational context — never a large card or a persistent paragraph, just enough to
// answer "what does this control do" the moment it appears.
const QUALIFIER_HINTS = {
  'exterior:Garage': "Any garage works? Leave it as Any, or tell us if Attached or Detached matters.",
};

export default function QualifierPicker({ categoryKey, label, displayLabel, priorities, patch, chipClassName = 'hh-chip hh-chip-qualifier' }) {
  const options = qualifierOptions(categoryKey, label);
  if (!options) return null;
  const current = selectedQualifiers(priorities, categoryKey, label);
  const isGarage = categoryKey === 'exterior' && label === 'Garage';
  const anyLabel = isGarage ? 'Any garage' : 'Any';
  const anyActive = isGarage ? isGarageQualifierAny(current) : !current.length;
  const setQualifier = (qualifierKey) => patch((next) => {
    next[categoryKey] = isGarage
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
