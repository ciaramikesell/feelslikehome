'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import { normalizePriorities } from '@/lib/constants';
import { NEW_SEARCH_CHOICES, ONBOARDING_SUGGESTIONS, applySearchChoice, onboardingOverview, onboardingPriorityCounts } from '@/lib/onboarding';
import { selectPriorityItem } from '@/lib/matching';
import { createClient } from '@/lib/supabase/client';
import { useReliableOptimisticState } from '@/lib/useReliableOptimisticState';
import { completeOnboarding } from '@/lib/supabase/data';
import { savePriorities } from '@/lib/supabase/collaboration';
import { sanitizeRedirectPath } from '@/lib/safeRedirect';
import BetaFeedback from '@/components/BetaFeedback';

const criterionKey = (criterion) => `${criterion.categoryKey}:${criterion.label}`;

function OnboardingProgress({ step }) {
  const steps = ['The basics', 'What matters', 'Dealbreakers', 'My Search'];
  return <ol className="hh-onboarding-progress" aria-label="Setup progress">
    {steps.map((label, index) => <li key={label} className={step === index + 1 ? 'is-current' : step > index + 1 ? 'is-complete' : ''} aria-current={step === index + 1 ? 'step' : undefined}>
      <span>{step > index + 1 ? <><Check size={12} /><span className="sr-only">Completed: </span></> : index + 1}</span><b>{label}</b>
    </li>)}
  </ol>;
}

function OnboardingShell({ children, wide = false }) {
  return <div className="hh-onboarding-shell"><div className={`hh-corner hh-onboarding-card ${wide ? 'is-wide' : ''}`}>{children}</div></div>;
}

function BasicsField({ label, value, onChange, placeholder, prefix, suffix }) {
  return <label className="hh-onboarding-field"><span className="hh-label">{label}</span><span className="hh-onboarding-input-wrap">{prefix}<input className="hh-input" inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />{suffix}</span></label>;
}

function BasicsStep({ priorities, patch, onNext }) {
  const selectedChoice = priorities.onboardingSearchType || '';
  const rental = selectedChoice === 'home_rent' || selectedChoice === 'apartment_rent';
  return <div className="hh-onboarding-step">
    <header><h1 className="hh-serif">Let&apos;s find what feels like home.</h1><p>Start with the kind of search you&apos;re making. A few useful numbers are optional—you can change all of this later.</p></header>
    <fieldset className="hh-onboarding-fieldset"><legend className="hh-label">What are you searching for?</legend><div className="hh-choice-grid">
      {NEW_SEARCH_CHOICES.map((choice) => <button type="button" key={choice.key} className={`hh-choice-card ${selectedChoice === choice.key ? 'on' : ''}`} aria-pressed={selectedChoice === choice.key} onClick={() => patch((next) => applySearchChoice(next, choice.key))}>{selectedChoice === choice.key && <Check size={15} aria-hidden="true" />}{choice.label}</button>)}
    </div></fieldset>
    {selectedChoice && <div className="hh-onboarding-basics-grid">
      <BasicsField label={rental ? 'Maximum monthly rent' : 'Maximum budget'} prefix="$" placeholder={rental ? '2,200' : '450,000'} value={priorities.budget.value} onChange={(value) => patch((next) => { next.budget = { ...next.budget, value }; return next; })} />
      <BasicsField label="Minimum bedrooms" placeholder="3" suffix="beds" value={priorities.bedsMin.value} onChange={(value) => patch((next) => { next.bedsMin = { ...next.bedsMin, value }; return next; })} />
      <BasicsField label="Minimum bathrooms" placeholder="2" suffix="baths" value={priorities.bathsMin.value} onChange={(value) => patch((next) => { next.bathsMin = { ...next.bathsMin, value }; return next; })} />
      <BasicsField label="Minimum square footage" placeholder="1,800" suffix="sq ft" value={priorities.sqftTarget.value} onChange={(value) => patch((next) => { next.sqftTarget = { ...next.sqftTarget, value }; return next; })} />
    </div>}
    <nav className="hh-onboarding-actions"><span /><button type="button" className="hh-btn" disabled={!selectedChoice} onClick={onNext}>Continue</button></nav>
  </div>;
}

function WhatMattersStep({ priorities, patch, onNext, onBack, dealbreakers, setDealbreakers }) {
  const categories = ONBOARDING_SUGGESTIONS[priorities.onboardingSearchType] || [];
  const [customOpen, setCustomOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customCategory, setCustomCategory] = useState(categories[0]?.[1]?.[0]?.categoryKey || 'homeFeel');
  const selected = (criterion) => ['must', 'important', 'nice'].includes(priorities[criterion.categoryKey]?.tiers?.[criterion.label]);
  const toggle = (criterion) => patch((next) => {
    const key = criterionKey(criterion);
    const def = { key: criterion.categoryKey, coreItems: [], suggestedItems: [] };
    next[criterion.categoryKey] = selectPriorityItem(next[criterion.categoryKey], def, { label: criterion.label, kind: criterion.kind }, selected(criterion) ? 'dontcare' : 'important');
    if (selected(criterion)) setDealbreakers((current) => { const copy = new Set(current); copy.delete(key); return copy; });
    return next;
  });
  const addCustom = () => {
    const label = customLabel.trim();
    if (!label) return;
    patch((next) => {
      const current = next[customCategory];
      if (!(current.customItems || []).some((entry) => entry.label.toLowerCase() === label.toLowerCase())) {
        next[customCategory] = { ...current, customItems: [...(current.customItems || []), { label, kind: customCategory === 'features' ? 'check' : 'rating' }], tiers: { ...current.tiers, [label]: 'important' } };
      }
      return next;
    });
    setCustomLabel(''); setCustomOpen(false);
  };
  return <div className="hh-onboarding-step">
    <header><h1 className="hh-serif">What matters to you?</h1><p>Pick everything you&apos;d care about when comparing your options. Don&apos;t overthink it—we&apos;ll start these as Important and you can change them anytime.</p></header>
    <div className="hh-onboarding-suggestions">{categories.map(([title, items]) => <section key={title}><h2>{title}</h2><div>{items.map((criterion) => <button type="button" key={criterionKey(criterion)} className={`hh-chip ${selected(criterion) ? 'on' : ''}`} aria-pressed={selected(criterion)} onClick={() => toggle(criterion)}>{selected(criterion) && <Check size={13} aria-hidden="true" />}{criterion.displayLabel}</button>)}</div></section>)}</div>
    {!customOpen ? <button type="button" className="hh-add-own" onClick={() => setCustomOpen(true)}><Plus size={14} /> Add your own</button> : <div className="hh-custom-priority hh-onboarding-custom">
      <select className="hh-input" aria-label="Custom priority category" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)}>{categories.map(([title, items]) => <option key={title} value={items[0].categoryKey}>{title}</option>)}</select>
      <input autoFocus className="hh-input" aria-label="Custom priority" placeholder="What else matters?" value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), addCustom())} />
      <button type="button" className="hh-btn" disabled={!customLabel.trim()} onClick={addCustom}>Add</button><button type="button" className="hh-btn hh-btn-ghost" onClick={() => setCustomOpen(false)}>Cancel</button>
    </div>}
    <nav className="hh-onboarding-actions"><button type="button" className="hh-btn hh-btn-ghost" onClick={onBack}>Back</button><button type="button" className="hh-btn" onClick={onNext}>Continue</button></nav>
  </div>;
}

function DealbreakersStep({ priorities, patch, dealbreakers, setDealbreakers, onBack, onFinish, isSaving }) {
  const catalog = useMemo(() => (ONBOARDING_SUGGESTIONS[priorities.onboardingSearchType] || []).flatMap(([, items]) => items), [priorities.onboardingSearchType]);
  const custom = ['location', 'features', 'exterior', 'homeFeel'].flatMap((categoryKey) => (priorities[categoryKey]?.customItems || []).map((entry) => ({ ...entry, categoryKey, displayLabel: entry.label })));
  const byKey = new Map([...catalog, ...custom].map((entry) => [criterionKey(entry), entry]));
  const selected = [...byKey.values()].filter((criterion) => ['must', 'important', 'nice'].includes(priorities[criterion.categoryKey]?.tiers?.[criterion.label]));
  const toggle = (criterion) => {
    const key = criterionKey(criterion); const becomingMust = !dealbreakers.has(key);
    setDealbreakers((current) => { const copy = new Set(current); becomingMust ? copy.add(key) : copy.delete(key); return copy; });
    patch((next) => { next[criterion.categoryKey] = { ...next[criterion.categoryKey], tiers: { ...next[criterion.categoryKey].tiers, [criterion.label]: becomingMust ? 'must' : 'important' } }; return next; });
  };
  return <div className="hh-onboarding-step">
    <header><h1 className="hh-serif">Okay, what are the dealbreakers?</h1><p>These all matter. Which ones would be really hard to compromise on?</p><p className="hh-onboarding-note">We&apos;ll move those to Must Have. Everything else stays Important.</p></header>
    {selected.length ? <div className="hh-dealbreaker-chips">{selected.map((criterion) => <button type="button" key={criterionKey(criterion)} className={`hh-chip ${dealbreakers.has(criterionKey(criterion)) ? 'on' : ''}`} aria-pressed={dealbreakers.has(criterionKey(criterion))} onClick={() => toggle(criterion)}>{dealbreakers.has(criterionKey(criterion)) && <Check size={13} aria-hidden="true" />}{criterion.displayLabel}</button>)}</div> : <p className="hh-onboarding-empty">Nothing to sort here. Your search can start simple.</p>}
    <nav className="hh-onboarding-actions"><button type="button" className="hh-btn hh-btn-ghost" onClick={onBack}>Back</button><button type="button" className="hh-btn" disabled={isSaving} onClick={onFinish}>{isSaving ? 'Saving your search…' : 'Show me My Search'}</button></nav>
  </div>;
}

function SummaryStep({ priorities, onBack, onAddHome, onMySearch, isSaving }) {
  const overview = onboardingOverview(priorities);
  const counts = onboardingPriorityCounts(priorities);
  return <div className="hh-onboarding-step hh-onboarding-summary">
    <header><h1 className="hh-serif">My Search Criteria</h1><p>Here&apos;s what we&apos;ll use to match your options. You can update anything anytime.</p></header>
    <div className="hh-onboarding-summary-grid">
      <section aria-labelledby="search-overview-heading"><h2 id="search-overview-heading">Search overview</h2><ul>{overview.map((line) => <li key={line}>{line}</li>)}</ul></section>
      <section aria-labelledby="priority-summary-heading"><h2 id="priority-summary-heading">Your priorities</h2><ul className="hh-onboarding-counts"><li><strong>{counts.must}</strong> Must {counts.must === 1 ? 'Have' : 'Haves'}</li><li><strong>{counts.important}</strong> Important</li><li><strong>{counts.nice}</strong> Nice to {counts.nice === 1 ? 'Have' : 'Haves'}</li></ul></section>
    </div>
    <section className="hh-onboarding-activation"><h2 className="hh-serif">Looks good?</h2><p>Add a home you&apos;re considering and we&apos;ll show you how it stacks up.</p><button type="button" className="hh-btn hh-onboarding-primary" disabled={isSaving} onClick={onAddHome}>Add your first home</button><button type="button" className="hh-btn hh-btn-ghost" disabled={isSaving} onClick={onMySearch}>Go to My Search</button></section>
    <nav className="hh-onboarding-actions"><button type="button" className="hh-btn hh-btn-ghost" onClick={onBack}>Back</button></nav>
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
  const initial = normalizePriorities(initialPriorities);
  const initialDealbreakers = new Set(['location', 'features', 'exterior', 'homeFeel'].flatMap((categoryKey) => Object.entries(initial[categoryKey].tiers || {}).filter(([, tier]) => tier === 'must').map(([label]) => `${categoryKey}:${label}`)));
  const [step, setStep] = useState(1); const [dealbreakers, setDealbreakers] = useState(initialDealbreakers); const [finishError, setFinishError] = useState('');
  const showSummary = async () => { setFinishError(''); try { await flush(); setStep(4); } catch { setFinishError("Couldn't save your search. Your choices are still here—please try again."); } };
  const finish = async (destination) => { setFinishError(''); try { await flush(); await completeOnboarding(createClient(), userId); router.push(destination); router.refresh(); } catch { setFinishError("Couldn't finish setup. Your choices are still here—please try again."); } };
  return <div className="hh-root"><OnboardingShell wide={step > 1}>
    {(saveError || finishError) && <p className="hh-save-error" role="alert">{saveError || finishError} <button type="button" onClick={saveError ? retry : () => setFinishError('')}>Dismiss</button></p>}
    <div className="hh-onboarding-brand"><BrandMark size={30} /><span className="hh-serif"><span>Feels Like </span><b>Home</b></span></div>
    <OnboardingProgress step={step} />
    {step === 1 && <BasicsStep priorities={priorities} patch={patch} onNext={() => setStep(2)} />}
    {step === 2 && <WhatMattersStep priorities={priorities} patch={patch} dealbreakers={dealbreakers} setDealbreakers={setDealbreakers} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
    {step === 3 && <DealbreakersStep priorities={priorities} patch={patch} dealbreakers={dealbreakers} setDealbreakers={setDealbreakers} onBack={() => setStep(2)} onFinish={showSummary} isSaving={isSaving} />}
    {step === 4 && <SummaryStep priorities={priorities} onBack={() => setStep(3)} onAddHome={() => finish('/homes?add=1')} onMySearch={() => finish(pendingRedirect || '/search?welcome=1')} isSaving={isSaving} />}
  </OnboardingShell><BetaFeedback userId={userId} searchId={searchId} searchType={priorities.searchType} appVersion={appVersion} /></div>;
}
