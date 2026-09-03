'use client';

import { useState } from 'react';
import { Star, ChevronDown, Heart, ThumbsUp, HelpCircle, AlertTriangle, CheckCircle2, Check } from 'lucide-react';
import { TIER_ORDER, TIER_META } from '@/lib/constants';
import { matchColor } from '@/lib/matching';

export function BrandMark({ size = 34 }) {
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg viewBox="0 0 64 64" width={size} height={size} style={{ display: 'block' }} xmlns="http://www.w3.org/2000/svg">
        <path d="M6 32 L32 9 L58 32 Z" fill="var(--brick)" />
        <rect x="13" y="27" width="38" height="30" rx="7" fill="var(--brick)" />
      </svg>
      <Heart
        size={size * 0.3}
        color="var(--paper-raised)"
        fill="var(--paper-raised)"
        strokeWidth={0}
        style={{ position: 'absolute', top: '58%', left: '48%', transform: 'translate(-50%, -50%)' }}
      />
      <div
        style={{
          position: 'absolute', top: '58%', left: '60%', width: size * 0.44, height: size * 0.44,
          borderRadius: '50%', background: 'var(--moss)', border: '2px solid var(--paper)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Check size={size * 0.25} color="var(--paper-raised)" strokeWidth={3.5} />
      </div>
    </div>
  );
}

export function Wordmark({ size = 27, className = 'hh-serif' }) {
  return (
    <h1 className={className} style={{ fontSize: size, margin: 0, letterSpacing: '-0.015em' }}>
      <span style={{ color: 'var(--ink)', fontWeight: 500 }}>Feels Like </span>
      <span style={{ color: 'var(--brick)', fontWeight: 700 }}>Home</span>
    </h1>
  );
}

export function StarInput({ value, onChange, size = 16, readOnly = false }) {
  const [hover, setHover] = useState(0);
  const display = hover || value || 0;
  return (
    <span className="hh-star-row" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) =>
        readOnly ? (
          <Star key={n} size={size} fill={n <= display ? '#C69245' : 'none'} color={n <= display ? '#C69245' : '#DED2C1'} strokeWidth={1.5} />
        ) : (
          <button key={n} type="button" className="hh-star-btn" onMouseEnter={() => setHover(n)} onClick={() => onChange(n === value ? 0 : n)} aria-label={`Rate ${n} star${n > 1 ? 's' : ''}`}>
            <Star size={size} fill={n <= display ? '#C69245' : 'none'} color={n <= display ? '#C69245' : '#DED2C1'} strokeWidth={1.5} />
          </button>
        )
      )}
    </span>
  );
}

export function TierPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    const meta = TIER_META[value] || TIER_META.dontcare;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 11.5, padding: '5px 8px 5px 12px', borderRadius: 999, cursor: 'pointer',
          fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 600,
          border: '1px solid ' + meta.color, background: meta.color, color: '#fff',
          display: 'inline-flex', alignItems: 'center', gap: 3,
        }}
      >
        {meta.label} <ChevronDown size={12} />
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} onMouseLeave={() => setOpen(false)}>
      {TIER_ORDER.map((t) => (
        <button key={t} type="button" onClick={() => { onChange(t); setOpen(false); }}
          style={{
            fontSize: 11.5, padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontFamily: 'Plus Jakarta Sans, sans-serif',
            border: '1px solid ' + (value === t ? TIER_META[t].color : 'var(--line)'),
            background: value === t ? TIER_META[t].color : 'var(--paper-raised)',
            color: value === t ? '#fff' : 'var(--ink-soft)', fontWeight: value === t ? 600 : 400,
          }}>
          {TIER_META[t].label}
        </button>
      ))}
    </div>
  );
}

export function ReactionButtons({ home, onReact }) {
  const opts = [{ key: 'love', icon: Heart, color: '#C1592F' }, { key: 'like', icon: ThumbsUp, color: '#3E6B6F' }, { key: 'unsure', icon: HelpCircle, color: '#C69245' }];
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {opts.map(({ key, icon: Icon, color }) => (
        <button key={key} type="button" onClick={() => onReact(home.id, home.reaction === key ? null : key)}
          style={{ border: '1px solid ' + (home.reaction === key ? color : 'var(--line)'), background: home.reaction === key ? color : 'transparent', borderRadius: 8, padding: '4px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title={key}>
          <Icon size={13} color={home.reaction === key ? '#fff' : 'var(--ink-soft)'} fill={home.reaction === key && key !== 'unsure' ? '#fff' : 'none'} />
        </button>
      ))}
    </div>
  );
}

export function MatchSummary({ match, compact }) {
  if (!match) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BrandMark size={compact ? 18 : 20} />
        <span className="hh-mono" style={{ fontSize: compact ? 15 : 18, fontWeight: 600, color: matchColor(match.pct) }}>{match.pct}% match</span>
        {match.mustTotal > 0 && <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Must-haves: {match.mustMet}/{match.mustTotal}</span>}
      </div>
      {!compact && (match.missing.length > 0 || match.satisfied.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {match.missing.slice(0, 3).map((c) => <div key={c.key} style={{ fontSize: 11.5, color: 'var(--brick)', display: 'flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={11} /> Missing: {c.label}</div>)}
          {match.satisfied.slice(0, Math.max(0, 4 - match.missing.length)).map((c) => <div key={c.key} style={{ fontSize: 11.5, color: 'var(--moss)', display: 'flex', alignItems: 'center', gap: 5 }}><CheckCircle2 size={11} /> {c.label}{c.detail ? ` — ${c.detail}` : ''}</div>)}
        </div>
      )}
    </div>
  );
}
