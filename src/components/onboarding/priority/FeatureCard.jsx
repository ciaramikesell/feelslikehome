'use client';

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { LEVEL_COPY } from '@/lib/searchProfile';
import FeatureVisual from './FeatureVisual';

// One feature in the two-column grid. Tapping it opens the importance picker;
// it never selects anything by itself. The chosen level stays visible on the
// card in words (never colour alone). An ambiguous card (Extra Bedroom,
// Private Garage, Landscaping) carries a one-line hint.
// Milestone 3: when the level changes (never on first render), the badge and
// check get one short spring (CSS, ~240ms) so the choice visibly lands. Keyed
// on the level, so it plays once per change and never loops.
export default function FeatureCard({ feature, onOpen, eager = false }) {
  const level = feature.level;
  const levelText = level ? LEVEL_COPY[level].heading : null;
  const previous = useRef(level);
  const [justSet, setJustSet] = useState(false);
  useEffect(() => {
    const was = previous.current;
    previous.current = level;
    if (!level || was === level) return undefined;
    setJustSet(true);
    const timer = setTimeout(() => setJustSet(false), 400);
    return () => clearTimeout(timer);
  }, [level]);
  return (
    <li className="flh-ob-pf-cell">
      <button
        type="button"
        className={`flh-ob-pf-card${level ? ` is-selected is-${level}` : ''}${justSet ? ' is-just-set' : ''}`}
        aria-haspopup="dialog"
        aria-label={`${feature.text}${feature.custom ? ' (your own)' : ''}: ${levelText || 'not chosen'}. Choose importance${feature.hint ? `. ${feature.hint}` : ''}`}
        onClick={() => onOpen(feature)}
      >
        <FeatureVisual feature={feature} eager={eager} />
        <span className="flh-ob-pf-card-body" aria-hidden="true">
          <span className="flh-ob-pf-card-title">{feature.text}</span>
          {feature.hint && <span className="flh-ob-pf-card-hint">{feature.hint}</span>}
          <span key={level || 'none'} className={`flh-ob-pf-card-level${level ? ` is-${level}` : ''}`}>{levelText || 'Tap to choose'}</span>
        </span>
        {level && <span key={level} className="flh-ob-pf-card-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>}
      </button>
    </li>
  );
}
