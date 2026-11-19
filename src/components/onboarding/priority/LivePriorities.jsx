'use client';

import { useId } from 'react';
import { ChevronRight } from 'lucide-react';
import { boardColumns } from '@/lib/priorityBoard';
import { LEVEL_COPY, PRIORITY_LEVELS } from '@/lib/searchProfile';
import { storedFeatureLabel } from '@/lib/priorityCategories';

const EMPTY = {
  must: 'Nothing essential yet.',
  important: 'Nothing added here yet.',
  nice: 'Room for the little extras.',
};

export default function LivePriorities({ priorities, onOpen }) {
  const id = useId();
  const headingId = `${id}-title`;
  const itemId = (feature) => `${id}-${encodeURIComponent(feature.id)}`;
  const groups = boardColumns(priorities);

  function open(feature) {
    const restoreFocus = () => {
      const target = document.getElementById(itemId(feature)) || document.getElementById(headingId);
      // Resizing can hide the sidebar while its dialog is still open.
      const fallback = document.querySelector('.flh-ob-guided-layout .flh-onboarding-header h1');
      (target?.getClientRects().length ? target : fallback)?.focus();
    };
    // Legacy custom priorities can have a different stored spelling.
    const editable = feature.custom ? { ...feature, label: storedFeatureLabel(priorities, feature) } : feature;
    onOpen(editable, null, restoreFocus);
  }

  return (
    <aside className="flh-ob-live-priorities" aria-labelledby={headingId}>
      <header>
        <h2 id={headingId} tabIndex={-1}>Your Priorities</h2>
        <p>Saved as you go</p>
      </header>
      {PRIORITY_LEVELS.map((tier) => (
        <section className={`flh-ob-live-group is-${tier}`} key={tier} aria-labelledby={`${id}-${tier}`}>
          <h3 id={`${id}-${tier}`}>{LEVEL_COPY[tier].heading} <span>{groups[tier].length}</span></h3>
          {groups[tier].length
            ? <ul>
              {groups[tier].map((feature) => (
                <li key={feature.id}>
                  <button id={itemId(feature)} type="button" aria-haspopup="dialog"
                    aria-label={`${feature.text}: ${LEVEL_COPY[tier].heading}. Change importance`}
                    onClick={() => open(feature)}>
                    <span>{feature.text}</span><ChevronRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            : <p>{EMPTY[tier]}</p>}
        </section>
      ))}
    </aside>
  );
}
