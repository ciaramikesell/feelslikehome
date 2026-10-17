'use client';

import { useState } from 'react';
import { Check, Footprints, Heart, MessageSquareQuote, Pencil, RotateCcw, Star, Users } from 'lucide-react';
import { POST_TOUR_EVALUATIONS, POST_TOUR_RESPONSES, POST_TOUR_VERDICTS } from '@/components/PostTourModal';
import { criterionDisplayLabel, isArchivedStatus, TOUR_RATING_KEY, tourResponseLabel, tourResponseOptions } from '@/lib/constants';
import { inPersonAnswer, inPersonCriteria } from '@/lib/matchCriteria';
import { hasToured, postTourVerdict } from '@/lib/lifecycle';

// Tour Feedback — "how did I actually feel about this home?"
// Reuses the existing stores and workflows only:
//  - reaction, tour date and the post-tour survey are this person's own
//    home_member_state, recorded through the existing PostTourModal
//    (onRecordTake); nothing here marks a home toured by itself;
//  - "Things to check in person" answers the buyer's own selected in-person
//    Match criteria (Natural Light, Layout / Flow …) through onAnswerInPerson:
//    the same ratings[key] tour response Match already scores, so the answer
//    shows in Match Criteria at once. It is not a second survey;
//  - pros, cons and notes are the shared home fields (no per-person author),
//    shown exactly as written and edited through onSaveNotes (shared save);
//  - Realtor context is rendered by the caller (children).
// Carried over from the #151 evaluation redesign onto the #152 workspace.

const criterionName = (item) => (item.key.includes(':') ? criterionDisplayLabel(item.key.split(':')[0], item.label) : item.label);

function Stars({ value }) {
  return <span className="flh-tour-stars" aria-label={`${value} out of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={15} fill={n <= value ? 'currentColor' : 'none'} aria-hidden="true" />)}</span>;
}

const TIER_TAG = { must: 'Must-Have', important: 'Important', nice: 'Nice to Have' };
const splitKey = (key) => [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];

// One in-person Match criterion: its own tour responses plus Unknown, written to
// this buyer's ratings only. Same radio control as Match Criteria.
function InPersonRow({ item, home, readOnly, onAnswer }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [categoryKey, label] = splitKey(item.key);
  const value = inPersonAnswer(home, item.key);
  const older = typeof home.ratings?.[item.key] === 'number' && home.ratings[item.key] > 0 ? home.ratings[item.key] : null;
  const options = [...tourResponseOptions(categoryKey, label), { value: undefined, label: 'Unknown' }];
  const tone = (option) => (option.value === 'positive' ? 'yes' : option.value === 'negative' ? 'no' : option.value === 'neutral' ? 'neutral' : 'unknown');
  const answer = async (next) => {
    setPending(true); setError('');
    try { await onAnswer(item, next); } catch { setError('Couldn’t save that answer. Try again.'); } finally { setPending(false); }
  };
  return <li className="flh-tour-check">
    <div className="flh-tour-check-copy">
      <strong>{criterionName(item)}</strong>
      <small><span className={`flh-tier-tag is-${item.tier}`}>{TIER_TAG[item.tier]}</span>{older && value === undefined ? ` · Earlier rating ${older}/5 still counts until you choose` : ''}</small>
      {error && <span className="hh-save-error" role="alert">{error}</span>}
    </div>
    {readOnly
      ? <span className={`flh-mc-readonly is-${value === 'positive' ? 'yes' : value === 'negative' ? 'no' : 'unknown'}`}>{value ? tourResponseLabel(categoryKey, label, value) : older ? `${older}/5` : 'Unknown'}</span>
      : <fieldset className="flh-mc-answer flh-tour-check-answer" disabled={pending}>
        <legend className="sr-only">{criterionName(item)}</legend>
        {options.map((option) => {
          const checked = option.value === undefined ? value === undefined && !older : value === option.value;
          return <label key={option.label} className={`flh-mc-option is-${tone(option)} ${checked ? 'is-checked' : ''}`}>
            <input type="radio" name={`in-person-${item.key}`} checked={checked} onChange={() => answer(option.value)} />
            <span>{option.label}</span>
          </label>;
        })}
      </fieldset>}
  </li>;
}

function InPersonChecks({ match, home, readOnly, isCollaborative, perspectiveName, onAnswer }) {
  const items = inPersonCriteria(match);
  if (!items.length) return null;
  const answered = items.filter((item) => inPersonAnswer(home, item.key)).length;
  return (
    <section className="flh-tour-block" aria-labelledby="tour-in-person-checks-title">
      <div className="flh-tour-block-head"><div>
        <h3 id="tour-in-person-checks-title" className="hh-serif">Things to check in person</h3>
        <p>{readOnly
          ? `From ${perspectiveName || 'the buyer'}’s Match Criteria. ${answered} of ${items.length} answered.`
          : `From your Match Criteria — answer any time, before or after a visit, or skip. Unknown never counts against this home.${isCollaborative ? ' Your answers are yours; your co-buyer keeps their own.' : ''}`}</p>
      </div></div>
      <ul className="flh-tour-checks">{items.map((item) => <InPersonRow key={item.key} item={item} home={home} readOnly={readOnly} onAnswer={onAnswer} />)}</ul>
    </section>
  );
}

const RESPONSE_LABEL = Object.fromEntries(POST_TOUR_RESPONSES.map((item) => [item.value, item.label]));
const formatDate = (iso) => {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(date) : null;
};

function NotesEditor({ home, onSave, onCancel }) {
  const [draft, setDraft] = useState({ pros: home.pros || '', cons: home.cons || '', notes: home.notes || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try { await onSave(draft); } catch { setError('We couldn’t save your notes. Please try again — nothing you typed is lost.'); setSaving(false); }
  };
  return (
    <div className="flh-tour-notes-form">
      <label>What you loved<textarea className="hh-textarea flh-tour-short-text" value={draft.pros} onChange={(event) => setDraft({ ...draft, pros: event.target.value })} placeholder="Great kitchen, quiet street" /></label>
      <label>What gave you pause<textarea className="hh-textarea flh-tour-short-text" value={draft.cons} onChange={(event) => setDraft({ ...draft, cons: event.target.value })} placeholder="Busy road" /></label>
      <label className="wide">Notes<textarea className="hh-textarea" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="HOA details, sewer/water, financing options, recent updates, listing terms, or anything else worth noting." /></label>
      {error && <p className="hh-save-error wide" role="alert">{error}</p>}
      <div className="wide flh-tour-form-actions"><button type="button" className="hh-btn hh-btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button><button type="button" className="hh-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save notes'}</button></div>
    </div>
  );
}

function NotesSection({ home, title, intro, readOnly, isCollaborative, onSaveNotes }) {
  const [editing, setEditing] = useState(false);
  // Shown exactly as written: splitting on commas would break phrases such as
  // "Bright, open living room" (pros and cons are free text, not lists).
  const pros = (home.pros || '').trim();
  const cons = (home.cons || '').trim();
  const hasAny = pros || cons || home.notes;
  return (
    <section className="flh-tour-block" aria-labelledby="tour-notes-title">
      <div className="flh-tour-block-head">
        <div><h3 id="tour-notes-title" className="hh-serif">{title}</h3><p>{intro}{isCollaborative ? ' Shared with everyone in this search.' : ''}</p></div>
        {!readOnly && !editing && <button type="button" className="flh-hf-edit" onClick={() => setEditing(true)}><Pencil size={13} aria-hidden="true" /> {hasAny ? 'Edit' : 'Add'}<span className="sr-only"> notes</span></button>}
      </div>
      {editing ? <NotesEditor home={home} onCancel={() => setEditing(false)} onSave={async (draft) => { await onSaveNotes(draft); setEditing(false); }} />
        : hasAny ? <div className="flh-tour-notes">
          <div className="flh-tour-list is-loved"><h4>What {readOnly ? 'they' : 'you'} loved</h4>{pros ? <p>{pros}</p> : <p className="flh-tour-empty-line">Nothing yet.</p>}</div>
          <div className="flh-tour-list is-pause"><h4>What gave {readOnly ? 'them' : 'you'} pause</h4>{cons ? <p>{cons}</p> : <p className="flh-tour-empty-line">Nothing yet.</p>}</div>
          {home.notes && <div className="flh-tour-list is-notes wide"><h4>Notes</h4><p>{home.notes}</p></div>}
        </div>
          : <p className="flh-tour-empty-line">{readOnly ? 'No notes yet.' : 'Nothing written yet. Jot down anything — before or after a visit.'}</p>}
    </section>
  );
}

export default function TourFeedback({ home, match, vocabulary, readOnly = false, isCollaborative = false, perspectiveName = null, coBuyerPerspective = null, coBuyerName = null, saveError = '', onRetry = null, onRecordTake, onToggleWantToTour, onToggleFavorite, onArchive, onRestore, onSaveNotes, onAnswerInPerson, children = null }) {
  const toured = hasToured(home);
  const verdict = POST_TOUR_VERDICTS.find((item) => item.key === postTourVerdict(home));
  const overall = home.ratings?.[TOUR_RATING_KEY] || 0;
  const survey = POST_TOUR_EVALUATIONS.filter((item) => home.ratings?.[item.key]).map((item) => ({ ...item, response: home.ratings[item.key] }));
  // Older 1–5 rating priorities (not in-person Match criteria) stay visible as
  // part of the take. In-person criteria live in "Things to check in person",
  // and answering one never makes this read as a recorded take or a tour.
  const inPersonKeys = new Set(inPersonCriteria(match).map((criterion) => criterion.key));
  const olderRatings = (match?.allSelected || []).filter((criterion) => !criterion.objective && criterion.evaluated && !inPersonKeys.has(criterion.key));
  const hasTake = Boolean(verdict || overall > 0 || survey.length);
  const who = readOnly ? (perspectiveName || 'The buyer') : 'You';
  const whose = readOnly ? `${perspectiveName || 'The buyer'}’s` : 'Your';
  const archived = isArchivedStatus(home.status);
  const tourDate = formatDate(home.touredAt);
  const coTakes = coBuyerPerspective?.differentTakes || [];
  const coHasTake = Boolean(coBuyerPerspective && (coBuyerPerspective.overallFeeling > 0 || coTakes.length));
  const VerdictIcon = verdict?.icon || Footprints;

  return (
    <section className="flh-tour" aria-label={`${whose} tour feedback`}>
      {saveError && <p className="hh-save-error" role="alert">{saveError}{onRetry && <> <button type="button" onClick={onRetry}>Retry</button></>}</p>}

      {!readOnly && <div className="flh-tour-plans" aria-label="Your plans for this home">
        {toured ? <span className="hh-detail-toured-state"><Check size={15} aria-hidden="true" /> Toured{tourDate ? ` ${tourDate}` : ''}</span>
          : <button type="button" className={`hh-btn ${home.status === 'Want to Tour' ? 'hh-btn-ghost' : ''}`} aria-pressed={home.status === 'Want to Tour'} onClick={onToggleWantToTour}><Footprints size={15} aria-hidden="true" />{home.status === 'Want to Tour' ? 'On your Want to Tour list' : 'Want to tour'}</button>}
        <button type="button" className="hh-btn hh-btn-ghost" aria-pressed={home.isFavorite} onClick={onToggleFavorite}><Heart size={15} aria-hidden="true" fill={home.isFavorite ? 'currentColor' : 'none'} />{home.isFavorite ? 'Favorited' : 'Favorite'}</button>
        <button type="button" className="hh-detail-archive-action" onClick={archived ? onRestore : onArchive}>{archived ? <><RotateCcw size={14} aria-hidden="true" /> Restore</> : 'Archive'}</button>
      </div>}
      {!readOnly && home.coBuyerWantsToTour && <p className="flh-tour-context">Your co-buyer still wants to tour this home.</p>}

      {toured || hasTake ? <section className={`flh-tour-hero is-${verdict?.key || 'none'}`} aria-labelledby="tour-take-heading">
        <span className="flh-tour-hero-icon" aria-hidden="true"><VerdictIcon size={24} fill={verdict?.filled ? 'currentColor' : 'none'} /></span>
        <div>
          <p className="flh-eyebrow">{whose} take{readOnly && tourDate ? ` · toured ${tourDate}` : ''}</p>
          <h2 id="tour-take-heading" className="hh-serif">{verdict ? verdict.title : `${who} toured it — no reaction recorded yet`}</h2>
          <p>{verdict ? ({ love: 'A real contender.', considering: 'Not sure yet — still weighing it.', not_for_me: 'Ruled out after seeing it.' })[verdict.key] : 'Add how it felt while it’s fresh.'}{overall > 0 && <> <Stars value={overall} /> overall feeling</>}</p>
          {isCollaborative && !readOnly && <p className="flh-tour-context">Your reaction and in-person answers are yours. Your co-buyer can see them and keeps their own.</p>}
          {!readOnly && <button type="button" className="hh-btn hh-btn-ghost" onClick={onRecordTake}>{verdict ? 'Edit your take' : 'Record your take'}</button>}
        </div>
      </section>
        : <section className="flh-tour-hero is-empty" aria-labelledby="tour-take-heading">
          <span className="flh-tour-hero-icon" aria-hidden="true"><MessageSquareQuote size={24} /></span>
          <div>
            <p className="flh-eyebrow">Before the tour</p>
            <h2 id="tour-take-heading" className="hh-serif">{readOnly ? `${who} hasn’t recorded a tour yet` : 'Your impressions will live here'}</h2>
            <p>{readOnly ? 'Their reaction and in-person impressions will appear here after they tour.' : `After you visit, capture how this ${vocabulary.singularLower} actually felt — what you loved and what gave you pause. It won’t change your Match.`}</p>
            {!readOnly && <button type="button" className="hh-btn hh-btn-ghost" onClick={onRecordTake}>I’ve toured it — record my take</button>}
          </div>
        </section>}

      <InPersonChecks match={match} home={home} readOnly={readOnly} isCollaborative={isCollaborative} perspectiveName={perspectiveName} onAnswer={onAnswerInPerson} />

      {(survey.length > 0 || olderRatings.length > 0) && <section className="flh-tour-block" aria-labelledby="tour-in-person-title">
        <div className="flh-tour-block-head"><div><h3 id="tour-in-person-title" className="hh-serif">How it felt in person</h3><p>From {readOnly ? 'their' : 'your'} take after the tour.</p></div></div>
        <dl className="flh-tour-feelings">
          {survey.map((item) => <div key={item.key} className={`is-${item.response}`}><dt>{item.label}</dt><dd>{RESPONSE_LABEL[item.response] || item.response}</dd></div>)}
          {olderRatings.map((criterion) => <div key={criterion.key} className={criterion.met === true ? 'is-positive' : criterion.met === false ? 'is-negative' : 'is-neutral'}><dt>{criterionName(criterion)}</dt><dd>{criterion.detail}</dd></div>)}
        </dl>
      </section>}

      <NotesSection
        home={home} readOnly={readOnly} isCollaborative={isCollaborative} onSaveNotes={onSaveNotes}
        title={toured ? 'What stood out' : 'Notes so far'}
        intro={readOnly ? 'What the buyers loved, what gave them pause, and their notes.' : toured ? 'What you loved, what gave you pause, and anything else worth remembering.' : 'Anything you’ve noticed or want to ask — these are notes, not tour feedback.'}
      />

      {coBuyerPerspective && <section className="flh-tour-block flh-tour-cobuyer" aria-labelledby="cobuyer-take-title">
        <div className="flh-tour-block-head"><div><h3 id="cobuyer-take-title" className="hh-serif"><Users size={17} aria-hidden="true" /> {coBuyerName ? `${coBuyerName}’s take` : 'Your co-buyer’s take'}</h3><p>{readOnly ? 'Each buyer’s reactions are their own.' : 'Their reactions are their own and are never changed by yours.'}</p></div></div>
        {coHasTake ? <>
          {coBuyerPerspective.overallFeeling > 0 && <p className="flh-tour-co-overall"><Stars value={coBuyerPerspective.overallFeeling} /> overall feeling</p>}
          {coTakes.length > 0 && <div className="flh-tour-differences"><h4>{readOnly ? `Where ${perspectiveName || 'the buyers'} and ${coBuyerName || 'their co-buyer'} see it differently` : 'Where you see it differently'}</h4>{coTakes.map((take) => { const category = take.key?.split(':')[0]; return <p key={take.key}><strong>{criterionDisplayLabel(category, take.label)}</strong><span>{take.youLiked ? (readOnly ? 'They liked it' : 'You liked it') : (readOnly ? 'They didn’t' : 'You didn’t')} · {take.coBuyerLiked ? `${coBuyerName || 'Co-buyer'} did` : `${coBuyerName || 'Co-buyer'} didn’t`}</span></p>; })}</div>}
        </> : <p className="flh-tour-empty-line">No take from them yet.</p>}
      </section>}

      {children}
    </section>
  );
}
