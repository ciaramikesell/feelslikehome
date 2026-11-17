'use client';

import { useState } from 'react';
import ShareTutorial from '@/components/ShareTutorial';
import { ArrowRight, Check, ChevronRight } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import { LEVEL_COPY } from '@/lib/searchProfile';
import { basicsSummary } from '@/lib/onboardingReview';
import { yardConflict } from '@/lib/yardConflict';
import YardConflictNote from './YardConflictNote';
import { GARAGE_TYPES, earlierPreferences, otherChosenPriorities, reviewCategories } from '@/lib/priorityCategories';

// The editable summary after the last category. Every chosen priority is a
// button that opens the same importance picker; each section links back to its
// screen ("Back to review" then returns here). Skipped screens say so and can be
// opened. Nothing is inferred: what wasn't answered reads as not set.

function Section({ title, onEdit, editLabel = 'Edit', children, status = null }) {
  return (
    <section className="flh-ob-review-card flh-ob-pf-review-card" aria-label={title}>
      <header className="flh-ob-review-head">
        <h2 className="flh-ob-review-title">{title}</h2>
        {onEdit && <button type="button" className="flh-ob-review-edit" onClick={onEdit} aria-label={`${editLabel}: ${title}`}>{editLabel}</button>}
      </header>
      {status}
      {children}
    </section>
  );
}

function PriorityList({ items, onOpen }) {
  return (
    <ul className="flh-ob-pf-review-list">
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" className="flh-ob-pf-review-item" aria-haspopup="dialog" onClick={() => onOpen(item)} aria-label={`${item.text}: ${LEVEL_COPY[item.level].heading}${item.source ? ` (${item.source.toLowerCase()})` : ''}. Change importance`}>
            <span className="flh-ob-pf-review-name">{item.text}{item.custom && <span className="flh-ob-pf-own">Your own</span>}{item.source && <span className="flh-ob-pf-review-source">{item.source}</span>}</span>
            <span className={`flh-ob-pf-card-level is-${item.level}`}>{LEVEL_COPY[item.level].heading}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

// Rental Essentials (spec §7, D8): the pets answer, then Pet-Friendly once,
// with where its level came from. Tapping it changes the level by hand.
function PetsLines({ pets, onOpen }) {
  return (
    <>
      <p className="flh-ob-pf-review-line">Pets moving with you: <strong>{pets.answerText || 'Not answered'}</strong></p>
      {pets.item && <PriorityList items={[{ ...pets.item, source: pets.source }]} onOpen={onOpen} />}
      {!pets.item && pets.answer && <p className="flh-ob-pf-review-note">No pet requirement. A home is never marked down for its pet policy.</p>}
    </>
  );
}

// Home to Rent (D4): the acreage with its optional importance, editable here.
function LotLine({ lot, onOpen }) {
  const text = `${lot.value} acres`;
  return (
    <ul className="flh-ob-pf-review-list flh-ob-pf-review-lot">
      <li>
        <button type="button" className="flh-ob-pf-review-item" aria-haspopup="dialog" onClick={() => onOpen(lot.feature)}
          aria-label={`Ideal lot size, ${text}: ${lot.level ? LEVEL_COPY[lot.level].heading : 'not ranked, not part of your Match'}. Choose importance`}>
          <span className="flh-ob-pf-review-name">Ideal lot size: {text}{!lot.level && <span className="flh-ob-pf-review-source">Not part of your Match</span>}</span>
          <span className={`flh-ob-pf-card-level${lot.level ? ` is-${lot.level}` : ''}`}>{lot.level ? LEVEL_COPY[lot.level].heading : 'Not ranked'}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </li>
    </ul>
  );
}

export default function PriorityReview({ header, priorities, sharedFor = null, skipped = [], onEdit, onOpenFeature, onFinish, finishing, finishError, celebrate = false }) {
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const basics = basicsSummary(priorities).filter((row) => row.key !== 'lot');
  const categories = reviewCategories(priorities);
  const others = otherChosenPriorities(priorities);
  const earlier = earlierPreferences(priorities);
  const lot = String(priorities.lotSizeTarget?.value ?? '').trim();
  // Pet-Friendly (one row, Rental Essentials) and a ranked lot size count too.
  const total = categories.reduce((sum, category) => sum + category.chosen.length + (category.pets?.item ? 1 : 0) + (category.lot?.scored ? 1 : 0), 0) + others.length;
  const firstPlace = priorities.onboardingSearchType === 'apartment_rent' ? 'Add my first apartment' : 'Add my first home';
  const open = (item) => onOpenFeature({ ...item });

  return (
    <div className="flh-onboarding-step flh-ob-review flh-ob-pf-review">
      {/* Milestone 3: having just walked every category, a small one-shot
          "done" moment (a check that springs in once). It celebrates the
          person's own choices — never that FLH found or verified anything. */}
      {celebrate
        ? <span className="flh-ob-review-mark flh-ob-done-mark" aria-hidden="true"><Check size={30} strokeWidth={2.6} /></span>
        : <span className="flh-ob-review-mark" aria-hidden="true"><BrandMark size={44} /></span>}
      {header}
      <YardConflictNote conflict={yardConflict(priorities)} onEdit={(feature) => open(feature)} />
      <p className="flh-ob-pf-review-total" role="status">{celebrate ? 'Nicely done. ' : ''}{total ? `${total} ${total === 1 ? 'priority' : 'priorities'} shape your Match. Unknown details never count against a home.` : 'No priorities chosen yet—that’s fine. Add them now or anytime in My Search.'}</p>

      <Section title="The Basics" onEdit={() => onEdit('basics')}>
        <dl className="flh-ob-review-list">
          {basics.map((row) => (
            <div key={row.key} className="flh-ob-review-row">
              <dt>{row.label}</dt>
              <dd className={row.value ? '' : 'is-unset'}>{row.value || 'Not set yet'}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="flh-ob-review-secondary" onClick={() => onEdit('search_type')}>Change what you’re looking for</button>
      </Section>


      {categories.map((category) => {
        const wasSkipped = skipped.includes(category.step);
        const garageLine = category.garage && category.garage.importance && (
          <p className="flh-ob-pf-review-line">
            Garage: <strong>{category.garage.importance === 'not_important' ? 'Not important' : LEVEL_COPY[category.garage.importance].heading}</strong>
            {category.garage.importance !== 'not_important' && category.garage.type && <> · {GARAGE_TYPES.find((type) => type.key === category.garage.type)?.label}</>}
          </p>
        );
        const lotLine = category.key === 'exterior' && lot && (category.lot
          ? <LotLine lot={category.lot} onOpen={open} />
          : <p className="flh-ob-pf-review-line">Ideal lot size: <strong>{lot} acres</strong></p>);
        const petsLines = category.pets && (category.pets.answer || category.pets.item) && <PetsLines pets={category.pets} onOpen={open} />;
        const empty = !category.chosen.length && !garageLine && !lotLine && !petsLines;
        return (
          <Section key={category.key} title={category.title} onEdit={() => onEdit(category.step)} editLabel={empty ? (category.pets ? 'Answer' : 'Add') : 'Edit'}
            status={wasSkipped && empty ? <p className="flh-ob-pf-review-empty">Skipped—add anytime.</p> : null}>
            {garageLine}
            {petsLines}
            {lotLine}
            {category.chosen.length > 0 && <PriorityList items={category.chosen} onOpen={open} />}
            {empty && !wasSkipped && <p className="flh-ob-pf-review-empty">{category.pets ? 'Not answered yet.' : 'Nothing chosen.'}</p>}
          </Section>
        );
      })}

      {others.length > 0 && (
        <Section title="More of your priorities">
          <p className="flh-ob-pf-review-note">Chosen earlier. They count exactly as before.</p>
          <PriorityList items={others} onOpen={open} />
        </Section>
      )}

      {earlier.length > 0 && (
        <Section title="Saved from earlier">
          <dl className="flh-ob-review-list">
            {earlier.map((group) => <div key={group.key} className="flh-ob-review-row"><dt>{group.title}</dt><dd>{group.text}</dd></div>)}
          </dl>
          <p className="flh-ob-pf-review-note">Kept as you set them. You can change these in My Search.</p>
        </Section>
      )}

      {!sharedFor && <section className="flh-ob-first-import" aria-labelledby="first-import-title">
        <h2 id="first-import-title" className="flh-ob-label">Now, bring your priorities to life.</h2>
        <p className="flh-lead">Import a listing you’ve already found and see how it fits what matters to you. You can review its facts before saving.</p>
        <button type="button" className="flh-text-action" onClick={() => setTutorialOpen(true)}>Using an iPhone? Practice sharing a listing</button>
        {tutorialOpen && <ShareTutorial onClose={() => setTutorialOpen(false)} />}
      </section>}
      {finishError && <p className="hh-save-error flh-ob-review-error" role="alert">{finishError}</p>}
      <nav className="flh-onboarding-actions flh-ob-review-actions" aria-label="Finish setup">
        {!sharedFor && <button type="button" className="flh-text-action flh-ob-later" disabled={finishing} onClick={() => onFinish('/search?welcome=1')}>Go to My Search</button>}
        <button type="button" className="flh-button flh-button-primary flh-ob-cta" disabled={finishing} aria-busy={finishing || undefined} onClick={() => onFinish(sharedFor ? '/homes' : '/homes?add=1')}>
          <span>{sharedFor ? (finishing ? 'Saving your preferences…' : 'Save and see the homes') : (finishing ? 'Saving your search…' : firstPlace)}</span>
          <span className="flh-ob-cta-icon" aria-hidden="true"><ArrowRight size={20} strokeWidth={2.2} /></span>
        </button>
      </nav>
    </div>
  );
}
