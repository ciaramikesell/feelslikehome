'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import Sheet from '@/components/Sheet';
import { applyHomeFactSuggestion, pendingOfferedFacts } from '@/lib/listingTextHomeFacts';

// The shared Home Facts checklist from pasted listing text (Add Home V3): one
// row per fact (field and value, the listing's sentence on demand, the school
// attribution) and one Add N facts. Used by Add Home's review (HomeModal's
// HomeFactReview) and by the later review of facts offered but not added
// (OfferedFactsSheet, opened from Home Facts), so the checklist exists once.
// Nothing here writes: callers decide what Add does.

export function FactChecklistRows({ suggestions, isSelected, onToggle, note = () => null, evidenceSource = 'From the listing text you pasted' }) {
  return <ul className="flh-fact-checklist-rows">{suggestions.map((suggestion) => {
    const selected = isSelected(suggestion);
    return <li key={suggestion.id} className={selected ? 'is-selected' : ''}>
      <label className="flh-fact-check">
        <input type="checkbox" checked={selected} onChange={() => onToggle(suggestion)} />
        <span className="flh-fact-check-text"><b>{suggestion.label}</b><span className="flh-fact-check-value">{suggestion.display || String(suggestion.value)}</span></span>
      </label>
      {suggestion.school && <small className="flh-fact-note">Named in the listing text. FLH hasn’t verified it or checked school boundaries.</small>}
      {note(suggestion)}
      {suggestion.evidence && <details className="flh-fact-why"><summary>Why?</summary><blockquote><span>“{suggestion.evidence}”</span><cite>{evidenceSource}</cite></blockquote></details>}
    </li>;
  })}</ul>;
}

export function AddFactsButton({ chosen, onAdd }) {
  return <button type="button" className="hh-btn flh-fact-add" onClick={() => onAdd(chosen)} disabled={!chosen.length}>
    {chosen.length ? <><Check size={15} aria-hidden="true" /> Add {chosen.length} fact{chosen.length === 1 ? '' : 's'}</> : 'Check a fact to add it'}
  </button>;
}

/**
 * The later review: facts the pasted listing offered when this home was added
 * that nobody added yet (homes.listing_import.offeredFacts), in a sheet. Every
 * row starts unchecked (the buyer already passed on them once). Add writes the
 * checked ones through `onAdd(patch)` — the ordinary Home Facts save — and only
 * into fields still empty, with values that still fit the home. A field filled
 * since drops off the list; nothing is ever overwritten.
 */
export function OfferedFactsSheet({ home, open, onClose, onAdd }) {
  const offered = pendingOfferedFacts(home);
  const [chosen, setChosen] = useState({});
  const selected = offered.filter((item) => chosen[item.id]);
  const add = (items) => {
    const patch = {};
    let next = home;
    for (const item of items) {
      const after = applyHomeFactSuggestion(next, item);
      if (after !== next) { patch[item.field] = item.value; next = after; }
    }
    if (Object.keys(patch).length) onAdd(patch);
    setChosen({});
    onClose();
  };
  return <Sheet open={open && offered.length > 0} onClose={onClose} title="From the listing" size="default" className="flh-offered-sheet">
    <p className="flh-offered-intro">These were in the listing text pasted when this home was added. Check any that are right to add them to Home Facts for everyone in this search. The rest stay Unknown.</p>
    <FactChecklistRows suggestions={offered} isSelected={(item) => !!chosen[item.id]} onToggle={(item) => setChosen((value) => ({ ...value, [item.id]: !value[item.id] }))} evidenceSource="From the listing text pasted for this home" />
    <AddFactsButton chosen={selected} onAdd={add} />
  </Sheet>;
}
