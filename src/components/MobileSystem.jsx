'use client';

import Link from 'next/link';
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Sparkles } from 'lucide-react';

// Authenticated-mobile foundation — the small set of layout/visual primitives the
// approved Onboarding and My Search designs established, so later pages (Homes,
// Tour, Compare, Map, Home Detail…) can adopt the same system incrementally.
// Presentation only: none of these read or write data. Their styles live under the
// `flh-` prefix in globals.css, built on the shared color/type tokens there.

// Page container: a single readable column on phones, a centered column (never a
// stretched 390px layout) on wider screens.
export function MobilePage({ children, className = '', width = 'default', ...rest }) {
  return <div className={`flh-page flh-page-${width} ${className}`} {...rest}>{children}</div>;
}

// Editorial page heading: serif title, one quiet supporting line, optional aside
// (e.g. a save status).
export function PageHeading({ eyebrow, title, subtitle, aside, as: Heading = 'h1' }) {
  return (
    <header className="flh-page-heading">
      {eyebrow && <p className="flh-eyebrow">{eyebrow}</p>}
      <Heading className="flh-page-title">{title}</Heading>
      {(subtitle || aside) && (
        <div className="flh-page-subline">
          {subtitle && <p>{subtitle}</p>}
          {aside}
        </div>
      )}
    </header>
  );
}

// Focused subpage header: back control, centered serif title, optional Cancel.
export function SubpageHeader({ title, backHref, onBack, onCancel, cancelLabel = 'Cancel' }) {
  const back = backHref && !onBack
    ? <Link href={backHref} className="flh-icon-button" aria-label="Back"><ChevronLeft size={20} aria-hidden="true" /></Link>
    : <button type="button" className="flh-icon-button" aria-label="Back" onClick={onBack}><ChevronLeft size={20} aria-hidden="true" /></button>;
  return (
    <header className="flh-subpage-header">
      {back}
      <h1 className="flh-subpage-title">{title}</h1>
      {onCancel ? <button type="button" className="flh-text-action" onClick={onCancel}>{cancelLabel}</button> : <span aria-hidden="true" />}
    </header>
  );
}

// Uppercase section label with an optional right-aligned meta value
// ("WHAT MATTERS MOST · 8 priorities").
export function SectionLabel({ children, meta, as: Tag = 'h2' }) {
  return (
    <div className="flh-section-label">
      <Tag>{children}</Tag>
      {meta && <span>{meta}</span>}
    </div>
  );
}

// The one card treatment. `tone` gives the approved supporting variants: default
// (white), sage (places/positive), warm (collaboration), quiet (status).
// Renders a link or button when it navigates, so the whole card is one tap target.
export function SectionCard({ children, tone = 'default', href, onClick, className = '', ariaLabel, ...rest }) {
  const cls = `flh-card flh-card-${tone} ${href || onClick ? 'is-interactive' : ''} ${className}`;
  if (href) return <Link href={href} className={cls} aria-label={ariaLabel} {...rest}>{children}</Link>;
  if (onClick) return <button type="button" className={cls} onClick={onClick} aria-label={ariaLabel} {...rest}>{children}</button>;
  return <section className={cls} aria-label={ariaLabel} {...rest}>{children}</section>;
}

// Round icon medallion used at the start of summary cards and helper rows.
export function IconBadge({ icon: Icon, tone = 'terracotta' }) {
  return <span className={`flh-icon-badge flh-icon-badge-${tone}`} aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>;
}

// A compact status/helper row: icon, a title, one line of supporting text, and an
// optional trailing affordance.
export function HelperRow({ icon, title, body, tone = 'sage', trailing, className = '' }) {
  return (
    <div className={`flh-helper-row flh-helper-row-${tone} ${className}`}>
      {icon && <IconBadge icon={icon} tone={tone === 'sage' ? 'sage' : 'terracotta'} />}
      <div className="flh-helper-copy">
        {title && <strong>{title}</strong>}
        {body && <span>{body}</span>}
      </div>
      {trailing}
    </div>
  );
}

export function Chevron() {
  return <ChevronRight size={18} className="flh-chevron" aria-hidden="true" />;
}

// Selectable chip. Selected uses the approved sage treatment with a check mark;
// unselected stays quiet.
export function ChoiceChip({ selected, onClick, children, ...rest }) {
  return (
    <button type="button" className={`flh-choice-chip ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={onClick} {...rest}>
      {selected && <Check size={14} strokeWidth={2.6} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

// Compact visual selection card (e.g. search type).
export function SelectCard({ selected, onClick, icon: Icon, children }) {
  return (
    <button type="button" className={`flh-select-card ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={onClick}>
      {Icon && <Icon size={20} strokeWidth={1.9} aria-hidden="true" />}
      <span>{children}</span>
      {selected && <span className="flh-select-card-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>}
    </button>
  );
}

// Persistent bottom action for focused editors. Sits above the iOS home
// indicator; the page reserves space for it (see .flh-has-action-bar).
export function StickyActionBar({ children, note }) {
  return (
    <div className="flh-action-bar">
      <div className="flh-action-bar-inner">
        {children}
        {note && <p className="flh-action-bar-note">{note}</p>}
      </div>
    </div>
  );
}

// Quiet autosave indicator for pages that save as you go.
export function SaveStatus({ saving, error }) {
  if (error) return null;
  return (
    <span className="flh-save-status" role="status" aria-live="polite">
      {saving ? <LoaderCircle size={14} className="flh-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
      {saving ? 'Saving…' : 'Saved'}
    </span>
  );
}

// Colored level marker used wherever Must Have / Important / Nice to Have appear.
export function LevelDot({ tier }) {
  return <span className={`flh-level-dot flh-level-${tier}`} aria-hidden="true" />;
}

// Small initials avatar for participants (no photos are stored).
export function Avatar({ name, tone = 'warm' }) {
  const initials = String(name || '?').trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?';
  return <span className={`flh-avatar flh-avatar-${tone}`} aria-hidden="true">{initials}</span>;
}

// The one Match badge (My Homes cards; later Map pins/preview, Compare, Home
// Detail). Presentation only: `pct` is the caller's canonical computeMatch
// percentage for the signed-in participant. With no computable percentage it
// renders nothing, so Unknown never appears as a number.
export function MatchBadge({ pct, size = 'sm', className = '' }) {
  if (pct === null || pct === undefined) return null;
  return (
    <span className={`flh-match-badge flh-match-badge-${size} ${className}`} aria-label={`${pct}% Match`}>
      <Sparkles aria-hidden="true" strokeWidth={2.2} />
      <span aria-hidden="true">{pct}%</span>
    </span>
  );
}

// Compact state chip. Tones follow the system semantics: positive (sage), negative
// (only for a confirmed problem), unknown (taupe — never styled as a miss), quiet.
export function StatusTag({ tone = 'quiet', children }) {
  return <span className={`flh-tag is-${tone}`}>{children}</span>;
}

// "You + collaborator" initials, for a search that really is shared. Status only.
export function ParticipantStack({ collaboratorName }) {
  const label = `Searching together with ${collaboratorName || 'a co-buyer'}. Each of you keeps your own Match.`;
  return (
    <span className="flh-avatar-stack flh-participants" role="img" aria-label={label} title={label}>
      <Avatar name="You" />
      <Avatar name={collaboratorName || 'Co-buyer'} tone="sage" />
    </span>
  );
}
