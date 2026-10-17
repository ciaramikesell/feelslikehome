'use client';

import { useState } from 'react';
import { Check, Minus, X } from 'lucide-react';
import { criterionDisplayLabel, isExperientialCriterion } from '@/lib/constants';
import { answerableCriteriaKeys, criterionAnswer } from '@/lib/matchCriteria';
import { conditionLabel, layoutLabel, propertyTypeLabel } from '@/lib/homeFacts';

// Match Criteria: the buyer's own priorities from My Search, in three tiers,
// each answered Yes / No / Unknown for this home. Rows come from computeMatch's
// allSelected — the very list the Match % is scored from — so nothing here is a
// second scoring path. Answers are written exactly where the editor always
// wrote them: personal checks (home_member_state) for the buyer's own
// questions, and the shared Pets / Utilities / In-Unit Laundry fields for those
// three rental facts. Facts Match reads from Home Facts (price, beds, garage
// spaces, layout …) are shown with their state and corrected there.

export const MATCH_TIERS = Object.freeze([
  { key: 'must', title: 'Must-Haves', empty: 'No Must-Haves in your search.' },
  { key: 'important', title: 'Important', empty: 'Nothing marked Important in your search.' },
  { key: 'nice', title: 'Nice to Have', empty: 'No Nice to Haves in your search.' },
]);

const ANSWERS = [['yes', 'Yes', true], ['no', 'No', 'no'], ['unknown', 'Unknown', undefined]];

const criterionName = (item) => (item.key.includes(':') ? criterionDisplayLabel(item.key.split(':')[0], item.label) : item.label);

function stateOf(item) {
  if (!item.evaluated) return { tone: 'unknown', text: 'Unknown', icon: <span aria-hidden="true">?</span> };
  if (item.met === null) return { tone: 'neutral', text: 'Neutral', icon: <Minus size={13} aria-hidden="true" /> };
  return item.met ? { tone: 'met', text: 'Matches', icon: <Check size={13} aria-hidden="true" /> } : { tone: 'missed', text: 'Doesn’t match', icon: <X size={13} aria-hidden="true" /> };
}

// computeMatch's detail for list facts is the stored values ("house", "Two
// Story"); show them as Home Facts names them. Other details read as written.
const DETAIL_LABELS = { preferredPropertyTypes: propertyTypeLabel, homeLayout: layoutLabel, homeCondition: conditionLabel };
function detailText(item) {
  if (!item.evaluated || !item.detail || ['Yes', 'No'].includes(item.detail)) return '';
  const label = DETAIL_LABELS[item.key];
  return label && item.met ? item.detail.split(', ').map(label).join(', ') : item.detail;
}

function readOnlySource(item) {
  if (item.key === 'location:Commute') return 'From your places';
  const category = item.key.split(':')[0];
  if (item.key.includes(':') && isExperientialCriterion(category, item.label)) return 'Checked in person · Tour Feedback';
  return 'From Home Facts';
}

function AnswerControl({ item, value, disabled, onChange }) {
  const name = `match-${item.key}`;
  return <fieldset className="flh-mc-answer" disabled={disabled}>
    <legend className="sr-only">{criterionName(item)}</legend>
    {ANSWERS.map(([id, label, next]) => {
      const checked = next === undefined ? value === undefined : value === next;
      return <label key={id} className={`flh-mc-option is-${id} ${checked ? 'is-checked' : ''}`}>
        <input type="radio" name={name} value={id} checked={checked} onChange={() => onChange(next)} />
        <span>{label}</span>
      </label>;
    })}
  </fieldset>;
}

export default function MatchCriteria({ home, priorities, match, readOnly = false, onAnswer, onEditFacts = null }) {
  const [pending, setPending] = useState({});
  const [errors, setErrors] = useState({});
  const answerable = answerableCriteriaKeys(priorities);
  const rows = match?.allSelected || [];

  const answer = async (item, next) => {
    setPending((current) => ({ ...current, [item.key]: true }));
    setErrors((current) => ({ ...current, [item.key]: '' }));
    try { await onAnswer(item, next); } catch {
      setErrors((current) => ({ ...current, [item.key]: 'Couldn’t save that answer. Try again.' }));
    } finally {
      setPending((current) => ({ ...current, [item.key]: false }));
    }
  };

  return <div className="flh-mc" aria-label="Match criteria">
    {MATCH_TIERS.map((tier) => {
      const tierRows = rows.filter((item) => item.tier === tier.key);
      const headingId = `mc-${tier.key}-title`;
      const unknown = tierRows.filter((item) => !item.evaluated).length;
      return <section key={tier.key} className={`flh-mc-tier is-${tier.key}`} aria-labelledby={headingId}>
        <header className="flh-mc-tier-head">
          <h2 id={headingId} className="hh-serif">{tier.title}</h2>
          {tierRows.length > 0 && <span>{tierRows.length} {tierRows.length === 1 ? 'priority' : 'priorities'}{unknown ? ` · ${unknown} unknown` : ''}</span>}
        </header>
        {tierRows.length === 0 ? <p className="flh-mc-empty">{tier.empty}</p> : <ul className="flh-mc-rows">
          {tierRows.map((item) => {
            const state = stateOf(item);
            const canAnswer = answerable.has(item.key);
            const value = canAnswer ? criterionAnswer(home, item.key, priorities.searchType) : null;
            return <li key={item.key} className={`flh-mc-row is-${state.tone}`}>
              <div className="flh-mc-copy">
                <strong>{criterionName(item)}</strong>
                {canAnswer
                  ? <small>{value === undefined ? 'Unknown never counts against this home.' : 'Your answer for this home.'}</small>
                  : <small><span className={`flh-mc-state is-${state.tone}`}>{state.icon}{state.text}</span>{detailText(item) ? ` · ${detailText(item)}` : ''} · {readOnlySource(item)}</small>}
                {errors[item.key] && <span className="hh-save-error" role="alert">{errors[item.key]}</span>}
              </div>
              {canAnswer && (readOnly
                ? <span className={`flh-mc-readonly is-${value === true ? 'yes' : value === 'no' ? 'no' : 'unknown'}`}>{value === true ? 'Yes' : value === 'no' ? 'No' : 'Unknown'}</span>
                : <AnswerControl item={item} value={value} disabled={!!pending[item.key]} onChange={(next) => answer(item, next)} />)}
            </li>;
          })}
        </ul>}
      </section>;
    })}
    {!readOnly && onEditFacts && <p className="flh-mc-footnote">Price, size, garage spaces, layout and condition come from Home Facts. <button type="button" className="flh-hf-link" onClick={onEditFacts}>Correct Home Facts</button></p>}
  </div>;
}
