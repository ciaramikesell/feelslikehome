'use client';

import { useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import Sheet from '@/components/Sheet';
import { LevelDot } from '@/components/MobileSystem';
import { GARAGE_PREFERENCE_OPTIONS } from '@/lib/constants';
import { LEVEL_COPY, PRIORITY_LEVELS } from '@/lib/searchProfile';

const DRAG_THRESHOLD = 6;

// The three-level priority board shared by onboarding's Rank Priorities step and
// My Search's Rank Priorities editor. Moving a priority only changes its level
// (the existing category `tiers` map) — the product has no within-level order.
//
// Two equal ways to move a priority, so mobile never depends on drag alone:
//  - drag the handle into another level (pointer events, so it works for touch
//    and mouse alike — HTML5 drag-and-drop does not fire for touch on iOS);
//  - tap the priority (or its handle) to open an explicit level picker.
export default function RankBoard({ levels, onMove, onRemove, garagePreference = 'any', onGaragePreferenceChange, schoolsNote = '', onSchoolsNoteChange, showDescriptions = false }) {
  const [picker, setPicker] = useState(null);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);

  const tierAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('[data-rank-tier]')?.getAttribute('data-rank-tier') || null;

  const handlePointerDown = (event, item) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { item, startX: event.clientX, startY: event.clientY, moved: false, overTier: item.tier };
  };
  const handlePointerMove = (event) => {
    const current = dragRef.current;
    if (!current) return;
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD) return;
    current.moved = true;
    current.overTier = tierAt(event.clientX, event.clientY) || current.overTier;
    setDrag({ key: current.item.key, overTier: current.overTier });
  };
  const handlePointerUp = () => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current) return;
    if (!current.moved) { setPicker(current.item); return; }
    if (current.overTier && current.overTier !== current.item.tier) onMove(current.item, current.overTier);
  };
  const cancelDrag = () => { dragRef.current = null; setDrag(null); };

  const choose = (tier) => { if (picker && tier !== picker.tier) onMove(picker, tier); setPicker(null); };

  return (
    <div className={`flh-rank-board ${drag ? 'is-dragging' : ''}`}>
      {levels.map((level) => (
        <section
          key={level.tier}
          className={`flh-rank-level flh-rank-level-${level.tier} ${drag?.overTier === level.tier ? 'is-drop-target' : ''}`}
          data-rank-tier={level.tier}
          aria-labelledby={`rank-level-${level.tier}`}
        >
          <header className="flh-rank-level-header">
            <LevelDot tier={level.tier} />
            <h3 id={`rank-level-${level.tier}`}>{level.label}</h3>
            <span className="flh-rank-count" aria-label={`${level.items.length} ${level.items.length === 1 ? 'priority' : 'priorities'}`}>{level.items.length}</span>
            <span className="flh-rank-hint">{showDescriptions ? level.description : level.hint}</span>
          </header>
          {level.items.length ? (
            <ul className="flh-rank-list">
              {level.items.map((item) => (
                <li key={item.key} className={`flh-rank-row ${drag?.key === item.key ? 'is-dragged' : ''}`}>
                  <button type="button" className="flh-rank-row-main" onClick={() => setPicker(item)} aria-label={`${item.displayLabel}${item.qualifier ? `, ${item.qualifier}` : ''}. ${level.label}. Change level`}>
                    <span className="flh-rank-label">{item.displayLabel}</span>
                    {item.qualifier && <span className="flh-rank-qualifier">{item.qualifier}</span>}
                    {item.experiential && <span className="flh-rank-qualifier" title="You'll evaluate this after touring the home">◷ After tour</span>}
                    {item.legacy && <span className="flh-rank-qualifier" title="Saved earlier; no longer counted in Match">Legacy</span>}
                  </button>
                  <button
                    type="button"
                    className="flh-rank-handle"
                    aria-label={`Move ${item.displayLabel}`}
                    onPointerDown={(event) => handlePointerDown(event, item)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={cancelDrag}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPicker(item); } }}
                  >
                    <GripVertical size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flh-rank-empty">Nothing here yet — drag or tap a priority to move it here.</p>
          )}
        </section>
      ))}

      <Sheet open={!!picker} onClose={() => setPicker(null)} title={picker ? picker.displayLabel : ''} size="compact">
        {picker && (
          <div className="flh-level-picker">
            <p className="flh-level-picker-prompt">Where does this belong?</p>
            <div role="radiogroup" aria-label={`Level for ${picker.displayLabel}`}>
              {PRIORITY_LEVELS.map((tier) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={picker.tier === tier}
                  key={tier}
                  className={`flh-level-option flh-level-option-${tier} ${picker.tier === tier ? 'is-current' : ''}`}
                  onClick={() => choose(tier)}
                >
                  <LevelDot tier={tier} />
                  <span><strong>{LEVEL_COPY[tier].heading}</strong><small>{LEVEL_COPY[tier].description}</small></span>
                </button>
              ))}
            </div>
            {picker.categoryKey === 'exterior' && picker.label === 'Garage' && onGaragePreferenceChange && (
              <div className="flh-garage-preference">
                <span className="flh-field-label">Garage preference <em>(optional)</em></span>
                <div className="flh-segmented" role="radiogroup" aria-label="Garage preference">
                  {GARAGE_PREFERENCE_OPTIONS.map((option) => (
                    <button type="button" role="radio" key={option.key} aria-checked={garagePreference === option.key} className={garagePreference === option.key ? 'is-selected' : ''} onClick={() => onGaragePreferenceChange(option.key)}>{option.label}</button>
                  ))}
                </div>
              </div>
            )}
            {picker.categoryKey === 'location' && picker.label === 'Schools' && onSchoolsNoteChange && (
              <label className="flh-field">
                <span className="flh-field-label">School preference <em>(optional)</em></span>
                <input className="flh-input" value={schoolsNote} onChange={(event) => onSchoolsNoteChange(event.target.value)} placeholder="School, district, or rating" />
              </label>
            )}
            {onRemove && (
              <button type="button" className="flh-text-action flh-remove-priority" onClick={() => { onRemove(picker); setPicker(null); }}>Remove priority</button>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
