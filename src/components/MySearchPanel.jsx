'use client';

import { useState } from 'react';
import { Plus, X, GripVertical } from 'lucide-react';
import { TierPicker } from '@/components/ui';
import {
  MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, ITEMLIST_CATEGORIES, INVESTMENT_PROPERTY_TYPES,
  isSimpleRentalType, terminology, nextInvestmentTypes,
} from '@/lib/constants';
import { splitCategoryItems, applyOrder } from '@/lib/matching';
import { createClient } from '@/lib/supabase/client';
import { updateSearchPriorities } from '@/lib/supabase/data';

function ObjectiveRow({ label, value, onValueChange, tier, onTierChange, placeholder, prefix, suffix }) {
  return (
    <div className="hh-priority-row" style={{ alignItems: 'center' }}>
      <div style={{ flex: '1 1 220px' }}>
        <div className="hh-label" style={{ marginBottom: 4 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          {prefix && <span className="hh-mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{prefix}</span>}
          <input className="hh-mono hh-value-input" value={value} onChange={(e) => onValueChange(e.target.value)} placeholder={placeholder} />
          {suffix && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{suffix}</span>}
        </div>
      </div>
      <TierPicker value={tier} onChange={onTierChange} />
    </div>
  );
}

function MultiselectSection({ def, priorities, patch }) {
  const { key, title, options } = def;
  const catState = priorities[key] || { values: [], tier: 'dontcare' };
  const toggle = (opt) => patch((next) => { const cur = next[key].values; next[key] = { ...next[key], values: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] }; return next; });
  return (
    <section>
      <h3 className="hh-serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{title}</h3>
      <div className="hh-priority-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 220px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {options.map((o) => <span key={o} className={`hh-chip ${catState.values.includes(o) ? 'on' : ''}`} onClick={() => toggle(o)}>{o}</span>)}
        </div>
        <TierPicker value={catState.tier} onChange={(t) => patch((next) => { next[key] = { ...next[key], tier: t }; return next; })} />
      </div>
    </section>
  );
}

function BedroomPreferencesSection({ priorities, patch }) {
  return (
    <section>
      <h3 className="hh-serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Bedroom Preferences</h3>
      {SINGLESELECT_CATEGORIES.map((def) => {
        const catState = priorities[def.key] || { value: '', tier: 'dontcare' };
        return (
          <div className="hh-priority-row" key={def.key} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 220px' }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{def.title}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {def.options.map((o) => (
                  <span key={o} className={`hh-chip ${catState.value === o ? 'on' : ''}`} onClick={() => patch((next) => {
                    const wasSelected = next[def.key].value === o;
                    const newValue = wasSelected ? '' : o;
                    const newTier = !wasSelected && o === 'Either / No Preference' ? 'dontcare' : next[def.key].tier;
                    next[def.key] = { ...next[def.key], value: newValue, tier: newTier };
                    return next;
                  })}>{o}</span>
                ))}
              </div>
            </div>
            <TierPicker value={catState.tier} onChange={(t) => patch((next) => { next[def.key] = { ...next[def.key], tier: t }; return next; })} />
          </div>
        );
      })}
    </section>
  );
}

function ItemListSection({ def, priorities, patch }) {
  const { key, title, blurb, defaultCustomKind } = def;
  const { catState, core, suggestions, custom } = splitCategoryItems(def, priorities);
  const [newItem, setNewItem] = useState('');
  const [dragIndex, setDragIndex] = useState(null);
  const rows = applyOrder([...core, ...custom], catState.order || []);
  const isCoreLabel = (label) => def.coreItems.some((i) => i.label === label);

  const setTier = (label, tier) => patch((next) => { next[key] = { ...next[key], tiers: { ...next[key].tiers, [label]: tier } }; return next; });
  const addOrRestore = (item) => {
    if (isCoreLabel(item.label)) {
      patch((next) => { next[key] = { ...next[key], hiddenCore: (next[key].hiddenCore || []).filter((l) => l !== item.label) }; return next; });
    } else {
      patch((next) => { next[key] = { ...next[key], customItems: [...(next[key].customItems || []), item] }; return next; });
    }
  };
  const addTyped = () => { const label = newItem.trim(); if (!label) return; addOrRestore({ label, kind: defaultCustomKind }); setNewItem(''); };
  const deleteItem = (item) => {
    if (isCoreLabel(item.label)) {
      patch((next) => { next[key] = { ...next[key], hiddenCore: [...(next[key].hiddenCore || []), item.label] }; return next; });
    } else {
      patch((next) => { next[key] = { ...next[key], customItems: (next[key].customItems || []).filter((i) => i.label !== item.label), order: (next[key].order || []).filter((l) => l !== item.label) }; return next; });
    }
  };

  const reorder = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx == null) return;
    const next = [...rows];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    patch((p) => { p[key] = { ...p[key], order: next.map((r) => r.label) }; return p; });
  };

  return (
    <section>
      <h3 className="hh-serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{title}</h3>
      {blurb && <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 4px' }}>{blurb}</p>}
      {rows.map((item, idx) => (
        <div
          key={item.label}
          className={`hh-priority-row draggable ${dragIndex === idx ? 'dragging' : ''}`}
          draggable
          onDragStart={() => setDragIndex(idx)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); reorder(dragIndex, idx); setDragIndex(null); }}
          onDragEnd={() => setDragIndex(null)}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
            <GripVertical size={14} className="hh-drag-handle" style={{ flexShrink: 0 }} />
            {item.label} <span style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{item.kind === 'rating' ? '★ rated per home' : '✓ yes/no'}</span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <TierPicker value={catState.tiers?.[item.label] || 'dontcare'} onChange={(t) => setTier(item.label, t)} />
            <button type="button" className="hh-btn hh-btn-danger" style={{ padding: 5 }} onClick={() => deleteItem(item)} title={`Remove ${item.label}`} aria-label={`Remove ${item.label}`}>
              <X size={13} />
            </button>
          </div>
        </div>
      ))}
      {suggestions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 6 }}>Suggestions — tap to add:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map((item) => <button key={item.label} type="button" className="hh-suggest-chip" onClick={() => addOrRestore(item)}><Plus size={11} /> {item.label}</button>)}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <input className="hh-input" placeholder="Add your own..." value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTyped())} />
        <button type="button" className="hh-btn hh-btn-ghost" onClick={addTyped}><Plus size={14} /></button>
      </div>
    </section>
  );
}

export default function MySearchPanel({ searchId, initialPriorities }) {
  const [priorities, setPriorities] = useState(initialPriorities);

  const patch = (updater) => {
    setPriorities((prev) => {
      const next = updater({ ...prev });
      const supabase = createClient();
      updateSearchPriorities(supabase, searchId, next).catch((e) => console.error('Could not save priorities', e));
      return next;
    });
  };

  const p = priorities;

  return (
    <div style={{ display: 'grid', gap: 28, maxWidth: 760 }}>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>Tell us what matters and by how much. Set to &quot;Don&apos;t care&quot; and it won&apos;t be asked about when you add a home. Drag any criterion to change the order it appears in.</p>

      <section>
        <h3 className="hh-serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Budget &amp; Basics</h3>
        <ObjectiveRow label={terminology(p.searchType).budgetLabel} prefix="$" value={p.budget.value} onValueChange={(v) => patch((n) => { n.budget = { ...n.budget, value: v }; return n; })} tier={p.budget.tier} onTierChange={(t) => patch((n) => { n.budget = { ...n.budget, tier: t }; return n; })} placeholder={terminology(p.searchType).pricePlaceholder} />
        <ObjectiveRow label="Minimum Square Footage" suffix="sqft" value={p.sqftTarget.value} onValueChange={(v) => patch((n) => { n.sqftTarget = { ...n.sqftTarget, value: v }; return n; })} tier={p.sqftTarget.tier} onTierChange={(t) => patch((n) => { n.sqftTarget = { ...n.sqftTarget, tier: t }; return n; })} placeholder="1,800" />
        {!isSimpleRentalType(p.searchType) && <ObjectiveRow label="Minimum Lot Size" suffix="acres" value={p.lotSizeTarget.value} onValueChange={(v) => patch((n) => { n.lotSizeTarget = { ...n.lotSizeTarget, value: v }; return n; })} tier={p.lotSizeTarget.tier} onTierChange={(t) => patch((n) => { n.lotSizeTarget = { ...n.lotSizeTarget, tier: t }; return n; })} placeholder="0.25" />}
        <ObjectiveRow label="Minimum Bedrooms" suffix="beds" value={p.bedsMin.value} onValueChange={(v) => patch((n) => { n.bedsMin = { ...n.bedsMin, value: v }; return n; })} tier={p.bedsMin.tier} onTierChange={(t) => patch((n) => { n.bedsMin = { ...n.bedsMin, tier: t }; return n; })} placeholder="3" />
        <ObjectiveRow label="Minimum Bathrooms" suffix="baths" value={p.bathsMin.value} onValueChange={(v) => patch((n) => { n.bathsMin = { ...n.bathsMin, value: v }; return n; })} tier={p.bathsMin.tier} onTierChange={(t) => patch((n) => { n.bathsMin = { ...n.bathsMin, tier: t }; return n; })} placeholder="2" />
      </section>

      {p.searchType === 'investment' && (
        <section>
          <h3 className="hh-serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Investment Property Type</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {INVESTMENT_PROPERTY_TYPES.map((opt) => (
              <span key={opt} className={`hh-chip ${(p.investmentPropertyTypes || []).includes(opt) ? 'on' : ''}`}
                onClick={() => patch((n) => { n.investmentPropertyTypes = nextInvestmentTypes(n.investmentPropertyTypes || [], opt); return n; })}>
                {opt}
              </span>
            ))}
          </div>
        </section>
      )}

      {!isSimpleRentalType(p.searchType) && MULTISELECT_CATEGORIES.map((def) => <MultiselectSection key={def.key} def={def} priorities={p} patch={patch} />)}
      <BedroomPreferencesSection priorities={p} patch={patch} />
      {ITEMLIST_CATEGORIES.map((def) => <ItemListSection key={def.key} def={def} priorities={p} patch={patch} />)}
    </div>
  );
}
