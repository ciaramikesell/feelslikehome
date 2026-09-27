'use client';

import { Check, Minus, X } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import { criterionLabel as label, matchColor, mustHaveStatus, selectHomeCardCriteria } from '@/lib/matching';

function StateIcon({ criterion }) {
  if (!criterion.evaluated) return <span className="flh-state-icon is-unknown" aria-hidden="true">?</span>;
  if (criterion.met === null) return <span className="flh-state-icon is-neutral" aria-hidden="true"><Minus size={12} /></span>;
  return criterion.met
    ? <span className="flh-state-icon is-positive" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
    : <span className="flh-state-icon is-negative" aria-hidden="true"><X size={12} strokeWidth={3} /></span>;
}

const stateText = (criterion) => (!criterion.evaluated ? 'Unknown' : criterion.met === null ? 'Neutral' : criterion.met ? 'Met' : 'Missing');

// Home Detail's compact Match panel. Everything here is read from the one
// canonical `match` (computeMatch) the rest of Home Detail uses — no counts are
// computed, adjusted, or reconciled for display:
//  - Must Haves: every criterion at the Must Have tier (mustHaveStatus), each
//    with its own state. Only a confirmed miss is "missing"; Unknown is Unknown.
//  - Personalized criteria: the non-Must-Have summary the Homes card has always
//    used (selectHomeCardCriteria). evaluated = match + don't match; unknown is
//    listed separately; a neutral tour response is its own line when present.
export default function DetailMatchPanel({ match, heading = 'Your personalized Match' }) {
  if (!match) return null;
  const must = mustHaveStatus(match);
  const { criteriaSummary } = selectHomeCardCriteria(match);
  const summary = criteriaSummary || { total: 0, evaluated: 0, matches: [], mismatches: [], unknown: [], neutral: [] };
  return (
    <section className="flh-card flh-detail-match" aria-labelledby="detail-match-heading">
      <p className="flh-section-kicker" id="detail-match-heading">{heading}</p>
      {match.pct != null
        ? <div className="flh-detail-match-score" style={{ color: matchColor(match.pct) }}><BrandMark size={22} /> {match.pct}% Match</div>
        : <div className="flh-detail-match-score is-unknown"><BrandMark size={22} /> Not enough information yet</div>}

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
          <p className="flh-detail-match-label">Personalized criteria <span>{summary.evaluated}/{summary.total} evaluated</span></p>
          <ul className="flh-detail-match-counts">
            <li><span className="flh-state-icon is-positive" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>{summary.matches.length} match</li>
            <li><span className="flh-state-icon is-negative" aria-hidden="true"><X size={12} strokeWidth={3} /></span>{summary.mismatches.length} don’t match</li>
            {summary.neutral.length > 0 && <li><span className="flh-state-icon is-neutral" aria-hidden="true"><Minus size={12} /></span>{summary.neutral.length} neutral after touring</li>}
            <li><span className="flh-state-icon is-unknown" aria-hidden="true">?</span>{summary.unknown.length} {summary.unknown.length === 1 ? 'criterion' : 'criteria'} still unknown</li>
          </ul>
        </div>
      )}
      <p className="flh-detail-match-note">Unknown details never count against a home.</p>
    </section>
  );
}
