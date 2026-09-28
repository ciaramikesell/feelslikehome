'use client';

import { Check, HousePlus, Lightbulb, Minus, X } from 'lucide-react';
import { IconBadge } from '@/components/MobileSystem';
import { criterionLabel as label, matchFactualSummary, mustHaveStatus, weightedPrioritySummary } from '@/lib/matching';

function StateIcon({ criterion }) {
  if (!criterion.evaluated) return <span className="flh-state-icon is-unknown" aria-hidden="true">?</span>;
  if (criterion.met === null) return <span className="flh-state-icon is-neutral" aria-hidden="true"><Minus size={12} /></span>;
  return criterion.met
    ? <span className="flh-state-icon is-positive" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
    : <span className="flh-state-icon is-negative" aria-hidden="true"><X size={12} strokeWidth={3} /></span>;
}

const stateText = (criterion) => (!criterion.evaluated ? 'Unknown' : criterion.met === null ? 'Neutral' : criterion.met ? 'Met' : 'Missing');

// Home Detail's Personalized Match panel. Everything here is read from the one
// canonical `match` (computeMatch) the rest of Home Detail uses — no counts are
// computed, adjusted, or reconciled for display:
//  - Must Haves: every criterion at the Must Have tier (mustHaveStatus), each
//    with its own state. Only a confirmed miss is "missing"; Unknown is Unknown.
//  - All weighted priorities: every ranked priority counted once, Must Haves
//    included (weightedPrioritySummary), so the aggregate can never say
//    everything matches while a Must Have above it is missing. Unknown is its
//    own count, never a "don't match"; a neutral tour response is its own line.
//  - The summary sentence is the deterministic matchFactualSummary, not prose.
// Search Basics are not weighted and never appear here (see SearchBasicsPanel).
export default function DetailMatchPanel({ match, heading = 'Your personalized Match' }) {
  if (!match) return null;
  const must = mustHaveStatus(match);
  const summary = weightedPrioritySummary(match);
  const factual = matchFactualSummary(match);
  return (
    <section className="flh-card flh-detail-match" aria-labelledby="detail-match-heading">
      <div className="flh-detail-match-head">
        <IconBadge icon={HousePlus} />
        <div>
          <p className="flh-section-kicker" id="detail-match-heading">{heading}</p>
          {match.pct != null
            ? <p className="flh-detail-match-score">{match.pct}% Match</p>
            : <p className="flh-detail-match-score is-unknown">Not enough information yet</p>}
        </div>
      </div>

      {must.total > 0 && (
        <div className="flh-detail-match-group is-must">
          <p className="flh-detail-match-label">Must Haves <span>{must.met} met · {must.missed} missing{must.neutral ? ` · ${must.neutral} neutral` : ''} · {must.unknown} unknown</span></p>
          <ul>
            {must.all.map((criterion) => (
              <li key={criterion.key} className={!criterion.evaluated ? 'is-unknown' : criterion.met === false ? 'is-negative' : ''}>
                <StateIcon criterion={criterion} /><span>{label(criterion)}</span><span className="sr-only">{stateText(criterion)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.total > 0 && (
        <div className="flh-detail-match-group">
          <p className="flh-detail-match-label">All weighted priorities <span>{summary.evaluated} of {summary.total} evaluated</span></p>
          <ul className="flh-detail-match-counts">
            <li><span className="flh-state-icon is-positive" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>{summary.matches.length} match</li>
            <li className={summary.mismatches.length ? 'is-negative' : ''}><span className="flh-state-icon is-negative" aria-hidden="true"><X size={12} strokeWidth={3} /></span>{summary.mismatches.length} don’t match</li>
            {summary.neutral.length > 0 && <li><span className="flh-state-icon is-neutral" aria-hidden="true"><Minus size={12} /></span>{summary.neutral.length} neutral after touring</li>}
            <li className="is-unknown"><span className="flh-state-icon is-unknown" aria-hidden="true">?</span>{summary.unknown.length} still unknown</li>
          </ul>
        </div>
      )}
      {factual && (factual.mustClause || factual.importantSentence) && (
        <p className="flh-detail-match-evidence"><Lightbulb size={15} aria-hidden="true" /><span>{[factual.mustClause && `${factual.mustClause}.`, factual.importantSentence].filter(Boolean).join(' ')}</span></p>
      )}
      <p className="flh-detail-match-note">Unknown details never count against a home.</p>
    </section>
  );
}
