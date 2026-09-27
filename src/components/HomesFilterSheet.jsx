'use client';

import { useEffect, useState } from 'react';
import Sheet from '@/components/Sheet';
import { ChoiceChip } from '@/components/MobileSystem';
import { EMPTY_FILTERS, MATCH_THRESHOLDS, SORT_OPTIONS, activeFilterCount, normalizeFilters, showMatchingLabel } from '@/lib/homesCollection';

// Sort & filter for My Homes' saved contenders. Edits a draft; nothing changes the
// collection until the apply button, whose count is computed from the real homes
// with the draft applied (countFor). Closing without applying discards the draft.
export default function HomesFilterSheet({ open, onClose, filters, sortBy, onApply, countFor, counts, vocabulary }) {
  const [draft, setDraft] = useState(() => normalizeFilters(filters));
  const [draftSort, setDraftSort] = useState(sortBy);
  useEffect(() => {
    if (open) { setDraft(normalizeFilters(filters)); setDraftSort(sortBy); }
  }, [open, filters, sortBy]);

  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const matching = countFor(draft);
  const active = activeFilterCount(draft) > 0;

  return (
    <Sheet open={open} onClose={onClose} title={`Filter My ${vocabulary.plural}`} size="large" className="flh-filter-sheet">
      {active && <button type="button" className="flh-text-action flh-filter-clear" onClick={() => setDraft({ ...EMPTY_FILTERS })}>Clear</button>}

      <section className="flh-filter-section" aria-labelledby="filter-sort">
        <h3 id="filter-sort" className="flh-section-kicker">Sort by</h3>
        <div className="flh-chip-row" role="radiogroup" aria-labelledby="filter-sort">
          {SORT_OPTIONS.map((option) => (
            <button type="button" role="radio" key={option.key} aria-checked={draftSort === option.key} className={`flh-choice-chip ${draftSort === option.key ? 'is-selected' : ''}`} onClick={() => setDraftSort(option.key)}>{option.label}</button>
          ))}
        </div>
      </section>

      <section className="flh-filter-section" aria-labelledby="filter-match">
        <h3 id="filter-match" className="flh-section-kicker">Minimum Match</h3>
        <div className="flh-segmented" role="radiogroup" aria-labelledby="filter-match">
          <button type="button" role="radio" aria-checked={draft.minMatch == null} className={draft.minMatch == null ? 'is-selected' : ''} onClick={() => set({ minMatch: null })}>Any</button>
          {MATCH_THRESHOLDS.map((threshold) => (
            <button type="button" role="radio" key={threshold} aria-checked={draft.minMatch === threshold} className={draft.minMatch === threshold ? 'is-selected' : ''} onClick={() => set({ minMatch: threshold })}>{threshold}%+ <span className="flh-filter-count">({counts.match90})</span></button>
          ))}
        </div>
      </section>

      <section className="flh-filter-section" aria-labelledby="filter-must">
        <h3 id="filter-must" className="flh-section-kicker">Must Haves</h3>
        <label className="flh-toggle-row">
          <span><strong>No Must-Haves missing</strong><small>Hides {vocabulary.pluralLower} with a confirmed Must Have miss. Unknown details never count as missing.</small></span>
          <input type="checkbox" role="switch" checked={draft.noMustMissing} onChange={(event) => set({ noMustMissing: event.target.checked })} />
        </label>
      </section>

      <section className="flh-filter-section" aria-labelledby="filter-lists">
        <h3 id="filter-lists" className="flh-section-kicker">Your lists</h3>
        <div className="flh-chip-row">
          <ChoiceChip selected={draft.favorites} onClick={() => set({ favorites: !draft.favorites })}>Favorites ({counts.favorites})</ChoiceChip>
          <ChoiceChip selected={draft.wantToTour} onClick={() => set({ wantToTour: !draft.wantToTour })}>Want to Tour ({counts.wantToTour})</ChoiceChip>
        </div>
      </section>

      <div className="flh-filter-apply">
        <button type="button" className="flh-button flh-button-primary flh-button-block" onClick={() => onApply({ filters: draft, sortBy: draftSort })}>{showMatchingLabel(matching, vocabulary)}</button>
      </div>
    </Sheet>
  );
}
