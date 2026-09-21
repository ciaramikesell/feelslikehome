'use client';

import { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useSheetFocusTrap } from '@/lib/useSheetFocusTrap';

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

  useSheetFocusTrap(open, onClose, dialogRef);

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
