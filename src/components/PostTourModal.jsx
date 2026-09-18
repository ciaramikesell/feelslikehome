'use client';

import { useMemo, useState } from 'react';
import { Check, CircleDashed, Heart, X, XCircle } from 'lucide-react';
import { postTourVerdict } from '@/lib/lifecycle';

export const POST_TOUR_EVALUATIONS = [
  { key: 'tour-v2:curb_appeal', label: 'Curb Appeal' },
  { key: 'tour-v2:layout', label: 'Layout' },
  { key: 'tour-v2:privacy', label: 'Privacy' },
  { key: 'tour-v2:neighborhood', label: 'Neighborhood' },
];

const RESPONSES = [
  { value: 'negative', label: 'Didn’t like it' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'positive', label: 'Loved it' },
];

const VERDICTS = [
  { key: 'love', icon: Heart, filled: true, title: 'Love it', body: 'Real contender.' },
  { key: 'considering', icon: CircleDashed, title: 'Still considering', body: 'Not sure yet.' },
  { key: 'not_for_me', icon: XCircle, title: 'Definitely not', body: 'Rule this one out.' },
];

function Evaluation({ item, value, onChange }) {
  return <fieldset className="hh-tour-response-group">
    <legend>{item.label}</legend>
    <div role="radiogroup" aria-label={`${item.label} in-person evaluation`}>
      {RESPONSES.map((option) => <label key={option.value} className={value === option.value ? 'is-selected' : ''}>
        <input type="radio" name={item.key} checked={value === option.value} onChange={() => onChange(option.value)} />
        <span>{option.label}</span>
      </label>)}
    </div>
    {value && <button type="button" className="hh-clear-tour-response" onClick={() => onChange(undefined)}>Clear answer</button>}
  </fieldset>;
}

export default function PostTourModal({ home, isCollaborative = false, saveError = '', onVerdict, onClose }) {
  const [verdict, setVerdict] = useState(postTourVerdict(home));
  const [ratings, setRatings] = useState(home.ratings || {});
  const [noteEntry, setNoteEntry] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const evaluationCount = useMemo(() => POST_TOUR_EVALUATIONS.filter(({ key }) => ratings[key]).length, [ratings]);

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
    <p className="hh-tour-confirmation-reaction">{VERDICTS.find((item) => item.key === saved.verdict)?.title}</p>
    <ul className="hh-tour-confirmation-list">
      <li>✓ Tour feedback saved</li>
      {saved.noteAdded && <li>✓ Note added</li>}
      {saved.evaluationCount > 0 && <li>✓ {saved.evaluationCount} in-person {saved.evaluationCount === 1 ? 'detail' : 'details'} recorded</li>}
    </ul>
    <button className="hh-btn" onClick={onClose}>Done</button>
  </div></div>;

  return <div className="hh-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="hh-modal hh-corner hh-post-tour-modal" role="dialog" aria-modal="true" aria-labelledby="tour-take-title">
      <header className="hh-tour-header"><div><h2 id="tour-take-title" className="hh-serif">Record your take</h2><p>Capture what only being there could tell you.</p></div><button className="hh-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      {isCollaborative && <p className="hh-detail-context">Your reaction and in-person evaluations belong to you. Your co-buyer may see them; notes remain shared with this search.</p>}
      {saveError && <p className="hh-save-error" role="alert">{saveError}</p>}

      <section className="hh-tour-section">
        <h3>Where are you at with this home?</h3>
        <div className="hh-post-tour-verdicts">{VERDICTS.map((item) => { const Icon = item.icon; const selected = verdict === item.key; return <button key={item.key} type="button" aria-pressed={selected} className={selected ? 'is-selected' : ''} onClick={() => chooseVerdict(item.key)}><Icon size={21} fill={selected && item.filled ? 'currentColor' : 'none'} /><strong>{item.title}</strong><span>{item.body}</span></button>; })}</div>
      </section>

      {verdict === 'not_for_me' && <aside className="hh-tour-fast-exit"><p>That’s enough to save your take. Add details below if you want to remember why.</p><div><button className="hh-btn" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save my take'}</button></div></aside>}

      <section className="hh-tour-section"><h3>How did it feel in person?</h3><p className="hh-tour-optional">Optional — answer only what stood out.</p><div className="hh-tour-evaluations">{POST_TOUR_EVALUATIONS.map((item) => <Evaluation key={item.key} item={item} value={ratings[item.key]} onChange={(value) => setRatings((current) => { const next = { ...current }; if (value) next[item.key] = value; else delete next[item.key]; return next; })} />)}</div></section>
      <section className="hh-tour-section hh-tour-note"><h3>Anything you want to remember?</h3><p>Get your thoughts down while they’re fresh. Type them here, or use your phone’s microphone to talk them out.</p><textarea className="hh-textarea" value={noteEntry} onChange={(event) => setNoteEntry(event.target.value)} placeholder="Walkability, home condition, natural light, any concerns?" /></section>
      <footer className="hh-tour-actions"><button className="hh-btn hh-btn-ghost" onClick={onClose}>Cancel</button><button className="hh-btn" disabled={!verdict || saving} onClick={save}>{saving ? 'Saving…' : 'Save my take'}</button></footer>
    </div>
  </div>;
}
