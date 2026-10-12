'use client';

import { ArrowRight, Check } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import { areasSummary, basicsDisplay, basicsSummary, peopleSummary, placesSummary, prioritiesSummary } from '@/lib/onboardingReview';

// Step 6 of Onboarding V2: "Your search is ready." (approved Figma design).
//
// A read-only summary of what the earlier steps saved, one numbered card per
// part, each with an Edit link back to its step. Unanswered questions read
// "Not set yet"; nothing is inferred — except that when only the search type is
// answered, the core Basics collapse into one compact invitation to add them.
// "Add my first home" ("…apartment" for Apartment to Rent) completes onboarding
// through the existing completion service and only then opens the existing
// add-home flow; "Go to My Search"
// completes and opens My Search instead. A co-buyer setting up preferences on
// someone else's search (sharedFor) gets one action that saves their own
// preferences and opens that search's homes — never "My Search".

function SummaryCard({ number, title, editLabel, onEdit, empty, emptyText, children }) {
  const headingId = `flh-ob-review-${number}`;
  return (
    <section className="flh-ob-review-card" aria-labelledby={headingId}>
      <header className="flh-ob-review-head">
        <h2 id={headingId} className="flh-ob-review-title"><span className="flh-ob-matters-number" aria-hidden="true">{String(number).padStart(2, '0')}</span>{title}</h2>
        {!empty && <button type="button" className="flh-ob-review-edit" onClick={onEdit} aria-label={`Edit ${title}`}>Edit</button>}
      </header>
      {empty ? (
        <div className="flh-ob-review-empty">
          <span>{emptyText}</span>
          <button type="button" className="flh-ob-review-add" onClick={onEdit} aria-label={`${editLabel}: ${title}`}>{editLabel}</button>
        </div>
      ) : children}
    </section>
  );
}

export default function ReviewStep({ header, sharedFor = null, priorities, places, people, choice, role, onEdit, onFinish, finishing, finishError }) {
  const basics = basicsSummary(priorities);
  const areas = areasSummary(priorities);
  const savedPlaces = placesSummary(places);
  const who = peopleSummary({ choice, people, role, searchType: priorities?.onboardingSearchType || null });
  const firstPlace = priorities?.onboardingSearchType === 'apartment_rent' ? 'Add my first apartment' : 'Add my first home';
  const levels = prioritiesSummary(priorities);
  const rankedCount = levels.reduce((sum, level) => sum + level.items.length, 0);
  const basicsView = basicsDisplay(basics);

  return (
    <div className="flh-onboarding-step flh-ob-review">
      <span className="flh-ob-review-mark" aria-hidden="true"><BrandMark size={44} /></span>
      {header}

      <SummaryCard number={1} title="The Basics" editLabel="Add details" onEdit={() => onEdit('basics')} empty={basicsView.mode === 'empty'} emptyText="No basics added yet.">
        {basicsView.mode === 'compact' ? (
          <>
            <dl className="flh-ob-review-list">
              <div className="flh-ob-review-row"><dt>Looking for</dt><dd>{basicsView.type}</dd></div>
            </dl>
            <div className="flh-ob-review-empty flh-ob-review-prompt">
              <span>{basicsView.prompt}</span>
              <button type="button" className="flh-ob-review-add" onClick={() => onEdit('basics')} aria-label="Add details: budget, bedrooms and bathrooms">Add details</button>
            </div>
          </>
        ) : (
          <dl className="flh-ob-review-list">
            {basics.map((row) => (
              <div key={row.key} className="flh-ob-review-row">
                <dt>{row.label}</dt>
                <dd className={row.value ? '' : 'is-unset'}>{row.value || 'Not set yet'}</dd>
              </div>
            ))}
          </dl>
        )}
      </SummaryCard>

      <SummaryCard number={2} title="Areas of Interest" editLabel="Add areas" onEdit={() => onEdit('locations')} empty={!areas.length} emptyText="No areas added yet.">
        <ul className="flh-ob-review-chips" aria-label="Areas of interest">
          {areas.map((area) => <li key={area.key}><strong>{area.name}</strong><span>{area.type}</span></li>)}
        </ul>
        {areas.length > 1 && <p className="flh-ob-review-note">Each area is an alternative, not a requirement.</p>}
      </SummaryCard>

      <SummaryCard number={3} title="Places That Matter" editLabel="Add a place" onEdit={() => onEdit('locations')} empty={!savedPlaces.length} emptyText="No saved places yet.">
        <ul className="flh-ob-review-places">
          {savedPlaces.map((place) => <li key={place.key}><strong>{place.label}</strong><span>{place.address}</span></li>)}
        </ul>
      </SummaryCard>

      <SummaryCard number={4} title="Your People" editLabel="Add people" onEdit={() => onEdit('collaboration')} empty={!who.length} emptyText="Just you for now.">
        <ul className="flh-ob-review-people">
          {who.map((line) => (
            <li key={line.key} className={`is-${line.kind}`}>
              {line.kind === 'joined' && <Check size={15} strokeWidth={2.4} aria-hidden="true" />}
              <span>{line.text}</span>
            </li>
          ))}
        </ul>
        {who.some((line) => line.kind === 'intent') && <p className="flh-ob-review-note">You can invite people anytime from My Search.</p>}
      </SummaryCard>

      <SummaryCard number={5} title="Your Priorities" editLabel="Choose priorities" onEdit={() => onEdit('priorities')} empty={!rankedCount} emptyText="No priorities chosen yet.">
        <div className="flh-ob-review-levels">
          {levels.filter((level) => level.items.length).map((level) => (
            <div key={level.tier} className={`flh-ob-review-level is-${level.tier}`}>
              <h3>{level.title} <span>{level.items.length}</span></h3>
              <ul>
                {level.items.map((item) => <li key={item.key}>{item.label}{item.qualifier && <span className="flh-ob-rank-qualifier">{item.qualifier}</span>}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <button type="button" className="flh-ob-review-secondary" onClick={() => onEdit('rank')}>Change rankings</button>
      </SummaryCard>

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
