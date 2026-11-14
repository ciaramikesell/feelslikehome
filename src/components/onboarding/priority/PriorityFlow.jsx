'use client';

import { useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { OnboardingAction } from '@/components/onboarding/OnboardingShell';
import { BudgetField, SearchTypeControl, Stepper, UnitField } from '@/components/onboarding/BasicsStep';
import LocationsStep from '@/components/onboarding/LocationsStep';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { STEPPERS } from '@/lib/onboardingBasics';
import { basicsFieldsFor, LEVEL_COPY, PRIORITY_LEVELS } from '@/lib/searchProfile';
import {
  GARAGE_TYPES, addOwnFeature, categoryView, featureLevel, garageImportance, garageType, priorityCategory,
  renameOwnFeature, setFeatureLevel, setGarageImportance, setGarageType, switchPrioritySearchType,
} from '@/lib/priorityCategories';
import FeatureCard from './FeatureCard';
import FeatureVisual from './FeatureVisual';
import ImportanceSheet from './ImportanceSheet';
import AddOwnFeature from './AddOwnFeature';
import PriorityReview from './PriorityReview';

// Mobile Priority Onboarding V3 (flow 4). Every screen has the same frame:
// eyebrow (step and category), heading, lead, content, then one footer with
// Back · Skip · Continue. Category screens are one component driven by
// src/lib/priorityCategories.js — no screen has its own implementation.

const SEARCH_TYPE_PHRASES = { home_buy: 'a home to buy', home_rent: 'a home to rent', apartment_rent: 'an apartment to rent' };

function Header({ eyebrow, heading, lead }) {
  return (
    <header className="flh-onboarding-header">
      <p className="flh-eyebrow">{eyebrow}</p>
      <h1 className="flh-page-title">{heading[0]}<em>{heading[1]}</em></h1>
      {lead && <p className="flh-lead">{lead}</p>}
    </header>
  );
}

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

// The importance picker, shared by every category screen and by Review.
export function useImportancePicker(priorities, patch) {
  const [sheet, setSheet] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const open = (feature, note = null) => setSheet({ feature, note });
  const close = () => setSheet(null);
  const choose = (tier) => {
    const { feature } = sheet;
    patch((next) => setFeatureLevel(next, feature, tier));
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
        feature={sheet?.feature || null}
        note={sheet?.note || null}
        level={sheet ? featureLevel(priorities, sheet.feature) : null}
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
          <h2 id="flh-ob-pf-garage-type" className="flh-ob-label flh-ob-pf-section-label">Attached or detached?</h2>
          <ul className="flh-ob-pf-grid flh-ob-pf-grid-three" aria-label="Garage type">
            {GARAGE_TYPES.map((choice) => (
              <li key={choice.key} className="flh-ob-pf-cell">
                <button type="button" className={`flh-ob-pf-card${type === choice.key ? ' is-selected is-important' : ''}`} aria-pressed={type === choice.key} onClick={() => patch((next) => setGarageType(next, choice.key))}>
                  <FeatureVisual feature={{ art: choice.art, icon: choice.icon }} eager />
                  <span className="flh-ob-pf-card-body"><span className="flh-ob-pf-card-title">{choice.label}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
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
      {lotSize && (
        <section className="flh-card flh-ob-pf-question">
          <UnitField label="Ideal lot size" unit="acres" decimal value={priorities.lotSizeTarget.value} onChange={(value) => patch((next) => { next.lotSizeTarget = { ...next.lotSizeTarget, value }; return next; })} />
        </section>
      )}
      {showFeatures && (
        <>
          {garage && view.cards.length > 0 && <h2 className="flh-ob-label flh-ob-pf-section-label">Garage details</h2>}
          <FeatureGrid cards={view.cards} onOpen={(feature) => picker.open(feature)} label={category.title} />
          <AddOwnFeature title={category.title} suggestions={view.suggestions} onAdd={add} />
          {notice && <p className="sr-only" role="status">{notice}</p>}
          {addError && <p className="flh-ob-help" role="alert">{addError}</p>}
        </>
      )}
      {footer}
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
    const { priorities: next, removed } = switchPrioritySearchType(priorities, key);
    patch(() => next);
    onSearchType(key);
    setSwitched((earlier) => {
      const all = [...new Set([...(earlier?.removed || []), ...removed])];
      return all.length ? { removed: all, previous: earlier?.previous || priorities, previousType: earlier?.previousType || choice } : null;
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
          <p>Now looking for {SEARCH_TYPE_PHRASES[choice]}. Removed what no longer applies: {switched.removed.join(', ')}. Everything else is kept.</p>
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

const SHARED_LABEL = (sharedFor, title) => `Your preferences for ${sharedFor} · ${title}`;

export default function PriorityFlow({
  step, progress, sharedFor = null, priorities, patch, editingFromReview = false, busy = false,
  onContinue, onSkip, onBack, onSearchType,
  searchAreas, AddressField = AddressAutocomplete, places, placesError, onCreatePlace, onDeletePlace,
  review,
}) {
  const picker = useImportancePicker(priorities, patch);
  const choice = priorities.onboardingSearchType || 'home_buy';
  const apartment = choice === 'apartment_rent';
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
  if (step === 'basics') {
    return (
      <BasicsQuestions
        priorities={priorities}
        patch={patch}
        header={<Header eyebrow={eyebrow('The Basics')} heading={['The basics of your ', apartment ? 'apartment search' : 'home search']} lead={choice === 'home_buy' ? 'Your budget and the space you need. Skip anything you haven’t decided.' : 'Your monthly rent and the space you need. Skip anything you haven’t decided.'} />}
        footer={footer()}
      />
    );
  }
  if (step === 'locations') {
    return (
      <LocationsStep
        priorities={priorities}
        patch={patch}
        AddressField={AddressField}
        searchAreas={searchAreas}
        places={places}
        placesError={placesError}
        onCreatePlace={onCreatePlace}
        onDeletePlace={onDeletePlace}
        onNext={() => onContinue(step)}
        header={<Header eyebrow={eyebrow('Where you’re looking')} heading={['Where are you ', 'looking?']} lead="Add the cities, neighborhoods or school districts you’re drawn to. Each is an alternative, never a requirement." />}
        footer={footer()}
      />
    );
  }
  if (step === 'review') {
    return (
      <>
        <PriorityReview
          {...review}
          priorities={priorities}
          places={places}
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
  const category = priorityCategory(priorities, step);
  if (!category) return <p className="flh-ob-unbuilt" role="status">This step isn’t available for this search.</p>;
  return (
    <>
      <CategoryStep
        categoryKey={category.key}
        priorities={priorities}
        patch={patch}
        picker={picker}
        header={<Header eyebrow={eyebrow(category.title)} heading={category.heading} lead={category.lead} />}
        footer={footer()}
        onAutoAdvance={category.key === 'garage' ? () => onContinue(step) : null}
      />
      {picker.element}
    </>
  );
}
