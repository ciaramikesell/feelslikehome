'use client';

import { StatusTag } from '@/components/MobileSystem';
import { postTourSummary } from '@/lib/postTour';

const REACTION_TONE = { love: 'positive', considering: 'quiet', not_for_me: 'negative' };

// A participant's own post-tour take, read from the canonical postTourSummary.
// `compact` renders a single line of tags (cards); otherwise a short recap.
// Never a Match input and never merged with anyone else's take.
export default function PostTourRecap({ home, compact = false, ownerLabel = null }) {
  const take = postTourSummary(home);
  if (!take.toured && !take.verdict && !take.impressions.length) return null;
  if (take.needsTake) return <div className="flh-tour-recap is-compact"><StatusTag tone="accent">Toured · needs your take</StatusTag></div>;
  const groups = [['Loved it', take.liked], ['Neutral', take.neutral], ['Didn’t like it', take.disliked]].filter(([, items]) => items.length);
  if (compact) {
    return (
      <div className="flh-tour-recap is-compact">
        {take.verdictLabel && <StatusTag tone={REACTION_TONE[take.verdict]}>{ownerLabel ? `${ownerLabel}: ` : ''}{take.verdictLabel}</StatusTag>}
        {take.impressions.length > 0 && <span className="flh-tour-recap-count">{take.impressions.length} in-person {take.impressions.length === 1 ? 'impression' : 'impressions'}</span>}
      </div>
    );
  }
  return (
    <div className="flh-tour-recap">
      {take.verdictLabel && <p className="flh-tour-recap-verdict">{ownerLabel || 'Your reaction'}: <StatusTag tone={REACTION_TONE[take.verdict]}>{take.verdictLabel}</StatusTag></p>}
      {groups.length > 0 && <dl>{groups.map(([label, items]) => <div key={label}><dt>{label}</dt><dd>{items.map((item) => item.label).join(' · ')}</dd></div>)}</dl>}
    </div>
  );
}
