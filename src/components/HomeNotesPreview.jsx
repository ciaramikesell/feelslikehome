'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { homeNoteGroups } from '@/lib/homeDisplay';

const MARKERS = { notes: '•', pros: '+', cons: '−' };

// My Homes card: "Notes (n) · Pros (n) · Cons (n)" — only the ones with
// something written. Each count previews its entries without leaving the card:
//  - mouse: hovering a count shows its preview; moving into the preview keeps
//    it open; a click pins it open (a second click closes it);
//  - touch: a tap opens it, a second tap (or a tap anywhere else) closes it;
//  - keyboard: Tab to a count shows its preview, Enter / Space pins it,
//    Escape closes it and returns focus to the count.
// One preview at a time per card. The preview's link opens the home's Tour
// Feedback, where the shared notes are edited.
export default function HomeNotesPreview({ home, href, onOpen, address }) {
  const groups = homeNoteGroups(home);
  const [open, setOpen] = useState(null); // { key, pinned }
  const rootRef = useRef(null);
  const triggerRefs = useRef({});
  const baseId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key === 'Escape') {
        const trigger = triggerRefs.current[open.key];
        setOpen(null);
        if (rootRef.current?.contains(document.activeElement)) trigger?.focus({ preventScroll: true });
      } else if (event.type === 'pointerdown' && !rootRef.current?.contains(event.target)) {
        setOpen(null);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, [open]);

  if (!groups.length) return null;

  // Hover never steals a preview someone pinned open; keyboard focus moving to
  // another count is a deliberate move, so it switches to that count.
  const preview = (key, { fromFocus = false } = {}) => setOpen((current) => {
    if (current?.key === key) return current;
    return current?.pinned && !fromFocus ? current : { key, pinned: false };
  });

  return (
    <div
      className="hh-note-previews"
      ref={rootRef}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') setOpen((current) => (current?.pinned ? current : null)); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null); }}
    >
      {groups.map(({ key, label, entries }, index) => {
        const expanded = open?.key === key;
        const panelId = `${baseId}-${key}`;
        return (
          <div className={`hh-note-preview is-${key}`} key={key}>
            {index > 0 && <span className="hh-note-preview-sep" aria-hidden="true">·</span>}
            <button
              type="button"
              ref={(node) => { triggerRefs.current[key] = node; }}
              className="hh-note-preview-trigger"
              aria-expanded={expanded}
              aria-controls={expanded ? panelId : undefined}
              onPointerEnter={(event) => { if (event.pointerType === 'mouse') preview(key); }}
              onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) preview(key, { fromFocus: true }); }}
              onClick={() => setOpen((current) => (current?.key === key && current.pinned ? null : { key, pinned: true }))}
            >
              {label} ({entries.length})<span className="sr-only">, preview</span>
            </button>
            {expanded && (
              <div className="hh-note-popover" id={panelId} role="region" aria-label={`${label} for ${address}`}>
                <strong>{label}</strong>
                <ul>
                  {entries.map((entry, i) => (
                    // Entries can repeat ("Needs paint" twice); the position keeps keys unique.
                    // eslint-disable-next-line react/no-array-index-key
                    <li key={`${i}-${entry}`}><span aria-hidden="true">{MARKERS[key]}</span><span>{entry}</span></li>
                  ))}
                </ul>
                <Link className="hh-note-popover-link" href={href} scroll={false} onClick={onOpen}>View or edit notes</Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
