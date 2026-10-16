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
  return next;
}

export const FULL_IMPORT = Object.freeze({
  fields: {
    address: '51613 Sass Rd, New Baltimore, MI 48047', price: '335000', beds: '5', baths: '2', sqft: '2080',
    lotSize: '0.29 acres', yearBuilt: '1993', propertyType: 'house', basementNotes: 'Unfinished', garageSpaces: '2',
    daysOnMarket: '23', latitude: 42.68, longitude: -82.73, propertyTaxAnnual: 4210, propertyTaxYear: 2025,
    listingId: '20261076983', heating: 'Forced air', exterior: 'Vinyl siding', roof: 'Asphalt shingle',
    garageType: 'attached', basementCondition: 'unfinished',
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

// A home imported before the structured Home Facts fields existed: its snapshot
// has the facts only as read-only listing facts ("Listing says …").
const LEGACY_IMPORT = Object.freeze({
  fields: Object.fromEntries(Object.entries(FULL_IMPORT.fields).filter(([key]) => !['listingId', 'heating', 'exterior', 'roof', 'garageType', 'basementCondition'].includes(key))),
  listingFacts: FULL_IMPORT.listingFacts,
  descriptionFeatures: FULL_IMPORT.descriptionFeatures,
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

const HOME_STATES = {
  full: { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'] }), justAdded: 'import' },
  saved: { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'], homeCondition: ['Move-In Ready'], primaryBedroomLocation: 'Main Floor', estMonthly: '2450', schoolDistrict: 'Anchor Bay School District', elementarySchool: 'Lighthouse Elementary', highSchool: 'Anchor Bay High', garageSpaces: '2', basementStyle: 'traditional', checks: { 'exterior:Garage': true, 'features:Finished basement': 'no' }, pros: 'Bright, open living area, Large backyard', cons: 'Kitchen feels a bit dated', notes: 'Quiet, well-kept street. Confirm HOA details and sewer.' }) },
  nophoto: { home: homeFrom(FULL_IMPORT), justAdded: 'import' },
  partial: { home: homeFrom(PARTIAL_IMPORT), justAdded: 'import' },
  legacy: { home: homeFrom(LEGACY_IMPORT, { photoUrl: PHOTO, lotSize: '8712 sq ft', garageSpaces: '4', schoolsNotes: 'Anchor Bay Schools' }) },
  unknown: { home: homeFrom(PARTIAL_IMPORT, { photoUrl: PHOTO }) },
  manual: { home: { ...emptyHome(), id: HOME_ID, userId: USER_ID, address: '14 Orchard Ln, Grosse Pointe, MI 48236', price: '410000', beds: '4', baths: '2.5' }, justAdded: 'manual' },
  realtor: { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'] }), readOnly: true },
  cobuyer: { home: homeFrom(FULL_IMPORT, { photoUrl: PHOTO, homeLayout: ['Two Story'], userId: '00000000-0000-4000-8000-000000000099' }), isCollaborative: true },
};

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
      home={fixture.home} priorities={priorities} commuteDestinations={[]} coBuyerPerspective={null}
      userId={USER_ID} searchId={SEARCH_ID} isCollaborative={!!fixture.isCollaborative} readOnly={!!fixture.readOnly}
      justAdded={fixture.justAdded || null} initialSection={section}
    />
  </div>;
}
