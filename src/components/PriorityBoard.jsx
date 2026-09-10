'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { DEFAULT_SELECTED_TIER, TIER_DESCRIPTIONS, TIER_META, TIER_ORDER, criterionDisplayLabel, getItemlistCategories, effectiveTier, isSchoolsSuppressed, isExperientialCriterion } from '@/lib/constants';
import { selectPriorityItem, splitCategoryItems } from '@/lib/matching';
import SchoolsRelevanceGate from '@/components/SchoolsRelevanceGate';

// The selected board has one canonical appearance. Adding reveals discovery
// controls beneath it; it never swaps the board for a configuration surface.
// Tier changes use the existing category tier map, with no within-tier order.
export default function PriorityBoard({ priorities, patch, onboarding = false }) {
  const categories = getItemlistCategories(priorities.searchType);
  const [addOpen, setAddOpen] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const [dragged, setDragged] = useState(null);
  const [dropTier, setDropTier] = useState(null);
  const [newItem, setNewItem] = useState('');
  const [newItemCategory, setNewItemCategory] = useState(categories[0]?.key || '');
  const schoolsSuppressed = isSchoolsSuppressed(priorities);
  const choicesOpen = onboarding || addOpen;

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
    addCustomItem(newItemCategory, { label, kind: def?.defaultCustomKind || 'check' });
    setNewItem('');
  };
  const setSchoolsNote = (note) => patch((next) => {
    next.location = { ...next.location, notes: { ...next.location?.notes, Schools: note } };
    return next;
  });

  return (
    <div>
      {selected.length || choicesOpen ? (
        <>
          {hasExperiential && <div className="hh-priority-legend"><span aria-hidden="true">*</span> Best answered after you tour</div>}
          <div className="hh-priority-tiers" aria-label="Selected preferences by importance">
            {buckets.map(({ tier, items }) => (
              <section
                key={tier}
                className={`hh-tier-group hh-tier-${tier} ${dropTier === tier ? 'is-drop-target' : ''}`}
                onDragOver={(event) => { event.preventDefault(); setDropTier(tier); }}
                onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget) && setDropTier(null)}
                onDrop={(event) => { event.preventDefault(); dropIntoTier(tier); }}
              >
                <div className="hh-tier-heading" style={{ color: TIER_META[tier].color }}>{TIER_META[tier].label}</div>
                {onboarding && <p className="hh-tier-description">{TIER_DESCRIPTIONS[tier]}</p>}
                <div className="hh-selected-priorities">
                  {items.map((item) => {
                    const key = `${item.categoryKey}:${item.label}`;
                    const open = activeItem === key;
                    return (
                      <div key={key} className="hh-selected-priority-wrap">
                        <button
                          type="button"
                          className="hh-selected-priority"
                          draggable
                          aria-expanded={open}
                          aria-label={`${criterionDisplayLabel(item.categoryKey, item.label)}. Open priority actions`}
                          onClick={() => setActiveItem(open ? null : key)}
                          onDragStart={(event) => {
                            setDragged({ type: 'selected', item });
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', key);
                          }}
                          onDragEnd={() => { setDragged(null); setDropTier(null); }}
                        >
                          <span>{criterionDisplayLabel(item.categoryKey, item.label)}</span>
                          {isExperientialCriterion(item.categoryKey, item.label) && <sup className="hh-experiential-marker" title="Best answered after you tour" aria-label="Best answered after you tour">*</sup>}
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
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : <p className="hh-priority-empty">Nothing selected yet — add what matters to you anytime.</p>}

      {!onboarding && (
        <button type="button" className="hh-btn hh-btn-ghost hh-add-priority-toggle" aria-expanded={addOpen} onClick={() => setAddOpen((open) => !open)}>
          {addOpen ? 'Close choices' : selected.length ? '+ Add another priority' : '+ Add a priority'}
        </button>
      )}

      {choicesOpen && (
        <div className="hh-add-priority-panel">
          {!onboarding && <div className="hh-schools-gate"><SchoolsRelevanceGate priorities={priorities} patch={patch} /></div>}
          <p className="hh-add-priority-help">{onboarding
            ? 'Drag a preference into the column that matches how much it matters to you. You can move it later if you change your mind. You can also click a preference to add it.'
            : 'Drag any preference below into Must Have, Important, or Nice to Have. You can also drag your existing priorities between columns to change how much they matter.'}</p>
          <div className="hh-suggestion-grid">
            {pools.map(({ def, core, custom, suggestions }) => {
              const unselected = [...core, ...custom].filter((item) => tierOf(def, item.label) === 'dontcare');
              const customLabels = new Set(custom.map((item) => item.label));
              // The add tray is already progressive disclosure. Keep every catalog
              // suggestion directly discoverable without changing its stored label.
              const catalogSuggestions = [...suggestions, ...(def.specificItems || [])]
                .filter((item) => !customLabels.has(item.label));
              const tray = [...unselected, ...catalogSuggestions]
                .filter((item, index, items) => tierOf(def, item.label) === 'dontcare' && items.findIndex((candidate) => candidate.label === item.label) === index);
              return (
                <section key={def.key}>
                  <h4 className="hh-suggestion-heading">{def.title}</h4>
                  <div className="hh-suggestion-tray">
                    {tray.map((item) => <button key={item.label} type="button" draggable className="hh-chip" onClick={() => selectItem(def, item)} onDragStart={(event) => { setDragged({ type: 'available', def, item }); event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain', `${def.key}:${item.label}`); }} onDragEnd={() => { setDragged(null); setDropTier(null); }}>{criterionDisplayLabel(def.key, item.label)}</button>)}
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
