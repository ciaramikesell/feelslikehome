// Home Facts: what FLH knows about the property itself, presented from data the
// app already stores. Nothing here infers a fact, fetches anything, or changes
// how Match scores a home — it only reads, groups, and formats existing fields:
//
//   - shared home fields (homes.*) such as garageSpaces, basementNotes,
//     homeLayout, homeCondition, primaryBedroomLocation, schoolsNotes;
//   - the importer's snapshot (homes.listing_import), whose read-only
//     listingFacts / descriptionFeatures are shown as "From listing" only.
//
// Unknown is always neutral: an empty field is shown as Unknown (or omitted),
// never as "No". See docs/home-facts-redesign.md for which onboarding options
// do and do not have a structured property fact today.

import {
  LAYOUT_DISPLAY_LABELS, CONDITION_DISPLAY_LABELS, showsMultiselectCategory, showsHomeLayout,
} from './constants.js';
import { parseNum } from './matching.js';
import { searchIntentCapabilities } from './searchIntent.js';
import {
  formatCurrencyDisplay, formatHomePrice, formatLotSizeDisplay, formatPropertyType,
  formatTriState, formatDateOnly,
} from './homeDisplay.js';
import { fieldProvenance, hasImportSnapshot } from './homeProvenance.js';

const isBlank = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
  || (Array.isArray(value) && value.length === 0);

// Fields the importer returns that are identity or invisible infrastructure, not
// property details a buyer can see — never counted as "details found".
const UNCOUNTED_IMPORT_FIELDS = new Set(['address', 'latitude', 'longitude', 'propertyTaxYear']);

// How many listing details FLH actually imported, counting only what the
// importer supplied (structured fields, read-only listing facts, and features
// explicitly stated in the description). Zero when there was no import.
export function importedDetailCount(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const fields = snapshot.fields && typeof snapshot.fields === 'object' ? snapshot.fields : {};
  const fieldCount = Object.entries(fields).filter(([key, value]) => !UNCOUNTED_IMPORT_FIELDS.has(key) && !isBlank(value)).length;
  const facts = Array.isArray(snapshot.listingFacts) ? snapshot.listingFacts.filter(Boolean).length : 0;
  const features = Array.isArray(snapshot.descriptionFeatures) ? snapshot.descriptionFeatures.length : 0;
  return fieldCount + facts + features;
}

/* ---------------------------------- Garage ---------------------------------- */

// garageSpaces is the shared, Match-evaluated garage fact: '0' is a real "no
// garage", empty is Unknown. Attached/Detached has no stored home field — it is
// shown only when the listing snapshot reported it, and is never editable.
export const GARAGE_SPACE_CHOICES = Object.freeze(['0', '1', '2', '3', '4']);

export function garageSpacesLabel(value) {
  if (isBlank(value)) return null;
  const spaces = parseNum(value);
  if (spaces === null) return String(value).trim();
  if (spaces === 0) return 'No garage';
  return `${spaces}-car garage`;
}

export function listingFactValue(snapshot, key) {
  const fact = Array.isArray(snapshot?.listingFacts) ? snapshot.listingFacts.find((item) => item?.key === key) : null;
  return fact ? fact.value : null;
}

export function formatFactValue(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (Array.isArray(value)) return value.filter((item) => !isBlank(item)).join(', ');
  if (isBlank(value)) return '';
  return String(value);
}

/* --------------------------------- Basement --------------------------------- */

// basementNotes is shared, descriptive text (the importer writes Finished /
// Partially finished / Unfinished / Walkout). It is not a Match input: the
// Finished basement and Walkout basement priorities are each buyer's own
// Yes / No answers. These choices only write the descriptive text.
export const BASEMENT_FINISH_CHOICES = Object.freeze(['Finished', 'Partially finished', 'Unfinished', 'No basement']);

export function parseBasement(text) {
  const raw = String(text || '').trim();
  if (!raw) return { finish: null, walkout: false, custom: null };
  const finish = /\bno basement\b/i.test(raw) ? 'No basement'
    : /\bpart(?:ial|ially|ly)[ -]?finished\b/i.test(raw) ? 'Partially finished'
      : /\bunfinished\b/i.test(raw) ? 'Unfinished'
        : /\bfinished\b/i.test(raw) ? 'Finished' : null;
  const walkout = finish !== 'No basement' && /\bwalk[ -]?out\b/i.test(raw);
  const recognized = composeBasement({ finish, walkout });
  const custom = recognized && recognized.toLowerCase() === raw.toLowerCase() ? null : raw;
  return { finish, walkout, custom };
}

export function composeBasement({ finish, walkout }) {
  if (finish === 'No basement') return 'No basement';
  if (finish && walkout) return `${finish}, walkout`;
  if (finish) return finish;
  if (walkout) return 'Walkout';
  return '';
}

/* ------------------------------ Layout/condition ----------------------------- */

export const LAYOUT_CHOICES = Object.freeze(Object.keys(LAYOUT_DISPLAY_LABELS));
export const CONDITION_CHOICES = Object.freeze(Object.keys(CONDITION_DISPLAY_LABELS));
export const PRIMARY_BEDROOM_CHOICES = Object.freeze(['Main Floor', 'Upstairs']);
export const PRIMARY_BEDROOM_LABELS = Object.freeze({ 'Main Floor': 'First-floor primary', Upstairs: 'Primary upstairs' });

export const layoutLabel = (value) => LAYOUT_DISPLAY_LABELS[value] || value;
export const conditionLabel = (value) => CONDITION_DISPLAY_LABELS[value] || value;

/* ------------------------------- Home Features ------------------------------- */

// Which of the four Home Features apply to this kind of search. Apartments have
// none of them as property facts; layout is purchase-only (showsHomeLayout).
export function homeFeatureAvailability(priorities, { apartment = false } = {}) {
  const searchType = priorities?.searchType;
  return {
    garage: !apartment,
    basement: !apartment,
    layout: !apartment && showsHomeLayout(searchType),
    condition: !apartment && showsMultiselectCategory('homeCondition', searchType),
  };
}

// The compact, read-only summary for each Home Features category. `value` is
// null when the fact is Unknown; `detail` is optional supporting text.
export function homeFeatureSummary(home, priorities, { apartment = false } = {}) {
  const available = homeFeatureAvailability(priorities, { apartment });
  const snapshot = home?.listingImport || null;
  const rows = [];
  if (available.garage) {
    const garageType = formatFactValue(listingFactValue(snapshot, 'garageType'));
    rows.push({
      key: 'garage', title: 'Garage', value: garageSpacesLabel(home?.garageSpaces),
      detail: garageType ? `Listing says: ${garageType}` : '',
      provenance: fieldProvenance(home?.garageSpaces, snapshot, 'garageSpaces'),
    });
  }
  if (available.basement) {
    rows.push({
      key: 'basement', title: 'Basement', value: isBlank(home?.basementNotes) ? null : String(home.basementNotes).trim(),
      detail: '', provenance: fieldProvenance(home?.basementNotes, snapshot, 'basementNotes'),
    });
  }
  if (available.layout) {
    const layouts = (home?.homeLayout || []).map(layoutLabel);
    const primary = PRIMARY_BEDROOM_LABELS[home?.primaryBedroomLocation] || (isBlank(home?.primaryBedroomLocation) ? '' : home.primaryBedroomLocation);
    const parts = [...layouts, primary].filter(Boolean);
    rows.push({ key: 'layout', title: 'Home layout', value: parts.length ? parts.join(' · ') : null, detail: '', provenance: parts.length ? null : 'unknown' });
  }
  if (available.condition) {
    const conditions = (home?.homeCondition || []).map(conditionLabel);
    rows.push({ key: 'condition', title: 'Home condition', value: conditions.length ? conditions.join(' · ') : null, detail: '', provenance: conditions.length ? null : 'unknown' });
  }
  return rows;
}

// The editable draft for Home Features. Only shared fields that already exist
// on the home (and that the editor already writes) are ever produced.
export function homeFeaturesDraft(home) {
  return {
    garageSpaces: isBlank(home?.garageSpaces) ? '' : String(home.garageSpaces).trim(),
    basementNotes: isBlank(home?.basementNotes) ? '' : String(home.basementNotes).trim(),
    homeLayout: Array.isArray(home?.homeLayout) ? [...home.homeLayout] : [],
    primaryBedroomLocation: home?.primaryBedroomLocation || '',
    homeCondition: Array.isArray(home?.homeCondition) ? [...home.homeCondition] : [],
  };
}

export const HOME_FEATURE_FIELDS = Object.freeze(['garageSpaces', 'basementNotes', 'homeLayout', 'primaryBedroomLocation', 'homeCondition']);

/* ------------------------------ All listing details ------------------------------ */

const SNAPSHOT_GROUP_TITLES = {
  structure: 'Structure & exterior',
  parking: 'Parking',
  utilities: 'Utilities & systems',
  listing: 'Listing',
  costs: 'Costs',
};

// Grouped, read-only rows for the collapsed "All listing details" section.
// Editable home fields carry provenance (From listing / Added by you); facts that
// exist only in the listing snapshot are always "From listing" and read-only.
export function listingDetailGroups(home, priorities, { apartment = false } = {}) {
  const snapshot = home?.listingImport || null;
  const provenance = (field) => fieldProvenance(home?.[field], snapshot, field);
  const { showsRentalFacts } = searchIntentCapabilities(priorities?.searchType);
  const row = (label, field, display, { always = false } = {}) => {
    const raw = home?.[field];
    const value = isBlank(raw) ? '' : (display ? display(raw) : String(raw));
    if (!value && !always) return null;
    return { label, value: value || null, provenance: value ? provenance(field) : 'unknown' };
  };
  const snapshotFacts = Array.isArray(snapshot?.listingFacts) ? snapshot.listingFacts.filter(Boolean) : [];
  const snapshotRows = (group, skip = []) => snapshotFacts
    .filter((item) => item.group === group && !skip.includes(item.key))
    .map((item) => ({ label: item.label, value: formatFactValue(item.value), provenance: 'listing', readOnly: true }))
    .filter((item) => item.value);

  const priceLabel = showsRentalFacts ? 'Monthly rent' : 'Asking price';
  const groups = [
    {
      key: 'price', title: showsRentalFacts ? 'Rent & listing' : 'Price & listing',
      rows: [
        apartment ? null : row(priceLabel, 'price', (value) => formatHomePrice(value, priorities?.searchType), { always: true }),
        showsRentalFacts ? null : row('Est. monthly payment', 'estMonthly', formatCurrencyDisplay),
        row('Days on market', 'daysOnMarket'),
        showsRentalFacts ? null : row('HOA fee', 'hoaFeeMonthly', (value) => `${formatCurrencyDisplay(value) || '$0'}/month`),
        showsRentalFacts ? null : row('Property taxes', 'propertyTaxAnnual', (value) => `${formatCurrencyDisplay(value)}/year${home?.propertyTaxYear ? ` (${home.propertyTaxYear})` : ''}`),
        ...snapshotRows('listing'),
        ...(isBlank(home?.hoaFeeMonthly) ? snapshotRows('costs') : []),
      ],
    },
    {
      key: 'size', title: 'Size',
      rows: apartment ? [row('Lot size', 'lotSize', formatLotSizeDisplay)] : [
        row('Bedrooms', 'beds', null, { always: true }),
        row('Bathrooms', 'baths', null, { always: true }),
        row('Square footage', 'sqft', (value) => `${parseNum(value)?.toLocaleString() ?? value} sq ft`, { always: true }),
        row('Lot size', 'lotSize', formatLotSizeDisplay, { always: true }),
      ],
    },
    {
      key: 'property', title: 'Property',
      rows: [
        row('Property type', 'propertyType', formatPropertyType, { always: true }),
        row('Year built', 'yearBuilt', null, { always: true }),
        ...(showsRentalFacts ? [
          row('Available on', 'availableOn', formatDateOnly),
          isBlank(home?.petsAllowed) ? null : { label: 'Pets allowed', value: formatTriState(home.petsAllowed), provenance: provenance('petsAllowed') },
          isBlank(home?.utilitiesIncluded) ? null : { label: 'Utilities included', value: formatTriState(home.utilitiesIncluded), provenance: provenance('utilitiesIncluded') },
          isBlank(home?.inUnitLaundry) ? null : { label: 'In-unit laundry', value: formatTriState(home.inUnitLaundry), provenance: provenance('inUnitLaundry') },
        ] : []),
      ],
    },
    // Garage type and the raw basement wording are already summarized in Home
    // Features, so they are not repeated here.
    { key: 'structure', title: SNAPSHOT_GROUP_TITLES.structure, rows: snapshotRows('structure', ['basement']) },
    { key: 'parking', title: SNAPSHOT_GROUP_TITLES.parking, rows: snapshotRows('parking', ['garageType']) },
    { key: 'utilities', title: SNAPSHOT_GROUP_TITLES.utilities, rows: snapshotRows('utilities') },
  ];
  return groups.map((group) => ({ ...group, rows: group.rows.filter(Boolean) })).filter((group) => group.rows.length);
}

export function descriptionFeatureLabels(home) {
  const features = home?.listingImport?.descriptionFeatures;
  return Array.isArray(features) ? features.map((item) => item?.label).filter(Boolean) : [];
}

/* ---------------------------------- Welcome ---------------------------------- */

// The calm acknowledgement shown once, right after a home is added. It never
// claims the imported details are verified.
export function homeFactsWelcome(home, justAdded) {
  if (!justAdded) return null;
  const count = importedDetailCount(home?.listingImport);
  if (justAdded === 'import' && count > 0 && hasImportSnapshot(home?.listingImport)) {
    return {
      title: 'Welcome home (at least for now).',
      body: `We found ${count} detail${count === 1 ? '' : 's'} about this property. Here’s what FLH already knows — you can fill in the rest whenever you’re ready.`,
    };
  }
  return {
    title: 'Welcome home (at least for now).',
    body: 'It’s saved to My Homes. Add what you know whenever you’re ready — anything left blank stays Unknown and never counts against this home.',
  };
}
