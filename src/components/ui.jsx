'use client';

import { useEffect, useRef, useState } from 'react';
import { Star, ChevronDown, Heart, Check } from 'lucide-react';
import { TIER_ORDER, TIER_META } from '@/lib/constants';
import { matchColor } from '@/lib/matching';

// Both brand pieces size from a CSS custom property when one is set (the compact
// authenticated phone header sets --flh-brandmark-size / --flh-wordmark-size),
// falling back to the `size` prop everywhere else. The mark's inner parts are
// proportional, so it stays correct at any size.
export function BrandMark({ size = 34 }) {
  const box = `var(--flh-brandmark-size, ${size}px)`;
  return (
    <div style={{ position: 'relative', width: box, height: box, flexShrink: 0 }}>
      <svg viewBox="0 0 64 64" style={{ display: 'block', width: '100%', height: '100%' }} xmlns="http://www.w3.org/2000/svg">
        <path d="M6 32 L32 9 L58 32 Z" fill="var(--brick)" />
        <rect x="13" y="27" width="38" height="30" rx="7" fill="var(--brick)" />
      </svg>
      <Heart
        color="var(--paper-raised)"
        fill="var(--paper-raised)"
        strokeWidth={0}
        style={{ position: 'absolute', top: '58%', left: '48%', width: '30%', height: '30%', transform: 'translate(-50%, -50%)' }}
      />
      <div
        style={{
          position: 'absolute', top: '58%', left: '60%', width: '44%', height: '44%',
          borderRadius: '50%', background: 'var(--moss)', border: '2px solid var(--paper)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Check color="var(--paper-raised)" strokeWidth={3.5} style={{ width: '75%', height: '75%' }} />
      </div>
    </div>
  );
}

export function Wordmark({ size = 27, className = 'hh-serif' }) {
  return (
    <h1 className={className} style={{ fontSize: `var(--flh-wordmark-size, ${size}px)`, margin: 0, letterSpacing: '-0.015em' }}>
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

export function TierPicker({ value, onChange, quiet = false, ariaLabel }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    const meta = TIER_META[value] || TIER_META.dontcare;
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
        style={{
          fontSize: 11.5, padding: '5px 8px 5px 12px', borderRadius: 999, cursor: 'pointer',
          fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 600,
          border: '1px solid ' + (quiet ? 'var(--line)' : meta.color), background: quiet ? 'transparent' : meta.color, color: quiet ? 'var(--ink-soft)' : '#fff',
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
        <button key={t} type="button" aria-pressed={value === t} onClick={() => { onChange(t); setOpen(false); }}
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
// It is the page's h1: the shell's wordmark is branding, not a heading.
export function PageIntro({ title, subtitle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 3, marginBottom: 20 }}>
      <h1 className="hh-serif" style={{ fontSize: 24, fontWeight: 700, color: 'var(--brick)', margin: 0, letterSpacing: '-0.01em' }}>{title}</h1>
      {subtitle && <p style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-soft)', margin: 0, lineHeight: 1.5 }}>{subtitle}</p>}
    </div>
  );
}

// The FLH house/heart/check, redrawn as one SVG for the small Match line on My
// Homes cards. BrandMark (above) stays the brand asset everywhere else; at
// 20–24px its overlaid heart sat high and left of the house body and the check
// badge crowded it. Here the heart is centered in the body's open area and the
// badge sits clear at the lower right — same shapes, same tokens.
export function MatchMark({ size = 24 }) {
  return (
    <svg className="hh-match-mark" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 32 L32 9 L58 32 Z" fill="var(--brick)" />
      <rect x="13" y="27" width="38" height="30" rx="7" fill="var(--brick)" />
      <path d="M31 49 C22 43 22.4 35 27 35 C29.2 35 30.4 36.4 31 37.8 C31.6 36.4 32.8 35 35 35 C39.6 35 40 43 31 49 Z" fill="var(--paper-raised)" />
      <circle cx="50" cy="50" r="11.5" fill="var(--moss)" stroke="var(--paper-raised)" strokeWidth="3" />
      <path d="M44.6 50.2 L48.4 54 L55.4 46.6" fill="none" stroke="var(--paper-raised)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MatchSummary({ match }) {
  if (!match) return null;

  // Priorities exist, but none of them can be evaluated yet — never show a raw 0%,
  // since that would falsely imply a poor fit rather than an absence of information.
  if (match.pct === null) {
    return (
      <div className="hh-match-score is-unknown">
        <MatchMark size={22} />
        <span className="hh-match-score-empty">Not enough information yet</span>
      </div>
    );
  }

  return (
    <div className="hh-match-score">
      <MatchMark size={24} />
      <span className="hh-match-score-value" style={{ color: matchColor(match.pct) }}><strong>{match.pct}%</strong> Match</span>
    </div>
  );
}

export function CriteriaDisclosure({ symbol, label, heading, items, tone }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event) => {
      if (event.key === 'Escape' || (event.type === 'pointerdown' && !rootRef.current?.contains(event.target))) {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, [open]);

  return (
    <div
      className={`hh-criteria-disclosure is-${tone}`}
      ref={rootRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!pinned) setOpen(false); }}
      onBlur={(event) => { if (!pinned && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    >
      <button type="button" aria-expanded={open} onFocus={() => setOpen(true)} onClick={() => { setOpen(!pinned); setPinned(!pinned); }}>
        <span aria-hidden="true">{symbol}</span> {label}
      </button>
      {open && (
        <div className="hh-criteria-popover" role="tooltip">
          <strong>{heading}</strong>
          <ul>{items.map((item) => <li key={item.key}><span aria-hidden="true">{symbol}</span> {item.label}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
