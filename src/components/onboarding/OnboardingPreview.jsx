'use client';

import { useMemo, useState } from 'react';
import Onboarding from '@/components/onboarding/Onboarding';
import { normalizePriorities } from '@/lib/constants';
import { ONBOARDING_SUGGESTIONS, applySearchChoice } from '@/lib/onboarding';
import { beginOnboarding, onboardingStepsFor, CURRENT_ONBOARDING_VERSION } from '@/lib/onboardingFlow';
import { addSearchArea } from '@/lib/searchAreas';
import { addCriterion, isCriterionSelected, moveCriterion, setGaragePreference, toggleCriterion } from '@/lib/searchProfile';

// Fixtures for the development-only preview (src/app/dev/onboarding). Fixed ids
// and timestamps keep every render, and every screenshot, identical.
const USER_ID = '00000000-0000-4000-8000-000000000001';
const SEARCH_ID = '00000000-0000-4000-8000-000000000002';
const OWNED_SEARCH_ID = '00000000-0000-4000-8000-000000000003';
const NOW = '2026-01-01T00:00:00.000Z';

function populatedPriorities() {
  let next = applySearchChoice(normalizePriorities({}), 'home_buy');
  next.budget = { ...next.budget, value: '650000' };
  next.bedsMin = { ...next.bedsMin, value: '3' };
  next.bathsMin = { ...next.bathsMin, value: '2' };
  next.sqftTarget = { ...next.sqftTarget, value: '1800' };
  next.lotSizeTarget = { ...next.lotSizeTarget, value: '0.25' };
  // The first two offered criteria of each group, then a deterministic spread
  // across the three levels so the Rank board shows all of them.
  const picked = ONBOARDING_SUGGESTIONS.home_buy.flatMap(([, items]) => items.slice(0, 2));
  for (const criterion of picked) next = toggleCriterion(next, criterion);
  picked.forEach((criterion, index) => {
    if (index % 3 === 0) next = moveCriterion(next, criterion.categoryKey, criterion.label, 'must');
    if (index % 3 === 2) next = moveCriterion(next, criterion.categoryKey, criterion.label, 'nice');
  });
  // Basics garage answer: Important, attached (existing Garage criterion + qualifier).
  const garage = { categoryKey: 'exterior', label: 'Garage', kind: 'check' };
  next = isCriterionSelected(next, 'exterior', 'Garage') ? moveCriterion(next, 'exterior', 'Garage', 'important') : addCriterion(next, garage, 'important');
  next = setGaragePreference(next, 'attached');
  return next;
}

// Development-only area-search results, so the preview is deterministic without
// a Google key. The app itself only ever uses the real provider
// (src/lib/areaSearchProvider.js). Typing "fail" shows a provider failure and
// "zzz" shows no results.
const PREVIEW_AREAS = [
  { placeId: 'preview-gp-city', name: 'Grosse Pointe', secondary: 'Michigan, USA', type: 'city' },
  { placeId: 'preview-gp-park', name: 'Grosse Pointe Park', secondary: 'Michigan, USA', type: 'city' },
  { placeId: 'preview-gp-schools', name: 'Grosse Pointe Public School System', secondary: 'Michigan, USA', type: 'school_district' },
  { placeId: 'preview-gp-farms', name: 'The Farms', secondary: 'Grosse Pointe Farms, MI, USA', type: 'neighborhood' },
  { placeId: 'preview-48230', name: '48230', secondary: 'Grosse Pointe, MI, USA', type: 'zip' },
  { placeId: 'preview-royal-oak', name: 'Royal Oak', secondary: 'Michigan, USA', type: 'city' },
].map((area) => ({ ...area, source: 'google_places' }));

function previewAreaSearch(query) {
  const term = query.trim().toLowerCase();
  if (term.includes('fail')) return Promise.reject(new Error('Preview provider failure'));
  return Promise.resolve({ results: PREVIEW_AREAS.filter((area) => `${area.name} ${area.secondary}`.toLowerCase().includes(term)), schoolDistricts: true });
}

// In-memory stand-ins for every write <Onboarding> makes. state=error makes
// saving fail, so the real save-error path renders after the first change.
function previewServices(fail) {
  const settle = () => (fail ? Promise.reject(new Error('Preview save failure')) : Promise.resolve(true));
  let nextPlace = 1;
  return {
    savePriorities: settle,
    saveProgress: () => Promise.resolve(true),
    completeOnboarding: settle,
    setActiveSearch: settle,
    submitFeedback: () => Promise.resolve(true),
    createPlace: (searchId, userId, place) => (fail ? Promise.reject(new Error('Preview save failure')) : Promise.resolve({ id: `preview-place-${nextPlace++}`, ...place, maxDriveMinutes: null })),
    deletePlace: () => settle(),
    searchAreas: previewAreaSearch,
    AddressField: PreviewAddressField,
  };
}

// Development-only address field with fixed sample suggestions, standing in
// for Google address autocomplete (which needs a key the preview doesn't have).
const PREVIEW_ADDRESSES = ['500 Woodward Ave, Detroit, MI 48226, USA', '1 Kercheval Ave, Grosse Pointe Farms, MI 48236, USA'];
function PreviewAddressField({ value, onChange, onSelect, placeholder }) {
  const [open, setOpen] = useState(false);
  const matches = value.trim().length >= 3 ? PREVIEW_ADDRESSES.filter((address) => address.toLowerCase().includes(value.trim().toLowerCase().slice(0, 3))) : [];
  return (
    <div style={{ position: 'relative' }}>
      <input className="hh-input" style={{ width: '100%' }} aria-label="Search for or enter the street address" value={value} placeholder={placeholder} onChange={(event) => { onChange(event.target.value); setOpen(true); }} />
      {open && matches.length > 0 && (
        <ul role="listbox" aria-label="Sample addresses" style={{ position: 'absolute', zIndex: 20, inset: '100% 0 auto', margin: '4px 0 0', padding: 4, listStyle: 'none', background: '#fff', border: '1px solid var(--line)', borderRadius: 10 }}>
          {matches.map((address) => <li key={address} role="option" aria-selected="false" style={{ padding: 10, cursor: 'pointer' }} onClick={() => { onSelect(address); setOpen(false); }}>{address}</li>)}
        </ul>
      )}
    </div>
  );
}

// Step 3 "returning" sample: a co-buyer who joined and a connected Realtor.
const PREVIEW_PEOPLE = { coBuyers: [{ name: 'Jordan' }], realtors: 1, ownerName: null };

const PREVIEW_PLACES = [{ id: 'preview-place-work', label: 'Work', address: '500 Woodward Ave, Detroit, MI 48226', maxDriveMinutes: null }];

function withPreviewAreas(priorities) {
  return [PREVIEW_AREAS[0], PREVIEW_AREAS[2]].reduce((next, area) => addSearchArea(next, area), priorities);
}

// flow=v2 previews the approved six-step sequence (flow 3), which is not live.
export default function OnboardingPreview({ step = 'basics', state = 'empty', mode = 'account', flow = 'live' }) {
  const shared = mode === 'shared';
  const version = flow === 'v2' ? 3 : CURRENT_ONBOARDING_VERSION;
  const fixture = useMemo(() => {
    const context = { searchId: SEARCH_ID, role: shared ? 'co_buyer' : 'owner' };
    const steps = onboardingStepsFor(version, { context });
    const target = steps.includes(step) ? step : steps[0];
    const returningToPeople = target === 'collaboration' && state === 'populated' && !shared;
    const progress = beginOnboarding({
      storedState: { step: target, completed: steps.slice(0, steps.indexOf(target)), startedAt: NOW, context, answers: returningToPeople ? { collaboration: 'co_buyer_and_realtor' } : {} },
      storedVersion: version,
      context,
      now: NOW,
      targetVersion: version,
    });
    const populated = state === 'populated' || target !== 'basics';
    // Step 2 starts empty unless state=populated (returning with answers).
    const priorities = populated ? populatedPriorities() : normalizePriorities({});
    return {
      progress,
      priorities: target === 'locations' && state === 'populated' ? withPreviewAreas(priorities) : priorities,
      places: target === 'locations' && state === 'populated' ? PREVIEW_PLACES : [],
      people: shared ? { coBuyers: [], realtors: 0, ownerName: 'Ciara' } : returningToPeople ? PREVIEW_PEOPLE : null,
    };
  }, [step, state, shared, version]);
  const services = useMemo(() => previewServices(state === 'error'), [state]);

  return (
    <Onboarding
      key={`${step}:${state}:${mode}:${flow}`}
      initialPlaces={fixture.places}
      initialPeople={fixture.people}
      userId={USER_ID}
      searchId={SEARCH_ID}
      initialPriorities={fixture.priorities}
      initialProgress={fixture.progress}
      mode={shared ? 'shared_search_setup' : 'account'}
      ownerName={shared ? 'Ciara' : null}
      ownedSearchId={shared ? OWNED_SEARCH_ID : null}
      services={services}
    />
  );
}
