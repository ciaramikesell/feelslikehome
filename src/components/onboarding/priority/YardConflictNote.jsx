'use client';

import { AlertTriangle } from 'lucide-react';

// Points out contradictory yard priorities (src/lib/yardConflict.js) and lets
// the buyer edit either side. Never changes anything by itself: each button
// only opens that priority's usual importance picker.
export default function YardConflictNote({ conflict, onEdit, className = '' }) {
  if (!conflict) return null;
  const features = [conflict.unfenced, ...conflict.fenced];
  return (
    <div className={`flh-ob-yard-conflict ${className}`.trim()} role="note" aria-label="Yard priorities that conflict">
      <AlertTriangle size={16} strokeWidth={2.2} aria-hidden="true" />
      <div className="flh-ob-yard-conflict-copy">
        <p>{conflict.message}</p>
        <div className="flh-ob-yard-conflict-actions">
          {features.map((feature) => (
            <button key={feature.id} type="button" className="flh-text-action" aria-haspopup="dialog" onClick={(event) => onEdit(feature, event.currentTarget)}>
              Change {feature.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
