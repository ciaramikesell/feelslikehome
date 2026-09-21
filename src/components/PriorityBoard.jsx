'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { DEFAULT_SELECTED_TIER, TIER_DESCRIPTIONS, TIER_META, TIER_ORDER, criterionDisplayLabel, criterionCompactLabel, hasQualifierOptions, getItemlistCategories, effectiveTier, isSchoolsSuppressed, isExperientialCriterion, isCriterionApplicable, isRetiredPurchaseBuiltIn } from '@/lib/constants';

// Presentation-only weight callout for My Search's desktop tier heading
// ("Must have (highest weight)") — TIER_META.weight itself (4/2/1) is the
// canonical value Match actually uses and is untouched by this label.
const TIER_WEIGHT_LABEL = { must: 'Highest weight', important: 'Medium weight', nice: 'Lowest weight' };
import { selectPriorityItem, splitCategoryItems } from '@/lib/matching';
import Sheet from '@/components/Sheet';
import QualifierPicker from '@/components/QualifierPicker';
import Coachmark, { useCoachmark } from '@/components/Coachmark';

const DRAG_COACHMARK_KEY = 'flh-my-search-drag-coachmark-dismissed';

// The list of one tier's selected priorities — tap a priority to reveal
// "Move to X" / "Remove" actions (already the real interaction; drag is a
// bonus for a mouse, not a requirement). Shared verbatim between the desktop
// column layout and the mobile per-tier Sheet below so the two never drift.
function TierItemsList({ tier, items, activeItem, setActiveItem, setTier, priorities, patch, setSchoolsNote, onItemDragStart, onItemDragEnd, cueKey }) {
  return (
    <div className="hh-selected-priorities">
      {items.map((item) => {
        const key = `${item.categoryKey}:${item.label}`;
        const open = activeItem === key;
        return (
          <div key={key} className="hh-selected-priority-wrap">
            <button
              type="button"
              className={`hh-selected-priority ${key === cueKey ? 'hh-drag-hint-cue' : ''}`}
              draggable
              aria-expanded={open}
              aria-label={`${criterionDisplayLabel(item.categoryKey, item.label)}. Open priority actions`}
              onClick={() => setActiveItem(open ? null : key)}
              onDragStart={(event) => {
                onItemDragStart(item);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', key);
              }}
              onDragEnd={onItemDragEnd}
            >
              <span>{criterionCompactLabel(item.categoryKey, item.label, priorities)}</span>
              {isRetiredPurchaseBuiltIn(item.categoryKey, item, priorities.searchType) && <sup className="hh-legacy-priority" title="Saved legacy priority; no longer included in pre-tour Match">Legacy</sup>}
              {isExperientialCriterion(item.categoryKey, item.label) && <sup className="hh-experiential-marker" title="You'll evaluate this after touring the home" aria-label="After tour">◷</sup>}
              <small className="hh-priority-change">Change</small>
            </button>
            {open && (
              <div className="hh-priority-context" role="group" aria-label={`Actions for ${criterionDisplayLabel(item.categoryKey, item.label)}`}>
                {TIER_ORDER.filter((target) => target !== 'dontcare').map((target) => (
                  <button type="button" key={target} disabled={target === tier} aria-current={target === tier ? 'true' : undefined} onClick={() => { setTier(item.categoryKey, item.label, target); setActiveItem(null); }}>Move to {TIER_META[target].label}</button>
                ))}
                <button type="button" onClick={() => { setTier(item.categoryKey, item.label, 'dontcare'); setActiveItem(null); }}>Remove priority</button>
                {item.categoryKey === 'location' && item.label === 'Schools' && (
                  <label>School preference<input className="hh-input" value={priorities.location?.notes?.Schools || ''} onChange={(event) => setSchoolsNote(event.target.value)} placeholder="School, district, or rating" /></label>
                )}
                {hasQualifierOptions(item.categoryKey, item.label) && (
                  <QualifierPicker categoryKey={item.categoryKey} label={item.label} displayLabel={criterionDisplayLabel(item.categoryKey, item.label)} priorities={priorities} patch={patch} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// The selected board has one canonical appearance. Adding reveals discovery
// controls beneath it; it never swaps the board for a configuration surface.
// Tier changes use the existing category tier map, with no within-tier order.
export default function PriorityBoard({ priorities, patch, onboarding = false, catalogOpen, onCatalogOpenChange, firstRun = false }) {
  const categories = getItemlistCategories(priorities.searchType);
  // One-time drag teaching moment for the first appropriate arrival after
  // onboarding (see MySearchPanel's `firstRun`, itself gated on the ?welcome=1
  // handoff) — never onboarding itself, which has no drag board at all.
  const [dragCoachmarkOpen, dismissDragCoachmark] = useCoachmark(DRAG_COACHMARK_KEY, !onboarding && firstRun);
  const [localAddOpen, setLocalAddOpen] = useState(false);
  const addOpen = catalogOpen ?? localAddOpen;
  const setAddOpen = onCatalogOpenChange ?? setLocalAddOpen;
  const [activeItem, setActiveItem] = useState(null);
  const [dragged, setDragged] = useState(null);
  const [dropTier, setDropTier] = useState(null);
  const [newItem, setNewItem] = useState('');
  const [newItemCategory, setNewItemCategory] = useState(categories[0]?.key || '');
  const schoolsSuppressed = isSchoolsSuppressed(priorities);
  const choicesOpen = onboarding || addOpen;

  // My Search only, never onboarding — stacking three fully-expanded tier
  // columns is fine on desktop but reads as one long drag-heavy page on a
  // phone. Below the phone boundary each tier collapses to a one-line
  // summary (name + count); tapping it opens that tier's existing item list
  // — the same TierItemsList, same tap-to-move/remove actions — in a Sheet.
  // Checked once via matchMedia after mount, same one-time-viewport-check
  // pattern used elsewhere in this app (e.g. AppShell's mobile tour gating),
  // so desktop's markup/behavior at first paint is completely unaffected.
  const [mobileCompact, setMobileCompact] = useState(false);
  const [openTierSheet, setOpenTierSheet] = useState(null);
  useEffect(() => {
    if (onboarding) return;
    const mq = window.matchMedia('(max-width: 700px)');
    const sync = () => setMobileCompact(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [onboarding]);

  const isSchoolsItem = (def, item) => def.key === 'location' && item.label === 'Schools';
  const pools = categories.map((def) => {
    const split = splitCategoryItems(def, priorities);
    if (!schoolsSuppressed) return { def, ...split };
    return {
      def,
      catState: split.catState,
      core: split.core.filter((item) => !isSchoolsItem(def, item)),
      custom: split.custom.filter((item) => !isSchoolsItem(def, item)),
      suggestions: split.suggestions.filter((item) => !isSchoolsItem(def, item)),
    };
  });
  const tierOf = (def, label) => effectiveTier(def.key, label, priorities, priorities[def.key]?.tiers?.[label]);
  const selected = pools.flatMap(({ def, core, custom }) => [...core, ...custom]
    .filter((item) => tierOf(def, item.label) !== 'dontcare')
    .map((item) => ({ ...item, categoryKey: def.key, tier: tierOf(def, item.label) })));
  const buckets = TIER_ORDER.filter((tier) => tier !== 'dontcare').map((tier) => ({
    tier,
    items: selected.filter((item) => item.tier === tier),
  }));
  const hasExperiential = selected.some((item) => isExperientialCriterion(item.categoryKey, item.label));

  const setTier = (categoryKey, label, tier) => patch((next) => {
    next[categoryKey] = { ...next[categoryKey], tiers: { ...next[categoryKey].tiers, [label]: tier } };
    return next;
  });
  const selectItem = (def, item, tier = DEFAULT_SELECTED_TIER) => patch((next) => {
    next[def.key] = selectPriorityItem(next[def.key], def, item, tier);
    return next;
  });
  const addCustomItem = (categoryKey, item, tier = DEFAULT_SELECTED_TIER) => patch((next) => {
    next[categoryKey] = {
      ...next[categoryKey],
      customItems: [...(next[categoryKey].customItems || []), item],
      tiers: { ...next[categoryKey].tiers, [item.label]: tier },
    };
    return next;
  });
  const dropIntoTier = (tier) => {
    if (dragged?.type === 'selected' && dragged.item.tier !== tier) {
      setTier(dragged.item.categoryKey, dragged.item.label, tier);
    } else if (dragged?.type === 'available') {
      selectItem(dragged.def, dragged.item, tier);
    }
    setDragged(null);
    setDropTier(null);
  };
  const addTyped = () => {
    const label = newItem.trim();
    if (!label || !newItemCategory) return;
    const def = categories.find((category) => category.key === newItemCategory);
    // A typed label matching an existing canonical/custom item in the chosen
    // category (case-insensitive) selects that item instead of creating a
    // visibly duplicate custom priority alongside it.
    const normalized = label.toLowerCase();
    const pool = pools.find((candidate) => candidate.def.key === newItemCategory);
    const existing = pool && [...pool.core, ...pool.custom, ...pool.suggestions].find((item) => item.label.toLowerCase() === normalized);
    if (existing) selectItem(def, existing);
    else addCustomItem(newItemCategory, { label, kind: def?.defaultCustomKind || 'check', source: 'custom' });
    setNewItem('');
  };
  const setSchoolsNote = (note) => patch((next) => {
    next.location = { ...next.location, notes: { ...next.location?.notes, Schools: note } };
    return next;
  });

  // A very subtle, one-time "this moves" cue on the first priority the user
  // will actually see — desktop only (mobile's compact summary rows have no
  // individual chip to attach it to until a tier Sheet is opened), and only
  // while the coachmark itself is still showing, so it never plays on repeat
  // visits. Respects prefers-reduced-motion entirely in CSS (see .hh-drag-hint-cue).
  const firstSelected = buckets.flatMap((bucket) => bucket.items)[0];
  const cueKey = dragCoachmarkOpen && !mobileCompact && firstSelected ? `${firstSelected.categoryKey}:${firstSelected.label}` : null;

  const tierItemsProps = { activeItem, setActiveItem, setTier, priorities, patch, setSchoolsNote, cueKey };

  return (
    <div>
      {dragCoachmarkOpen && (
        <Coachmark
          className="hh-drag-coachmark"
          heading="Now rank what matters most"
          body="We started everything you chose as Important. Drag your priorities between Must Have, Important, and Nice to Have to tell Feels Like Home how much each one matters."
          onDismiss={dismissDragCoachmark}
        />
      )}
      {!onboarding && (
        <div className="hh-priority-board-intro">
          <h4 className="hh-priority-board-heading">Rank what matters to you</h4>
          <p className="hh-priority-board-instruction">Drag any priority to move it between the three columns.</p>
        </div>
      )}
      {selected.length || choicesOpen ? (
        <>
          {hasExperiential && <div className="hh-priority-legend"><span aria-hidden="true">◷</span> After tour</div>}
          {mobileCompact ? (
            <div className="hh-tier-summary-list" aria-label="Selected preferences by importance">
              {buckets.map(({ tier, items }) => (
                <button
                  type="button"
                  key={tier}
                  className="hh-tier-summary-row"
                  onClick={() => setOpenTierSheet(tier)}
                >
                  <span className="hh-tier-summary-name" style={{ color: TIER_META[tier].color }}>{TIER_META[tier].label}</span>
                  <span className="hh-tier-summary-count">{items.length} {items.length === 1 ? 'priority' : 'priorities'}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <div className="hh-priority-tiers" aria-label="Selected preferences by importance">
              {buckets.map(({ tier, items }) => (
                <section
                  key={tier}
                  className={`hh-tier-group hh-tier-${tier} ${dropTier === tier ? 'is-drop-target' : ''}`}
                  onDragOver={(event) => { event.preventDefault(); setDropTier(tier); }}
                  onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget) && setDropTier(null)}
                  onDrop={(event) => { event.preventDefault(); dropIntoTier(tier); }}
                >
                  <div className="hh-tier-heading" style={{ color: TIER_META[tier].color }}>
                    {TIER_META[tier].label} <span className="hh-tier-weight">({TIER_WEIGHT_LABEL[tier]})</span>
                  </div>
                  {!onboarding && <div className="hh-tier-count">{items.length} {items.length === 1 ? 'priority' : 'priorities'} active</div>}
                  {onboarding && <p className="hh-tier-description">{TIER_DESCRIPTIONS[tier]}</p>}
                  <TierItemsList
                    tier={tier}
                    items={items}
                    {...tierItemsProps}
                    onItemDragStart={(item) => setDragged({ type: 'selected', item })}
                    onItemDragEnd={() => { setDragged(null); setDropTier(null); }}
                  />
                </section>
              ))}
            </div>
          )}
        </>
      ) : <p className="hh-priority-empty">Nothing selected yet — add what matters to you anytime.</p>}

      {mobileCompact && openTierSheet && (() => {
        const bucket = buckets.find((b) => b.tier === openTierSheet);
        return (
          <Sheet
            open
            onClose={() => { setOpenTierSheet(null); setActiveItem(null); }}
            title={TIER_META[openTierSheet].label}
            size="default"
          >
            <p className="hh-tier-description" style={{ marginBottom: 12 }}>{TIER_DESCRIPTIONS[openTierSheet]}</p>
            {bucket.items.length ? (
              <TierItemsList tier={openTierSheet} items={bucket.items} {...tierItemsProps} onItemDragStart={() => {}} onItemDragEnd={() => {}} />
            ) : (
              <p className="hh-priority-empty">Nothing in {TIER_META[openTierSheet].label.toLowerCase()} yet.</p>
            )}
          </Sheet>
        );
      })()}

      {!onboarding && (
        <button type="button" className="hh-btn hh-btn-ghost hh-add-priority-toggle" aria-expanded={addOpen} onClick={() => setAddOpen((open) => !open)}>
          {addOpen ? 'Close choices' : selected.length ? '+ Add another priority' : '+ Add a priority'}
        </button>
      )}

      {choicesOpen && (
        <div className="hh-add-priority-panel">
          <p className="hh-add-priority-help">{onboarding
            ? 'Drag a preference into the column that matches how much it matters to you. You can move it later if you change your mind. You can also click a preference to add it.'
            : 'Drag a preference below into a column to add it to your priorities.'}</p>
          <div className="hh-suggestion-grid">
            {pools.map(({ def, core, custom, suggestions }) => {
              const unselected = [...core, ...custom].filter((item) => tierOf(def, item.label) === 'dontcare');
              const customLabels = new Set(custom.map((item) => item.label));
              // The add tray is already progressive disclosure. Keep every catalog
              // suggestion directly discoverable without changing its stored label.
              const catalogSuggestions = [...suggestions, ...(def.specificItems || [])]
                .filter((item) => !customLabels.has(item.label));
              const propertyTypes = priorities.preferredPropertyTypes?.values || [];
              const tray = [...unselected, ...catalogSuggestions]
                .filter((item) => isCriterionApplicable(def.key, item.label, propertyTypes))
                .filter((item) => !isRetiredPurchaseBuiltIn(def.key, item, priorities.searchType))
                .filter((item, index, items) => tierOf(def, item.label) === 'dontcare' && items.findIndex((candidate) => candidate.label === item.label) === index);
              return (
                <section key={def.key}>
                  <h4 className="hh-suggestion-heading">{def.title}</h4>
                  <div className="hh-suggestion-tray">
                    {tray.flatMap((item) => {
                      const chip = <button key={item.label} type="button" draggable className="hh-chip" onClick={() => selectItem(def, item)} onDragStart={(event) => { setDragged({ type: 'available', def, item }); event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain', `${def.key}:${item.label}`); }} onDragEnd={() => { setDragged(null); setDropTier(null); }}>{criterionDisplayLabel(def.key, item.label)}{isExperientialCriterion(def.key, item.label) && <span className="hh-picker-tour-mark" aria-label="Evaluate after tour" title="You'll evaluate this after touring the home"> ◷</span>}</button>;
                      // A deliberate, deterministic line break (not brittle absolute
                      // positioning) so Pool — the start of the yard-amenity group —
                      // always begins its own visual row in the Exterior & Property
                      // tray, at any width, instead of wrapping wherever it happens
                      // to land after the longer parking/fencing labels above it.
                      return def.key === 'exterior' && item.label === 'Pool'
                        ? [<span key="pool-break" className="hh-suggestion-tray-break" aria-hidden="true" />, chip]
                        : [chip];
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="hh-custom-priority">
            <select className="hh-input" value={newItemCategory} onChange={(event) => setNewItemCategory(event.target.value)}>{categories.map((category) => <option key={category.key} value={category.key}>{category.title}</option>)}</select>
            <input className="hh-input" placeholder="Add your own..." value={newItem} onChange={(event) => setNewItem(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), addTyped())} />
            <button type="button" className="hh-btn hh-btn-ghost" onClick={addTyped} aria-label="Add custom priority"><Plus size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
