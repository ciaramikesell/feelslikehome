'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { TIER_META, DEFAULT_SELECTED_TIER, TIER_ORDER, criterionDisplayLabel, getItemlistCategories, effectiveTier, isSchoolsSuppressed } from '@/lib/constants';
import { selectPriorityItem, splitCategoryItems } from '@/lib/matching';
import { TierPicker } from '@/components/ui';

// Phase 1 — My Search Priority Board. Importance is now the primary
// organizing lens for SELECTED criteria (pooled across every category), per
// the beta finding that category-first organization made sense early on but
// importance is what actually helps someone decide. The old per-category
// drag-to-reorder system is intentionally not carried over here — once
// importance is the primary hierarchy, order-within-a-tier no longer serves
// the purpose it used to, and removing it also removes mobile's biggest
// accessibility gap (drag-only interaction). Every action here is tap/click;
// there is no drag anywhere in this component.
//
// The suggestion BANK (for items not yet selected) still groups by the old
// category taxonomy — Home / Property / Location / Space & Layout / How It
// Feels — since that grouping is genuinely useful for *discovering* new
// criteria, even though it's no longer how *selected* criteria are shown.
export default function PriorityBoard({ priorities, patch }) {
  const categories = getItemlistCategories(priorities.searchType);
  const [newItem, setNewItem] = useState('');
  const [newItemCategory, setNewItemCategory] = useState(categories[0]?.key || '');
  const schoolsSuppressed = isSchoolsSuppressed(priorities);

  // Pool every category's known+custom items, tagging each with which
  // category it actually lives in (needed since `patch` still writes into
  // one category's slice of priorities at a time). Schools is excluded
  // entirely (not just tier-overridden) while relevance is suppressed — the
  // Yes/No gate is the only place to turn it back on, so leaving it
  // selectable here (even if it wouldn't count toward Match) would be a
  // confusing "you can pick it but it does nothing" state. The underlying
  // stored tier/note are never touched by this filter — see effectiveTier.
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

  const selectedPooled = pools.flatMap(({ def, core, custom }) =>
    [...core, ...custom]
      .filter((item) => tierOf(def, item.label) !== 'dontcare')
      .map((item) => ({ ...item, categoryKey: def.key, tier: tierOf(def, item.label) }))
  );

  const buckets = TIER_ORDER.filter((t) => t !== 'dontcare').map((tier) => ({
    tier, items: selectedPooled.filter((i) => i.tier === tier),
  })).filter((b) => b.items.length > 0);

  const setTier = (categoryKey, label, tier) => patch((n) => {
    n[categoryKey] = { ...n[categoryKey], tiers: { ...n[categoryKey].tiers, [label]: tier } };
    return n;
  });

  const selectItem = (def, item) => patch((n) => {
    n[def.key] = selectPriorityItem(n[def.key], def, item, DEFAULT_SELECTED_TIER);
    return n;
  });

  const addCustomItem = (categoryKey, item) => patch((n) => {
    n[categoryKey] = {
      ...n[categoryKey],
      customItems: [...(n[categoryKey].customItems || []), item],
      tiers: { ...n[categoryKey].tiers, [item.label]: DEFAULT_SELECTED_TIER },
    };
    return n;
  });

  const removeItem = (categoryKey, label) => setTier(categoryKey, label, 'dontcare');

  const addTyped = () => {
    const label = newItem.trim();
    if (!label || !newItemCategory) return;
    const def = categories.find((c) => c.key === newItemCategory);
    addCustomItem(newItemCategory, { label, kind: def?.defaultCustomKind || 'check' });
    setNewItem('');
  };

  const setSchoolsNote = (note) => patch((n) => {
    n.location = { ...n.location, notes: { ...n.location?.notes, Schools: note } };
    return n;
  });

  return (
    <div>
      {/* Selected criteria, grouped by importance — the primary board. */}
      {buckets.length > 0 ? (
        <div style={{ display: 'grid', gap: 18, marginBottom: 22 }}>
          {buckets.map(({ tier, items }) => (
            <div key={tier}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: TIER_META[tier].color, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                {TIER_META[tier].label}
              </div>
              <div style={{ display: 'grid', gap: 2 }}>
                {items.map((item) => (
                  <div key={`${item.categoryKey}:${item.label}`} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>{criterionDisplayLabel(item.categoryKey, item.label)}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <TierPicker value={item.tier} onChange={(tier) => setTier(item.categoryKey, item.label, tier)} />
                        <button type="button" onClick={() => removeItem(item.categoryKey, item.label)} aria-label={`Remove ${criterionDisplayLabel(item.categoryKey, item.label)}`} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', padding: 4, display: 'flex' }}>
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                    {item.kind === 'rating' && (
                      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 3 }}>We&apos;ll ask after you tour.</div>
                    )}
                    {/* Schools gets one, narrowly-scoped exception: a personal preference
                        note, since "matters to me" alone doesn't say WHAT matters. This is
                        deliberately not a generic pattern — only Schools currently needs it. */}
                    {item.categoryKey === 'location' && item.label === 'Schools' && (
                      <input
                        className="hh-input"
                        placeholder="e.g. Adams High School, Rochester Community Schools, or a school zone"
                        value={priorities.location?.notes?.Schools || ''}
                        onChange={(e) => setSchoolsNote(e.target.value)}
                        style={{ fontSize: 12.5, marginTop: 6, width: '100%' }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', fontStyle: 'italic', marginBottom: 18 }}>Nothing selected yet — tap anything below that matters to you.</p>
      )}

      {/* Suggestion bank — grouped by category for discovery, tap to add. */}
      <div style={{ display: 'grid', gap: 16 }}>
        {pools.map(({ def, core, custom, suggestions }) => {
          const known = [...core, ...custom];
          const unselectedKnown = known.filter((item) => tierOf(def, item.label) === 'dontcare');
          const customLabels = new Set(custom.map((i) => i.label));
          const traySuggestions = suggestions.filter((item) => !customLabels.has(item.label));
          const tray = [...unselectedKnown, ...traySuggestions];
          if (!tray.length) return null;
          return (
            <div key={def.key}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 8 }}>
                {def.title}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tray.map((item) => (
                  <button key={item.label} type="button" className="hh-chip" aria-pressed="false" onClick={() => selectItem(def, item)}>
                    {criterionDisplayLabel(def.key, item.label)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
        <select className="hh-input" value={newItemCategory} onChange={(e) => setNewItemCategory(e.target.value)} style={{ flex: '0 0 auto', minWidth: 140 }}>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}
        </select>
        <input
          className="hh-input" placeholder="Add your own..." value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTyped())}
          style={{ flex: '1 1 160px' }}
        />
        <button type="button" className="hh-btn hh-btn-ghost" onClick={addTyped}><Plus size={14} /></button>
      </div>
    </div>
  );
}
