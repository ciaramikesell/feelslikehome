'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One reusable presentation for "a small decision, a workflow, or a
 * confirmation" — mobile-first bottom sheet, desktop dialog. This is the
 * shared primitive new native/mobile interactions should build on instead of
 * each hand-rolling its own modal chrome; it does not replace every existing
 * `.hh-modal-backdrop` usage in this pass (see ArchiveConfirmModal and the
 * delete ConfirmModal in HomesBoard.jsx for the first two interactions
 * migrated onto it).
 *
 * size: 'compact' (a short decision/confirmation) | 'default' (a form-sized
 * panel) | 'large' (a longer workflow, closer to full-height on mobile).
 */
export default function Sheet({
  open,
  onClose,
  title,
  ariaLabel,
  size = 'default',
  showClose = true,
  dismissOnBackdrop = true,
  children,
  className = '',
}) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const node = dialogRef.current;
    const focusables = () => node ? Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR)) : [];
    (focusables()[0] || node)?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
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
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="hh-sheet-backdrop"
      onMouseDown={(event) => dismissOnBackdrop && event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        className={`hh-sheet hh-sheet-${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={!title ? ariaLabel : undefined}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <div className="hh-sheet-grabber" aria-hidden="true" />
        {(title || showClose) && (
          <div className="hh-sheet-header">
            {title && <h2 id={titleId} className="hh-serif hh-sheet-title">{title}</h2>}
            {showClose && (
              <button type="button" className="hh-sheet-close" onClick={onClose} aria-label="Close">
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className="hh-sheet-body">{children}</div>
      </div>
    </div>
  );
}
