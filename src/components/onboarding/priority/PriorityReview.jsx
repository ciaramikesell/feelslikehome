'use client';

import { ArrowRight, ChevronRight } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import { LEVEL_COPY } from '@/lib/searchProfile';
import { areasSummary, basicsSummary } from '@/lib/onboardingReview';
import { placesSummary } from '@/lib/onboardingReview';
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
          <button type="button" className="flh-ob-pf-review-item" aria-haspopup="dialog" onClick={() => onOpen(item)} aria-label={`${item.text}: ${LEVEL_COPY[item.level].heading}. Change importance`}>
            <span className="flh-ob-pf-review-name">{item.text}{item.custom && <span className="flh-ob-pf-own">Your own</span>}</span>
            <span className={`flh-ob-pf-card-level is-${item.level}`}>{LEVEL_COPY[item.level].heading}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function PriorityReview({ header, priorities, places = [], sharedFor = null, skipped = [], onEdit, onOpenFeature, onFinish, finishing, finishError }) {
  const basics = basicsSummary(priorities).filter((row) => row.key !== 'lot');
  const areas = areasSummary(priorities);
  const savedPlaces = placesSummary(places);
  const categories = reviewCategories(priorities);
  const others = otherChosenPriorities(priorities);
  const earlier = earlierPreferences(priorities);
  const lot = String(priorities.lotSizeTarget?.value ?? '').trim();
  const total = categories.reduce((sum, category) => sum + category.chosen.length, 0) + others.length;
  const firstPlace = priorities.onboardingSearchType === 'apartment_rent' ? 'Add my first apartment' : 'Add my first home';
  const open = (item) => onOpenFeature({ ...item });

  return (
    <div className="flh-onboarding-step flh-ob-review flh-ob-pf-review">
      <span className="flh-ob-review-mark" aria-hidden="true"><BrandMark size={44} /></span>
      {header}
      <p className="flh-ob-pf-review-total" role="status">{total ? `${total} ${total === 1 ? 'priority' : 'priorities'} shape your Match. Unknown details never count against a home.` : 'No priorities chosen yet—that’s fine. Add them now or anytime in My Search.'}</p>

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

      <Section title="Where you’re looking" onEdit={() => onEdit('locations')}>
        {areas.length ? (
          <ul className="flh-ob-review-chips" aria-label="Areas of interest">
            {areas.map((area) => <li key={area.key}><strong>{area.name}</strong><span>{area.type}</span></li>)}
          </ul>
        ) : <p className="flh-ob-pf-review-empty">No areas added yet.</p>}
        {savedPlaces.length > 0 && (
          <ul className="flh-ob-review-places">
            {savedPlaces.map((place) => <li key={place.key}><strong>{place.label}</strong><span>{place.address}</span></li>)}
          </ul>
        )}
      </Section>

      {categories.map((category) => {
        const wasSkipped = skipped.includes(category.step);
        const garageLine = category.garage && category.garage.importance && (
          <p className="flh-ob-pf-review-line">
            Garage: <strong>{category.garage.importance === 'not_important' ? 'Not important' : LEVEL_COPY[category.garage.importance].heading}</strong>
            {category.garage.importance !== 'not_important' && category.garage.type && <> · {GARAGE_TYPES.find((type) => type.key === category.garage.type)?.label}</>}
          </p>
        );
        const lotLine = category.key === 'exterior' && lot && <p className="flh-ob-pf-review-line">Ideal lot size: <strong>{lot} acres</strong></p>;
        const empty = !category.chosen.length && !garageLine && !lotLine;
        return (
          <Section key={category.key} title={category.title} onEdit={() => onEdit(category.step)} editLabel={empty ? 'Add' : 'Edit'}
            status={wasSkipped && empty ? <p className="flh-ob-pf-review-empty">Skipped—add anytime.</p> : null}>
            {garageLine}
            {lotLine}
            {category.chosen.length > 0 && <PriorityList items={category.chosen} onOpen={open} />}
            {empty && !wasSkipped && <p className="flh-ob-pf-review-empty">Nothing chosen.</p>}
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
