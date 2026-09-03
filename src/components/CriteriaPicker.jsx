'use client';

import { useState } from 'react';
import { X, GripVertical, Plus } from 'lucide-react';
import { TIER_META, SELECTABLE_TIERS, DEFAULT_SELECTED_TIER } from '@/lib/constants';
import { splitCategoryItems, applyOrder } from '@/lib/matching';

export default function CriteriaPicker({ def, priorities, patch, draggable = false }) {
  const { key, title, blurb, defaultCustomKind } = def;
  const { catState, core, suggestions, custom } = splitCategoryItems(def, priorities);
  const [newItem, setNewItem] = useState('');
  const [dragIndex, setDragIndex] = useState(null);

  const tierOf = (label) => catState.tiers?.[label] || 'dontcare';
  const isKnownLabel = (label) => core.some((i) => i.label === label) || custom.some((i) => i.label === label);

  const known = [...core, ...custom];
  const selected = applyOrder(known.filter((i) => tierOf(i.label) !== 'dontcare'), catState.order || []);
  const unselectedKnown = known.filter((i) => tierOf(i.label) === 'dontcare');
  const customLabels = new Set(custom.map((i) => i.label));
  const traySuggestions = suggestions.filter((i) => !customLabels.has(i.label));
  const tray = [...unselectedKnown, ...traySuggestions];

  const setTier = (label, tier) => patch((n) => { n[key] = { ...n[key], tiers: { ...n[key].tiers, [label]: tier } }; return n; });

  const selectItem = (item) => {
    if (isKnownLabel(item.label)) {
      setTier(item.label, DEFAULT_SELECTED_TIER);
    } else {
      patch((n) => {
        n[key] = {
          ...n[key],
          customItems: [...(n[key].customItems || []), item],
          tiers: { ...n[key].tiers, [item.label]: DEFAULT_SELECTED_TIER },
        };
        return n;
      });
    }
  };

  const deselectItem = (label) => setTier(label, 'dontcare');

  const addTyped = () => {
    const label = newItem.trim();
    if (!label) return;
    selectItem({ label, kind: defaultCustomKind });
    setNewItem('');
  };

  const reorder = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx == null) return;
    const next = [...selected];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    patch((p) => { p[key] = { ...p[key], order: next.map((r) => r.label) }; return p; });
  };

  return (
    <section>
      <h3 className="hh-serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{title}</h3>
      {blurb && <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 10px' }}>{blurb}</p>}

      {selected.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {selected.map((item, idx) => (
            <div
              key={item.label}
              className={draggable ? `hh-priority-row draggable ${dragIndex === idx ? 'dragging' : ''}` : undefined}
              style={draggable ? undefined : { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}
              draggable={draggable}
              onDragStart={draggable ? () => setDragIndex(idx) : undefined}
              onDragOver={draggable ? (e) => e.preventDefault() : undefined}
              onDrop={draggable ? (e) => { e.preventDefault(); reorder(dragIndex, idx); setDragIndex(null); } : undefined}
              onDragEnd={draggable ? () => setDragIndex(null) : undefined}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                {draggable && <GripVertical size={14} className="hh-drag-handle" style={{ flexShrink: 0 }} />}
                {item.label}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ display: 'flex', gap: 3 }}>
                  {SELECTABLE_TIERS.map((t) => (
                    <button
                      key={t} type="button" onClick={() => setTier(item.label, t)}
                      style={{
                        fontSize: 10.5, padding: '4px 8px', borderRadius: 999, cursor: 'pointer', fontWeight: tierOf(item.label) === t ? 600 : 400,
                        border: '1px solid ' + (tierOf(item.label) === t ? TIER_META[t].color : 'var(--line)'),
                        background: tierOf(item.label) === t ? TIER_META[t].color : 'transparent',
                        color: tierOf(item.label) === t ? '#fff' : 'var(--ink-soft)',
                      }}
                    >
                      {TIER_META[t].label}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => deselectItem(item.label)} aria-label={`Remove ${item.label}`} title="Remove" style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', padding: 4, display: 'flex' }}>
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tray.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {tray.map((item) => (
            <button key={item.label} type="button" className="hh-chip" onClick={() => selectItem(item)}>{item.label}</button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <input className="hh-input" placeholder="Add your own..." value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTyped())} />
        <button type="button" className="hh-btn hh-btn-ghost" onClick={addTyped}><Plus size={14} /></button>
      </div>
    </section>
  );
}
