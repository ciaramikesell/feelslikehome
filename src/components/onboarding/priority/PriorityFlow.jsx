'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Compass, Sparkles } from 'lucide-react';
import { OnboardingAction } from '@/components/onboarding/OnboardingShell';
import { BudgetField, SearchTypeControl, Stepper, UnitField } from '@/components/onboarding/BasicsStep';
import PriorityBoard from '@/components/onboarding/priority/PriorityBoard';
import { desktopProgress, isBoardStep } from '@/lib/priorityBoard';
import { STEPPERS } from '@/lib/onboardingBasics';
import { basicsFieldsFor, LEVEL_COPY, PRIORITY_LEVELS } from '@/lib/searchProfile';
import {
  GARAGE_TYPES, LOT_SIZE_FEATURE, addOwnFeature, categoryView, featureLevel, garageImportance, garageType, lotSizeImportance,
  lotSizeRankable, lotSizeValue, priorityCategory, renameOwnFeature, setFeatureLevel, setGarageImportance, setGarageType,
  setLotSizeImportance, setLotSizeValue, switchMessage, switchPrioritySearchType,
} from '@/lib/priorityCategories';
import FeatureCard from './FeatureCard';
import FeatureVisual from './FeatureVisual';
import ImportanceSheet from './ImportanceSheet';
import AddOwnFeature from './AddOwnFeature';
import PriorityReview from './PriorityReview';
import YardConflictNote from './YardConflictNote';
import { yardConflict } from '@/lib/yardConflict';
import PetsQuestion from './PetsQuestion';
import { selectionHaptic } from '@/lib/haptics';

// Mobile Priority Onboarding V3 (flow 4). Every screen has the same frame:
// eyebrow (step and category), heading, lead, content, then one footer with
// Back · Skip · Continue. Category screens are one component driven by
// src/lib/priorityCategories.js — no screen has its own implementation.

const SEARCH_TYPE_PHRASES = { home_buy: 'a home to buy', home_rent: 'a home to rent', apartment_rent: 'an apartment to rent' };

export function PriorityHeader({ eyebrow, heading, lead }) {
  return (
    <header className="flh-onboarding-header">
      <p className="flh-eyebrow">{eyebrow}</p>
      <h1 className="flh-page-title flh-editorial-heading"><span>{heading[0]}</span><em>{heading[1].charAt(0).toUpperCase() + heading[1].slice(1)}</em></h1>
      {lead && <p className="flh-lead">{lead}</p>}
    </header>
  );
}
const Header = PriorityHeader;

export function PriorityFooter({ onBack, onSkip, onContinue, continueLabel = 'Continue', busy = false }) {
  return (
    <nav className="flh-onboarding-actions flh-ob-pf-footer" aria-label="Step navigation">
      {onBack
        ? <button type="button" className="flh-ob-pf-back" onClick={onBack} disabled={busy} aria-label="Back"><ArrowLeft size={18} strokeWidth={2.2} aria-hidden="true" /><span>Back</span></button>
        : <span aria-hidden="true" />}
      {onSkip
        ? <button type="button" className="flh-text-action flh-ob-pf-skip" onClick={onSkip} disabled={busy}>Skip</button>
        : <span aria-hidden="true" />}
      <OnboardingAction disabled={busy} onClick={onContinue}>{continueLabel}</OnboardingAction>
    </nav>
  );
}

// A numeric target ranked with the same sheet (Home to Rent's Ideal lot size,
// D4) writes its existing tier; every other feature is a priority.
const levelOf = (priorities, feature) => (feature.target === 'lotSizeTarget' ? lotSizeImportance(priorities) : featureLevel(priorities, feature));
const writeLevel = (priorities, feature, tier) => (feature.target === 'lotSizeTarget' ? setLotSizeImportance(priorities, tier) : setFeatureLevel(priorities, feature, tier));

// Milestone 3 motion: the sheet slides away instead of vanishing — on phones
// only, and never under Reduce Motion (then it closes at once). Short enough
// that the next tap is never waiting on it.
export const SHEET_CLOSE_MS = 180;
function animatesSheetClose() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 700px)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// The importance picker, shared by every category screen and by Review — in
// first-time onboarding and in Explore My Priorities alike.
export function useImportancePicker(priorities, patch) {
  const [sheet, setSheet] = useState(null);
  const [closing, setClosing] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const closeTimer = useRef(null);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const open = (feature, note = null) => { clearTimeout(closeTimer.current); setClosing(false); setSheet({ feature, note }); };
  const close = () => {
    if (!animatesSheetClose()) { setSheet(null); return; }
    setClosing(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => { setSheet(null); setClosing(false); }, SHEET_CLOSE_MS);
  };
  const choose = (tier) => {
    if (closing) return;
    const { feature } = sheet;
    // A subtle native tick for choosing an importance (Not important included).
    // Guarded: silent on the web and on builds without the Haptics plugin.
    selectionHaptic();
    patch((next) => writeLevel(next, feature, tier));
    setAnnouncement(PRIORITY_LEVELS.includes(tier) ? `${feature.text}: ${LEVEL_COPY[tier].heading}.` : `${feature.text}: not important.`);
    close();
  };
  const rename = (feature, name) => {
    const result = renameOwnFeature(priorities, feature, name);
    if (result.error) return result;
    patch(() => result.priorities);
    setSheet((current) => ({ ...current, feature: { ...result.feature, level: featureLevel(result.priorities, result.feature) } }));
    setAnnouncement(`Renamed to ${result.feature.text}.`);
    return result;
  };
  const element = (
    <>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <ImportanceSheet
        open={Boolean(sheet)}
        closing={closing}
        feature={sheet?.feature || null}
        note={sheet?.note || null}
        level={sheet ? levelOf(priorities, sheet.feature) : null}
        onClose={close}
        onChoose={choose}
        onRename={rename}
      />
    </>
  );
  return { open, element };
}

function FeatureGrid({ cards, onOpen, label }) {
  if (!cards.length) return null;
  return (
    <ul className="flh-ob-pf-grid" aria-label={label}>
      {cards.map((card, index) => <FeatureCard key={card.id} feature={card} onOpen={onOpen} eager={index < 4} />)}
    </ul>
  );
}

const GARAGE_CHOICES = [...PRIORITY_LEVELS.map((tier) => ({ key: tier, label: LEVEL_COPY[tier].heading, hint: LEVEL_COPY[tier].hint })), { key: 'not_important', label: 'Not important', hint: 'Skip the garage questions' }];

// Not important moves straight on (onNotImportant); coming back shows it
// chosen and lets the person change it.
function GarageQuestions({ priorities, patch, onNotImportant }) {
  const importance = garageImportance(priorities);
  const type = garageType(priorities);
  return (
    <>
      <section className="flh-card flh-ob-pf-question" aria-labelledby="flh-ob-pf-garage-q">
        <h2 id="flh-ob-pf-garage-q" className="flh-ob-label">How important is a garage?</h2>
        <div className="flh-ob-pf-options" role="group" aria-labelledby="flh-ob-pf-garage-q">
          {GARAGE_CHOICES.map((choice) => (
            <button key={choice.key} type="button" className={`flh-ob-pf-option${importance === choice.key ? ' is-current' : ''}`} aria-pressed={importance === choice.key} onClick={() => {
              if (importance !== choice.key) selectionHaptic();
              patch((next) => setGarageImportance(next, choice.key));
              if (choice.key === 'not_important' && onNotImportant) onNotImportant();
            }}>
              <span className="flh-ob-pf-option-title">{choice.label}</span>
              <span className="flh-ob-pf-option-hint">{choice.hint}</span>
            </button>
          ))}
        </div>
        {importance === 'not_important' && <p className="flh-ob-help" role="status">Got it—no garage questions. A home is never marked down for having one, or for not.</p>}
      </section>
      {PRIORITY_LEVELS.includes(importance) && (
        <section aria-labelledby="flh-ob-pf-garage-type">
          <h2 id="flh-ob-pf-garage-type" className="flh-ob-label flh-ob-pf-section-label">Which garage?</h2>
          <ul className="flh-ob-pf-grid flh-ob-pf-grid-three" aria-label="Garage type">
            {GARAGE_TYPES.map((choice) => (
              <li key={choice.key} className="flh-ob-pf-cell">
                <button type="button" className={`flh-ob-pf-card${type === choice.key ? ' is-selected is-important' : ''}`} aria-pressed={type === choice.key} onClick={() => patch((next) => setGarageType(next, choice.key))}>
                  <FeatureVisual feature={{ art: choice.art, icon: choice.icon }} eager />
                  <span className="flh-ob-pf-card-body"><span className="flh-ob-pf-card-title">{choice.label}</span><span className="flh-ob-pf-card-level">{choice.hint}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// Home to Rent (D4): once acreage is entered, an optional importance from the
// shared sheet. Until one is chosen the acreage is not part of Match.
function LotSizeImportance({ priorities, onOpen }) {
  const value = lotSizeValue(priorities);
  const level = lotSizeImportance(priorities);
  if (!value) return <p className="flh-ob-help flh-ob-pf-lot-help">Enter acreage to choose how much it matters. Optional.</p>;
  return (
    <div className="flh-ob-pf-lot">
      <button type="button" className={`flh-ob-pf-lot-button${level ? ` is-selected is-${level}` : ''}`} aria-haspopup="dialog" onClick={onOpen}
        aria-label={`Lot size importance: ${level ? LEVEL_COPY[level].heading : 'not chosen'}. Choose importance`}>
        <span className="flh-ob-pf-lot-title" aria-hidden="true">How important is lot size?</span>
        <span className={`flh-ob-pf-card-level${level ? ` is-${level}` : ''}`} aria-hidden="true">{level ? LEVEL_COPY[level].heading : 'Optional · Tap to choose'}</span>
      </button>
      <p className="flh-ob-help flh-ob-pf-lot-help">{level
        ? `Homes on at least ${value} acres count toward your Match. An unknown lot size never counts against a home.`
        : 'Not part of your Match until you choose how much it matters.'}</p>
    </div>
  );
}

export function CategoryStep({ categoryKey, priorities, patch, header, footer, picker, onAutoAdvance = null }) {
  const view = categoryView(priorities, categoryKey);
  const [notice, setNotice] = useState('');
  const [addError, setAddError] = useState('');
  if (!view) return null;
  const { category } = view;
  const garage = category.key === 'garage';
  const importance = garage ? garageImportance(priorities) : null;
  // Garage details only once a garage matters; anything already chosen stays visible.
  // A question screen (Rental Essentials) has no cards and no Add your own;
  // its question is built separately (spec Stage 3).
  const showFeatures = !category.question && (!garage || PRIORITY_LEVELS.includes(importance) || view.chosenCount > 0);
  const lotSize = category.key === 'exterior' && basicsFieldsFor(priorities.onboardingSearchType || 'home_buy').lotSize;
  const rankLot = lotSize && lotSizeRankable(priorities);
  const add = (value) => {
    const result = addOwnFeature(priorities, category.key, value?.label ?? value);
    if (!result) return;
    setAddError(result.feature ? '' : (result.error || ''));
    if (!result.feature) return;
    if (result.priorities !== priorities) patch(() => result.priorities);
    const elsewhere = result.homeCategory ? priorityCategory(priorities, result.homeCategory)?.title : null;
    const note = elsewhere ? `You’ll find this under ${elsewhere}.` : null;
    setNotice(note || '');
    picker.open({ ...result.feature, level: featureLevel(result.priorities, result.feature) }, note);
  };

  return (
    <div className={`flh-onboarding-step flh-ob-pf-step flh-ob-pf-${category.key}`}>
      {header}
      {garage && <GarageQuestions priorities={priorities} patch={patch} onNotImportant={onAutoAdvance} />}
      {category.question && <PetsQuestion priorities={priorities} patch={patch} />}
      {lotSize && (
        <section className="flh-card flh-ob-pf-question">
          <UnitField label="Ideal lot size" unit="acres" decimal value={priorities.lotSizeTarget.value} onChange={(value) => patch((next) => (rankLot ? setLotSizeValue(next, value) : { ...next, lotSizeTarget: { ...next.lotSizeTarget, value } }))} />
          {rankLot && <LotSizeImportance priorities={priorities} onOpen={() => picker.open({ ...LOT_SIZE_FEATURE, level: lotSizeImportance(priorities) })} />}
        </section>
      )}
      {showFeatures && (
        <>
          {garage && view.cards.length > 0 && <h2 className="flh-ob-label flh-ob-pf-section-label">Garage details</h2>}
          <FeatureGrid cards={view.cards} onOpen={(feature) => picker.open(feature)} label={category.title} />
          {category.key === 'exterior' && <YardConflictNote conflict={yardConflict(priorities)} onEdit={(feature) => picker.open(feature)} />}
          <AddOwnFeature title={category.title} suggestions={view.suggestions} onAdd={add} />
          {notice && <p className="sr-only" role="status">{notice}</p>}
          {addError && <p className="flh-ob-help" role="alert">{addError}</p>}
        </>
      )}
      {footer}
    </div>
  );
}

// One category page, complete: its header (from the category's own copy), the
// cards, and the shared importance sheet. The single building block for every
// category walkthrough — first-time onboarding (below) and Explore My
// Priorities (src/components/explore/ExplorePriorities.jsx) — so Milestone 3's
// polish lands in one place and reaches both.
export function CategoryScreen({ category, priorities, patch, eyebrow, footer, onAutoAdvance = null, picker: sharedPicker = null }) {
  const ownPicker = useImportancePicker(priorities, patch);
  const picker = sharedPicker || ownPicker;
  return (
    <>
      <CategoryStep
        categoryKey={category.key}
        priorities={priorities}
        patch={patch}
        picker={picker}
        header={<Header eyebrow={eyebrow} heading={category.heading} lead={category.lead} />}
        footer={footer}
        onAutoAdvance={category.key === 'garage' ? onAutoAdvance : null}
      />
      {!sharedPicker && picker.element}
    </>
  );
}

// Milestone 2: the two first-time setup paths, as two large choices. Both are
// good ways to start; neither changes how Match works. Choosing one moves on.
const SETUP_PATH_CHOICES = Object.freeze([
  Object.freeze({ key: 'personalize', icon: Sparkles, title: 'Let’s personalize your search', body: 'Walk through the features that matter to you, one room at a time.', recommended: true }),
  Object.freeze({ key: 'as_i_go', icon: Compass, title: 'I’ll figure it out as I go', body: 'Start saving homes now. You can tell us what matters later.' }),
]);

// Tapping a choice is the one action, so there is no Continue: only a quiet
// Back, in the flow of the page, so both choices fit a 320 × 568 screen.
function SetupPathStep({ setupPath, onChoose, header, onBack, busy }) {
  return (
    <div className="flh-onboarding-step flh-ob-pf-step flh-ob-setup-path">
      {header}
      <div className="flh-ob-path-options" role="group" aria-label="How would you like to start?">
        {SETUP_PATH_CHOICES.map(({ key, icon: Icon, title, body, recommended }) => (
          <button key={key} type="button" className={`flh-ob-path-card${setupPath === key ? ' is-current' : ''}`} aria-pressed={setupPath === key} disabled={busy} onClick={() => onChoose(key)}>
            <span className="flh-ob-path-icon" aria-hidden="true"><Icon size={22} strokeWidth={2} /></span>
            <span className="flh-ob-path-text">
              {recommended && <span className="flh-ob-path-badge">Recommended</span>}
              <span className="flh-ob-path-title">{title}</span>
              <span className="flh-ob-path-body">{body}</span>
            </span>
          </button>
        ))}
      </div>
      {onBack && (
        <nav className="flh-ob-path-nav" aria-label="Step navigation">
          <button type="button" className="flh-ob-pf-back" onClick={onBack} disabled={busy}><ArrowLeft size={18} strokeWidth={2.2} aria-hidden="true" /><span>Back</span></button>
        </nav>
      )}
    </div>
  );
}

function SearchTypeStep({ priorities, patch, header, footerFor, onSearchType }) {
  const choice = priorities.onboardingSearchType || '';
  const [invalid, setInvalid] = useState(false);
  const [switched, setSwitched] = useState(null);
  const typeRef = useRef(null);
  const chooseType = (key) => {
    setInvalid(false);
    if (key === choice) return;
    const { priorities: next, removed, garage } = switchPrioritySearchType(priorities, key);
    patch(() => next);
    onSearchType(key);
    setSwitched((earlier) => {
      const all = [...new Set([...(earlier?.removed || []), ...removed])];
      // The garage note describes this switch only (a held preference moves with each switch).
      const garageNote = garage?.saved || garage?.restored ? garage : null;
      return all.length || garageNote ? { removed: all, garage: garageNote, previous: earlier?.previous || priorities, previousType: earlier?.previousType || choice } : null;
    });
  };
  const undo = () => { patch(() => switched.previous); onSearchType(switched.previousType); setSwitched(null); };
  const proceed = () => {
    if (choice) return true;
    setInvalid(true);
    typeRef.current?.querySelector('input')?.focus();
    return false;
  };
  return (
    <div className="flh-onboarding-step flh-ob-pf-step">
      {header}
      <SearchTypeControl choice={choice} onChoose={chooseType} invalid={invalid} groupRef={typeRef} />
      {switched && (
        <div className="flh-ob-switch-note" role="status">
          <p>{switchMessage(SEARCH_TYPE_PHRASES[choice], switched)}</p>
          <button type="button" className="flh-text-action" onClick={undo}>Undo</button>
        </div>
      )}
      {footerFor(proceed)}
    </div>
  );
}

function BasicsQuestions({ priorities, patch, header, footer }) {
  const choice = priorities.onboardingSearchType || 'home_buy';
  const fields = basicsFieldsFor(choice);
  const rent = choice !== 'home_buy';
  const setValue = (key, value) => patch((next) => { next[key] = { ...next[key], value }; return next; });
  return (
    <div className="flh-onboarding-step flh-ob-pf-step flh-ob-basics">
      {header}
      <section className="flh-card flh-ob-basics-card" aria-label="The basics">
        <BudgetField label={fields.budgetLabel} rent={rent} value={priorities.budget.value} onChange={(value) => setValue('budget', value)} />
        <hr className="flh-ob-divider" />
        <div className="flh-ob-pair">
          <Stepper label="Bedrooms" noun="bedrooms" value={priorities.bedsMin.value} rule={STEPPERS.bedsMin} onChange={(value) => setValue('bedsMin', value)} />
          <Stepper label="Bathrooms" noun="bathrooms" value={priorities.bathsMin.value} rule={STEPPERS.bathsMin} onChange={(value) => setValue('bathsMin', value)} />
        </div>
        <hr className="flh-ob-divider" />
        <UnitField label="Ideal square footage" unit="sq ft" value={priorities.sqftTarget.value} onChange={(value) => setValue('sqftTarget', value)} />
      </section>
      {footer}
    </div>
  );
}

const BASICS_TITLE = { home_buy: 'The Basics', home_rent: 'Rental Basics', apartment_rent: 'Apartment Basics' };
const BASICS_NOUN = { home_buy: 'home search', home_rent: 'rental search', apartment_rent: 'apartment search' };
const SHARED_LABEL = (sharedFor, title) => `Your preferences for ${sharedFor} · ${title}`;

export default function PriorityFlow({
  step, progress, sharedFor = null, priorities, patch, editingFromReview = false, busy = false,
  onContinue, onSkip, onBack, onSearchType,
  review, board = false,
  setupPath = null, onSetupPath = null, quickStart = false,
}) {
  const picker = useImportancePicker(priorities, patch);
  const choice = priorities.onboardingSearchType || 'home_buy';
  const eyebrow = (title) => (sharedFor ? SHARED_LABEL(sharedFor, title) : `Step ${progress.position} of ${progress.total} · ${title}`);
  const first = progress.index === 0;
  const footer = ({ skip = true, validate = null, label } = {}) => (
    <PriorityFooter
      busy={busy}
      onBack={first || editingFromReview ? null : () => onBack(step)}
      onSkip={skip && !editingFromReview ? () => onSkip(step) : null}
      onContinue={() => { if (!validate || validate()) onContinue(step); }}
      continueLabel={label || (editingFromReview ? 'Back to review' : 'Continue')}
    />
  );

  if (step === 'search_type') {
    return (
      <SearchTypeStep
        priorities={priorities}
        patch={patch}
        onSearchType={onSearchType}
        header={<Header eyebrow={eyebrow('The Basics')} heading={sharedFor ? ['What are you ', 'looking for?'] : ['The basics: ', 'what are you looking for?']} lead="This decides which questions follow. You can change it anytime." />}
        footerFor={(validate) => footer({ skip: false, validate })}
      />
    );
  }
  if (step === 'setup_path') {
    return (
      <SetupPathStep
        setupPath={setupPath}
        onChoose={onSetupPath}
        header={<Header eyebrow={eyebrow('Getting Started')} heading={['How would you like ', 'to start?']} lead="Either way it’s the same FLH, and you can change your mind anytime." />}
        onBack={first || editingFromReview ? null : () => onBack(step)}
        busy={busy}
      />
    );
  }
  if (step === 'basics') {
    // Quick start (Milestone 2): Basics is the last screen and every answer on
    // it is optional; Continue or Skip finishes and opens Add Home.
    const quickLead = 'All optional. Skip anything you haven’t decided—you can add it later.';
    return (
      <BasicsQuestions
        priorities={priorities}
        patch={patch}
        header={<Header eyebrow={eyebrow(BASICS_TITLE[choice] || 'The Basics')} heading={['The basics of your ', BASICS_NOUN[choice] || 'home search']} lead={quickStart ? quickLead : (choice === 'home_buy' ? 'Your budget and the space you need. Skip anything you haven’t decided.' : 'Your monthly rent and the space you need. Skip anything you haven’t decided.')} />}
        footer={footer(quickStart && review.guest ? { label: 'Save your personalized search' }
          : quickStart ? { label: sharedFor ? 'Save and see the homes' : 'Start saving homes' } : {})}
      />
    );
  }
  if (step === 'review') {
    return (
      <>
        <PriorityReview
          {...review}
          priorities={priorities}
          sharedFor={sharedFor}
          onOpenFeature={picker.open}
          header={sharedFor
            ? <Header eyebrow={`Your preferences for ${sharedFor}`} heading={['Your preferences are ', 'ready.']} lead={`Here’s what home looks like to you in ${sharedFor}. Tap anything to change it. These are yours alone.`} />
            : <Header eyebrow="Review" heading={['Your search is ', 'ready.']} lead="Here’s what home looks like to you so far. Tap any priority to change how much it matters, or edit a section." />}
        />
        {picker.element}
      </>
    );
  }
  // Desktop (docs/desktop-priority-board.md): every card category is one board.
  if (board && isBoardStep(step)) {
    return (
      <PriorityBoard
        priorities={priorities}
        patch={patch}
        header={<Header eyebrow={eyebrow('What matters most')} heading={['What matters ', 'most to you?']} lead="Drag the features that matter into the importance column that fits you." />}
        footer={footer()}
      />
    );
  }
  const category = priorityCategory(priorities, step);
  if (!category) return <p className="flh-ob-unbuilt" role="status">This step isn’t available for this search.</p>;
  const categoryStep = (
    <CategoryScreen
      category={category}
      priorities={priorities}
      patch={patch}
      picker={picker}
      eyebrow={eyebrow(category.title)}
      footer={footer()}
      onAutoAdvance={() => onContinue(step)}
    />
  );
  const boardProgress = desktopProgress([...progress.steps, 'review'], step);
  return (
    <>
      {isBoardStep(step)
        ? <BoardGate pendingEyebrow={sharedFor ? SHARED_LABEL(sharedFor, 'What matters most') : `Step ${boardProgress.position} of ${boardProgress.total} · What matters most`}>{categoryStep}</BoardGate>
        : categoryStep}
      {picker.element}
    </>
  );
}

// Before hydration a desktop browser shows server HTML, which is always the
// phone screen (the server can't know the width). For a board step that HTML
// also carries a board-shaped placeholder; at ≥ 1024px, and only while this
// gate is on screen (the board replaces it as soon as JavaScript runs), CSS
// shows the placeholder instead of the photo cards, so the cards never flash.
// Below 1024px the wrapper is display: contents and the placeholder is not
// displayed: the phone screen is unchanged. Server and first client render are
// identical, so there is no hydration mismatch. docs/desktop-priority-board.md.
function BoardGate({ pendingEyebrow, children }) {
  return (
    <div className="flh-ob-board-gate">
      {children}
      <div className="flh-onboarding-step flh-ob-board-pending" aria-hidden="true">
        <Header eyebrow={pendingEyebrow} heading={['What matters ', 'most to you?']} lead="Drag the features that matter into the importance column that fits you." />
        <div className="flh-ob-board-pending-frame"><span /><span /><span /><span /></div>
      </div>
    </div>
  );
}
