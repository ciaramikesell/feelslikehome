'use client';

import { useEffect, useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Check, Clock, Footprints, Heart, History, Info, ListChecks, Sparkles, TrendingDown } from 'lucide-react';
import Sheet from '@/components/Sheet';
import { EMPTY_FILTERS, MATCH_THRESHOLDS, SORT_OPTIONS, activeFilterCount, normalizeFilters, showMatchingLabel } from '@/lib/homesCollection';

// Presentation only: an icon per existing sort mode. The modes themselves (and
// their order) come from SORT_OPTIONS.
const SORT_ICONS = { matchDesc: Sparkles, newest: Clock, oldest: History, priceAsc: ArrowUpNarrowWide, priceDesc: ArrowDownWideNarrow, matchAsc: TrendingDown };

function ToggleRow({ icon: Icon, title, body, checked, onChange }) {
  return (
    <label className="flh-toggle-row">
      {Icon && <span className="flh-toggle-icon" aria-hidden="true"><Icon size={16} strokeWidth={1.9} /></span>}
      <span className="flh-toggle-copy"><strong>{title}</strong><small>{body}</small></span>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

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
        <div className="flh-select-grid flh-sort-grid" role="radiogroup" aria-labelledby="filter-sort">
          {SORT_OPTIONS.map((option) => {
            const Icon = SORT_ICONS[option.key];
            const selected = draftSort === option.key;
            return (
              <button type="button" role="radio" key={option.key} aria-checked={selected} className={`flh-select-card ${selected ? 'is-selected' : ''}`} onClick={() => setDraftSort(option.key)}>
                {Icon && <Icon size={18} strokeWidth={1.9} aria-hidden="true" />}
                <span>{option.label}</span>
                {selected && <span className="flh-select-card-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flh-filter-section" aria-labelledby="filter-match">
        <h3 id="filter-match" className="flh-section-kicker">Minimum Match</h3>
        <div className="flh-segmented flh-segmented-accent flh-segmented-block" role="radiogroup" aria-labelledby="filter-match">
          <button type="button" role="radio" aria-checked={draft.minMatch == null} className={draft.minMatch == null ? 'is-selected' : ''} onClick={() => set({ minMatch: null })}>Any</button>
          {MATCH_THRESHOLDS.map((threshold) => (
            <button type="button" role="radio" key={threshold} aria-checked={draft.minMatch === threshold} className={draft.minMatch === threshold ? 'is-selected' : ''} onClick={() => set({ minMatch: threshold })}>{threshold}%+ <span className="flh-filter-count">({counts.match90})</span></button>
          ))}
        </div>
      </section>

      <section className="flh-filter-section" aria-labelledby="filter-must">
        <h3 id="filter-must" className="flh-section-kicker">Must Haves</h3>
        <ToggleRow icon={ListChecks} title="No Must-Haves missing" body={`Hides ${vocabulary.pluralLower} with a confirmed Must Have miss. Unknown details never count as missing.`} checked={draft.noMustMissing} onChange={(value) => set({ noMustMissing: value })} />
      </section>

      <section className="flh-filter-section" aria-labelledby="filter-lists">
        <h3 id="filter-lists" className="flh-section-kicker">Your lists</h3>
        <div className="flh-toggle-list">
          <ToggleRow icon={Heart} title={`Favorites (${counts.favorites})`} body={`Only ${vocabulary.pluralLower} you’ve favorited`} checked={draft.favorites} onChange={(value) => set({ favorites: value })} />
          <ToggleRow icon={Footprints} title={`Want to Tour (${counts.wantToTour})`} body={`Only ${vocabulary.pluralLower} you want to see in person`} checked={draft.wantToTour} onChange={(value) => set({ wantToTour: value })} />
        </div>
      </section>

      <p className="flh-filter-note"><Info size={14} aria-hidden="true" /> Filters only narrow the {vocabulary.pluralLower} you’ve saved, using your own Match. Nothing is removed.</p>

      <div className="flh-filter-apply">
        <button type="button" className="flh-button flh-button-primary flh-button-block" onClick={() => onApply({ filters: draft, sortBy: draftSort })}>{showMatchingLabel(matching, vocabulary)}</button>
      </div>
    </Sheet>
  );
}
