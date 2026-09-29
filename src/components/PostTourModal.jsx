'use client';

import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, CircleDashed, Heart, Home as HomeIcon, X, XCircle } from 'lucide-react';
import { postTourVerdict } from '@/lib/lifecycle';
import { POST_TOUR_EVALUATIONS, TOUR_RESPONSES, reactionLabel } from '@/lib/postTour';
import { homeIdentity } from '@/lib/homePresentation';

export { POST_TOUR_EVALUATIONS };

// Overall reaction: participant-owned lifecycle state (Love it / Still
// considering / Rule this one out). Labels come from the shared postTour model.
const VERDICTS = [
  { key: 'love', icon: Heart, filled: true, body: 'Real contender.' },
  { key: 'considering', icon: CircleDashed, body: 'Not sure yet.' },
  { key: 'not_for_me', icon: XCircle, body: 'Not the one.' },
];

function Evaluation({ item, value, onChange }) {
  return <fieldset className="hh-tour-response-group">
    <legend>{item.label}</legend>
    <div role="radiogroup" aria-label={`${item.label} in-person evaluation`}>
      {TOUR_RESPONSES.map((option) => <label key={option.value} className={value === option.value ? 'is-selected' : ''}>
        <input type="radio" name={item.key} checked={value === option.value} onChange={() => onChange(option.value)} />
        <span>{option.label}</span>
      </label>)}
    </div>
    {value && <button type="button" className="hh-clear-tour-response" onClick={() => onChange(undefined)}>Clear answer</button>}
  </fieldset>;
}

// Two-step memory capture: (1) overall reaction + quick impressions, then
// (2) notes + an editable recap. Nothing here is a Match input: impressions are
// tour-v2:* keys and the reaction is lifecycle state; notes are appended to the
// home's notes, which are shared in a shared search (labeled truthfully).
export default function PostTourModal({ home, priorities = null, isCollaborative = false, collaboratorName = null, saveError = '', onVerdict, onClose }) {
  const [step, setStep] = useState(1);
  const [verdict, setVerdict] = useState(postTourVerdict(home));
  const [ratings, setRatings] = useState(home.ratings || {});
  const [noteEntry, setNoteEntry] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const bodyRef = useRef(null);
  const evaluationCount = useMemo(() => POST_TOUR_EVALUATIONS.filter(({ key }) => ratings[key]).length, [ratings]);
  const identity = homeIdentity(home, priorities);
  const partner = collaboratorName || 'Your co-buyer';
  const recap = (response) => POST_TOUR_EVALUATIONS.filter(({ key }) => ratings[key] === response).map(({ label }) => label);

  const goTo = (next) => { setStep(next); bodyRef.current?.scrollTo?.({ top: 0 }); };
  const chooseVerdict = (next) => {
    setVerdict(next);
    setSaved(null);
  };
  const save = async () => {
    if (!verdict || saving) return;
    setSaving(true);
    try {
      await onVerdict(home, verdict, { ratings, noteEntry: noteEntry.trim() });
      setSaved({ verdict, noteAdded: Boolean(noteEntry.trim()), evaluationCount });
    } catch {} finally { setSaving(false); }
  };

  if (saved) return <div className="hh-modal-backdrop"><div className="hh-modal hh-corner hh-post-tour-modal" role="dialog" aria-modal="true" aria-labelledby="tour-saved-title">
    <button className="hh-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
    <Check className="hh-tour-saved-icon" size={28} aria-hidden="true" />
    <h2 id="tour-saved-title" className="hh-serif">Your tour take is saved.</h2>
    <p className="hh-tour-confirmation-reaction">{reactionLabel(saved.verdict)}</p>
    <ul className="hh-tour-confirmation-list">
      <li>✓ Tour feedback saved</li>
      {saved.noteAdded && <li>✓ Note added</li>}
      {saved.evaluationCount > 0 && <li>✓ {saved.evaluationCount} in-person {saved.evaluationCount === 1 ? 'detail' : 'details'} recorded</li>}
    </ul>
    <p className="flh-tour-match-note">Your take is your own perspective. It won’t change your Match.</p>
    <button className="hh-btn" onClick={onClose}>Done</button>
  </div></div>;

  return <div className="hh-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="hh-modal hh-corner hh-post-tour-modal flh-post-tour" role="dialog" aria-modal="true" aria-labelledby="tour-take-title">
      <header className="hh-tour-header flh-post-tour-header">
        {step === 2 ? <button type="button" className="flh-icon-button flh-icon-button-plain" onClick={() => goTo(1)} aria-label="Back to step 1"><ArrowLeft size={18} /></button> : <span aria-hidden="true" />}
        <div><h2 id="tour-take-title" className="hh-serif">Record your take</h2><p>Step {step} of 2 · Capture what only being there could tell you.</p></div>
        <button className="hh-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <div className="flh-post-tour-home">
        <span className="flh-post-tour-thumb" aria-hidden="true">{home.photoUrl ? <img src={home.photoUrl} alt="" /> : <HomeIcon size={18} />}</span>
        <span><strong>{identity.primary}</strong>{identity.supporting && <small>{identity.supporting}</small>}</span>
      </div>
      {saveError && <p className="hh-save-error" role="alert">{saveError}</p>}

      <div ref={bodyRef} className="flh-post-tour-body">
        {step === 1 && <>
          <section className="hh-tour-section">
            <h3>Where are you at with this home?</h3>
            <div className="hh-post-tour-verdicts">{VERDICTS.map((item) => { const Icon = item.icon; const selected = verdict === item.key; return <button key={item.key} type="button" aria-pressed={selected} className={selected ? 'is-selected' : ''} onClick={() => chooseVerdict(item.key)}><Icon size={21} fill={selected && item.filled ? 'currentColor' : 'none'} /><strong>{reactionLabel(item.key)}</strong><span>{item.body}</span></button>; })}</div>
          </section>

          {verdict === 'not_for_me' && <aside className="hh-tour-fast-exit"><p>That’s enough to save your take. Add details if you want to remember why.</p><div><button className="hh-btn" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save my take'}</button></div></aside>}

          <section className="hh-tour-section"><p className="flh-step-label">Step 1</p><h3>How did it feel in person?</h3><p className="hh-tour-optional">Optional — answer only what stood out.</p><div className="hh-tour-evaluations">{POST_TOUR_EVALUATIONS.map((item) => <Evaluation key={item.key} item={item} value={ratings[item.key]} onChange={(value) => setRatings((current) => { const next = { ...current }; if (value) next[item.key] = value; else delete next[item.key]; return next; })} />)}</div></section>
          {isCollaborative && <p className="flh-post-tour-owner">Your reaction and in-person evaluations belong to you. {partner} records a separate take, and neither of you changes the other’s.</p>}
        </>}

        {step === 2 && <>
          <section className="hh-tour-section hh-tour-note"><p className="flh-step-label">Step 2</p><h3>Anything you want to remember?</h3><p>Get your thoughts down while they’re fresh. Type them here, or use your keyboard’s dictation to talk them out.</p>
            <label className="sr-only" htmlFor="post-tour-note">Tour note</label>
            <textarea id="post-tour-note" className="hh-textarea" value={noteEntry} onChange={(event) => setNoteEntry(event.target.value)} placeholder="Walkability, home condition, natural light, any concerns?" />
            <p className="flh-post-tour-owner">{isCollaborative ? 'Notes are added to this home’s notes, which everyone in this search can see.' : 'Notes are added to this home’s notes.'} They’re perspective, not verified property facts.</p>
          </section>
          <section className="flh-post-tour-recap" aria-labelledby="post-tour-recap">
            <div className="flh-section-label"><h3 id="post-tour-recap">Your quick recap</h3><button type="button" className="flh-text-action" onClick={() => goTo(1)}>Edit</button></div>
            <dl>
              <div><dt>Overall</dt><dd>{reactionLabel(verdict) || 'Not chosen yet'}</dd></div>
              {recap('positive').length > 0 && <div><dt>Loved it</dt><dd>{recap('positive').join(' · ')}</dd></div>}
              {recap('neutral').length > 0 && <div><dt>Neutral</dt><dd>{recap('neutral').join(' · ')}</dd></div>}
              {recap('negative').length > 0 && <div><dt>Didn’t like it</dt><dd>{recap('negative').join(' · ')}</dd></div>}
            </dl>
          </section>
        </>}
        {/* The in-person evaluations use tour-v2:* keys, which are not Match criteria,
            and the verdict is a lifecycle state — neither feeds computeMatch. */}
        <p className="flh-tour-match-note">Your in-person take is saved with this home. It won’t change your Match — Match reflects your My Search priorities and what’s known about the home.</p>
      </div>

      <footer className="hh-tour-actions">
        {step === 1
          ? <><button className="hh-btn hh-btn-ghost" onClick={onClose}>Cancel</button><button className="hh-btn" onClick={() => goTo(2)}>Next: notes</button></>
          : <><button className="hh-btn hh-btn-ghost" onClick={() => goTo(1)}>Back</button><button className="hh-btn" disabled={!verdict || saving} onClick={save}>{saving ? 'Saving…' : 'Save my take'}</button></>}
      </footer>
      {step === 2 && !verdict && <p className="flh-post-tour-hint" role="status">Choose an overall reaction in step 1 to save.</p>}
    </div>
  </div>;
}
