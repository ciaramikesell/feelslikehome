'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { MatchMark } from '@/components/ui';
import { matchColor } from '@/lib/matching';
import { revealCopy } from '@/lib/matchReveal';

const CONFETTI = 14;

// The one-time Match Reveal (docs/match-reveal.md): a small centered dialog over
// the home, shown once a buyer's own save has gathered enough of the details
// that matter to them. Their real Match %, a line that follows it honestly, and
// two ways on. Escape, the close button, "Keep going" and a click outside all
// dismiss it; focus returns to where it was.
export default function MatchReveal({ match, completeness, onOpenBreakdown, onClose }) {
  const dialogRef = useRef(null);
  const primaryRef = useRef(null);
  const copy = revealCopy(match, completeness);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    primaryRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll('button')];
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return <div className="flh-reveal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className={`flh-reveal is-${copy.band}`} role="dialog" aria-modal="true" aria-labelledby="flh-reveal-title" aria-describedby="flh-reveal-body">
      {copy.celebrate && <div className="flh-reveal-confetti" aria-hidden="true">{Array.from({ length: CONFETTI }, (_, index) => <span key={index} style={{ '--i': index }} />)}</div>}
      <button type="button" className="flh-reveal-close" onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /></button>
      <p className="flh-reveal-score" style={{ color: matchColor(match.pct) }}>
        <MatchMark size={30} />
        <span><strong>{match.pct}%</strong> Match</span>
      </p>
      <h2 id="flh-reveal-title" className="flh-reveal-title">{copy.headline}</h2>
      <p id="flh-reveal-body" className="flh-reveal-body">{copy.body}</p>
      <p className="flh-reveal-progress">{copy.progress}</p>
      <div className="flh-reveal-actions">
        <button ref={primaryRef} type="button" className="hh-btn" onClick={onOpenBreakdown}>See the breakdown</button>
        <button type="button" className="hh-btn hh-btn-ghost" onClick={onClose}>Keep going</button>
      </div>
    </div>
  </div>;
}
