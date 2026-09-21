'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Extracted from Sheet.jsx as its own plain-JS hook (no JSX) so its exact
// contract can be exercised with a real DOM + React render in tests, without
// needing a JSX transform in this project's plain `node --test` runner.
//
// PROVEN REGRESSION (matches the prior co-buyer/Realtor invitation-modal
// bug, root-caused the same way): this effect must depend ONLY on `open`,
// never on `onClose` or any other caller-supplied callback. Every Sheet
// caller creates its onClose/cancel/close function inline in the component
// body (never wrapped in useCallback), so it gets a new identity on every
// re-render of that caller — including the re-render triggered by every
// keystroke in a controlled input inside the sheet (CommuteDestinations'
// `cancel`, InviteCoBuyer's `close`, etc.). If this effect depended on
// `[open, onClose]`, each keystroke would re-run it and re-focus the first
// focusable element (typically the header's X button), yanking focus out of
// whatever the user was typing into. `onCloseRef` always holds the latest
// callback, so Escape and the cleanup's restore-focus call the current one
// without ever needing it in the dependency array.
export function useSheetFocusTrap(open, onClose, dialogRef) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const node = dialogRef.current;
    const focusables = () => node ? Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR)) : [];
    (focusables()[0] || node)?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    // Lock page scroll while the sheet is open — its own body scrolls
    // independently (see .hh-sheet-body), so this never fights the page.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose is intentionally excluded; see onCloseRef above.
  }, [open]);
}
