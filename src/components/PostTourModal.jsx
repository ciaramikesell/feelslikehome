'use client';

import { useState } from 'react';
import { X, Heart, CircleDashed, XCircle } from 'lucide-react';
import { StarInput } from '@/components/ui';
import { TOUR_RATING_KEY, criterionDisplayLabel } from '@/lib/constants';
import { selectedSubjectiveCriteria, curatedAdditionalSubjectiveCriteria } from '@/lib/matching';

// A small set of things people commonly notice on a tour that DON'T correspond to a
// formal rating criterion at all — deliberately short. Anything that maps onto a real
// criterion (Natural Light, Layout / Flow, Yard, Privacy, Room Sizes, Character / Charm,
// Condition, Street, Noise) is now handled exactly and unambiguously via LikeDislikeRow
// above instead, since several of those names are genuinely ambiguous on their own
// (e.g. "Privacy" and "Condition" each refer to two different real criteria) or don't
// match the stored label closely enough to safely tie back to Match. These just toggle
// a word in the existing Pros/Cons text fields; there's no criterion behind them.
const IMPRESSION_CHIPS = ['Kitchen', 'Storage'];

// Equivalent structural treatment for all three verdicts (same icon size/position),
// each semantically distinct: a filled heart for Love it, a neutral dashed circle for
// genuine ambivalence, and a clear X for ruling a home out.
const VERDICTS = [
  { key: 'love', icon: Heart, filled: true, title: 'Love it', body: 'This is a real contender.' },
  { key: 'considering', icon: CircleDashed, filled: false, title: 'Still considering', body: "I'm not sure yet." },
  { key: 'not_for_me', icon: XCircle, filled: false, title: 'Not for me', body: 'I can rule this one out.' },
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

// Liked/Didn't Like for a specific, exactly-identified criterion (never a loosely-worded
// guess) — writes the SAME ratings[key] storage Match 2.0 already reads, using sentinel
// values (5=Liked, 2=Didn't like) that land on the correct side of the existing
// met = value >= 3 threshold. This is why no change to matching.js was needed: Match
// already treats a coarse 5/2 exactly the same way it always treated a fine-grained
// star rating. A historical 1-5 star value from before this UI existed still displays
// correctly here (>=3 shows as Liked, <3 as Didn't Like) WITHOUT being rewritten unless
// the user actually taps something — old data is read, never silently reinterpreted in
// storage.
function LikeDislikeRow({ label, must, value, onChange }) {
  const liked = value >= 3;
  const disliked = value > 0 && value < 3;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 34, gap: 10 }}>
      <span style={{ fontSize: 13.5, color: must ? 'var(--brick)' : 'var(--ink)', fontWeight: must ? 700 : 400, flex: 1 }}>{label}</span>
      <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => onChange(liked ? 0 : 5)}
          className="hh-chip"
          style={{
            fontSize: 11.5, padding: '4px 10px', borderColor: 'var(--moss)',
            background: liked ? 'var(--moss)' : 'transparent', color: liked ? '#fff' : 'var(--moss)',
          }}
        >
          Liked
        </button>
        <button
          type="button"
          onClick={() => onChange(disliked ? 0 : 2)}
          className="hh-chip"
          style={{
            fontSize: 11.5, padding: '4px 10px', borderColor: 'var(--brick)',
            background: disliked ? 'var(--brick)' : 'transparent', color: disliked ? '#fff' : 'var(--brick)',
          }}
        >
          Didn't like
        </button>
      </div>
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
            const Icon = v.icon;
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
                <Icon size={20} style={{ marginBottom: 4 }} color={selected ? 'var(--brick)' : 'var(--ink-soft)'} fill={selected && v.filled ? 'var(--brick)' : 'none'} />
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
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>Tell us what stood out about the things you said matter to you.</div>
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
                      return <LikeDislikeRow key={key} label={criterionDisplayLabel(item.categoryKey, item.label)} must={must} value={ratings[key] || 0} onChange={(v) => setRating(key, v)} />;
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
                      return <LikeDislikeRow key={key} label={criterionDisplayLabel(item.categoryKey, item.label)} value={ratings[key] || 0} onChange={(v) => setRating(key, v)} />;
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="hh-label" style={{ marginBottom: 4 }}>Anything else worth remembering?</label>
                <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '0 0 10px' }}>For things that aren't in the list above — the kitchen, the neighbors, anything.</p>
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
