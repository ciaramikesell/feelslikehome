'use client';

import { useEffect, useId, useState } from 'react';
import { Check } from 'lucide-react';
import Sheet from '@/components/Sheet';
import { LEVEL_COPY, PRIORITY_LEVELS } from '@/lib/searchProfile';

// The one importance picker (a bottom sheet on phones, a dialog on desktop):
// Must Have, Important, Nice to Have, or Not important. Each is a button — a
// tap applies it and closes, so arrow keys never change an answer by accident.
// Closing without a choice changes nothing. The person's own features can be
// renamed here too (before homes are evaluated against them).
export default function ImportanceSheet({ feature, level, open, onClose, onChoose, onRename, note = null }) {
  const id = useId();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setRenaming(false); setError(''); setName(feature?.text || ''); }, [feature?.id, open]);
  if (!feature) return null;

  const saveName = () => {
    const result = onRename?.(feature, name);
    if (result?.error) { setError(result.error); return; }
    setRenaming(false);
  };

  return (
    <Sheet open={open} onClose={onClose} title={feature.text} size="compact" className="flh-ob-pf-sheet">
      {note && <p className="flh-ob-pf-sheet-note" role="status">{note}</p>}
      <div role="group" aria-labelledby={`${id}-q`} className="flh-ob-pf-levels">
        <p id={`${id}-q`} className="flh-ob-pf-sheet-question">How important is it to you?</p>
        {PRIORITY_LEVELS.map((tier) => (
          <button key={tier} type="button" className={`flh-ob-pf-level is-${tier}${level === tier ? ' is-current' : ''}`} aria-pressed={level === tier} onClick={() => onChoose(tier)}>
            <span className="flh-ob-pf-level-dot" aria-hidden="true" />
            <span className="flh-ob-pf-level-copy">
              <span className="flh-ob-pf-level-title">{LEVEL_COPY[tier].heading}</span>
              <span className="flh-ob-pf-level-hint">{LEVEL_COPY[tier].description}</span>
            </span>
            {level === tier && <Check size={18} strokeWidth={2.6} aria-hidden="true" />}
          </button>
        ))}
        <button type="button" className={`flh-ob-pf-level is-none${level ? '' : ' is-quiet'}`} aria-pressed={false} onClick={() => onChoose('none')}>
          <span className="flh-ob-pf-level-copy">
            <span className="flh-ob-pf-level-title">{level ? 'Remove · Not important' : 'Not important'}</span>
            <span className="flh-ob-pf-level-hint">It won’t count toward any home—and it’s never marked as missing.</span>
          </span>
        </button>
      </div>
      {feature.custom && onRename && (
        <div className="flh-ob-pf-rename">
          {!renaming ? (
            <button type="button" className="flh-text-action" onClick={() => setRenaming(true)}>Rename “{feature.text}”</button>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); saveName(); }}>
              <label className="flh-ob-label" htmlFor={`${id}-name`}>Name</label>
              <span className="flh-ob-input">
                <input id={`${id}-name`} value={name} maxLength={60} autoComplete="off" aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${id}-err` : undefined} onChange={(event) => { setName(event.target.value); setError(''); }} />
              </span>
              {error && <p id={`${id}-err`} className="flh-ob-pf-error" role="alert">{error}</p>}
              <div className="flh-inline-actions">
                <button type="button" className="flh-text-action" onClick={() => setRenaming(false)}>Cancel</button>
                <button type="submit" className="flh-button flh-button-primary flh-button-small">Save name</button>
              </div>
            </form>
          )}
        </div>
      )}
      {feature.art && <p className="flh-ob-pf-sheet-fine">The picture shows an example, not any particular home.</p>}
    </Sheet>
  );
}
