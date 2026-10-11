'use client';

import { useMemo, useRef, useState } from 'react';
import Onboarding from '@/components/onboarding/Onboarding';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { normalizePriorities } from '@/lib/constants';
import { googleAreaSuggestions } from '@/lib/areaSearchProvider';
import { chooseSearchType } from '@/lib/onboardingBasics';
import { beginOnboarding } from '@/lib/onboardingFlow';
import { addSearchArea } from '@/lib/searchAreas';
import { addCriterion, moveCriterion } from '@/lib/searchProfile';
import { moveGroup, toggleGroupValue } from '@/lib/whatMattersGroups';
import { basicsSummary, prioritiesSummary } from '@/lib/onboardingReview';

// TEMPORARY Preview-only QA journey for the six-step onboarding (flow 3,
// not live). See docs/onboarding-v2-preview-qa.md.
//
// • Every write <Onboarding> can make is an in-memory stand-in: preferences,
//   progress, completion, places, active search, feedback. Nothing reaches
//   Supabase; no account, search, member, invitation or place changes.
// • Finishing never enters the real app: services.navigate shows what the real
//   app would do instead, and says plainly that nothing was saved.
// • Area and address lookups can use live Google Places, clearly labelled
//   sample results, or a simulated outage.

const DEMO_SEARCH = '00000000-0000-4000-8000-0000000000d1';
const DEMO_OWN_SEARCH = '00000000-0000-4000-8000-0000000000d2';
const DEMO_USER = '00000000-0000-4000-8000-0000000000d3';
const OWNER_NAME = 'Ciara (demo)';

const SCENARIOS = {
  decisive: {
    title: 'A · The decisive buyer',
    role: 'owner',
    script: 'Set a budget, bedrooms and bathrooms. Add two or three areas and a place. Pick a co-buyer or Realtor card. Choose many priorities, including House or Condo and Ranch or Two story. Move several to Must-Have. On Review, edit a section and come back, then finish.',
  },
  exploratory: {
    title: 'B · The exploratory buyer',
    role: 'owner',
    script: 'Choose only what you’re looking for. Skip areas and places, choose “Maybe later” on Your People, and “Skip for now” on What Matters. Review should show a minimal search with friendly empty states; finish anyway.',
  },
  cobuyer: {
    title: 'C · The co-buyer',
    role: 'co_buyer',
    script: `You’ve joined ${OWNER_NAME}’s shared search. Set your own preferences, then edit an answer from Review and finish. Nothing about ${OWNER_NAME}’s preferences or your own search changes; “Not now—go to your own search” is also available.`,
  },
};

const SAMPLE_AREAS = [
  { placeId: 'sample-gp-city', name: 'Grosse Pointe', type: 'city' },
  { placeId: 'sample-gp-park', name: 'Grosse Pointe Park', type: 'city' },
  { placeId: 'sample-gp-schools', name: 'Grosse Pointe Public School System', type: 'school_district' },
  { placeId: 'sample-gp-farms', name: 'The Farms', type: 'neighborhood' },
  { placeId: 'sample-48230', name: '48230', type: 'zip' },
  { placeId: 'sample-royal-oak', name: 'Royal Oak', type: 'city' },
].map((area) => ({ ...area, secondary: 'Sample result — not from Google', source: 'google_places' }));
const SAMPLE_ADDRESSES = ['500 Woodward Ave, Detroit, MI 48226 (sample)', '1 Kercheval Ave, Grosse Pointe Farms, MI 48236 (sample)'];

function SampleAddressField({ value, onChange, onSelect, placeholder }) {
  const term = value.trim().toLowerCase();
  const matches = term.length >= 3 ? SAMPLE_ADDRESSES.filter((address) => address.toLowerCase().includes(term.slice(0, 3))) : [];
  return (
    <div style={{ position: 'relative' }}>
      <input className="hh-input" style={{ width: '100%' }} aria-label="Search for or enter the street address" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {matches.length > 0 && value !== matches[0] && (
        <ul role="listbox" aria-label="Sample addresses (not from Google)" style={{ position: 'absolute', zIndex: 20, inset: '100% 0 auto', margin: '4px 0 0', padding: 4, listStyle: 'none', background: '#fff', border: '1px solid var(--line)', borderRadius: 10 }}>
          {matches.map((address) => <li key={address} role="option" aria-selected="false" style={{ padding: 10, cursor: 'pointer' }} onClick={() => onSelect(address)}>{address}</li>)}
        </ul>
      )}
    </div>
  );
}

// "Start at Review" for scenario A: a fully answered search to inspect quickly.
function decisiveAnswers() {
  let p = chooseSearchType(normalizePriorities({}), 'home_buy', { presetPropertyType: false });
  p = { ...p, budget: { ...p.budget, value: '650000' }, bedsMin: { ...p.bedsMin, value: '3' }, bathsMin: { ...p.bathsMin, value: '2' }, sqftTarget: { ...p.sqftTarget, value: '1800' } };
  for (const area of SAMPLE_AREAS.slice(0, 3)) p = addSearchArea(p, area);
  for (const [categoryKey, label] of [['location', 'Reputable Schools'], ['location', 'Quiet street'], ['features', 'Home office'], ['exterior', 'Garage'], ['exterior', 'Large backyard'], ['features', 'Finished basement']]) p = addCriterion(p, { categoryKey, label, kind: 'check' });
  p = moveCriterion(moveCriterion(p, 'location', 'Reputable Schools', 'must'), 'exterior', 'Garage', 'must');
  p = moveCriterion(p, 'features', 'Finished basement', 'nice');
  p = moveGroup(toggleGroupValue(toggleGroupValue(p, 'preferredPropertyTypes', 'house'), 'preferredPropertyTypes', 'condo'), 'preferredPropertyTypes', 'must');
  p = toggleGroupValue(toggleGroupValue(p, 'homeLayout', 'Ranch / Single Story'), 'homeLayout', 'Two Story');
  return p;
}

function initialFor(scenarioKey, startAt) {
  const scenario = SCENARIOS[scenarioKey];
  const context = { searchId: DEMO_SEARCH, role: scenario.role };
  const atReview = startAt === 'review';
  const progress = beginOnboarding({
    storedState: {
      step: atReview ? 'review' : 'basics',
      completed: atReview ? ['basics', 'locations', 'collaboration', 'priorities', 'rank'] : [],
      startedAt: '2026-01-01T00:00:00.000Z',
      context,
      answers: atReview ? { collaboration: 'realtor' } : {},
    },
    storedVersion: 3,
    targetVersion: 3,
    context,
  });
  return {
    progress,
    priorities: atReview ? decisiveAnswers() : normalizePriorities({}),
    places: atReview ? [{ id: 'demo-place-1', label: 'Work', address: SAMPLE_ADDRESSES[0], maxDriveMinutes: null }] : [],
  };
}

function Finished({ result, scenario, onReview, onRestart }) {
  const where = {
    '/homes?add=1': 'open Add a home (the existing add-home flow)',
    '/search?welcome=1': 'open My Search',
    '/homes': scenario.role === 'co_buyer' ? 'return to your own search (switching your active search)' : 'open Homes',
  }[result.destination.split('#')[0]] || `open ${result.destination}`;
  const saved = result.priorities;
  return (
    <section role="status" aria-live="polite" style={{ maxWidth: 640, margin: '32px auto 120px', padding: '0 16px', font: '14px/1.5 var(--font-sans)', color: 'var(--ink)' }}>
      <p className="flh-eyebrow">Demo finished — nothing was saved</p>
      <h1 className="flh-page-title" style={{ margin: '6px 0 12px' }}>This is where the real app would take over.</h1>
      <p>In the real app, Feels Like Home would now {scenario.role === 'co_buyer' && result.destination !== '/homes'
        ? <>save <strong>your own</strong> preferences in {OWNER_NAME}’s shared search (without changing theirs or creating a new search)</>
        : result.destination === '/homes' ? <>switch you back to your own search</> : <>save your preferences and mark onboarding complete</>}, then {where}.</p>
      <p style={{ color: 'var(--ink-soft)' }}>No account, search, invitation, member or place was created or changed. Completion calls in this demo: {result.completions}.</p>
      {saved && (
        <details style={{ margin: '16px 0', padding: 12, background: '#fff', borderRadius: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>What the real app would have saved (demo copy)</summary>
          <p style={{ margin: '8px 0 4px', fontWeight: 600 }}>The Basics</p>
          <ul>{basicsSummary(saved).map((row) => <li key={row.key}>{row.label}: {row.value || 'Not set yet'}</li>)}</ul>
          <p style={{ margin: '8px 0 4px', fontWeight: 600 }}>Priorities</p>
          <ul>{prioritiesSummary(saved).map((level) => <li key={level.tier}>{level.title}: {level.items.map((item) => (item.qualifier ? `${item.label} (${item.qualifier})` : item.label)).join(', ') || '—'}</li>)}</ul>
          <p style={{ margin: '8px 0 4px', fontWeight: 600 }}>Places</p>
          <ul>{result.places.length ? result.places.map((place) => <li key={place.id}>{place.label}: {place.address}</li>) : <li>None</li>}</ul>
        </details>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button type="button" className="flh-button flh-button-outline" onClick={onReview}>Back to Review (keep answers)</button>
        <button type="button" className="flh-button flh-button-primary" onClick={onRestart}>Restart this scenario</button>
      </div>
    </section>
  );
}

export default function OnboardingJourneyHarness() {
  const [scenarioKey, setScenarioKey] = useState('decisive');
  const [provider, setProvider] = useState('live');
  const [failSaves, setFailSaves] = useState(false);
  const [run, setRun] = useState({ key: 0, startAt: 'basics' });
  const [finished, setFinished] = useState(null);
  const store = useRef({ priorities: null, places: [], completions: 0 });
  const scenario = SCENARIOS[scenarioKey];

  const initial = useMemo(() => {
    const base = initialFor(scenarioKey, run.startAt);
    if (run.startAt === 'resume' && store.current.priorities) {
      return { ...base, priorities: store.current.priorities, places: store.current.places, progress: { ...initialFor(scenarioKey, 'review').progress, state: { ...initialFor(scenarioKey, 'review').progress.state, answers: store.current.answers || {} } } };
    }
    store.current = { priorities: base.priorities, places: base.places, completions: 0, answers: base.progress.state.answers };
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, scenarioKey]);

  const services = useMemo(() => {
    let nextPlace = 1;
    const failing = () => Promise.reject(new Error('Simulated save failure (demo)'));
    return {
      savePriorities: (searchId, userId, priorities) => { if (failSaves) return failing(); store.current.priorities = priorities; return Promise.resolve(true); },
      saveProgress: (userId, progress) => { store.current.answers = progress?.state?.answers || {}; return Promise.resolve(true); },
      completeOnboarding: () => { if (failSaves) return failing(); store.current.completions += 1; return Promise.resolve(true); },
      setActiveSearch: () => (failSaves ? failing() : Promise.resolve(true)),
      submitFeedback: () => Promise.resolve(true),
      createPlace: (searchId, userId, place) => {
        if (failSaves) return failing();
        const row = { id: `demo-place-${nextPlace++}`, label: place.label, address: place.address, maxDriveMinutes: null };
        store.current.places = [...store.current.places, row];
        return Promise.resolve(row);
      },
      deletePlace: (id) => { store.current.places = store.current.places.filter((place) => place.id !== id); return Promise.resolve(); },
      searchAreas: async (query) => {
        if (provider === 'fail') throw new Error('Simulated provider outage (demo)');
        if (provider === 'sample') {
          const term = query.trim().toLowerCase();
          return { results: SAMPLE_AREAS.filter((area) => area.name.toLowerCase().includes(term)), schoolDistricts: true };
        }
        return googleAreaSuggestions(query);
      },
      AddressField: provider === 'live' ? AddressAutocomplete : SampleAddressField,
      navigate: (destination) => setFinished({ destination, completions: store.current.completions, priorities: store.current.priorities, places: store.current.places }),
    };
  }, [provider, failSaves]);

  const restart = (startAt = 'basics') => { setFinished(null); setRun((current) => ({ key: current.key + 1, startAt })); };
  const chooseScenario = (key) => { setScenarioKey(key); setFinished(null); setRun((current) => ({ key: current.key + 1, startAt: 'basics' })); };

  const bar = { padding: '10px 16px', background: '#2E2621', color: '#fff', font: '500 13px/1.45 var(--font-sans)' };
  const pill = (active) => ({ minHeight: 34, padding: '0 12px', border: '1px solid rgba(255,255,255,.5)', borderRadius: 999, background: active ? '#fff' : 'transparent', color: active ? '#2E2621' : '#fff', font: '600 12.5px var(--font-sans)', cursor: 'pointer' });
  return (
    <>
      <div role="region" aria-label="Demo controls" style={bar}>
        <p style={{ margin: '0 0 8px' }}><strong>DEMO — Preview only.</strong> Six-step onboarding with demonstration data. Nothing you do here is saved, and your real account is never changed.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {Object.entries(SCENARIOS).map(([key, entry]) => <button key={key} type="button" aria-pressed={scenarioKey === key} style={pill(scenarioKey === key)} onClick={() => chooseScenario(key)}>{entry.title}</button>)}
          <button type="button" style={pill(false)} onClick={() => restart('basics')}>Restart</button>
          {scenarioKey === 'decisive' && <button type="button" style={pill(false)} onClick={() => restart('review')}>Start at Review (sample answers)</button>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <label>Area &amp; address search:{' '}
            <select value={provider} onChange={(event) => setProvider(event.target.value)} style={{ font: 'inherit' }}>
              <option value="live">Live Google Places</option>
              <option value="sample">Sample results (not Google)</option>
              <option value="fail">Simulate Google outage</option>
            </select>
          </label>
          <label><input type="checkbox" checked={failSaves} onChange={(event) => setFailSaves(event.target.checked)} /> Simulate save failures</label>
        </div>
        <p style={{ margin: '8px 0 0', color: '#E8DED4' }}><strong>{scenario.title}:</strong> {scenario.script}</p>
      </div>
      {finished ? (
        <Finished result={finished} scenario={scenario} onReview={() => { setFinished(null); setRun((current) => ({ key: current.key + 1, startAt: 'resume' })); }} onRestart={() => restart('basics')} />
      ) : (
        <Onboarding
          key={`${scenarioKey}:${run.key}`}
          userId={DEMO_USER}
          searchId={DEMO_SEARCH}
          initialPriorities={initial.priorities}
          initialProgress={initial.progress}
          initialPlaces={initial.places}
          initialPeople={scenario.role === 'co_buyer' ? { coBuyers: [], realtors: 0, ownerName: OWNER_NAME } : null}
          mode={scenario.role === 'co_buyer' ? 'shared_search_setup' : 'account'}
          ownerName={scenario.role === 'co_buyer' ? OWNER_NAME : null}
          ownedSearchId={scenario.role === 'co_buyer' ? DEMO_OWN_SEARCH : null}
          services={services}
        />
      )}
    </>
  );
}
