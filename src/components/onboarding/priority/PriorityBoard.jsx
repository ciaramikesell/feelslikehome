'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, GripVertical, LandPlot, Plus, Undo2 } from 'lucide-react';
import { UnitField } from '@/components/onboarding/BasicsStep';
import { LEVEL_COPY, PRIORITY_LEVELS } from '@/lib/searchProfile';
import {
  GARAGE_TYPES, garageType, lotSizeImportance, lotSizeValue, priorityCategory, setGarageType, setLotSizeValue,
} from '@/lib/priorityCategories';
import { BOARD_HOUSE_GARAGE, BOARD_OWN_GROUP, BOARD_OWN_TITLE, addBoardOwnFeature, boardLevel, boardSuggestions, placeOnBoard, priorityBoard } from '@/lib/priorityBoard';
import { featureDescription } from '@/lib/featureDescriptions';
import FeatureVisual from './FeatureVisual';

// The desktop priority board (docs/desktop-priority-board.md): one screen that
// replaces the phone's category screens. A feature library grouped by those
// same categories, and three importance columns. Every chip is in exactly one
// place. Three ways to rank, all writing through placeOnBoard →
// setFeatureLevel, the same write as the phone screens:
//   • drag a chip to a column, between columns, or back to the library;
//   • click (or Enter / Space on) a chip: a small importance chooser opens;
//   • type in Add your own: canonical suggestions first, then your own words.
// Hover (after a short delay) or keyboard focus shows a small preview with the
// feature's onboarding photo — or its icon — and one sentence. The sentence is
// also the chip's accessible description; the preview itself is decorative.

const HOVER_DELAY_MS = 450;
const FOCUS_DELAY_MS = 200;

const COLUMN_EMPTY = Object.freeze({
  must: 'Deal-breakers go here.',
  important: 'Things that weigh on your decision.',
  nice: 'Bonuses you’d enjoy.',
});

const isHouseGarage = (feature) => feature?.id === BOARD_HOUSE_GARAGE.id && feature.group === BOARD_HOUSE_GARAGE.group;

function levelText(level) {
  return level ? LEVEL_COPY[level].heading : 'not ranked';
}

/* ---------------------------------- chips ---------------------------------- */

function Chip({ feature, level, dragging, board }) {
  const descId = useId();
  const qualifier = board.qualifierFor?.(feature, level) || null;
  // Only what the person typed reads "Your own" (catalog-less suggestions such as
  // Built-in Shelving are FLH's, even though they are stored as Yes/No items).
  const own = feature.custom && (feature.role === 'own' || feature.role === 'other');
  return (
    <li className="flh-ob-board-cell">
      <button
        type="button"
        className={`flh-ob-board-chip${level ? ` is-${level}` : ''}${dragging ? ' is-dragging' : ''}`}
        draggable
        data-chip-id={feature.id}
        aria-haspopup="dialog"
        aria-describedby={descId}
        onClick={(event) => board.openChooser(feature, event.currentTarget)}
        onDragStart={(event) => board.dragStart(event, feature)}
        onDragEnd={board.dragEnd}
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') board.previewSoon(feature, event.currentTarget, HOVER_DELAY_MS); }}
        onPointerLeave={board.previewHide}
        onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) board.previewSoon(feature, event.currentTarget, FOCUS_DELAY_MS); }}
        onBlur={board.previewHide}
      >
        <GripVertical className="flh-ob-board-grip" size={14} strokeWidth={2} aria-hidden="true" />
        <span className="flh-ob-board-chip-text">{feature.text}</span>
        {qualifier && <span className={`flh-ob-board-chip-qualifier${qualifier.set ? '' : ' is-unset'}`} aria-hidden="true">{qualifier.text}</span>}
        {own && <span className="flh-ob-pf-own" aria-hidden="true">Your own</span>}
        <span className="sr-only">{own ? ' (your own)' : ''}{qualifier ? `, ${qualifier.text}` : ''}: {levelText(level)}. Choose importance</span>
      </button>
      <span id={descId} hidden>{featureDescription(feature)}</span>
    </li>
  );
}

/* ------------------------------ drop targets ------------------------------- */

function useDropTarget(board, target) {
  const [over, setOver] = useState(false);
  const accepts = () => board.draggingRef.current && board.draggingRef.current.from !== target;
  return {
    over: over && Boolean(board.dragging),
    handlers: {
      onDragOver: (event) => { if (!accepts()) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (!over) setOver(true); },
      onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(false); },
      onDrop: (event) => { event.preventDefault(); setOver(false); board.drop(target); },
    },
  };
}

function Column({ tier, items, board }) {
  const drop = useDropTarget(board, tier);
  const headingId = useId();
  const active = Boolean(board.dragging) && board.dragging.from !== tier;
  return (
    <section className={`flh-ob-board-column is-${tier}${active ? ' is-target' : ''}${drop.over ? ' is-over' : ''}`} aria-labelledby={headingId} {...drop.handlers}>
      <header className="flh-ob-board-column-head">
        <h2 id={headingId} className="flh-ob-board-column-title"><span className="flh-ob-pf-level-dot" aria-hidden="true" />{LEVEL_COPY[tier].heading}</h2>
        <span className="flh-ob-board-count" aria-label={`${items.length} ${items.length === 1 ? 'priority' : 'priorities'}`}>{items.length}</span>
        <p className="flh-ob-board-column-hint">{LEVEL_COPY[tier].description}</p>
      </header>
      {items.length > 0
        ? <ul className="flh-ob-board-list" aria-label={LEVEL_COPY[tier].heading}>{items.map((feature) => <Chip key={feature.id} feature={feature} level={tier} board={board} dragging={board.dragging?.id === feature.id} />)}</ul>
        : <p className="flh-ob-board-empty">{COLUMN_EMPTY[tier]}<span>Drag a feature here, or click one to choose.</span></p>}
    </section>
  );
}

/* --------------------------------- library --------------------------------- */

function GarageType({ priorities, patch }) {
  const type = garageType(priorities);
  const id = useId();
  return (
    <div className="flh-ob-board-garage" role="group" aria-labelledby={id}>
      <p id={id} className="flh-ob-board-chooser-question">Attached or detached?</p>
      <div className="flh-ob-board-segments">
        {GARAGE_TYPES.map((choice) => (
          <button key={choice.key} type="button" className={`flh-ob-board-segment${type === choice.key ? ' is-current' : ''}`} aria-pressed={type === choice.key}
            onClick={() => patch((next) => setGarageType(next, choice.key))}>
            {type === choice.key && <Check size={13} strokeWidth={3} aria-hidden="true" />}{choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Ideal lot size is a threshold ("at least n acres"), not a feature, so it has
// its own panel. Home to Rent (#184, D4): entering acreage creates a rankable
// "Ideal lot size · n+ acres" chip right here; it counts only once it is in a
// column. Home to Buy keeps a plain acreage field.
function LotSizePanel({ group, priorities, patch, board }) {
  const value = lotSizeValue(priorities);
  const level = lotSizeImportance(priorities);
  const rankable = group.lotRankable;
  const id = useId();
  const status = !rankable
    ? 'Optional. Saved with your search.'
    : !value
      ? 'Enter acreage to make it a priority you can rank.'
      : level
        ? `Ranked ${LEVEL_COPY[level].heading}: homes on at least ${value} acres count toward your Match. An unknown lot size never counts against a home.`
        : 'Not part of your Match until you rank it.';
  return (
    <div className={`flh-ob-board-lot${rankable ? ' is-rankable' : ''}${rankable && value ? ' has-value' : ''}${level && rankable ? ` is-${level}` : ''}`} role="group" aria-labelledby={`${id}-title`}>
      <div className="flh-ob-board-lot-head">
        <span className="flh-ob-board-lot-icon" aria-hidden="true"><LandPlot size={18} strokeWidth={1.8} /></span>
        <span className="flh-ob-board-lot-copy">
          <span id={`${id}-title`} className="flh-ob-board-lot-title">Ideal lot size</span>
          <span className="flh-ob-board-lot-kind">{rankable ? 'A minimum you can rank' : 'A minimum'}</span>
        </span>
      </div>
      {/* The phone screen's write (#184): Home to Rent clears the importance with the acreage; Home to Buy only sets the value. */}
      <UnitField label="Ideal lot size, at least" unit="acres" decimal value={priorities.lotSizeTarget.value} onChange={(value) => patch((next) => (group.lotRankable ? setLotSizeValue(next, value) : { ...next, lotSizeTarget: { ...next.lotSizeTarget, value } }))} />
      {rankable && group.lotChip && (
        <div className="flh-ob-board-lot-rank">
          <ul className="flh-ob-board-chips" aria-label="Ideal lot size"><Chip feature={group.lotChip} level={null} board={board} dragging={board.dragging?.id === group.lotChip.id} /></ul>
          <span className="flh-ob-board-lot-cue" aria-hidden="true"><ArrowRight size={14} strokeWidth={2.2} /> Drag to a column, or click to rank</span>
        </div>
      )}
      <p className="flh-ob-help flh-ob-board-lot-help" role="status">{status}</p>
    </div>
  );
}

function LibraryGroup({ group, priorities, patch, board }) {
  const headingId = useId();
  return (
    <section className="flh-ob-board-group" aria-labelledby={headingId} data-group={group.key}>
      <h3 id={headingId} className="flh-ob-board-group-title">
        {group.title}
        {group.rankedCount > 0 && <span className="flh-ob-board-ranked">{group.rankedCount} ranked</span>}
      </h3>
      {group.features.length > 0
        ? <ul className="flh-ob-board-chips" aria-label={group.title}>{group.features.map((feature) => <Chip key={feature.id} feature={feature} level={null} board={board} dragging={board.dragging?.id === feature.id} />)}</ul>
        : <p className="flh-ob-board-all-ranked">{group.own ? (group.rankedCount ? 'All ranked.' : 'What you add appears here.') : 'All ranked.'}</p>}
      {group.garageDetailsHidden && <p className="flh-ob-board-note">Rank Garage to see details like a workbench or a door to the yard.</p>}
      {group.lotSize && <LotSizePanel group={group} priorities={priorities} patch={patch} board={board} />}
    </section>
  );
}

function AddYourOwn({ priorities, patch, board }) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const boxRef = useRef(null);
  const matches = boardSuggestions(board.model, text);
  const add = () => {
    const result = addBoardOwnFeature(priorities, text);
    if (!result) return;
    if (!result.feature) { setError(result.error || ''); return; }
    setError('');
    if (result.priorities !== priorities) patch(() => result.priorities);
    const elsewhere = result.homeCategory === BOARD_OWN_GROUP ? BOARD_OWN_TITLE : (result.homeCategory ? priorityCategory(priorities, result.homeCategory)?.title : null);
    setText('');
    board.openChooser(result.feature, boxRef.current, elsewhere ? `You’ll find this under ${elsewhere}.` : null);
  };
  return (
    <section className="flh-ob-board-add" aria-labelledby={`${id}-label`} ref={boxRef}>
      <label id={`${id}-label`} className="flh-ob-label" htmlFor={`${id}-input`}>Add your own</label>
      <div className="flh-ob-board-add-row">
        <span className="flh-ob-input">
          <input id={`${id}-input`} value={text} maxLength={60} autoComplete="off" placeholder="Type a feature" aria-describedby={`${id}-hint`}
            onChange={(event) => { setText(event.target.value); setError(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (text.trim()) add(); } }} />
        </span>
        <button type="button" className="flh-button flh-button-outline flh-ob-board-add-button" disabled={!text.trim()} onClick={add}><Plus size={15} aria-hidden="true" /> Add</button>
      </div>
      <p id={`${id}-hint`} className={text.trim() ? 'flh-ob-help' : 'sr-only'}>{text.trim() ? (matches.length ? 'Already in the library:' : `Add “${text.trim()}” to Your own features, then choose how much it matters.`) : 'FLH checks the library first, so nothing is added twice.'}</p>
      {matches.length > 0 && (
        <ul className="flh-ob-board-matches" aria-label="Matching features">
          {matches.map(({ feature, groupTitle }) => (
            <li key={feature.id}>
              <button type="button" className="flh-ob-board-match" onClick={() => { setText(''); board.openChooser(feature, boxRef.current); }}>
                <span>{feature.text}</span><span className="flh-ob-board-match-group">{groupTitle}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="flh-ob-pf-error" role="alert">{error}</p>}
    </section>
  );
}

/* ---------------------------- chooser & preview ---------------------------- */

// Positions a floating element inside the board next to `anchor`: below it by
// default (above for the preview), flipped when the window has no room, and
// kept inside the board horizontally.
function useFloating(boardRef, anchor, preferAbove) {
  const ref = useRef(null);
  // Measured before it is shown: transparent (not hidden) so focus can move in.
  const [style, setStyle] = useState({ top: 0, left: 0, opacity: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    const container = boardRef.current;
    if (!element || !container || !anchor?.isConnected) return;
    const box = container.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const height = element.offsetHeight;
    const width = element.offsetWidth;
    const gap = 8;
    const roomAbove = rect.top - height - gap >= 8;
    const roomBelow = rect.bottom + height + gap <= window.innerHeight - 8;
    const above = preferAbove ? (roomAbove || !roomBelow) : (!roomBelow && roomAbove);
    const top = above ? rect.top - box.top - height - gap : rect.bottom - box.top + gap;
    const left = Math.max(0, Math.min(rect.left - box.left, box.width - width));
    setStyle({ top, left });
  }, [anchor, boardRef, preferAbove]);
  return { ref, style };
}

function Chooser({ chooser, level, boardRef, onChoose, onClose, garage = null }) {
  const { feature, anchor, note } = chooser;
  const titleId = useId();
  const floating = useFloating(boardRef, anchor, false);
  useEffect(() => {
    const first = floating.ref.current?.querySelector('[aria-pressed="true"]') || floating.ref.current?.querySelector('button');
    first?.focus();
    const outside = (event) => { if (!floating.ref.current?.contains(event.target) && !anchor?.contains?.(event.target)) onClose(false); };
    // Escape closes it wherever focus is (e.g. still on the chip after a mouse click).
    const escape = (event) => { if (event.key === 'Escape') onClose(true); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [feature.id]);
  return (
    <div ref={floating.ref} className="flh-ob-board-chooser" role="dialog" aria-modal="false" aria-labelledby={titleId} style={floating.style}
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          // Keep Tab inside the small dialog; Escape (or a choice) leaves it.
          const buttons = [...floating.ref.current.querySelectorAll('button')];
          const index = buttons.indexOf(document.activeElement);
          const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index === buttons.length - 1 ? 0 : index + 1);
          event.preventDefault();
          buttons[next]?.focus();
        }
      }}>
      <p id={titleId} className="flh-ob-board-chooser-title">{feature.text}</p>
      {note && <p className="flh-ob-board-chooser-note" role="status">{note}</p>}
      <p className="flh-ob-board-chooser-question">How important is it to you?</p>
      <div className="flh-ob-board-chooser-levels">
        {PRIORITY_LEVELS.map((tier) => (
          <button key={tier} type="button" className={`flh-ob-board-level is-${tier}${level === tier ? ' is-current' : ''}`} aria-pressed={level === tier} onClick={() => onChoose(tier)}>
            <span className="flh-ob-pf-level-dot" aria-hidden="true" />
            <span className="flh-ob-board-level-copy"><span className="flh-ob-board-level-title">{LEVEL_COPY[tier].heading}</span><span className="flh-ob-board-level-hint">{LEVEL_COPY[tier].hint}</span></span>
            {level === tier && <Check size={15} strokeWidth={2.6} aria-hidden="true" />}
          </button>
        ))}
      </div>
      {/* Home to Buy Garage: the existing attached / detached qualifier, once a garage matters (as on the phone). */}
      {garage && level && <GarageType priorities={garage.priorities} patch={garage.patch} />}
      {level
        ? <button type="button" className="flh-ob-board-remove" onClick={() => onChoose('none')}>Remove · back to the library<span>It won’t count, and it’s never marked as missing.</span></button>
        : <button type="button" className="flh-text-action flh-ob-board-cancel" onClick={() => onClose(true)}>Not now</button>}
    </div>
  );
}

function Preview({ preview, boardRef }) {
  const floating = useFloating(boardRef, preview.anchor, true);
  return (
    <div ref={floating.ref} className="flh-ob-board-preview" aria-hidden="true" style={floating.style}>
      <FeatureVisual feature={preview.feature} eager />
      <p className="flh-ob-board-preview-name">{preview.feature.text}</p>
      <p className="flh-ob-board-preview-text">{featureDescription(preview.feature)}</p>
    </div>
  );
}

/* ---------------------------------- board ---------------------------------- */

export default function PriorityBoard({ priorities, patch, header, footer }) {
  const boardRef = useRef(null);
  const [earlierRemoved, setEarlierRemoved] = useState([]);
  const model = useMemo(() => priorityBoard(priorities, { earlierRemoved }), [priorities, earlierRemoved]);
  const [dragging, setDragging] = useState(null);
  const draggingRef = useRef(null);
  const [chooser, setChooser] = useState(null);
  const [preview, setPreview] = useState(null);
  const previewTimer = useRef(null);
  const [lastAction, setLastAction] = useState(null);
  const focusAfter = useRef(null);
  const reopenAfter = useRef(null);
  const libraryDrop = useDropTarget({ draggingRef, dragging, drop: (target) => drop(target) }, 'none');

  // Keyboard focus follows a chip after it moves (or the chooser closes).
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    const chip = [...(boardRef.current?.querySelectorAll('[data-chip-id]') || [])].find((element) => element.dataset.chipId === id);
    chip?.focus({ preventScroll: false });
    // Ranking the house Garage reopens its chooser where the chip now is, so
    // Attached / Detached can be answered straight away.
    if (chip && reopenAfter.current?.id === id) { setChooser({ feature: reopenAfter.current, anchor: chip, note: null }); reopenAfter.current = null; }
  });
  useEffect(() => () => clearTimeout(previewTimer.current), []);

  const previewHide = () => { clearTimeout(previewTimer.current); setPreview(null); };
  const previewSoon = (feature, anchor, delay) => {
    clearTimeout(previewTimer.current);
    if (draggingRef.current || chooser) return;
    previewTimer.current = setTimeout(() => { if (!draggingRef.current) setPreview({ feature, anchor }); }, delay);
  };

  const place = (feature, target, { refocus = false } = {}) => {
    const from = boardLevel(priorities, feature);
    if (target === from || (target === 'none' && !from)) return;
    const before = priorities;
    patch((next) => placeOnBoard(next, feature, target));
    if (target === 'none' && feature.role === 'other') setEarlierRemoved((list) => (list.some((entry) => entry.id === feature.id) ? list : [...list, feature]));
    const where = PRIORITY_LEVELS.includes(target) ? `moved to ${LEVEL_COPY[target].heading}` : 'moved back to the library. It won’t count toward any home';
    setLastAction({ before, message: `${feature.text} ${where}.`, id: feature.id });
    if (refocus) focusAfter.current = feature.id;
  };

  const dragStart = (event, feature) => {
    previewHide();
    setChooser(null);
    const from = boardLevel(priorities, feature) || 'none';
    draggingRef.current = { id: feature.id, feature, from };
    setDragging({ id: feature.id, from });
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', feature.text);
  };
  const dragEnd = () => { draggingRef.current = null; setDragging(null); };
  function drop(target) {
    const current = draggingRef.current;
    dragEnd();
    if (current) place(current.feature, target);
  }

  const openChooser = (feature, anchor, note = null) => { previewHide(); setChooser({ feature, anchor, note }); };
  const closeChooser = (restoreFocus) => {
    if (restoreFocus && chooser) {
      if (chooser.anchor?.dataset?.chipId) chooser.anchor.focus(); else focusAfter.current = chooser.feature.id;
    }
    setChooser(null);
  };
  const choose = (tier) => {
    const { feature } = chooser;
    setChooser(null);
    place(feature, tier, { refocus: true });
    if (!PRIORITY_LEVELS.includes(tier) || boardLevel(priorities, feature) === tier) focusAfter.current = feature.id;
    if (isHouseGarage(feature) && PRIORITY_LEVELS.includes(tier) && !garageType(priorities)) reopenAfter.current = feature;
  };
  const undo = () => {
    if (!lastAction) return;
    const { before, id, message } = lastAction;
    patch(() => before);
    setLastAction({ undone: true, message: `Undone: ${message.replace(/\.$/, '')}.` });
    focusAfter.current = id;
  };

  // The ranked house Garage carries its attached / detached answer (or asks for it).
  const qualifierFor = (feature, level) => {
    if (!level || !isHouseGarage(feature)) return null;
    const type = GARAGE_TYPES.find((choice) => choice.key === garageType(priorities));
    return type ? { text: type.label, set: true } : { text: 'Attached or detached?', set: false };
  };
  const board = { model, dragging, draggingRef, dragStart, dragEnd, drop, openChooser, previewSoon, previewHide, qualifierFor };
  const fromColumn = dragging && dragging.from !== 'none';

  return (
    <div className="flh-onboarding-step flh-ob-pf-step flh-ob-board-step">
      {header}
      <p className="flh-ob-board-status" role="status" aria-live="polite">
        {lastAction ? (
          <>
            <span>{lastAction.message}</span>
            {!lastAction.undone && <button type="button" className="flh-text-action flh-ob-board-undo" onClick={undo}><Undo2 size={14} aria-hidden="true" /> Undo</button>}
          </>
        ) : <span className="flh-ob-board-status-idle">{model.rankedCount ? 'Click any feature to choose its importance, or drag it.' : 'Nothing ranked yet. Anything left in the library simply isn’t counted.'}</span>}
      </p>
      <div className={`flh-ob-board${dragging ? ' is-dragging' : ''}`} ref={boardRef}>
        <section className={`flh-ob-board-library${fromColumn ? ' is-target' : ''}${libraryDrop.over ? ' is-over' : ''}`} aria-label="Feature library" {...libraryDrop.handlers}>
          <header className="flh-ob-board-library-head">
            <h2 className="flh-ob-board-library-title">Feature library</h2>
            <p className="flh-ob-board-library-hint">Not ranked. Nothing here counts for or against a home.</p>
          </header>
          {fromColumn && <p className="flh-ob-board-drop-hint" aria-hidden="true">Drop here to remove it from your priorities</p>}
          <AddYourOwn priorities={priorities} patch={patch} board={board} />
          <div className="flh-ob-board-groups">
            {model.groups.map((group) => <LibraryGroup key={group.key} group={group} priorities={priorities} patch={patch} board={board} />)}
          </div>
        </section>
        <div className="flh-ob-board-summary">
          <h2 className="flh-ob-board-summary-title">Your priorities</h2>
          <ul className="flh-ob-board-summary-counts" aria-label="Ranked by importance">
            {PRIORITY_LEVELS.map((tier) => <li key={tier} className={`is-${tier}`}><span className="flh-ob-pf-level-dot" aria-hidden="true" />{model.columns[tier].length} {LEVEL_COPY[tier].heading}</li>)}
          </ul>
        </div>
        <div className="flh-ob-board-columns" aria-label="Your priorities" role="group">
          {PRIORITY_LEVELS.map((tier) => <Column key={tier} tier={tier} items={model.columns[tier]} board={board} />)}
        </div>
        {chooser && <Chooser chooser={chooser} level={boardLevel(priorities, chooser.feature)} boardRef={boardRef} onChoose={choose} onClose={closeChooser} garage={isHouseGarage(chooser.feature) ? { priorities, patch } : null} />}
        {preview && !dragging && !chooser && <Preview preview={preview} boardRef={boardRef} />}
      </div>
      {footer}
    </div>
  );
}
