'use client';

import { useId, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, GripVertical } from 'lucide-react';
import { moveCriterion } from '@/lib/searchProfile';
import { moveGroup, priorityLevelsWithGroups } from '@/lib/whatMattersGroups';

// Step 5 of Onboarding V2: "Let's put things in order." (approved Figma design).
//
// Each priority sits in one of three levels. Moving it changes only its level
// (a criterion's tier, or a grouped preference's single tier — so "House or
// Condo" moves as one item and can never become two Must Haves). Order within
// a level means nothing, exactly as in Match. Two equal ways to move:
//   • the assignment menu on every row (a native select: tap, keyboard and
//     screen readers all work the same way);
//   • dragging the handle into another level (pointer events, so touch and
//     mouse both work; only the handle starts a drag, so scrolling never does).

const LEVELS = Object.freeze({
  must: { title: 'Must-Have', description: 'I could rule out a home over this.' },
  important: { title: 'Important', description: 'This meaningfully affects my decision.' },
  nice: { title: 'Nice-to-Have', description: 'I’d love it, but can live without it.' },
});
const DRAG_THRESHOLD = 6;

function MissingInfo() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`flh-ob-sharing flh-ob-rank-info${open ? ' is-open' : ''}`}>
      <button type="button" className="flh-ob-sharing-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <span><span className="flh-ob-rank-info-title">How Match handles missing information</span></span>
        <ChevronDown size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <div id={id} className="flh-ob-sharing-panel" hidden={!open}>
        <ul>
          <li>A priority only counts once FLH knows the answer for a home—from the listing or from you.</li>
          <li>Unknown never counts against a home, even for a Must-Have.</li>
          <li>For a choice like “House or Condo”, a home only needs to match one.</li>
        </ul>
      </div>
    </div>
  );
}

export default function RankStepV2({ header, priorities, patch, onNext, onChoose }) {
  const levels = priorityLevelsWithGroups(priorities);
  const total = levels.reduce((sum, level) => sum + level.items.length, 0);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const [announcement, setAnnouncement] = useState('');

  const move = (item, tier) => {
    if (tier === item.tier) return;
    patch((next) => (item.group ? moveGroup(next, item.categoryKey, tier) : moveCriterion(next, item.categoryKey, item.label, tier)));
    setAnnouncement(`${item.displayLabel} moved to ${LEVELS[tier].title}.`);
  };

  const tierAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('[data-rank-tier]')?.getAttribute('data-rank-tier') || null;
  const onPointerDown = (event, item) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { item, x: event.clientX, y: event.clientY, moved: false, over: item.tier };
  };
  const onPointerMove = (event) => {
    const current = dragRef.current;
    if (!current) return;
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_THRESHOLD) return;
    current.moved = true;
    current.over = tierAt(event.clientX, event.clientY) || current.over;
    setDrag({ key: current.item.key, over: current.over });
  };
  const onPointerUp = () => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (current?.moved && current.over) move(current.item, current.over);
  };
  const cancel = () => { dragRef.current = null; setDrag(null); };

  return (
    <div className={`flh-onboarding-step flh-ob-rank${drag ? ' is-dragging' : ''}`}>
      {header}
      <MissingInfo />
      {total > 0 && <p className="flh-ob-rank-hint">Use the menu on any priority to move it—or drag it by its handle.</p>}
      {total === 0 && (
        <div className="flh-ob-rank-empty">
          <p className="flh-ob-rank-empty-title">No priorities selected yet.</p>
          <p className="flh-ob-rank-empty-copy">You can continue now or go back to choose a few things that matter.</p>
          <button type="button" className="flh-button flh-button-outline flh-button-small" onClick={onChoose}>Choose priorities</button>
        </div>
      )}
      <div className="flh-ob-rank-levels">
        {levels.map((level) => (
          <section
            key={level.tier}
            className={`flh-ob-rank-level is-${level.tier}${drag?.over === level.tier ? ' is-drop-target' : ''}`}
            data-rank-tier={level.tier}
            aria-labelledby={`flh-ob-rank-${level.tier}`}
          >
            <header className="flh-ob-rank-head">
              <span>
                <h2 id={`flh-ob-rank-${level.tier}`} className="flh-ob-rank-title">{LEVELS[level.tier].title}</h2>
                <span className="flh-ob-rank-desc">{LEVELS[level.tier].description}</span>
              </span>
              <span className="flh-ob-rank-count" aria-label={`${level.items.length} ${level.items.length === 1 ? 'priority' : 'priorities'}`}>{level.items.length}</span>
            </header>
            {level.items.length ? (
              <ul className="flh-ob-rank-list">
                {level.items.map((item) => (
                  <li key={item.key} className={`flh-ob-rank-row${drag?.key === item.key ? ' is-dragged' : ''}`}>
                    <button
                      type="button"
                      className="flh-ob-rank-handle"
                      aria-label={`Drag ${item.displayLabel} to another level`}
                      tabIndex={-1}
                      onPointerDown={(event) => onPointerDown(event, item)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={cancel}
                    >
                      <GripVertical size={18} aria-hidden="true" />
                    </button>
                    <span className="flh-ob-rank-label">
                      <span>{item.displayLabel}</span>
                      {item.qualifier && <span className="flh-ob-rank-qualifier">{item.qualifier}</span>}
                    </span>
                    <span className="flh-ob-rank-menu">
                      <select
                        value={level.tier}
                        aria-label={`Importance of ${item.displayLabel}${item.qualifier ? ` (${item.qualifier})` : ''}`}
                        onChange={(event) => move(item, event.target.value)}
                      >
                        {Object.entries(LEVELS).map(([tier, copy]) => <option key={tier} value={tier}>{copy.title}</option>)}
                      </select>
                      <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flh-ob-rank-placeholder">Move a priority here when it belongs in this group.</p>
            )}
          </section>
        ))}
      </div>
      <span className="sr-only" aria-live="polite">{announcement}</span>
      <nav className="flh-onboarding-actions flh-ob-rank-actions" aria-label="Step actions">
        <button type="button" className="flh-button flh-button-primary flh-ob-cta" onClick={onNext}>
          <span>Review my search</span>
          <span className="flh-ob-cta-icon" aria-hidden="true"><ArrowRight size={20} strokeWidth={2.2} /></span>
        </button>
      </nav>
    </div>
  );
}
