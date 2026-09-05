'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { StarInput } from '@/components/ui';
import { TOUR_RATING_KEY, criterionDisplayLabel } from '@/lib/constants';
import { selectedSubjectiveCriteria, curatedAdditionalSubjectiveCriteria } from '@/lib/matching';

// A small, curated set of things people commonly notice on a tour — deliberately NOT
// an exhaustive list of every criterion the app supports. These just toggle a word in
// the existing Pros/Cons text fields; there's no new data model behind them, so this
// list isn't limited to items that also exist as formal rating criteria.
const IMPRESSION_CHIPS = [
  'Natural light', 'Layout', 'Kitchen', 'Yard', 'Privacy', 'Street', 'Room sizes', 'Condition', 'Storage', 'Character', 'Noise',
];

const VERDICTS = [
  { key: 'love', emoji: '❤️', title: 'Love it', body: 'This is a real contender.' },
  { key: 'considering', emoji: '', title: 'Still considering', body: "I'm not sure yet." },
  { key: 'not_for_me', emoji: '', title: 'Not for me', body: 'I can rule this one out.' },
];

// Pros/Cons stay a plain comma-separated string — these three helpers are the only
// thing that knows that convention, so both preset chips (toggle on/off) and custom
// "+ Add your own" entries (always add, never silently remove something you typed)
// can share it without a new tagging model.
function isInList(text, word) {
  return (text || '').split(',').map((s) => s.trim().toLowerCase()).includes(word.toLowerCase());
}
function toggleInList(text, word) {
  const items = (text || '').split(',').map((s) => s.trim()).filter(Boolean);
  const idx = items.findIndex((i) => i.toLowerCase() === word.toLowerCase());
  if (idx === -1) return [...items, word].join(', ');
  items.splice(idx, 1);
  return items.join(', ');
}
function addToList(text, word) {
  const items = (text || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (items.some((i) => i.toLowerCase() === word.toLowerCase())) return text;
  return [...items, word].join(', ');
}

function RatingRow({ label, must, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 34 }}>
      <span style={{ fontSize: 13.5, color: must ? 'var(--brick)' : 'var(--ink)', fontWeight: must ? 700 : 400 }}>{label}</span>
      <StarInput value={value || 0} onChange={onChange} size={19} />
    </div>
  );
}

// One "Liked" or "Didn't like" group: independently-toggleable preset chips, plus a
// small "+ Add your own" reveal for a custom thought not covered by the presets.
// Both read/write the same Pros or Cons string the rest of the app already uses.
function StandOutGroup({ title, color, value, onChange }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState('');

  const submitCustom = () => {
    const v = customValue.trim();
    if (v) onChange(addToList(value, v));
    setCustomValue('');
    setCustomOpen(false);
  };

  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
        {IMPRESSION_CHIPS.map((c) => {
          const on = isInList(value, c);
          return (
            <span key={c} className={`hh-chip ${on ? 'on' : ''}`} style={{ fontSize: 11 }} onClick={() => onChange(toggleInList(value, c))}>
              {c}
            </span>
          );
        })}
      </div>
      {customOpen ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="hh-input"
            style={{ fontSize: 11.5, padding: '5px 8px' }}
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitCustom()}
            placeholder="Type your own..."
            autoFocus
          />
          <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 11, padding: '5px 10px', whiteSpace: 'nowrap' }} onClick={submitCustom}>Add</button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, color: 'var(--ink-soft)', cursor: 'pointer', textDecoration: 'underline' }}
        >
          + Add your own
        </button>
      )}
    </div>
  );
}

/**
 * onVerdict(home, verdict, patch) — called when the user commits their evaluation.
 * `patch` carries the ratings/notes/pros/cons collected here; the caller decides what
 * status/reaction change the verdict implies and how to persist it (including the
 * separate archive confirmation for "Not for me").
 *
 * Fast path (what most users see and need): overall feeling -> a note -> a verdict ->
 * Done. Everything else lives behind one collapsed "+ Add tour details" disclosure for
 * meticulous users, and is entirely optional.
 */
export default function PostTourModal({ home, priorities, onVerdict, onClose }) {
  const initialVerdict = home.reaction === 'love' ? 'love' : (home.status === 'Toured' ? 'considering' : null);
  const [verdict, setVerdict] = useState(initialVerdict);
  const [ratings, setRatings] = useState(home.ratings || {});
  const [pros, setPros] = useState(home.pros || '');
  const [cons, setCons] = useState(home.cons || '');
  const [notes, setNotes] = useState(home.notes || '');

  const subjectiveItems = selectedSubjectiveCriteria(priorities);
  const additionalItems = curatedAdditionalSubjectiveCriteria(priorities);

  // Open by default only if there's already something back there — editing an
  // existing tour reflection shouldn't feel like your detailed answers vanished.
  const [detailsOpen, setDetailsOpen] = useState(() => {
    const anyRated = [...subjectiveItems, ...additionalItems]
      .some((item) => (home.ratings?.[`${item.categoryKey}:${item.label}`] || 0) > 0);
    return anyRated || !!home.pros || !!home.cons;
  });

  const setRating = (key, v) => setRatings((r) => ({ ...r, [key]: v }));
  const patch = { ratings, pros, cons, notes };

  const handleDone = () => {
    if (!verdict) return;
    onVerdict(home, verdict, patch);
  };

  return (
    <div className="hh-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hh-modal hh-corner" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h2 className="hh-serif" style={{ fontSize: 20, margin: 0, fontWeight: 600 }}>How did it feel?</h2>
          <button className="hh-btn hh-btn-ghost" style={{ padding: 6 }} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '2px 0 20px' }}>Capture your first impression while it's fresh.</p>

        {/* 1. Overall feeling — the user's gut reaction, kept separate from Match. */}
        <div style={{ marginBottom: 20 }}>
          <label className="hh-label" style={{ marginBottom: 8 }}>Overall, how did this home feel?</label>
          <StarInput value={ratings[TOUR_RATING_KEY] || 0} onChange={(v) => setRating(TOUR_RATING_KEY, v)} size={26} />
        </div>

        {/* 2. The note — likely typed or dictated standing outside the house. */}
        <div style={{ marginBottom: 22 }}>
          <label className="hh-label" style={{ marginBottom: 6 }}>Anything you want to remember?</label>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 8px', lineHeight: 1.45 }}>
            Get your thoughts down while they're fresh. Type them here, or use your phone's microphone to talk them out.
          </p>
          <textarea className="hh-textarea" style={{ minHeight: 100 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else worth remembering..." />
        </div>

        {/* 3. The decision — large, tappable, unambiguous. */}
        <label className="hh-label" style={{ marginBottom: 8 }}>Where are you at with this home?</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 22 }}>
          {VERDICTS.map((v) => {
            const selected = verdict === v.key;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setVerdict(v.key)}
                style={{
                  textAlign: 'center', padding: '16px 8px', borderRadius: 14, cursor: 'pointer', minHeight: 76,
                  border: `1.5px solid ${selected ? 'var(--brick)' : 'var(--line)'}`,
                  background: selected ? 'rgba(193,89,47,0.08)' : 'var(--paper-raised)',
                }}
              >
                {v.emoji && <div style={{ fontSize: 22, marginBottom: 4 }}>{v.emoji}</div>}
                <div style={{ fontSize: 14, fontWeight: 700, color: selected ? 'var(--brick)' : 'var(--ink)' }}>{v.title}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2, lineHeight: 1.35 }}>{v.body}</div>
              </button>
            );
          })}
        </div>

        {/* Optional deeper section — for the meticulous user, never required for Done. */}
        <div style={{ marginBottom: 22 }}>
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
              background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12,
              padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{detailsOpen ? '− Hide tour details' : '+ Add tour details'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>Rate the things you could only really know after seeing the home in person.</div>
            </div>
          </button>

          {detailsOpen && (
            <div style={{ marginTop: 14 }}>
              {subjectiveItems.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <label className="hh-label" style={{ marginBottom: 6 }}>You said these matter to you</label>
                  <div style={{ display: 'grid', gap: 4 }}>
                    {subjectiveItems.map((item) => {
                      const key = `${item.categoryKey}:${item.label}`;
                      const must = priorities[item.categoryKey]?.tiers?.[item.label] === 'must';
                      return <RatingRow key={key} label={criterionDisplayLabel(item.categoryKey, item.label)} must={must} value={ratings[key]} onChange={(v) => setRating(key, v)} />;
                    })}
                  </div>
                </div>
              )}

              {additionalItems.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <label className="hh-label" style={{ marginBottom: 6 }}>Anything else stand out?</label>
                  <div style={{ display: 'grid', gap: 4 }}>
                    {additionalItems.map((item) => {
                      const key = `${item.categoryKey}:${item.label}`;
                      return <RatingRow key={key} label={criterionDisplayLabel(item.categoryKey, item.label)} value={ratings[key]} onChange={(v) => setRating(key, v)} />;
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="hh-label" style={{ marginBottom: 4 }}>What stood out?</label>
                <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '0 0 10px' }}>Tap anything you want to remember.</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <StandOutGroup title="Liked" color="var(--moss)" value={pros} onChange={setPros} />
                  <StandOutGroup title="Didn't like" color="var(--brick)" value={cons} onChange={setCons} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="hh-btn hh-btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="hh-btn"
            style={verdict === 'not_for_me' ? { background: 'var(--brick)', borderColor: 'var(--brick)' } : undefined}
            onClick={handleDone}
            disabled={!verdict}
          >
            {verdict === 'not_for_me' ? 'Archive home' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
