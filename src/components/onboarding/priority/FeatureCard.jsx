'use client';

import { Check } from 'lucide-react';
import { LEVEL_COPY } from '@/lib/searchProfile';
import FeatureVisual from './FeatureVisual';

// One feature in the two-column grid. Tapping it opens the importance picker;
// it never selects anything by itself. The chosen level stays visible on the
// card in words (never colour alone).
export default function FeatureCard({ feature, onOpen, eager = false }) {
  const level = feature.level;
  const levelText = level ? LEVEL_COPY[level].heading : null;
  return (
    <li className="flh-ob-pf-cell">
      <button
        type="button"
        className={`flh-ob-pf-card${level ? ` is-selected is-${level}` : ''}`}
        aria-haspopup="dialog"
        aria-label={`${feature.text}${feature.custom ? ' (your own)' : ''}: ${levelText || 'not chosen'}. Choose importance`}
        onClick={() => onOpen(feature)}
      >
        <FeatureVisual feature={feature} eager={eager} />
        <span className="flh-ob-pf-card-body" aria-hidden="true">
          <span className="flh-ob-pf-card-title">{feature.text}</span>
          <span className={`flh-ob-pf-card-level${level ? ` is-${level}` : ''}`}>{levelText || 'Tap to choose'}</span>
        </span>
        {level && <span className="flh-ob-pf-card-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>}
      </button>
    </li>
  );
}
