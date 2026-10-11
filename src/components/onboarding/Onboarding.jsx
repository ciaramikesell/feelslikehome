'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import { ChoiceChip, HelperRow, SectionCard } from '@/components/MobileSystem';
import RankBoard from '@/components/RankBoard';
import { GARAGE_PREFERENCE_OPTIONS, normalizePriorities } from '@/lib/constants';
import { ONBOARDING_SUGGESTIONS } from '@/lib/onboarding';
import {
  addCustomCriterion, customCategoryOptions,
  isCriterionSelected, moveCriterion, priorityLevels, selectedPriorityCount,
  setGaragePreference, toggleCriterion,
} from '@/lib/searchProfile';
import { createClient } from '@/lib/supabase/client';
import { useReliableOptimisticState } from '@/lib/useReliableOptimisticState';
import { completeOnboarding, saveOnboardingProgress } from '@/lib/supabase/data';
import { advanceOnboarding, completeOnboardingState, onboardingProgress, retreatOnboarding, setOnboardingAnswer } from '@/lib/onboardingFlow';
import { ANALYTICS_EVENTS, track } from '@/lib/analytics';
import { createCommuteDestination, deleteCommuteDestination, savePriorities, setActiveSearch } from '@/lib/supabase/collaboration';
import { choiceFromSelection, normalizePeople } from '@/lib/onboardingPeople';
import { googleAreaSuggestions } from '@/lib/areaSearchProvider';
import { sanitizeRedirectPath } from '@/lib/safeRedirect';
import { OnboardingAction, OnboardingRail, OnboardingTopBar } from '@/components/onboarding/OnboardingShell';
import BasicsStep from '@/components/onboarding/BasicsStep';
import LocationsStep from '@/components/onboarding/LocationsStep';
import CollaborationStep from '@/components/onboarding/CollaborationStep';
import WhatMattersStepV2 from '@/components/onboarding/WhatMattersStepV2';
import RankStepV2 from '@/components/onboarding/RankStepV2';

// Screen labels for the flow-1 steps (src/lib/onboardingFlow.js owns order and branching).
// Flow 1 is live; the approved six-step flow (3) is built and previewed step by step.
const STEP_LABELS = {
  basics: 'The Basics', what_matters: 'What Matters', rank: 'Rank Priorities',
  locations: 'Location', collaboration: 'Your People', priorities: 'What Matters', review: 'Review',
};

const BUILT_STEPS = new Set(['basics', 'locations', 'collaboration', 'priorities', 'what_matters', 'rank']);

// sharedFor: null in first-time account onboarding; in shared-search setup, the
// search the preferences are for (e.g. "Ciara’s search").
// The progress bar and step count live in the shell's top bar (OnboardingShell);
// the eyebrow names the step (approved copy: "STEP 1 · THE BASICS").
function StepHeader({ step, progress, title, lead, sharedFor = null }) {
  return (
    <header className="flh-onboarding-header">
      <p className="flh-eyebrow">{sharedFor ? `Your preferences for ${sharedFor}` : `Step ${progress.position} · ${STEP_LABELS[step]}`}</p>
      <h1 className="flh-page-title">{title}</h1>
      {lead && <p className="flh-lead">{lead}</p>}
    </header>
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

function WhatMattersStep({ priorities, patch, onNext, isSaving, progress, sharedFor = null }) {
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
      <StepHeader step="what_matters" progress={progress} sharedFor={sharedFor} searchType={priorities.onboardingSearchType} title="What matters to you?" lead="For now, just choose what matters. You’ll decide what’s a Must Have, Important, or Nice to Have next." />
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
        <OnboardingAction disabled={isSaving} onClick={onNext}>{isSaving ? 'Saving…' : 'Rank my priorities'}</OnboardingAction>
      </nav>
    </div>
  );
}

function RankStep({ priorities, patch, onFinish, finishing, progress, sharedFor = null }) {
  const levels = priorityLevels(priorities);
  return (
    <div className="flh-onboarding-step">
      <StepHeader step="rank" progress={progress} sharedFor={sharedFor} searchType={priorities.onboardingSearchType} title="Now rank what matters most." lead="Everything you chose began as Important. Drag a priority between levels, or tap it and choose where it belongs." />
      <RankBoard
        levels={levels}
        showDescriptions
        onMove={(item, tier) => patch((next) => moveCriterion(next, item.categoryKey, item.label, tier))}
        garagePreference={priorities.exterior?.garagePreference || 'any'}
        onGaragePreferenceChange={(value) => patch((next) => setGaragePreference(next, value))}
      />
      <nav className="flh-onboarding-actions">
        <OnboardingAction disabled={finishing} onClick={onFinish}>{finishing ? 'Saving your search…' : (sharedFor ? 'Save and see the homes' : 'Finish')}</OnboardingAction>
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

// Every write onboarding makes, in one place. Real pages use these defaults;
// the development-only preview (src/app/dev/onboarding) passes in-memory
// stand-ins so it can never touch Supabase.
const SUPABASE_SERVICES = Object.freeze({
  savePriorities: (searchId, userId, next) => savePriorities(createClient(), { id: searchId }, userId, next),
  saveProgress: (userId, progress) => saveOnboardingProgress(createClient(), userId, progress),
  completeOnboarding: (userId, progress) => completeOnboarding(createClient(), userId, progress),
  setActiveSearch: (userId, searchId) => setActiveSearch(createClient(), userId, searchId),
  submitFeedback: undefined, // BetaFeedback's own Supabase default
  // Places That Matter are the participant's own commute destinations on this
  // search. Onboarding never sets a maximum drive time (null), so a place adds
  // distance context only and never becomes a requirement.
  createPlace: (searchId, userId, place) => createCommuteDestination(createClient(), searchId, userId, { ...place, maxDriveMinutes: null }),
  deletePlace: (placeId) => deleteCommuteDestination(createClient(), placeId),
  // Areas of interest come only from the area-search provider (Google Places).
  searchAreas: (query) => googleAreaSuggestions(query),
});

// mode:
//   'account'             first-time account onboarding (records account-level
//                         onboarding completion and resumable progress).
//   'shared_search_setup' an already-onboarded co-buyer sets up their OWN
//                         preferences for a search they joined. Writes only their
//                         preference document on that search: never account
//                         onboarding state, never another search, never another
//                         person's preferences. Ends on that search's Homes, and
//                         can be left for the person's own search at any time.
export default function Onboarding({ userId, searchId, initialPriorities, initialProgress, appVersion = null, mode = 'account', ownerName = null, ownedSearchId = null, initialPlaces = [], placesError = null, initialPeople = null, peopleError = null, services = SUPABASE_SERVICES }) {
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
  const persistPriorities = useCallback((next) => services.savePriorities(searchId, userId, next), [services, searchId, userId]);
  const { state: priorities, patch, saveError, retry, flush, isSaving } = useReliableOptimisticState(normalizePriorities(initialPriorities), persistPriorities);
  // Saved places are rows of their own (not part of the priorities document):
  // shown only once the database has confirmed each write.
  const [places, setPlaces] = useState(initialPlaces);
  const createPlace = async (place) => {
    const saved = await services.createPlace(searchId, userId, place);
    setPlaces((current) => [...current, saved]);
  };
  const deletePlace = async (place) => {
    await services.deletePlace(place.id);
    setPlaces((current) => current.filter((entry) => entry.id !== place.id));
  };
  // Step 3: who is already in this search (read-only; onboarding never invites).
  const [people] = useState(() => normalizePeople(initialPeople));
  // Resumable progress (src/lib/onboardingFlow.js): the server page resolved
  // where to land for this person and this search. The gate itself is still
  // only profiles.onboarding_complete; stored progress steers, never traps —
  // an unknown or stale step resolves to a screen this person can see.
  const version = initialProgress.version;
  const [progressState, setProgressState] = useState(initialProgress.state);
  const progressRef = useRef(progressState);
  const step = progressState.step;
  // The approved six-step flow (3, not live) moves home details from Basics to Step 4.
  const sixStep = version === 3;
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
    saveChainRef.current = saveChainRef.current.then(() => services.saveProgress(userId, { version, state: progressRef.current }));
    return saveChainRef.current;
  }, [services, userId, version, sharedSetup]);
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
  // Step 3's cards are the onboarding answer only: saved with progress, never
  // an invitation or a membership.
  const chooseCollaboration = (selection) => {
    const choice = choiceFromSelection(selection);
    try { persistProgress(setOnboardingAnswer(progressRef.current, 'collaboration', choice)); } catch { /* an invited co-buyer always searches with a co-buyer */ }
  };
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
      await services.setActiveSearch(userId, ownedSearchId);
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
      await services.completeOnboarding(userId, { version, state: completeOnboardingState(version, progressRef.current) });
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
      <div className="flh-ob-layout">
        <OnboardingRail progress={progress} labels={STEP_LABELS} complete={ready} sharedFor={sharedFor} />
        <main className="flh-onboarding">
          {/* Back returns to the previous step; nothing precedes the first one yet. */}
          <OnboardingTopBar progress={progress} showProgress={!ready} onBack={!ready && progress.index > 0 ? () => goBack(step) : null} />
          {sharedSetup && ownedSearchId && (
            <p className="flh-shared-setup-exit">
              <button type="button" className="flh-text-action" onClick={backToOwnSearch} disabled={leavingSetup}>{leavingSetup ? 'Switching…' : 'Not now—go to your own search'}</button>
            </p>
          )}
          {(saveError || finishError) && <p className="hh-save-error" role="alert">{saveError || finishError} <button type="button" onClick={saveError ? retry : () => setFinishError('')}>{saveError ? 'Retry' : 'Dismiss'}</button></p>}
          {!ready && step === 'basics' && (
            <BasicsStep
              priorities={priorities}
              patch={patch}
              onNext={() => goTo('basics')}
              homeDetails={!sixStep}
              presetPropertyType={!sixStep}
              header={sharedFor ? (
                <>
                  <StepHeader step="basics" progress={progress} sharedFor={sharedFor} title={`Set up your preferences for ${sharedFor}.`} lead="Tell us what you’re looking for. These are yours alone—you can change them anytime." />
                  <HelperRow
                    tone="sage"
                    title="You don’t have to agree on everything."
                    body={`${ownerName || 'Your co-buyer'} keeps their own preferences, and FLH shows how each home works for each of you. Your own search and its homes aren’t affected.`}
                  />
                </>
              ) : (
                <StepHeader step="basics" progress={progress} title={<>The Basics of <em>Your Search</em></>} lead="What does home look like to you? You can adjust these anytime." />
              )}
            />
          )}
          {!ready && step === 'what_matters' && <WhatMattersStep priorities={priorities} patch={patch} progress={progress} sharedFor={sharedFor} onNext={() => goTo('what_matters')} isSaving={isSaving} />}
          {!ready && step === 'priorities' && (
            <WhatMattersStepV2
              priorities={priorities}
              patch={patch}
              isSaving={isSaving}
              onNext={() => goTo('priorities')}
              header={<StepHeader step="priorities" progress={progress} sharedFor={sharedFor} searchType={priorities.onboardingSearchType} title={<>What matters <em>most?</em></>} lead="Choose anything you’d weigh when comparing homes. You’ll rank your picks next." />}
            />
          )}
          {!ready && step === 'rank' && !sixStep && <RankStep priorities={priorities} patch={patch} progress={progress} sharedFor={sharedFor} onFinish={finish} finishing={finishing} />}
          {!ready && step === 'rank' && sixStep && (
            <RankStepV2
              priorities={priorities}
              patch={patch}
              onNext={() => goTo('rank')}
              onChoose={() => goBack('rank')}
              header={<StepHeader step="rank" progress={progress} sharedFor={sharedFor} searchType={priorities.onboardingSearchType} title={<>Let’s put things <em>in order.</em></>} lead="Everything you picked starts as Important. Move each priority into Must-Have, Important, or Nice-to-Have." />}
            />
          )}
          {!ready && step === 'locations' && (
            <LocationsStep
              priorities={priorities}
              patch={patch}
              AddressField={services.AddressField}
              searchAreas={services.searchAreas}
              places={places}
              placesError={placesError}
              onCreatePlace={createPlace}
              onDeletePlace={deletePlace}
              onNext={() => goTo('locations')}
              header={<StepHeader step="locations" progress={progress} sharedFor={sharedFor} title={<>Where are you <em>looking?</em></>} lead="Every search starts somewhere. Add the areas you’re drawn to, and we’ll keep them in mind as you explore." />}
            />
          )}
          {!ready && step === 'collaboration' && (
            <CollaborationStep
              choice={progressState.answers?.collaboration || null}
              onChoose={chooseCollaboration}
              people={people}
              peopleError={peopleError}
              role={progressState.context?.role === 'co_buyer' ? 'co_buyer' : 'owner'}
              onNext={() => goTo('collaboration')}
              onMaybeLater={() => goTo('collaboration')}
              header={<StepHeader step="collaboration" progress={progress} sharedFor={sharedFor} title={<>Searching with <em>someone?</em></>} lead="Home searching is better together. Invite the people who are part of your journey—or add them later." />}
            />
          )}
          {/* Approved-flow steps not built yet (only reachable in the development preview). */}
          {!ready && !BUILT_STEPS.has(step) && <p className="flh-ob-unbuilt" role="status">This step isn’t built yet.</p>}
          {ready && <ReadyStep onAddHome={() => leave('/homes?add=1')} onViewSearch={() => leave('/search?welcome=1')} />}
        </main>
      </div>
    </div>
  );
}
