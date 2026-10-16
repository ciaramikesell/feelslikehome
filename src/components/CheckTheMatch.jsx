'use client';

import { useState } from 'react';
import { ArrowRight, Check, HelpCircle, Minus, Pencil, Users, X } from 'lucide-react';
import { matchColor } from '@/lib/matching';
import {
  TIERS, answerOptions, answerSource, currentAnswer, matchOverview, priorityLabel, priorityState, scoreExplanation, sourceNote,
} from '@/lib/matchReview';

// Check the Match — "does this home meet what matters to me?"
// Reads the one canonical computeMatch result. Answers save through the
// caller's onAnswer: a personal answer only ever touches this buyer's own row;
// a shared property fact (Pets / Utilities / In-unit laundry) the shared home.
// Fact-based priorities are answered on Home Facts, never stored twice.

const STATE_ICON = {
  match: <Check size={13} strokeWidth={3} aria-hidden="true" />,
  mismatch: <X size={13} strokeWidth={3} aria-hidden="true" />,
  neutral: <Minus size={13} aria-hidden="true" />,
  unknown: <span aria-hidden="true">?</span>,
};
const STATE_TEXT = { match: 'Matches', mismatch: 'Doesn’t match', neutral: 'Neutral', unknown: 'Unknown' };
// The highest-priority unknowns first; the rest are one tap away.
const WONDERING_PREVIEW = 5;
const TIER_SINGLE = Object.fromEntries(TIERS.map((tier) => [tier.key, tier.single]));

function AnswerControls({ criterion, home, searchType, onAnswer, label }) {
  const [pending, setPending] = useState(false);
  const value = currentAnswer(home, criterion, searchType);
  const choose = async (next) => {
    if (pending || next === value) return;
    setPending(true);
    try { await onAnswer(criterion, next); } catch { /* the workspace shows the error and restores the saved answer */ } finally { setPending(false); }
  };
  return (
    <div className="flh-answer" role="group" aria-label={`${label}: your answer`} aria-busy={pending}>
      {answerOptions(criterion).map((option) => {
        const selected = option.value === undefined ? value === undefined || value === false : value === option.value;
        const tone = option.value === undefined ? 'unknown' : option.value === true || option.value === 'positive' ? 'yes' : option.value === 'no' || option.value === 'negative' ? 'no' : 'neutral';
        return <button type="button" key={String(option.value)} className={`flh-answer-option is-${tone} ${selected ? 'is-selected' : ''}`} aria-pressed={selected} disabled={pending} onClick={() => choose(option.value)}>{option.label}</button>;
      })}
    </div>
  );
}

function PriorityRow({ criterion, home, searchType, readOnly, onAnswer, onGoToFacts, showTier = false, toured }) {
  const source = answerSource(criterion);
  const state = priorityState(criterion);
  const label = priorityLabel(criterion);
  const answerable = !readOnly && ['personal', 'shared', 'tour'].includes(source);
  const [changing, setChanging] = useState(false);
  const open = answerable && (state === 'unknown' || changing);
  const note = source === 'tour' && toured ? 'Your in-person take' : sourceNote(source);
  const detail = state === 'unknown' ? null : criterion.detail;
  return (
    <li className={`flh-priority is-${state} ${open ? 'is-open' : ''}`}>
      <div className="flh-priority-main">
        <span className={`flh-priority-icon is-${state}`}>{STATE_ICON[state]}</span>
        <div className="flh-priority-text">
          <strong>{label}</strong>
          <span className="flh-priority-meta">
            {showTier && <em className={`flh-tier-tag is-${criterion.tier}`}>{TIER_SINGLE[criterion.tier]}</em>}
            <span className="sr-only">{STATE_TEXT[state]}. </span>
            {detail && <span>{detail}</span>}
            {note && <span className="flh-priority-source">{source === 'shared' && <Users size={11} aria-hidden="true" />}{note}</span>}
          </span>
        </div>
        {answerable && state !== 'unknown' && <button type="button" className="flh-priority-change" aria-expanded={changing} onClick={() => setChanging((value) => !value)}>{changing ? 'Done' : <><Pencil size={12} aria-hidden="true" /> Change</>}<span className="sr-only"> {label}</span></button>}
        {!readOnly && source === 'facts' && state === 'unknown' && onGoToFacts && <button type="button" className="flh-priority-change" onClick={onGoToFacts}>Add in Home Facts <ArrowRight size={12} aria-hidden="true" /></button>}
      </div>
      {open && <AnswerControls criterion={criterion} home={home} searchType={searchType} onAnswer={onAnswer} label={label} />}
      {open && source === 'shared' && <p className="flh-priority-hint">A property fact — your answer is shared with everyone in this search.</p>}
    </li>
  );
}

export default function CheckTheMatch({ home, match, priorities, vocabulary, readOnly = false, perspectiveName = null, coBuyerPerspective = null, coBuyerName = null, toured = false, saveError = '', onAnswer, onGoToFacts, matchRef = null, children = null }) {
  const [showAll, setShowAll] = useState(false);
  const [allUnknown, setAllUnknown] = useState(false);
  const overview = matchOverview(match);
  const searchType = priorities.searchType;
  const whose = readOnly ? `${perspectiveName || 'The buyer'}’s` : 'Your';
  const reviewUnknown = () => {
    const target = document.getElementById('still-wondering');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target?.focus({ preventScroll: true });
  };
  const rowProps = { home, searchType, readOnly, onAnswer, onGoToFacts, toured };
  const niceMisses = overview.mismatches.filter((criterion) => criterion.tier === 'nice').length;
  const coMatch = coBuyerPerspective?.match;

  if (!overview.total) return <section className="flh-match"><div className="flh-match-empty"><HelpCircle size={22} aria-hidden="true" /><div><strong className="hh-serif">No priorities to check yet</strong><p>{readOnly ? 'The buyer hasn’t set priorities for this search yet.' : 'Set what matters in My Search and this page will show how the home lines up.'}</p></div></div>{children}</section>;

  return (
    <section className="flh-match" aria-label={`${whose} Match`}>
      {saveError && <p className="hh-save-error" role="alert">{saveError}</p>}

      <div className="flh-match-overview" ref={matchRef} tabIndex={-1}>
        <div className="flh-match-score" style={{ '--score-color': matchColor(overview.pct) }}>
          <strong>{overview.pct == null ? '—' : `${overview.pct}%`}</strong>
          <span>{whose} Match</span>
        </div>
        <div className="flh-match-summary-text">
          <h2 className="hh-serif">{overview.pct == null ? 'Not enough answers yet' : overview.mustMisses.length ? `${overview.pct}% — with a Must-Have to weigh` : overview.pct >= 80 ? `${overview.pct}% — lining up well so far` : `${overview.pct}% of what matters, so far`}</h2>
          <p>{scoreExplanation(overview)}{niceMisses > 0 ? ` ${niceMisses} Nice-to-Have ${niceMisses === 1 ? 'answer is' : 'answers are'} a confirmed No, which lowers the score a little.` : ''}</p>
          <ul className="flh-match-counts">
            <li className="is-match">{STATE_ICON.match}{overview.matches.length} {overview.matches.length === 1 ? 'match' : 'match'}</li>
            <li className="is-mismatch">{STATE_ICON.mismatch}{overview.mismatches.length} {overview.mismatches.length === 1 ? 'doesn’t match' : 'don’t match'}</li>
            {overview.neutral.length > 0 && <li className="is-neutral">{STATE_ICON.neutral}{overview.neutral.length} neutral</li>}
            <li className="is-unknown">{STATE_ICON.unknown}{overview.unknownCount} still unknown</li>
          </ul>
          <p className="flh-match-progress">{overview.confirmedCount} of {overview.total} priorities have an answer.</p>
          {overview.unknownCount > 0 && !readOnly && <button type="button" className="flh-match-review" onClick={reviewUnknown}>Review what’s still unknown <ArrowRight size={14} aria-hidden="true" /></button>}
        </div>
      </div>

      {overview.mustMisses.length > 0 && <aside className="flh-match-attention" aria-label="Must-Haves needing attention">
        <strong className="hh-serif">{overview.mustMisses.length === 1 ? 'A Must-Have isn’t met' : `${overview.mustMisses.length} Must-Haves aren’t met`}</strong>
        <ul>{overview.mustMisses.map((criterion) => <li key={criterion.key}><X size={13} strokeWidth={3} aria-hidden="true" /> {priorityLabel(criterion)}{criterion.detail && criterion.detail !== 'No' ? ` — ${criterion.detail}` : ''}</li>)}</ul>
        <p>This is a confirmed answer, not an unknown. It counts most against this home. If it’s wrong, change it below.</p>
      </aside>}

      {overview.unknownCount > 0 && <section className="flh-match-block flh-match-wondering" id="still-wondering" tabIndex={-1} aria-labelledby="still-wondering-title">
        <div className="flh-match-block-head">
          <h3 id="still-wondering-title" className="hh-serif">Still wondering about…</h3>
          <p>{readOnly ? 'Priorities without an answer yet. Unknown never counts against the home.' : 'Answer what you know — anything you leave as Unknown simply isn’t counted. Must-Haves come first.'}</p>
        </div>
        <ul className="flh-priority-list">{(allUnknown ? overview.unknown : overview.unknown.slice(0, WONDERING_PREVIEW)).map((criterion) => <PriorityRow key={criterion.key} criterion={criterion} showTier {...rowProps} />)}</ul>
        {overview.unknownCount > WONDERING_PREVIEW && <button type="button" className="flh-match-review" aria-expanded={allUnknown} onClick={() => setAllUnknown((value) => !value)}>{allUnknown ? 'Show fewer' : `Show ${overview.unknownCount - WONDERING_PREVIEW} more`}</button>}
      </section>}

      <section className="flh-match-block" aria-labelledby="match-known-title">
        <div className="flh-match-block-head is-row">
          <div>
            <h3 id="match-known-title" className="hh-serif">{showAll ? 'All priorities' : 'What’s confirmed'}</h3>
            <p>{showAll ? 'Every priority in this search, by importance.' : 'Answers so far, by importance. They stay compact so the page gets calmer as you learn more.'}</p>
          </div>
          <div className="flh-match-toggle" role="group" aria-label="Which priorities to show">
            <button type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>Confirmed</button>
            <button type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}>All {overview.total}</button>
          </div>
        </div>
        {overview.tiers.map((tier) => {
          const items = showAll ? tier.items : tier.items.filter((criterion) => criterion.evaluated);
          return <div key={tier.key} className={`flh-match-tier is-${tier.key}`}>
            <h4>{tier.title}<small>{tier.items.filter((criterion) => criterion.evaluated).length} of {tier.items.length} answered</small></h4>
            {items.length ? <ul className="flh-priority-list is-compact">{items.map((criterion) => <PriorityRow key={criterion.key} criterion={criterion} {...rowProps} />)}</ul>
              : <p className="flh-match-none">Nothing confirmed yet.</p>}
          </div>;
        })}
      </section>

      {coBuyerPerspective && <section className="flh-match-block flh-match-cobuyer" aria-labelledby="cobuyer-match-title">
        <h3 id="cobuyer-match-title" className="hh-serif"><Users size={17} aria-hidden="true" /> {coBuyerName ? `${coBuyerName}’s Match` : 'Your co-buyer’s Match'}</h3>
        {coMatch?.pct != null
          ? <p><strong>{coMatch.pct}%</strong> — based on their own priorities and their own answers ({coMatch.evaluatedCount} of {coMatch.selectedCount} answered). Each buyer’s answers stay separate; shared property facts are the same for both.</p>
          : <p>No Match for them yet — they haven’t confirmed enough of their own priorities for this home.</p>}
      </section>}

      {children}
    </section>
  );
}
