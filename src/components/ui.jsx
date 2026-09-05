'use client';

import { useState } from 'react';
import { Star, ChevronDown, Heart, CheckCircle2, Check } from 'lucide-react';
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

// Small, consistent "what is this page for" supporting copy, used near the top of
// each main logged-in page — not a redesign of page headers, just one subtle line.
export function PageIntro({ title, subtitle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 3, marginBottom: 20 }}>
      <h2 className="hh-serif" style={{ fontSize: 24, fontWeight: 700, color: 'var(--brick)', margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-soft)', margin: 0, lineHeight: 1.5 }}>{subtitle}</p>}
    </div>
  );
}

export function MatchSummary({ match }) {
  if (!match) return null;

  // Priorities exist, but none of them can be evaluated yet — never show a raw 0%,
  // since that would falsely imply a poor fit rather than an absence of information.
  if (match.pct === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BrandMark size={20} />
        <span style={{ fontSize: 13.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Not enough information yet</span>
      </div>
    );
  }

  let mustLabel = null;
  let mustSubLabel = null;
  if (match.mustTotal > 0) {
    if (match.mustEvaluated === 0) mustLabel = 'Must-haves not evaluated yet';
    else if (match.mustEvaluated === match.mustTotal) mustLabel = `Must-haves: ${match.mustMet}/${match.mustTotal} met`;
    else {
      mustLabel = `Must-haves: ${match.mustMet}/${match.mustEvaluated} met`;
      mustSubLabel = `${match.mustTotal - match.mustEvaluated} not evaluated`;
    }
  }

  // Reuses the same evaluated/objective/must-or-important "satisfied" list Match 2.0
  // already computes — never a separate satisfaction check. Only actually-confirmed
  // fulfilled criteria appear here; unknown and missed criteria are never listed.
  const fulfilledList = match.satisfied.map((c) => c.label).join(', ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <BrandMark size={20} />
        <span className="hh-mono" style={{ fontSize: 17, fontWeight: 700, color: matchColor(match.pct) }}>{match.pct}% Match</span>
      </div>
      {mustLabel && (
        <div style={{ fontSize: 11.5, color: 'var(--ink)' }}>{mustLabel}{mustSubLabel ? ` · ${mustSubLabel}` : ''}</div>
      )}
      {match.evaluatedCount < match.selectedCount && (
        <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>
          Based on {match.evaluatedCount} of {match.selectedCount} priorities evaluated
        </div>
      )}
      {fulfilledList && (
        <div style={{ fontSize: 11.5, color: 'var(--moss)', display: 'flex', alignItems: 'flex-start', gap: 5 }}>
          <CheckCircle2 size={12} style={{ marginTop: 2, flexShrink: 0 }} />
          <span>{fulfilledList}</span>
        </div>
      )}
    </div>
  );
}
