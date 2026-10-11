'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Building2, Home as HomeIcon, KeyRound, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import { ChoiceChip, HelperRow, SectionCard, SelectCard } from '@/components/MobileSystem';
import RankBoard from '@/components/RankBoard';
import { GARAGE_PREFERENCE_OPTIONS, normalizePriorities } from '@/lib/constants';
import { PROPERTY_TYPE_LABELS } from '@/lib/searchIntent';
import { NEW_SEARCH_CHOICES, ONBOARDING_SUGGESTIONS, applySearchChoice } from '@/lib/onboarding';
import {
  CONDITION_CHOICES, LAYOUT_CHOICES, addCustomCriterion, basicsFieldsFor, customCategoryOptions,
  isCriterionSelected, moveCriterion, priorityLevels, sanitizeNumericInput, selectedPriorityCount,
  setGaragePreference, toggleCriterion,
} from '@/lib/searchProfile';
import { createClient } from '@/lib/supabase/client';
import { useReliableOptimisticState } from '@/lib/useReliableOptimisticState';
import { completeOnboarding, saveOnboardingProgress } from '@/lib/supabase/data';
import { advanceOnboarding, completeOnboardingState, onboardingProgress, retreatOnboarding } from '@/lib/onboardingFlow';
import { ANALYTICS_EVENTS, track } from '@/lib/analytics';
import { savePriorities, setActiveSearch } from '@/lib/supabase/collaboration';
import { sanitizeRedirectPath } from '@/lib/safeRedirect';
import BetaFeedback from '@/components/BetaFeedback';

// Screen labels for the flow-1 steps (src/lib/onboardingFlow.js owns order and branching).
const STEP_LABELS = { basics: 'The Basics', what_matters: 'What Matters', rank: 'Rank Priorities' };
const CHOICE_ICONS = { home_buy: HomeIcon, home_rent: KeyRound, apartment_rent: Building2 };
const CHOICE_LABELS = { home_buy: 'Home to Buy', home_rent: 'Home to Rent', apartment_rent: 'Apartment to Rent' };

// sharedFor: null in first-time account onboarding; in shared-search setup, the
// search the preferences are for (e.g. "Ciara’s search").
function StepHeader({ step, progress, title, lead, sharedFor = null }) {
  return (
    <header className="flh-onboarding-header">
      <div className="flh-onboarding-progress" aria-hidden="true">{progress.steps.map((key, index) => <span key={key} className={index < progress.position ? 'is-done' : ''} />)}</div>
      <p className="flh-eyebrow">{sharedFor ? `Your preferences for ${sharedFor} · Step ${progress.position} of ${progress.total}` : `Step ${progress.position} of ${progress.total} · ${STEP_LABELS[step]}`}</p>
      <h1 className="flh-page-title">{title}</h1>
      {lead && <p className="flh-lead">{lead}</p>}
    </header>
  );
}

function NumberField({ label, value, onChange, prefix, suffix, placeholder, decimal = false, optional = false }) {
  return (
    <label className="flh-number-field">
      <span className="flh-field-label">{label}{optional && <em> (optional)</em>}</span>
      <span className="flh-number-input">
        {prefix && <span aria-hidden="true">{prefix}</span>}
        <input inputMode={decimal ? 'decimal' : 'numeric'} value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange(sanitizeNumericInput(event.target.value, { decimal }))} />
        {suffix && <span aria-hidden="true">{suffix}</span>}
      </span>
    </label>
  );
}

function OptionGroup({ legend, options, selected, onToggle }) {
  return (
    <fieldset className="flh-option-group">
      <legend className="flh-field-label">{legend} <em>(optional)</em></legend>
      <div className="flh-chip-row">
        {options.map((option) => <ChoiceChip key={option.value} selected={selected.includes(option.value)} onClick={() => onToggle(option.value)}>{option.label}</ChoiceChip>)}
      </div>
    </fieldset>
  );
}

// Multi-select Basics never carry "No Preference" forward once a real choice is made;
// an option retained from older data (e.g. 'Split Level', 'Townhome') stays visible
// and removable instead of silently disappearing.
const toggleValue = (values, value) => {
  const current = (values || []).filter((entry) => entry !== 'No Preference');
  return current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
};
const withRetained = (choices, values, labelFor = (value) => value) => [
  ...choices,
  ...(values || []).filter((value) => value !== 'No Preference' && !choices.some((choice) => choice.value === value)).map((value) => ({ value, label: labelFor(value) })),
];

function BasicsStep({ priorities, patch, onNext, progress, sharedFor = null, ownerName = null }) {
  const choice = priorities.onboardingSearchType || '';
  const fields = basicsFieldsFor(choice);
  const setValue = (key, value) => patch((next) => { next[key] = { ...next[key], value }; return next; });
  const setValues = (key, value) => patch((next) => { next[key] = { ...next[key], values: toggleValue(next[key]?.values, value) }; return next; });
  return (
    <div className="flh-onboarding-step">
      {sharedFor ? (
        <>
          <StepHeader step="basics" progress={progress} sharedFor={sharedFor} title={`Set up your preferences for ${sharedFor}.`} lead="Tell us what you’re looking for. These are yours alone—you can change them anytime." />
          <HelperRow
            tone="sage"
            title="You don’t have to agree on everything."
            body={`${ownerName || 'Your co-buyer'} keeps their own preferences, and FLH shows how each home works for each of you. Your own search and its homes aren’t affected.`}
          />
        </>
      ) : (
        <StepHeader step="basics" progress={progress} title="Let’s find what feels like home." lead="Start with the kind of search you’re making. Add a few helpful details now—you can change everything later." />
      )}
      <fieldset className="flh-option-group">
        <legend className="flh-section-kicker">Search type</legend>
        <div className="flh-select-grid">
          {NEW_SEARCH_CHOICES.map((option) => (
            <SelectCard key={option.key} icon={CHOICE_ICONS[option.key]} selected={choice === option.key} onClick={() => patch((next) => applySearchChoice(next, option.key))}>{CHOICE_LABELS[option.key]}</SelectCard>
          ))}
        </div>
      </fieldset>
      {choice && (
        <SectionCard className="flh-basics-card">
          <p className="flh-section-kicker">A few guideposts</p>
          <div className="flh-number-grid">
            <NumberField label={fields.budgetLabel} prefix="$" placeholder={fields.budgetPlaceholder} value={priorities.budget.value} onChange={(value) => setValue('budget', value)} />
            <NumberField label="Minimum bedrooms" placeholder="3" suffix="beds" value={priorities.bedsMin.value} onChange={(value) => setValue('bedsMin', value)} />
            <NumberField label="Minimum bathrooms" placeholder="2" suffix="baths" decimal value={priorities.bathsMin.value} onChange={(value) => setValue('bathsMin', value)} />
            <NumberField label="Minimum square footage" placeholder="1,800" suffix="sq ft" value={priorities.sqftTarget.value} onChange={(value) => setValue('sqftTarget', value)} />
            {fields.lotSize && <NumberField label="Minimum lot size" optional placeholder="0.25" suffix="acres" decimal value={priorities.lotSizeTarget.value} onChange={(value) => setValue('lotSizeTarget', value)} />}
          </div>
          {fields.propertyTypes.length > 0 && (
            <OptionGroup
              legend="What kinds of homes are you considering?"
              options={withRetained(fields.propertyTypes.map((value) => ({ value, label: PROPERTY_TYPE_LABELS[value] })), priorities.preferredPropertyTypes.values, (value) => PROPERTY_TYPE_LABELS[value] || value)}
              selected={priorities.preferredPropertyTypes.values}
              onToggle={(value) => setValues('preferredPropertyTypes', value)}
            />
          )}
          {fields.layout && <OptionGroup legend="Home layout" options={withRetained(LAYOUT_CHOICES, priorities.homeLayout.values)} selected={priorities.homeLayout.values} onToggle={(value) => setValues('homeLayout', value)} />}
          {fields.condition && <OptionGroup legend="Home condition" options={withRetained(CONDITION_CHOICES, priorities.homeCondition.values)} selected={priorities.homeCondition.values} onToggle={(value) => setValues('homeCondition', value)} />}
        </SectionCard>
      )}
      <nav className="flh-onboarding-actions">
        <span />
        <button type="button" className="flh-button flh-button-primary" disabled={!choice} onClick={onNext}>Continue</button>
      </nav>
    </div>
  );
}

function GarageQualifier({ priorities, patch }) {
  const value = priorities.exterior?.garagePreference || 'any';
  return (
    <div className="flh-garage-preference">
      <span className="flh-field-label">Garage preference <em>(optional)</em></span>
      <div className="flh-segmented" role="radiogroup" aria-label="Garage preference">
        {GARAGE_PREFERENCE_OPTIONS.map((option) => (
          <button type="button" role="radio" key={option.key} aria-checked={value === option.key} className={value === option.key ? 'is-selected' : ''} onClick={() => patch((next) => setGaragePreference(next, option.key))}>{option.label}</button>
        ))}
      </div>
    </div>
  );
}

function WhatMattersStep({ priorities, patch, onNext, onBack, isSaving, progress, sharedFor = null }) {
  const groups = ONBOARDING_SUGGESTIONS[priorities.onboardingSearchType] || [];
  const offered = groups.flatMap(([, items]) => items);
  const offeredKeys = new Set(offered.map((criterion) => `${criterion.categoryKey}:${criterion.label}`));
  const categories = customCategoryOptions(priorities);
  const [customOpen, setCustomOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customCategory, setCustomCategory] = useState(categories[0]?.key || 'location');
  const count = selectedPriorityCount(priorities);
  // Anything selected that isn't one of the offered chips — the buyer's own typed
  // priorities and any earlier selection — stays visible (and removable) here.
  const ownItems = priorityLevels(priorities).flatMap((level) => level.items).filter((item) => !offeredKeys.has(item.key));
  const garageSelected = isCriterionSelected(priorities, 'exterior', 'Garage');

  const addCustom = () => {
    if (!customLabel.trim()) return;
    patch((next) => addCustomCriterion(next, customCategory, customLabel, offered));
    setCustomLabel('');
    setCustomOpen(false);
  };

  return (
    <div className="flh-onboarding-step">
      <StepHeader step="what_matters" progress={progress} sharedFor={sharedFor} title="What matters to you?" lead="For now, just choose what matters. You’ll decide what’s a Must Have, Important, or Nice to Have next." />
      <HelperRow
        className="flh-count-row"
        tone="sage"
        title={count ? 'Your home profile is taking shape' : 'Choose what you’d weigh when comparing homes'}
        body={count ? `${count} ${count === 1 ? 'priority' : 'priorities'} selected · all start as Important` : 'Pick as many or as few as you like.'}
        trailing={<span className="flh-count-number" aria-hidden="true">{count}</span>}
      />
      {groups.map(([title, items]) => (
        <SectionCard key={title} className="flh-criteria-card">
          <h2 className="flh-card-title">{title}</h2>
          <div className="flh-chip-row">
            {items.map((criterion) => (
              <ChoiceChip key={`${criterion.categoryKey}:${criterion.label}`} selected={isCriterionSelected(priorities, criterion.categoryKey, criterion.label)} onClick={() => patch((next) => toggleCriterion(next, criterion))}>{criterion.displayLabel}</ChoiceChip>
            ))}
          </div>
          {garageSelected && items.some((criterion) => criterion.categoryKey === 'exterior' && criterion.label === 'Garage') && <GarageQualifier priorities={priorities} patch={patch} />}
        </SectionCard>
      ))}
      {ownItems.length > 0 && (
        <SectionCard className="flh-criteria-card">
          <h2 className="flh-card-title">Your own</h2>
          <div className="flh-chip-row">
            {ownItems.map((item) => <ChoiceChip key={item.key} selected onClick={() => patch((next) => moveCriterion(next, item.categoryKey, item.label, 'dontcare'))}>{item.displayLabel}</ChoiceChip>)}
          </div>
        </SectionCard>
      )}
      {!customOpen ? (
        <button type="button" className="flh-button flh-button-outline" onClick={() => setCustomOpen(true)}><Plus size={16} aria-hidden="true" /> Add your own</button>
      ) : (
        <SectionCard className="flh-custom-form">
          <label className="flh-field-label" htmlFor="onboarding-custom-priority">What else matters?</label>
          <input id="onboarding-custom-priority" autoFocus className="flh-input" placeholder="e.g. Mudroom" value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }} />
          <select className="flh-input" aria-label="Custom priority category" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)}>
            {categories.map((category) => <option key={category.key} value={category.key}>{category.title}</option>)}
          </select>
          <div className="flh-inline-actions">
            <button type="button" className="flh-text-action" onClick={() => setCustomOpen(false)}>Cancel</button>
            <button type="button" className="flh-button flh-button-primary flh-button-small" disabled={!customLabel.trim()} onClick={addCustom}>Add</button>
          </div>
        </SectionCard>
      )}
      <nav className="flh-onboarding-actions">
        <button type="button" className="flh-text-action" onClick={onBack}>Back</button>
        <button type="button" className="flh-button flh-button-primary" disabled={isSaving} onClick={onNext}>{isSaving ? 'Saving…' : 'Rank my priorities'}</button>
      </nav>
    </div>
  );
}

function RankStep({ priorities, patch, onBack, onFinish, finishing, progress, sharedFor = null }) {
  const levels = priorityLevels(priorities);
  return (
    <div className="flh-onboarding-step">
      <StepHeader step="rank" progress={progress} sharedFor={sharedFor} title="Now rank what matters most." lead="Everything you chose began as Important. Drag a priority between levels, or tap it and choose where it belongs." />
      <RankBoard
        levels={levels}
        showDescriptions
        onMove={(item, tier) => patch((next) => moveCriterion(next, item.categoryKey, item.label, tier))}
        garagePreference={priorities.exterior?.garagePreference || 'any'}
        onGaragePreferenceChange={(value) => patch((next) => setGaragePreference(next, value))}
      />
      <nav className="flh-onboarding-actions">
        <button type="button" className="flh-text-action" onClick={onBack}>Back</button>
        <button type="button" className="flh-button flh-button-primary" disabled={finishing} onClick={onFinish}>{finishing ? 'Saving your search…' : (sharedFor ? 'Save and see the homes' : 'Finish')}</button>
      </nav>
    </div>
  );
}

function ReadyStep({ onAddHome, onViewSearch }) {
  return (
    <div className="flh-onboarding-step flh-ready">
      <span className="flh-ready-mark" aria-hidden="true"><BrandMark size={44} /></span>
      <h1 className="flh-page-title">Your search is ready.</h1>
      <p className="flh-lead">Now let’s see how your first home measures up.</p>
      <ul className="flh-reassurance">
        <li><Sparkles size={16} aria-hidden="true" /> Your Match stays personal—it’s measured against your priorities, not anyone else’s.</li>
        <li><ShieldCheck size={16} aria-hidden="true" /> Unknown information never counts against a home.</li>
      </ul>
      <div className="flh-ready-actions">
        <button type="button" className="flh-button flh-button-primary" onClick={onAddHome}>Add your first home <ArrowRight size={16} aria-hidden="true" /></button>
        <button type="button" className="flh-button flh-button-outline" onClick={onViewSearch}>View My Search</button>
      </div>
    </div>
  );
}

// mode:
//   'account'             first-time account onboarding (records account-level
//                         onboarding completion and resumable progress).
//   'shared_search_setup' an already-onboarded co-buyer sets up their OWN
//                         preferences for a search they joined. Writes only their
//                         preference document on that search: never account
//                         onboarding state, never another search, never another
//                         person's preferences. Ends on that search's Homes, and
//                         can be left for the person's own search at any time.
export default function Onboarding({ userId, searchId, initialPriorities, initialProgress, appVersion = null, mode = 'account', ownerName = null, ownedSearchId = null }) {
  const sharedSetup = mode === 'shared_search_setup';
  const sharedFor = sharedSetup ? (ownerName ? `${/s$/i.test(ownerName) ? `${ownerName}’` : `${ownerName}’s`} search` : 'this shared search') : null;
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set only when the app-group auth gate sent the user here with a pending
  // destination (e.g. someone shared a listing URL before ever signing up) —
  // see (app)/layout.js. That destination matters more than the usual first-home
  // handoff, so finishing goes straight there when present (the canonical
  // /homes?url= intake then takes over); otherwise the completion screen shows.
  const pendingRedirect = sanitizeRedirectPath(searchParams.get('redirect'));
  const persistPriorities = useCallback((next) => savePriorities(createClient(), { id: searchId }, userId, next), [searchId, userId]);
  const { state: priorities, patch, saveError, retry, flush, isSaving } = useReliableOptimisticState(normalizePriorities(initialPriorities), persistPriorities);
  // Resumable progress (src/lib/onboardingFlow.js): the server page resolved
  // where to land for this person and this search. The gate itself is still
  // only profiles.onboarding_complete; stored progress steers, never traps —
  // an unknown or stale step resolves to a screen this person can see.
  const version = initialProgress.version;
  const [progressState, setProgressState] = useState(initialProgress.state);
  const progressRef = useRef(progressState);
  const step = progressState.step;
  const progress = onboardingProgress(version, progressState, step);
  const [ready, setReady] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');
  const eventContext = { flow_version: version, role: progressState.context?.role };

  // Writes are chained so quick taps can't land out of order and leave an
  // older position stored; each write carries the latest state.
  const saveChainRef = useRef(Promise.resolve());
  const saveProgress = useCallback(() => {
    // Shared-search setup is not account onboarding: its position is never stored.
    if (sharedSetup) return Promise.resolve(false);
    saveChainRef.current = saveChainRef.current.then(() => saveOnboardingProgress(createClient(), userId, { version, state: progressRef.current }));
    return saveChainRef.current;
  }, [userId, version, sharedSetup]);
  const persistProgress = useCallback((next) => {
    progressRef.current = next;
    setProgressState(next);
    return saveProgress();
  }, [saveProgress]);

  useEffect(() => {
    if (sharedSetup) return;
    if (initialProgress.changed) persistProgress(initialProgress.state);
    track(initialProgress.fresh ? ANALYTICS_EVENTS.ONBOARDING_STARTED : ANALYTICS_EVENTS.ONBOARDING_RESUMED, { ...eventContext, step, search_changed: initialProgress.searchChanged });
    // Once per mount: this records how the session began, not each render.
  }, []);

  useEffect(() => {
    if (!ready && !sharedSetup) track(ANALYTICS_EVENTS.ONBOARDING_STEP_VIEWED, { ...eventContext, step, position: progress.position, total: progress.total });
  }, [step, ready]);

  // Backgrounding (app switch, lock screen, tab hidden) is where an
  // interrupted session is most likely lost: save answers and position now.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      flush().catch(() => {});
      saveProgress();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [flush, saveProgress]);

  const goTo = async (fromStep) => {
    await flush();
    const { state: next } = advanceOnboarding(version, progressRef.current, fromStep);
    persistProgress(next);
    if (!sharedSetup) track(ANALYTICS_EVENTS.ONBOARDING_STEP_COMPLETED, { ...eventContext, step: fromStep });
    window.scrollTo?.({ top: 0 });
  };
  // Going back never clears an answer: priorities stay saved, and the
  // screen re-renders from them.
  const goBack = (fromStep) => { persistProgress(retreatOnboarding(version, progressRef.current, fromStep)); window.scrollTo?.({ top: 0 }); };
  const leave = (destination) => { router.push(destination); router.refresh(); };
  // Shared-search setup ends by saving this person's own preferences on this
  // search (the document the setup gate checks) and opening its Homes.
  const finishSharedSetup = async () => {
    await flush();
    await persistPriorities(priorities);
    leave(pendingRedirect || '/homes');
  };
  const [leavingSetup, setLeavingSetup] = useState(false);
  const backToOwnSearch = async () => {
    setLeavingSetup(true);
    try {
      await setActiveSearch(createClient(), userId, ownedSearchId);
      leave('/homes');
    } catch {
      setFinishError('Couldn’t switch back to your search. Please try again.');
      setLeavingSetup(false);
    }
  };
  const finish = async () => {
    setFinishError('');
    setFinishing(true);
    try {
      if (sharedSetup) { await finishSharedSetup(); return; }
      await flush();
      // The participant document must exist on this search when onboarding
      // ends — it is what the shared-search setup gate checks — even if the
      // last screen changed nothing. Idempotent upsert of the caller's own row.
      await persistPriorities(priorities);
      await completeOnboarding(createClient(), userId, { version, state: completeOnboardingState(version, progressRef.current) });
      track(ANALYTICS_EVENTS.ONBOARDING_COMPLETED, eventContext);
      if (pendingRedirect) { router.push(pendingRedirect); router.refresh(); return; }
      setReady(true);
      window.scrollTo?.({ top: 0 });
    } catch {
      setFinishError('Couldn’t finish setup. Your choices are still here—please try again.');
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="hh-root flh-onboarding-root">
      <main className="flh-onboarding">
        <div className="flh-onboarding-brand"><BrandMark size={28} /><span className="hh-serif"><span>Feels Like </span><b>Home</b></span></div>
        {sharedSetup && ownedSearchId && (
          <p className="flh-shared-setup-exit">
            <button type="button" className="flh-text-action" onClick={backToOwnSearch} disabled={leavingSetup}>{leavingSetup ? 'Switching…' : 'Not now—go to your own search'}</button>
          </p>
        )}
        {(saveError || finishError) && <p className="hh-save-error" role="alert">{saveError || finishError} <button type="button" onClick={saveError ? retry : () => setFinishError('')}>{saveError ? 'Retry' : 'Dismiss'}</button></p>}
        {!ready && step === 'basics' && <BasicsStep priorities={priorities} patch={patch} progress={progress} sharedFor={sharedFor} ownerName={ownerName} onNext={() => goTo('basics')} />}
        {!ready && step === 'what_matters' && <WhatMattersStep priorities={priorities} patch={patch} progress={progress} sharedFor={sharedFor} onBack={() => goBack('what_matters')} onNext={() => goTo('what_matters')} isSaving={isSaving} />}
        {!ready && step === 'rank' && <RankStep priorities={priorities} patch={patch} progress={progress} sharedFor={sharedFor} onBack={() => goBack('rank')} onFinish={finish} finishing={finishing} />}
        {ready && <ReadyStep onAddHome={() => leave('/homes?add=1')} onViewSearch={() => leave('/search?welcome=1')} />}
      </main>
      <BetaFeedback userId={userId} searchId={searchId} searchType={priorities.searchType} appVersion={appVersion} />
    </div>
  );
}
