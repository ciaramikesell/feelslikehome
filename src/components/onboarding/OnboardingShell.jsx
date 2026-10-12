'use client';

import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { BrandMark } from '@/components/ui';

// The shared onboarding frame (Onboarding V2, Phase 1): brand, back, step count
// and progress around whatever step is showing. Layout lives in globals.css under
// "Onboarding V2 shell"; every rule is scoped to .flh-onboarding-root.
//
// progress: { steps, position, total } from onboardingProgress(); the segments
// and the desktop step list always reflect the real flow, never a fixed count.

function Wordmark({ size }) {
  return (
    <span className="flh-ob-brand">
      <BrandMark size={size} />
      <span className="flh-ob-wordmark"><span>Feels Like </span><b>Home</b></span>
    </span>
  );
}

// Phones and tablets: back · brand · count, then the segmented progress bar.
// On desktop the rail carries brand and progress, and only Back remains here.
export function OnboardingTopBar({ progress, onBack = null, showProgress = true }) {
  return (
    <div className="flh-ob-topbar">
      <div className="flh-ob-topbar-row">
        {onBack && (
          <button type="button" className="flh-ob-back" onClick={onBack} aria-label="Back">
            <ArrowLeft size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        <Wordmark size={24} />
        {showProgress && <span className="flh-ob-count" aria-label={`Step ${progress.position} of ${progress.total}`}>{progress.position}/{progress.total}</span>}
      </div>
      {showProgress && (
        <div className="flh-ob-progress" style={{ '--ob-steps': progress.total }} aria-hidden="true">
          {progress.steps.map((key, index) => <span key={key} className={index < progress.position ? 'is-done' : ''} />)}
        </div>
      )}
    </div>
  );
}

// Desktop only (hidden below 960px): brand, the steps of this flow, and the
// reassurance the product already makes elsewhere in onboarding.
export function OnboardingRail({ progress, labels, complete = false, sharedFor = null }) {
  return (
    <aside className="flh-ob-rail" aria-label="Onboarding progress">
      <div className="flh-ob-rail-head">
        <Wordmark size={32} />
        {sharedFor && <p className="flh-ob-rail-context">Your preferences for {sharedFor}</p>}
      </div>
      <ol className="flh-ob-steps">
        {progress.steps.map((key, index) => {
          const done = complete || index < progress.index;
          const current = !complete && index === progress.index;
          return (
            <li key={key} className={done ? 'is-done' : current ? 'is-current' : ''} aria-current={current ? 'step' : undefined}>
              <span className="flh-ob-step-marker" aria-hidden="true">{done ? <Check size={13} strokeWidth={3} /> : index + 1}</span>
              <span>{labels[key] || key}</span>
            </li>
          );
        })}
      </ol>
      <ul className="flh-ob-reassurance">
        <li>You can change everything later.</li>
        <li>Unknown information never counts against a home.</li>
      </ul>
    </aside>
  );
}

// The step's forward action, matching the approved design: label left, arrow tile right.
export function OnboardingAction({ children, disabled = false, onClick }) {
  return (
    <button type="button" className="flh-button flh-button-primary flh-ob-cta" disabled={disabled} onClick={onClick}>
      <span>{children}</span>
      <span className="flh-ob-cta-icon" aria-hidden="true"><ArrowRight size={20} strokeWidth={2.2} /></span>
    </button>
  );
}
