'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { SaveStatus } from '@/components/MobileSystem';
import { OnboardingAction } from '@/components/onboarding/OnboardingShell';
import FeatureVisual from '@/components/onboarding/priority/FeatureVisual';
import { CategoryScreen, PriorityFooter, PriorityHeader } from '@/components/onboarding/priority/PriorityFlow';
import { normalizePriorities } from '@/lib/constants';
import { exploreCategory, exploreIndex, exploreProgress, exploreSteps, neighborExploreStep, recordExploreVisit } from '@/lib/explorePriorities';
import { createClient } from '@/lib/supabase/client';
import { savePriorities } from '@/lib/supabase/collaboration';
import { useReliableOptimisticState } from '@/lib/useReliableOptimisticState';

// Explore My Priorities (Milestone 2): the V3 category walkthrough, opened
// from My Search whenever someone likes. Same document and save path as My
// Search (savePriorities → the participant's own search_member_priorities
// row), same category screens, cards, photos and importance sheet as
// onboarding (CategoryScreen). Every change saves as it is made, so leaving
// at any moment loses nothing. Skip changes nothing. Basics, the kind of
// search and account onboarding are never involved.
const SERVICES = Object.freeze({
  savePriorities: (search, userId, next) => savePriorities(createClient(), search, userId, next),
});

function CategoryList({ index, onOpen }) {
  return (
    <ul className="flh-explore-list" aria-label="Categories">
      {index.map((entry) => (
        <li key={entry.step}>
          <button type="button" className="flh-explore-row" onClick={() => onOpen(entry.step)}>
            <span className="flh-explore-thumb" aria-hidden="true">{entry.cover ? <FeatureVisual feature={entry.cover} /> : null}</span>
            <span className="flh-explore-row-text">
              <span className="flh-explore-row-title">{entry.title}</span>
              <span className="flh-explore-row-meta">
                {entry.chosenCount
                  ? <><Check size={13} strokeWidth={2.6} aria-hidden="true" /> {entry.chosenCount} chosen</>
                  : (entry.visited ? 'Nothing chosen yet' : 'Not explored yet')}
              </span>
            </span>
            <ChevronRight size={20} className="flh-explore-row-chevron" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function ExplorePriorities({ search, userId, initialPriorities, initialStep = null, services = SERVICES }) {
  const router = useRouter();
  // Remembers whether the latest write failed, so Done can stay put (with
  // Retry) instead of leaving with an unsaved change.
  const lastWriteFailed = useRef(false);
  const persist = useCallback(async (next) => {
    try {
      await services.savePriorities(search, userId, next);
      lastWriteFailed.current = false;
    } catch (error) {
      lastWriteFailed.current = true;
      throw error;
    }
  }, [services, search, userId]);
  const { state: priorities, patch, saveError, retry, flush, isSaving } = useReliableOptimisticState(normalizePriorities(initialPriorities), persist);
  const [step, setStep] = useState(initialStep);
  const [edited, setEdited] = useState(false);
  const [notice, setNotice] = useState('');
  const [leaving, setLeaving] = useState(false);
  const headingRef = useRef(null);

  // A real answer (not a page visit) shows the "Saved" confirmation.
  const edit = useCallback((updater) => { setEdited(true); return patch(updater); }, [patch]);

  // Opening a category records it as the place to pick up from — a separate,
  // non-scoring write that changes no answer, and only when it is new.
  const open = useCallback((next) => {
    setNotice('');
    setStep(next);
    if (next) patch((draft) => recordExploreVisit(draft, next));
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set('category', next); else url.searchParams.delete('category');
      window.history.replaceState(window.history.state, '', url);
      window.scrollTo?.({ top: 0 });
    }
  }, [patch]);

  // Deep entry (?category=…) counts as a visit too.
  useEffect(() => { if (initialStep) patch((draft) => recordExploreVisit(draft, initialStep)); }, []);

  // Each page starts at its heading, so keyboard and screen-reader users hear where they are.
  const firstFocus = useRef(true);
  useEffect(() => {
    if (firstFocus.current && !initialStep) { firstFocus.current = false; return; }
    firstFocus.current = false;
    const heading = headingRef.current?.querySelector('h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }, [step]);

  // Backgrounding: let any in-flight save finish.
  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === 'hidden') flush().catch(() => {}); };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [flush]);

  const done = async () => {
    setLeaving(true);
    await flush();
    // A failed save keeps the person here with Retry, instead of leaving with lost changes.
    if (lastWriteFailed.current) { setLeaving(false); return; }
    router.push('/search');
    router.refresh();
  };

  const steps = exploreSteps(priorities);
  const progress = exploreProgress(priorities);
  const category = step ? exploreCategory(priorities, step) : null;
  const position = category ? steps.indexOf(step) + 1 : 0;
  const goNext = () => {
    const next = neighborExploreStep(priorities, step, 1);
    if (next) open(next);
    else { open(null); setNotice('You’ve been through every category. Your choices are saved.'); }
  };
  const goBack = () => open(neighborExploreStep(priorities, step, -1));

  const status = (edited || isSaving) && <SaveStatus saving={isSaving} error={saveError} />;
  const bar = (
    <div className="flh-explore-bar">
      {category
        ? <button type="button" className="flh-explore-bar-action" onClick={() => open(null)}><ArrowLeft size={18} aria-hidden="true" /> All categories</button>
        : <span />}
      <span className="flh-explore-bar-status">{status}</span>
      <button type="button" className="flh-explore-bar-action flh-explore-done" onClick={done} disabled={leaving}>{leaving ? 'Saving…' : 'Done'}</button>
    </div>
  );

  return (
    <div className="flh-onboarding-root flh-explore-root">
      <div className="flh-ob-layout">
        <main className="flh-onboarding flh-explore" ref={headingRef}>
          {bar}
          {saveError && <p className="hh-save-error" role="alert">{saveError} <button type="button" onClick={retry}>Retry</button></p>}
          {category ? (
            <CategoryScreen
              key={category.step}
              category={category}
              priorities={priorities}
              patch={edit}
              eyebrow={`Explore · ${position} of ${steps.length} · ${category.title}`}
              onAutoAdvance={goNext}
              footer={(
                <PriorityFooter
                  onBack={goBack}
                  onSkip={goNext}
                  onContinue={goNext}
                  continueLabel={position === steps.length ? 'Finish' : 'Next'}
                />
              )}
            />
          ) : (
            <div className="flh-onboarding-step flh-ob-pf-step flh-explore-index">
              <PriorityHeader eyebrow="My Search · Explore My Priorities" heading={['What would you like ', 'to explore?']} lead="Walk through the things that make a home feel right. Change your mind anytime." />
              {notice && <p className="flh-explore-notice" role="status">{notice}</p>}
              <OnboardingAction onClick={() => open(progress.lastStep || steps[0])}>
                {progress.lastStep ? `Pick up at ${exploreCategory(priorities, progress.lastStep)?.title}` : `Start with ${exploreCategory(priorities, steps[0])?.title || 'the first category'}`}
              </OnboardingAction>
              <CategoryList index={exploreIndex(priorities)} onOpen={open} />
              <p className="flh-ob-help">Everything saves as you go. Skipping a category changes nothing, and anything you haven’t answered stays unknown—never counted against a home.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
