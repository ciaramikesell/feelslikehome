'use client';

import { useEffect, useRef, useState } from 'react';

// The smallest reusable one-time contextual guidance primitive: a dismissible
// callout gated by a single localStorage flag, shown once until dismissed —
// not a generic multi-step tour framework. Each future coachmark (Want to
// Tour, Compare, Map, ...) gets its own instance with its own storageKey when
// that feature's moment actually arrives ("teach the next thing when the user
// can do the next thing"), rather than a shared engine built ahead of need.
// Follows the same plain-localStorage precedent already established by
// AppShell's MOBILE_TOUR_DISMISS_KEY — no database record for a tooltip.
export function useCoachmark(storageKey, active) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active) return;
    try {
      if (localStorage.getItem(storageKey) !== '1') setOpen(true);
    } catch { /* best-effort; a storage failure just means no coachmark, never a crash */ }
    // Checked once per mount/activation, mirroring PriorityBoard's own
    // one-time viewport check — never on every render, so dismissing it
    // can't be undone by an unrelated re-render before navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, active]);
  const dismiss = () => {
    setOpen(false);
    try { localStorage.setItem(storageKey, '1'); } catch { /* best-effort; dismissal still works for this visit */ }
  };
  return [open, dismiss];
}

// Non-modal by design (role="dialog" + aria-modal="false"): the rest of the
// page stays reachable and interactive, so this never traps focus. Escape and
// the "Got it" button both dismiss; focus moves to the dismiss button on
// appearance since it's the newest, most relevant thing on screen, exactly
// like a native browser permission prompt.
export default function Coachmark({ heading, body, ctaLabel = 'Got it', onDismiss, className = '' }) {
  const dismissRef = useRef(null);
  const headingId = useRef(`hh-coachmark-heading-${Math.random().toString(36).slice(2)}`);
  const bodyId = useRef(`hh-coachmark-body-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    dismissRef.current?.focus();
    const onKeyDown = (event) => { if (event.key === 'Escape') onDismiss(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return (
    <div className={`hh-coachmark ${className}`} role="dialog" aria-modal="false" aria-labelledby={headingId.current} aria-describedby={bodyId.current}>
      <p id={headingId.current} className="hh-coachmark-heading hh-serif">{heading}</p>
      <p id={bodyId.current} className="hh-coachmark-body">{body}</p>
      <button type="button" ref={dismissRef} className="hh-btn hh-coachmark-dismiss" onClick={onDismiss}>{ctaLabel}</button>
    </div>
  );
}
