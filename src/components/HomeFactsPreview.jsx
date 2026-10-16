'use client';

import { useState } from 'react';
import HomeDetail from '@/components/HomeDetail';
import HomeModal from '@/components/HomeModal';
import { emptyHome, normalizePriorities } from '@/lib/constants';
import { applySearchChoice } from '@/lib/onboarding';
import { addCriterion } from '@/lib/searchProfile';

// Fixtures for the development-only Home Facts preview (src/app/dev/home-facts/page.dev.js, never part of a production build).
// Renders the real <HomeDetail> and <HomeModal> with deterministic data; no
// sign-in, and nothing is read from or written to Supabase. The Add Home view's
// listing lookup is answered by the browser QA script (it intercepts
// /api/import-listing), and its save is simulated in memory.
const USER_ID = '00000000-0000-4000-8000-000000000001';
const SEARCH_ID = '00000000-0000-4000-8000-000000000002';
const HOME_ID = '00000000-0000-4000-8000-000000000010';
const PHOTO = '/images/Warm%20Cottage.png';
const LISTING_URL = 'https://www.zillow.com/homedetails/51613-Sass-Rd-New-Baltimore-MI-48047/12345_zpid/';

function previewPriorities() {
  let next = applySearchChoice(normalizePriorities({}), 'home_buy');
  next.budget = { ...next.budget, value: '400000', tier: 'must' };
  next.bedsMin = { ...next.bedsMin, value: '4', tier: 'must' };
  next.bathsMin = { ...next.bathsMin, value: '2', tier: 'important' };
  next.homeLayout = { values: ['Two Story', 'Ranch / Single Story'], tier: 'important' };
  next.homeCondition = { values: ['Move-In Ready'], tier: 'important' };
  next = addCriterion(next, { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, 'must');
  next = addCriterion(next, { categoryKey: 'features', label: 'Finished basement', kind: 'check' }, 'nice');
  // Personal Yes / No / Unknown priorities for the evaluation states.
  for (const [categoryKey, label, tier] of [
    ['features', 'Home office', 'must'], ['exterior', 'Fenced yard', 'important'], ['location', 'Walkable schools', 'important'],
    ['features', 'Fireplace', 'nice'], ['exterior', 'Patio / deck', 'nice'], ['features', 'Central air', 'nice'],
  ]) next = addCriterion(next, { categoryKey, label, kind: 'check' }, tier);
  return next;
}

export const FULL_IMPORT = Object.freeze({
  fields: {
    address: '51613 Sass Rd, New Baltimore, MI 48047', price: '335000', beds: '5', baths: '2', sqft: '2080',
    lotSize: '0.29 acres', yearBuilt: '1993', propertyType: 'house', basementNotes: 'Unfinished', garageSpaces: '2',
    daysOnMarket: '23', latitude: 42.68, longitude: -82.73, propertyTaxAnnual: 4210, propertyTaxYear: 2025,
  },
  listingFacts: [
    { key: 'stories', label: 'Stories / levels', value: 2, group: 'structure' },
    { key: 'exterior', label: 'Exterior', value: 'Vinyl siding', group: 'structure' },
    { key: 'roof', label: 'Roof', value: 'Asphalt shingle', group: 'structure' },
    { key: 'fireplaces', label: 'Fireplaces', value: 1, group: 'structure' },
    { key: 'basement', label: 'Basement', value: 'Unfinished basement', group: 'structure' },
    { key: 'garageType', label: 'Garage', value: 'Attached', group: 'parking' },
    { key: 'heating', label: 'Heating', value: 'Forced air', group: 'utilities' },
    { key: 'cooling', label: 'Cooling', value: 'Central', group: 'utilities' },
    { key: 'water', label: 'Water source', value: 'City', group: 'utilities' },
    { key: 'sewer', label: 'Sewer', value: 'City sewer', group: 'utilities' },
    { key: 'status', label: 'Listing status', value: 'Active', group: 'listing' },
    { key: 'mls', label: 'Listing ID', value: '20261076983', group: 'listing' },
  ],
  descriptionFeatures: [
    { id: 'first-floor-laundry', label: 'First-floor laundry' },
    { id: 'deck', label: 'Deck' },
    { id: 'hardwood-floors', label: 'Hardwood floors' },
  ],
});

const PARTIAL_IMPORT = Object.freeze({
  fields: { address: '208 Linden Ave, Royal Oak, MI 48073', price: '289000', beds: '3', baths: '1.5' },
  listingFacts: [],
  descriptionFeatures: [],
});

function homeFrom(snapshot, overrides = {}) {
  const fields = snapshot?.fields || {};
  return {
    ...emptyHome(), id: HOME_ID, userId: USER_ID, createdAt: '2026-10-16T14:24:00.000Z',
    ...Object.fromEntries(Object.entries(fields).filter(([key]) => key in emptyHome())),
    listingUrl: snapshot ? LISTING_URL : '', listingImport: snapshot, ...overrides,
  };
}

const TOURED = homeFrom(FULL_IMPORT, {
  photoUrl: PHOTO, homeLayout: ['Two Story'], homeCondition: ['Move-In Ready'], status: 'Toured', touredAt: '2026-10-11T15:00:00.000Z', reaction: 'love',
  checks: { 'features:Home office': true, 'exterior:Fenced yard': true, 'features:Fireplace': true },
  ratings: { 'tour-v2:curb_appeal': 'positive', 'tour-v2:layout': 'positive', 'tour-v2:privacy': 'neutral', 'tour-v2:neighborhood': 'negative' },
  pros: 'Bright, open living room, Huge backyard, Quiet street', cons: 'Kitchen feels dated, Busy road two blocks over',
  notes: 'Loved the light in the living room. Ask about the roof age.\n\nSecond look: the backyard is even bigger than the photos.',
});
const CO_BUYER = Object.freeze({ match: { pct: 64, evaluatedCount: 5, selectedCount: 13 }, overallFeeling: 2, differentTakes: [{ key: 'homeFeel:Natural Light', label: 'Natural Light', youLiked: true, coBuyerLiked: false }] });

const HOME_STATES = {
  full: { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'] }), justAdded: 'import' },
  saved: { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'], homeCondition: ['Move-In Ready'], primaryBedroomLocation: 'Upstairs', schoolsNotes: 'Anchor Bay School District', garageSpaces: '2', pros: 'Bright, open living area, Large backyard', cons: 'Kitchen feels a bit dated', notes: 'Quiet, well-kept street. Confirm HOA details and sewer.' }) },
  nophoto: { home: homeFrom(FULL_IMPORT), justAdded: 'import' },
  partial: { home: homeFrom(PARTIAL_IMPORT), justAdded: 'import' },
  unknown: { home: homeFrom(PARTIAL_IMPORT, { photoUrl: PHOTO }) },
  manual: { home: { ...emptyHome(), id: HOME_ID, userId: USER_ID, address: '14 Orchard Ln, Grosse Pointe, MI 48236', price: '410000', beds: '4', baths: '2.5' }, justAdded: 'manual' },
  realtor: { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'] }), readOnly: true },
  cobuyer: { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'], userId: '00000000-0000-4000-8000-000000000099' }), isCollaborative: true },
  // Evaluation states (Check the Match / Tour Feedback review).
  'eval-new': { home: { ...emptyHome(), id: HOME_ID, userId: USER_ID, address: '9 Birch Ct, Royal Oak, MI 48073' } },
  'eval-unknown': { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'] }) },
  'eval-mismatch': { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'], checks: { 'features:Home office': 'no', 'exterior:Fenced yard': true, 'features:Fireplace': true } }) },
  'eval-mostly': { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'], homeCondition: ['Move-In Ready'], checks: { 'features:Home office': true, 'exterior:Fenced yard': true, 'location:Walkable schools': true, 'features:Fireplace': true, 'exterior:Patio / deck': 'no' } }) },
  'eval-legacy-notes': { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'], status: 'Want to Tour', pros: 'Big backyard, Quiet street', cons: 'Dated kitchen', notes: 'Saw it from the street on Sunday. Ask about the roof age and whether the basement ever takes on water.' }) },
  'eval-toured': { home: TOURED },
  'eval-two-buyers': { home: TOURED, isCollaborative: true, coBuyerPerspective: CO_BUYER },
  'eval-realtor': { home: TOURED, isCollaborative: true, readOnly: true, coBuyerPerspective: CO_BUYER, perspectiveName: 'Jordan', coBuyerName: 'Sam' },
  'eval-save-error': { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'] }), failSaves: true },
};

// In-memory stand-ins for the two real save paths (saveHomePersonalState /
// saveHomePersonalAndShared). Each records what it was asked to write on
// window.__flhPreviewWrites so browser QA can assert the exact path and payload.
function previewPersistence(failSaves) {
  const record = (path, next) => {
    if (typeof window !== 'undefined') (window.__flhPreviewWrites ||= []).push({ path, checks: next.checks, ratings: next.ratings, status: next.status, pros: next.pros, cons: next.cons, notes: next.notes, petsAllowed: next.petsAllowed });
  };
  const write = (path) => async (next) => {
    record(path, next);
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (failSaves) throw new Error('Simulated save failure');
    return next;
  };
  return { personal: write('personal'), whole: write('whole') };
}

function AddHomePreview({ state, priorities }) {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(null);
  const [saveCalls, setSaveCalls] = useState(0);
  const existingHomes = state === 'duplicate' ? [homeFrom(FULL_IMPORT, { photoUrl: PHOTO })] : [];
  const onSave = async (home) => {
    setSaveCalls((count) => count + 1);
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (state === 'error') throw new Error('Simulated save failure');
    setSaved({ href: `/homes/${HOME_ID}?added=${home.listingImport ? 'import' : 'manual'}`, home });
    setOpen(false);
  };
  return <main className="hh-root" style={{ padding: 24 }}>
    <h1 className="hh-serif">My Homes</h1>
    {saved && <p role="status" data-testid="preview-saved" data-save-calls={saveCalls} data-address={saved.home.address} data-price={saved.home.price} data-garage={saved.home.garageSpaces} data-snapshot-facts={saved.home.listingImport?.listingFacts?.length ?? 0} data-listing-url={saved.home.listingUrl}>Saved. Opening Home Facts at {saved.href}</p>}
    {!open && !saved && <p role="status">Closed without saving.</p>}
    {open && <HomeModal
      initial={{ ...emptyHome(), listingUrl: state === 'manual' ? '' : LISTING_URL }} priorities={priorities} userId={USER_ID}
      onSave={onSave} onClose={() => setOpen(false)} autoFindOnMount={state !== 'manual'} existingHomes={existingHomes} importLanding
    />}
  </main>;
}

export default function HomeFactsPreview({ view = 'detail', state = 'full', section = 'facts' }) {
  const priorities = previewPriorities();
  if (view === 'add') return <AddHomePreview state={state} priorities={priorities} />;
  const fixture = HOME_STATES[state] || HOME_STATES.full;
  return <div className="hh-root" style={{ paddingTop: 24 }}>
    <HomeDetail
      home={fixture.home} priorities={priorities} commuteDestinations={[]} coBuyerPerspective={fixture.coBuyerPerspective || null}
      perspectiveName={fixture.perspectiveName || null} coBuyerName={fixture.coBuyerName || null}
      userId={USER_ID} searchId={SEARCH_ID} isCollaborative={!!fixture.isCollaborative} readOnly={!!fixture.readOnly}
      justAdded={fixture.justAdded || null} initialSection={section} persistence={previewPersistence(!!fixture.failSaves)}
    />
  </div>;
}
