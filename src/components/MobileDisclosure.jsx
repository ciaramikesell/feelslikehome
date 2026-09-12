'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

// Shared progressive-disclosure wrapper: open by default everywhere, and only
// collapses (behind a toggle) below `breakpoint`, checked once via matchMedia
// after mount — the same one-time viewport check already used throughout
// this app (see the mobile first-run tour gating in AppShell.jsx). Defaulting
// `open` to true keeps first-paint/SSR markup identical to "always open," so
// there's no hydration mismatch; matchMedia only ever narrows it afterward,
// and never on desktop.
//
// A plain <details> can't do this: a closed <details>'s non-summary content
// isn't laid out at all regardless of its own `display`, even forced with
// `!important`, so there's no pure-CSS way to keep something permanently open
// on desktop while defaulting closed on mobile — hence a controlled component.
//
// Originally HomesBoard.jsx's card-only CardContextDisclosure; generalized so
// Home Detail's Location & Commute section (and any future candidate) can
// reuse the identical mechanism instead of a parallel implementation. The
// default label/breakpoint/class names match that original usage exactly, so
// existing card behavior/CSS/tests are unaffected by this extraction.
export default function MobileDisclosure({ label = 'More details', breakpoint = 640, className = 'hh-card-context', children }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const sync = () => setOpen(!mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [breakpoint]);

  return (
    <div className="hh-card-context-details">
      <button type="button" className="hh-card-context-summary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{label}</span>
        <ChevronDown size={14} className="hh-card-context-chevron" style={{ transform: open ? 'rotate(180deg)' : 'none' }} aria-hidden="true" />
      </button>
      {open && <div className={className}>{children}</div>}
    </div>
  );
}
