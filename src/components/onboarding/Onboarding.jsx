'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import { normalizePriorities, hasQualifierOptions, MULTISELECT_CATEGORIES, showsMultiselectCategory, isApartmentRental } from '@/lib/constants';
import { searchIntentCapabilities, PROPERTY_TYPE_LABELS } from '@/lib/searchIntent';
import QualifierPicker from '@/components/QualifierPicker';
import { NEW_SEARCH_CHOICES, ONBOARDING_SUGGESTIONS, applySearchChoice } from '@/lib/onboarding';
import { selectPriorityItem } from '@/lib/matching';
import { createClient } from '@/lib/supabase/client';
import { useReliableOptimisticState } from '@/lib/useReliableOptimisticState';
import { completeOnboarding } from '@/lib/supabase/data';
import { savePriorities } from '@/lib/supabase/collaboration';
import { sanitizeRedirectPath } from '@/lib/safeRedirect';
import BetaFeedback from '@/components/BetaFeedback';

const criterionKey = (criterion) => `${criterion.categoryKey}:${criterion.label}`;

function OnboardingProgress({ step }) {
  const steps = ['The basics', 'What matters', 'Rank Priorities'];
  return <ol className="hh-onboarding-progress hh-onboarding-progress-3" aria-label="Setup progress">
    {steps.map((label, index) => <li key={label} className={step === index + 1 ? 'is-current' : step > index + 1 ? 'is-complete' : ''} aria-current={step === index + 1 ? 'step' : undefined}>
      <span>{step > index + 1 ? <><Check size={12} /><span className="sr-only">Completed: </span></> : index + 1}</span><b>{label}</b>
    </li>)}
  </ol>;
}

function OnboardingShell({ children, wide = false }) {
  return <div className="hh-onboarding-shell"><div className={`hh-corner hh-onboarding-card ${wide ? 'is-wide' : ''}`}>{children}</div></div>;
}

function BasicsField({ label, value, onChange, placeholder, prefix, suffix, inputMode = 'numeric' }) {
  return <label className="hh-onboarding-field"><span className="hh-label">{label}</span><span className="hh-onboarding-input-wrap">{prefix}<input className="hh-input" inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />{suffix}</span></label>;
}

// Same chip-multiselect shape My Search's own Basics editing uses (see
// MultiselectSection in MySearchPanel.jsx) — no tier picker here, since onboarding
// doesn't set per-field importance; the priorities document's own defaults already
// give these fields a sensible starting tier, adjustable later in My Search.
function MultiselectChips({ title, options, values, onToggle }) {
  return <div className="hh-onboarding-field">
    <span className="hh-label">{title} <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></span>
    <div className="hh-onboarding-chip-row">
      {options.map((option) => <button type="button" key={option} className={`hh-chip ${values.includes(option) ? 'on' : ''}`} aria-pressed={values.includes(option)} onClick={() => onToggle(option)}>{option}</button>)}
    </div>
  </div>;
}

function BasicsStep({ priorities, patch, onNext }) {
  const selectedChoice = priorities.onboardingSearchType || '';
  const rental = selectedChoice === 'home_rent' || selectedChoice === 'apartment_rent';
  const capabilities = searchIntentCapabilities(priorities.searchType);
  const toggleMultiselect = (key) => (option) => patch((next) => {
    const current = next[key].values || [];
    next[key] = { ...next[key], values: current.includes(option) ? current.filter((v) => v !== option) : [...current, option] };
    return next;
  });
  return <div className="hh-onboarding-step">
    <header><h1 className="hh-serif">First, give us the basics.</h1><p>Tell us what you&apos;re looking for so we know what belongs in your search. Nothing here is permanent—you can change it anytime.</p></header>
    <fieldset className="hh-onboarding-fieldset"><legend className="hh-label">What are you searching for?</legend><div className="hh-choice-grid">
      {NEW_SEARCH_CHOICES.map((choice) => <button type="button" key={choice.key} className={`hh-choice-card ${selectedChoice === choice.key ? 'on' : ''}`} aria-pressed={selectedChoice === choice.key} onClick={() => patch((next) => applySearchChoice(next, choice.key))}>{selectedChoice === choice.key && <Check size={15} aria-hidden="true" />}{choice.label}</button>)}
    </div></fieldset>
    {selectedChoice && <div className="hh-onboarding-basics-grid">
      <BasicsField label={rental ? 'Maximum monthly rent' : 'Maximum budget'} prefix="$" placeholder={rental ? '2,200' : '450,000'} value={priorities.budget.value} onChange={(value) => patch((next) => { next.budget = { ...next.budget, value }; return next; })} />
      <BasicsField label="Minimum bedrooms" placeholder="3" suffix="beds" value={priorities.bedsMin.value} onChange={(value) => patch((next) => { next.bedsMin = { ...next.bedsMin, value }; return next; })} />
      <BasicsField label="Minimum bathrooms" placeholder="2" suffix="baths" value={priorities.bathsMin.value} onChange={(value) => patch((next) => { next.bathsMin = { ...next.bathsMin, value }; return next; })} />
      <BasicsField label="Minimum square footage" placeholder="1,800" suffix="sq ft" value={priorities.sqftTarget.value} onChange={(value) => patch((next) => { next.sqftTarget = { ...next.sqftTarget, value }; return next; })} />
      {!isApartmentRental(priorities) && <BasicsField label="Minimum lot size" placeholder="0.25" suffix="acres" inputMode="decimal" value={priorities.lotSizeTarget.value} onChange={(value) => patch((next) => { next.lotSizeTarget = { ...next.lotSizeTarget, value }; return next; })} />}
    </div>}
    {selectedChoice && (capabilities.isPurchase || capabilities.isRental) && (
      <MultiselectChips
        title="What kinds of homes are you considering?"
        options={capabilities.preferredPropertyTypeOptions.map((value) => PROPERTY_TYPE_LABELS[value] || value)}
        values={(priorities.preferredPropertyTypes.values || []).map((value) => PROPERTY_TYPE_LABELS[value] || value)}
        onToggle={(optionLabel) => patch((next) => {
          const value = Object.keys(PROPERTY_TYPE_LABELS).find((key) => PROPERTY_TYPE_LABELS[key] === optionLabel) || optionLabel;
          const current = next.preferredPropertyTypes.values || [];
          next.preferredPropertyTypes = { ...next.preferredPropertyTypes, values: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] };
          return next;
        })}
      />
    )}
    {selectedChoice && MULTISELECT_CATEGORIES.filter((def) => showsMultiselectCategory(def.key, priorities.searchType)).map((def) => (
      <MultiselectChips key={def.key} title={def.title} options={def.options} values={priorities[def.key].values || []} onToggle={toggleMultiselect(def.key)} />
    ))}
    <nav className="hh-onboarding-actions"><span /><button type="button" className="hh-btn" disabled={!selectedChoice} onClick={onNext}>Continue</button></nav>
  </div>;
}

function WhatMattersStep({ priorities, patch, onNext, onBack, isSaving }) {
  const categories = ONBOARDING_SUGGESTIONS[priorities.onboardingSearchType] || [];
  const [customOpen, setCustomOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customCategory, setCustomCategory] = useState(categories[0]?.[1]?.[0]?.categoryKey || 'location');
  const selected = (criterion) => ['must', 'important', 'nice'].includes(priorities[criterion.categoryKey]?.tiers?.[criterion.label]);
  const toggle = (criterion) => patch((next) => {
    const def = { key: criterion.categoryKey, coreItems: [], suggestedItems: [] };
    next[criterion.categoryKey] = selectPriorityItem(next[criterion.categoryKey], def, { label: criterion.label, kind: criterion.kind }, selected(criterion) ? 'dontcare' : 'important');
    return next;
  });
  const addCustom = () => {
    const label = customLabel.trim();
    if (!label) return;
    // A typed label that matches an existing canonical chip (any category, not
    // just the selected one — the same wording almost never means two different
    // things) selects that chip instead of creating a visibly duplicate custom
    // priority alongside it.
    const normalized = label.toLowerCase();
    const existingCanonical = categories.flatMap(([, items]) => items).find((criterion) => criterion.label.toLowerCase() === normalized);
    if (existingCanonical) {
      if (!selected(existingCanonical)) toggle(existingCanonical);
    } else {
      patch((next) => {
        const current = next[customCategory];
        if (!(current.customItems || []).some((entry) => entry.label.toLowerCase() === normalized)) {
          next[customCategory] = { ...current, customItems: [...(current.customItems || []), { label, kind: customCategory === 'features' ? 'check' : 'rating' }], tiers: { ...current.tiers, [label]: 'important' } };
        }
        return next;
      });
    }
    setCustomLabel(''); setCustomOpen(false);
  };
  return <div className="hh-onboarding-step">
    <header><h1 className="hh-serif">What matters to you?</h1><p>Choose everything you&apos;d care about when comparing your options. Don&apos;t worry about ranking them yet—you&apos;ll do that next.</p></header>
    <div className="hh-onboarding-callout">
      <strong>For now, just choose what matters.</strong>
      <span>You&apos;ll decide what&apos;s a Must Have, Important, or Nice to Have on the next screen.</span>
    </div>
    <div className="hh-onboarding-suggestions">{categories.map(([title, items]) => <section key={title}><h2>{title}</h2><div>{items.flatMap((criterion) => {
      const chip = <button type="button" key={criterionKey(criterion)} className={`hh-chip ${selected(criterion) ? 'on' : ''}`} aria-pressed={selected(criterion)} onClick={() => toggle(criterion)}>{selected(criterion) && <Check size={13} aria-hidden="true" />}{criterion.displayLabel}</button>;
      if (!selected(criterion) || !hasQualifierOptions(criterion.categoryKey, criterion.label)) return [chip];
      return [chip, <QualifierPicker key={`${criterionKey(criterion)}-qualifiers`} categoryKey={criterion.categoryKey} label={criterion.label} displayLabel={criterion.displayLabel} priorities={priorities} patch={patch} />];
    })}</div></section>)}</div>
    {!customOpen ? <button type="button" className="hh-add-own" onClick={() => setCustomOpen(true)}><Plus size={14} /> Add your own</button> : <div className="hh-custom-priority hh-onboarding-custom">
      <select className="hh-input" aria-label="Custom priority category" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)}>{categories.map(([title, items]) => <option key={title} value={items[0].categoryKey}>{title}</option>)}</select>
      <input autoFocus className="hh-input" aria-label="Custom priority" placeholder="What else matters?" value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), addCustom())} />
      <button type="button" className="hh-btn" disabled={!customLabel.trim()} onClick={addCustom}>Add</button><button type="button" className="hh-btn hh-btn-ghost" onClick={() => setCustomOpen(false)}>Cancel</button>
    </div>}
    <nav className="hh-onboarding-actions"><button type="button" className="hh-btn hh-btn-ghost" onClick={onBack}>Back</button><button type="button" className="hh-btn" disabled={isSaving} onClick={onNext}>{isSaving ? 'Saving your search…' : 'Rank my priorities'}</button></nav>
  </div>;
}

export default function Onboarding({ userId, searchId, initialPriorities, appVersion = null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set only when the app-group auth gate sent the user here with a pending
  // destination (e.g. someone shared a listing URL before ever signing up) —
  // see (app)/layout.js. That destination matters more than the usual
  // welcome-to-My-Search landing, so it takes over `finish()` when present;
  // otherwise nothing about onboarding's normal completion changes.
  const pendingRedirect = sanitizeRedirectPath(searchParams.get('redirect'));
  const persistPriorities = useCallback((next) => savePriorities(createClient(), { id: searchId }, userId, next), [searchId, userId]);
  const { state: priorities, patch, saveError, retry, flush, isSaving } = useReliableOptimisticState(normalizePriorities(initialPriorities), persistPriorities);
  // Three-stage journey: The Basics -> What Matters -> Rank Priorities. "Rank
  // Priorities" is not a screen inside this component — it's the real My Search
  // workspace and its drag-and-drop tier board, reached by finishing step 2.
  // There is no persisted step number to strand an existing user on: onboarding
  // completion is tracked only by the profiles.onboarding_complete boolean (see
  // completeOnboarding), so every user who opens /onboarding always starts this
  // two-screen flow fresh, however far a previous version of onboarding got them.
  const [step, setStep] = useState(1); const [finishError, setFinishError] = useState('');
  const finish = async (destination) => { setFinishError(''); try { await flush(); await completeOnboarding(createClient(), userId); router.push(destination); router.refresh(); } catch { setFinishError("Couldn't finish setup. Your choices are still here—please try again."); } };
  return <div className="hh-root"><OnboardingShell wide={step > 1}>
    {(saveError || finishError) && <p className="hh-save-error" role="alert">{saveError || finishError} <button type="button" onClick={saveError ? retry : () => setFinishError('')}>Dismiss</button></p>}
    <div className="hh-onboarding-brand"><BrandMark size={30} /><span className="hh-serif"><span>Feels Like </span><b>Home</b></span></div>
    <OnboardingProgress step={step} />
    {step === 1 && <BasicsStep priorities={priorities} patch={patch} onNext={() => setStep(2)} />}
    {step === 2 && <WhatMattersStep priorities={priorities} patch={patch} onBack={() => setStep(1)} onNext={() => finish(pendingRedirect || '/search?welcome=1')} isSaving={isSaving} />}
  </OnboardingShell><BetaFeedback userId={userId} searchId={searchId} searchType={priorities.searchType} appVersion={appVersion} /></div>;
}
