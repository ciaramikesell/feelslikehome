'use client';

import { useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Minus, X } from 'lucide-react';
import { TIER_META, criterionDisplayLabel, isExperientialCriterion } from '@/lib/constants';
import { answerableCriteriaKeys, criterionAnswer, criterionResolution } from '@/lib/matchCriteria';

// Match Criteria: the buyer's own priorities from My Search, in three tiers.
// Rows come from computeMatch's allSelected — the very list the Match % is
// scored from — so nothing here is a second scoring path.
//
//   - Criteria answered from Home Facts (price, beds, layout, garage …) show
//     their determined result and a link to the fact; never a second control.
//   - The buyer's own criteria get Yes / No / Unknown (real radios), written
//     exactly where they always were: their own checks (home_member_state), or
//     the shared Pets / Utilities / In-Unit Laundry fields.
//   - Where a Home Fact answers a criterion exactly (Garage, basement, laundry
//     floor, First-Floor Primary, No HOA — homeFactCriteria.js), the third
//     option is "Home Facts": the answer follows the fact, shown under the
//     name. Yes / No is the buyer's own override; Home Facts removes it.
//   - After-tour criteria show their state and point to Tour Feedback.
//
// Green matches, terracotta doesn't, neutral is Unknown. Unknown never counts.

export const MATCH_TIERS = Object.freeze([
  { key: 'must', title: 'Must-Haves', empty: 'No Must-Haves in your search.' },
  { key: 'important', title: 'Important', empty: 'Nothing marked Important in your search.' },
  { key: 'nice', title: 'Nice to Have', empty: 'No Nice to Haves in your search.' },
]);

const ANSWERS = [['yes', 'Yes', true], ['no', 'No', 'no'], ['unknown', 'Unknown', undefined]];

// Where a fact-based criterion's value lives in Home Facts: [field id, label].
export const FACT_LINKS = Object.freeze({
  budget: ['hf-price', 'Price'],
  sqft: ['hf-sqft', 'Area'],
  lotSize: ['hf-lotSize', 'Lot'],
  beds: ['hf-beds', 'Beds'],
  baths: ['hf-baths', 'Baths'],
  preferredPropertyTypes: ['hf-propertyType', 'Type'],
  homeLayout: ['hf-layout', 'Layout'],
  homeCondition: ['hf-homeCondition', 'Condition'],
  primaryBedroomLocation: ['hf-layout', 'Layout'],
  secondaryBedroomLocation: ['hf-secondaryBedroomLocation', 'Bedrooms'],
});

const criterionName = (item) => (item.key.includes(':') ? criterionDisplayLabel(item.key.split(':')[0], item.label) : item.label);
const isAfterTour = (item) => item.key.includes(':') && isExperientialCriterion(item.key.split(':')[0], item.label);

export function criterionState(item) {
  if (!item.evaluated) return { tone: 'unknown', text: 'Unknown', icon: <Minus size={13} aria-hidden="true" /> };
  if (item.met === null) return { tone: 'neutral', text: 'Neutral', icon: <Minus size={13} aria-hidden="true" /> };
  return item.met ? { tone: 'met', text: 'Yes', icon: <Check size={13} aria-hidden="true" /> } : { tone: 'missed', text: 'No', icon: <X size={13} aria-hidden="true" /> };
}

function AnswerControl({ item, value, onChange, factBacked = false }) {
  const name = `match-${item.key}`;
  return <fieldset className="flh-mc2-answer">
    <legend className="sr-only">{criterionName(item)}</legend>
    {ANSWERS.map(([id, text, next]) => {
      // With a Home Fact behind the criterion, clearing the answer follows the fact.
      const label = id === 'unknown' && factBacked ? 'Home Facts' : text;
      const checked = next === undefined ? value === undefined : value === next;
      return <label key={id} className={`is-${id} ${factBacked && id === 'unknown' ? 'is-facts' : ''} ${checked ? 'is-checked' : ''}`}>
        <input type="radio" name={name} value={id} checked={checked} onChange={() => onChange(next)} />
        <span>{label}</span>
      </label>;
    })}
  </fieldset>;
}

function FactResult({ item, onOpenFact, tourHref }) {
  const state = criterionState(item);
  const link = FACT_LINKS[item.key];
  let source = null;
  if (link && onOpenFact) source = <button type="button" className="flh-mc2-source" onClick={() => onOpenFact(link[0])}>{link[1]} <ArrowUpRight size={11} aria-hidden="true" /><span className="sr-only"> — go to this fact in Home Facts</span></button>;
  else if (item.key === 'location:Commute') source = <a className="flh-mc2-source" href="/search/places">Places <ArrowUpRight size={11} aria-hidden="true" /></a>;
  else if (isAfterTour(item) && tourHref) source = <a className="flh-mc2-source" href={tourHref}>After tour <ArrowUpRight size={11} aria-hidden="true" /></a>;
  return <span className="flh-mc2-result">
    <span className={`flh-mc2-state is-${state.tone}`} title={item.evaluated && item.detail ? item.detail : undefined}>{state.icon}{state.text}</span>
    {source}
  </span>;
}

const answerText = (value) => (value === true ? 'Yes' : value === 'no' ? 'No' : 'Unknown');

// Where a fact-backed answer comes from, in one quiet line under the name:
// "From Home Facts: No · Basement ↗" while the fact answers it; "Your answer · Home
// Facts: No" when the buyer's own answer overrides a fact that says otherwise.
function FactNote({ resolved, onOpenFact }) {
  const [field, short] = resolved.link;
  const go = onOpenFact ? <button type="button" className="flh-mc2-source" onClick={() => onOpenFact(field)}>{short} <ArrowUpRight size={11} aria-hidden="true" /><span className="sr-only"> — go to this fact in Home Facts</span></button> : <span>{short}</span>;
  if (resolved.source === 'home_facts') return <small className="flh-mc2-from">From Home Facts: <b className={`is-${resolved.value === true ? 'met' : 'missed'}`}>{answerText(resolved.value)}</b> · {go}</small>;
  if (resolved.source === 'answer' && resolved.fact !== undefined && resolved.fact !== resolved.value) return <small className="flh-mc2-from">Your answer · Home Facts: {answerText(resolved.fact)} {go}</small>;
  return null;
}

function Tier({ tier, rows, home, priorities, answerable, readOnly, onAnswer, onOpenFact, tourHref, collapsible }) {
  const [open, setOpen] = useState(!collapsible);
  const headingId = `mc-${tier.key}-title`;
  const bodyId = `mc-${tier.key}-rows`;
  const weight = TIER_META[tier.key].weight;
  return <section className={`flh-mc2-tier is-${tier.key} ${open ? 'is-open' : ''}`} aria-labelledby={headingId}>
    <header className="flh-mc2-tier-head">
      <h3 id={headingId}>{tier.title} <span>{rows.length}</span></h3>
      <span className="flh-mc2-weight">{weight}× weight</span>
      {/* Phones collapse Important and Nice to Have; wider screens always show them. */}
      {collapsible && rows.length > 0 && <button type="button" className="flh-mc2-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>{open ? 'Hide' : 'Show'}<span className="sr-only"> {tier.title}</span> <ChevronDown size={14} aria-hidden="true" /></button>}
    </header>
    {rows.length === 0 ? <p className="flh-mc2-empty">{tier.empty}</p> : <ul id={bodyId} className="flh-mc2-rows" data-open={open ? 'true' : 'false'}>
      {rows.map((item) => {
        const canAnswer = answerable.has(item.key);
        const own = canAnswer ? criterionAnswer(home, item.key, priorities.searchType) : null;
        const resolved = canAnswer ? criterionResolution(home, item.key, priorities.searchType) : null;
        const value = resolved?.value;
        const tone = canAnswer ? (value === true ? 'met' : value === 'no' ? 'missed' : 'unknown') : criterionState(item).tone;
        // "Home Facts" replaces Unknown only when a fact actually answers it.
        const factBacked = !!resolved?.link && resolved.fact !== undefined;
        return <li key={item.key} className={`flh-mc2-row is-${tone}`}>
          <span className="flh-mc2-name">{criterionName(item)}{factBacked && <FactNote resolved={resolved} onOpenFact={onOpenFact} />}</span>
          {!canAnswer ? <FactResult item={item} onOpenFact={onOpenFact} tourHref={tourHref} />
            : readOnly ? <span className={`flh-mc2-state is-${tone}`}>{value === true ? 'Yes' : value === 'no' ? 'No' : 'Unknown'}</span>
              : <AnswerControl item={item} value={own} factBacked={factBacked} onChange={(next) => onAnswer(item, next)} />}
        </li>;
      })}
    </ul>}
  </section>;
}

export default function MatchCriteria({ home, priorities, match, readOnly = false, onAnswer, onOpenFact = null, tourHref = null }) {
  const answerable = answerableCriteriaKeys(priorities);
  const rows = match?.allSelected || [];
  return <div className="flh-mc2" aria-label="Match criteria">
    <div className="flh-mc2-columns" aria-hidden="true">
      <span>Your criterion</span><span>Result | your answer</span><span>Your criterion</span><span>Result | your answer</span>
    </div>
    {MATCH_TIERS.map((tier) => <Tier key={tier.key} tier={tier} rows={rows.filter((item) => item.tier === tier.key)} home={home} priorities={priorities} answerable={answerable}
      readOnly={readOnly} onAnswer={onAnswer} onOpenFact={onOpenFact} tourHref={tourHref} collapsible={tier.key !== 'must'} />)}
  </div>;
}
