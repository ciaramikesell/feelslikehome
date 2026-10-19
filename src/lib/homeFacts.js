// Home Facts: what FLH knows about the property itself — "We found your home.
// Here's what we know." Everything here reads, groups, formats and normalizes
// fields the app stores; nothing infers a fact, fetches anything, or changes how
// Match scores a home.
//
//   - shared home fields (homes.*): price, address, beds … plus the structured
//     Home Facts details (2026-10-17-home-facts-details.sql);
//   - the importer's snapshot (homes.listing_import): it proves what came "From
//     listing" (homeProvenance) and, for homes imported before a field existed,
//     supplies a quiet "Listing says …" hint. A hint is never copied into a field
//     unless a person saves it.
//
// Unknown is always neutral: an empty field is shown as Unknown, never "No".
// "None" (no garage, no basement) is a real answer and is stored as one.

import { LAYOUT_DISPLAY_LABELS, CONDITION_DISPLAY_LABELS, showsMultiselectCategory, showsHomeLayout } from './constants.js';
import { parseNum } from './matching.js';
import { typedLotSizeAcres } from './lotSize.js';
import { searchIntentCapabilities, PROPERTY_TYPE_LABELS } from './searchIntent.js';
import { formatCurrencyDisplay, formatHomePrice, formatLotSizeDisplay, formatTriState, formatDateOnly, digitsOnly } from './homeDisplay.js';
import { fieldProvenance, hasImportSnapshot } from './homeProvenance.js';
import { isLegacyNoHoaFact } from './listingFacts.js';

const isBlank = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
  || (Array.isArray(value) && value.length === 0);

// Fields the importer returns that are identity or invisible infrastructure, not
// property details a buyer can see — never counted as "details found".
const UNCOUNTED_IMPORT_FIELDS = new Set(['address', 'latitude', 'longitude', 'propertyTaxYear']);

// How many listing details FLH actually imported, counting only what the
// importer supplied (structured fields, read-only listing facts, and features
// explicitly stated in the description). Zero when there was no import.
// A listing fact restating a structured field the import also filled (e.g. the
// heating field and the "Heating" listing fact) is one detail, not two.
const FACT_COVERED_BY_FIELDS = Object.freeze({
  mls: ['listingId'], heating: ['heating'], cooling: ['cooling'], exterior: ['exterior'], roof: ['roof'],
  garageType: ['garageType'], basement: ['basementNotes', 'basementCondition', 'basementStyle'],
});

// Listing bookkeeping (status, dates, which MLS, a last known price) describes
// the listing, not the home, so it is shown but never counted as a detail.
const UNCOUNTED_LISTING_FACTS = new Set(['status', 'listedDate', 'removedDate', 'lastSeenDate', 'mlsName', 'lastKnownPrice']);

export function importedDetailCount(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const fields = snapshot.fields && typeof snapshot.fields === 'object' ? snapshot.fields : {};
  const fieldCount = Object.entries(fields).filter(([key, value]) => !UNCOUNTED_IMPORT_FIELDS.has(key) && !isBlank(value)).length;
  const covered = (fact) => (FACT_COVERED_BY_FIELDS[fact?.key] || []).some((field) => !isBlank(fields[field]));
  const facts = Array.isArray(snapshot.listingFacts) ? snapshot.listingFacts.filter((fact) => fact && !covered(fact) && !UNCOUNTED_LISTING_FACTS.has(fact.key) && !isLegacyNoHoaFact(fact)).length : 0;
  const features = Array.isArray(snapshot.descriptionFeatures) ? snapshot.descriptionFeatures.length : 0;
  return fieldCount + facts + features;
}

export function formatFactValue(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (Array.isArray(value)) return value.filter((item) => !isBlank(item)).join(', ');
  if (isBlank(value)) return '';
  return String(value);
}

export function listingFactValue(snapshot, key) {
  const fact = Array.isArray(snapshot?.listingFacts) ? snapshot.listingFacts.find((item) => item?.key === key) : null;
  return fact ? fact.value : null;
}

/* --------------------------------- Lot size --------------------------------- */

// Normalizes a lot size a person typed to acres, the unit Match's lot-size
// target uses. A bare number means acres (the field is labeled in acres);
// "sq ft", "sq m" and "hectares" are converted (typedLotSizeAcres, the same
// units Match reads). Anything else is kept exactly as typed rather than guessed at.
// Only a person's edit is normalized: stored values are never rewritten
// (formatLotSizeDisplay only changes how they read).
export function normalizeLotSizeInput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const acres = typedLotSizeAcres(text);
  if (acres === null) return text;
  const rounded = acres >= 0.01 ? Number(acres.toFixed(2)) : Number(acres.toFixed(4));
  return `${rounded} ${rounded === 1 ? 'acre' : 'acres'}`;
}

/* ---------------------------------- Choices ---------------------------------- */

// Property type stays the canonical homes.property_type value (Match's
// preferred-property-type input); these are the four offered on Home Facts.
// A different saved value (Other, Apartment …) stays visible and selected.
export const PROPERTY_TYPE_CHOICES = Object.freeze([
  ['house', 'Single-Family'], ['townhome', 'Townhome'], ['multifamily', 'Multi-Family'], ['condo', 'Condominium'],
]);
export const propertyTypeLabel = (value) => PROPERTY_TYPE_CHOICES.find(([key]) => key === value)?.[1] || PROPERTY_TYPE_LABELS[value] || value || '';

// Home Layout combines the shared homes.home_layout list (Ranch / Two-Story /
// Split Level) with First-Floor Primary, which is homes.primary_bedroom_location
// = 'Main Floor' — both are existing Match inputs, written exactly as before.
export const FIRST_FLOOR_PRIMARY = 'firstFloorPrimary';
export const LAYOUT_FACT_CHOICES = Object.freeze([
  ['Ranch / Single Story', 'Ranch'], ['Two Story', 'Two-Story'], ['Split Level', 'Split Level'], [FIRST_FLOOR_PRIMARY, 'First-Floor Primary'],
]);
export const CONDITION_FACT_CHOICES = Object.freeze(Object.entries(CONDITION_DISPLAY_LABELS));
export const layoutLabel = (value) => LAYOUT_DISPLAY_LABELS[value] || value;
export const conditionLabel = (value) => CONDITION_DISPLAY_LABELS[value] || value;

export const GARAGE_TYPE_CHOICES = Object.freeze([['none', 'None'], ['attached', 'Attached'], ['detached', 'Detached']]);
// garageSpaces is the Match-evaluated garage fact: '0' is a real "no garage",
// empty is Unknown. '3+' still reads as 3 for Match (parseNum).
export const GARAGE_SPACE_CHOICES = Object.freeze([['0', 'None'], ['1', '1'], ['2', '2'], ['3+', '3+']]);
export const BASEMENT_STYLE_CHOICES = Object.freeze([['none', 'None'], ['traditional', 'Traditional'], ['gardenview', 'Gardenview'], ['walkout', 'Walkout']]);
export const BASEMENT_CONDITION_CHOICES = Object.freeze([['none', 'None'], ['unfinished', 'Unfinished'], ['partially_finished', 'Partially Finished'], ['finished', 'Finished']]);

const choiceLabel = (choices, value) => choices.find(([key]) => key === value)?.[1] || (isBlank(value) ? '' : String(value));

// Which stored garage-space value a choice chip represents. '4' highlights
// "3+" without rewriting it; free text stays its own value.
export function garageSpacesChoice(value) {
  if (isBlank(value)) return null;
  const raw = String(value).trim();
  if (GARAGE_SPACE_CHOICES.some(([key]) => key === raw)) return raw;
  if (!/^\d+(?:\.\d+)?\s*\+?$/.test(raw)) return null;
  const spaces = parseNum(raw);
  if (spaces === 0) return '0';
  if (spaces === 1 || spaces === 2) return String(spaces);
  return spaces >= 3 ? '3+' : null;
}

export function garageSpacesLabel(value) {
  if (isBlank(value)) return null;
  const raw = String(value).trim();
  const spaces = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
  if (spaces === 0) return 'None';
  if (spaces !== null) return `${spaces} ${spaces === 1 ? 'space' : 'spaces'}`;
  if (raw === '3+') return '3+ spaces';
  return raw;
}

/* ---------------------------------- Sections --------------------------------- */

// Snapshot listing-fact keys behind each structured field, for homes imported
// before the field existed (or whose import predates this mapping).
const LISTING_FACT_KEYS = Object.freeze({
  listingId: 'mls', heating: 'heating', cooling: 'cooling', exterior: 'exterior', roof: 'roof', garageType: 'garageType', basement: 'basement',
});

// "Listing says: …" for a field the snapshot reported but nobody saved yet.
export function listingSays(home, field) {
  const value = listingFactValue(home?.listingImport, LISTING_FACT_KEYS[field]);
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return text ? `Listing says: ${text}` : null;
}

// Which Home Facts groups apply. Apartments have no garage / basement / layout
// facts; layout is purchase-only (showsHomeLayout).
export function homeFactsAvailability(priorities, { apartment = false } = {}) {
  const searchType = priorities?.searchType;
  return {
    garage: !apartment,
    basement: !apartment,
    layout: !apartment && showsHomeLayout(searchType),
    condition: !apartment && showsMultiselectCategory('homeCondition', searchType),
    propertyType: !apartment,
    schools: true,
  };
}

// The read view of Home Facts, grouped as the page shows it. Every row is
// { key, label, value (string | null = Unknown), provenance, hint }.
export function homeFactSections(home, priorities, { apartment = false } = {}) {
  const snapshot = home?.listingImport || null;
  const provenance = (field) => fieldProvenance(home?.[field], snapshot, field);
  const { showsRentalFacts } = searchIntentCapabilities(priorities?.searchType);
  const available = homeFactsAvailability(priorities, { apartment });
  const row = (label, field, display, { hint = null } = {}) => {
    const raw = home?.[field];
    const value = isBlank(raw) ? null : (display ? display(raw) : String(raw).trim());
    return { key: field, label, value: value || null, provenance: value ? provenance(field) : 'unknown', hint: value ? null : hint };
  };
  const optional = (label, field, display) => (isBlank(home?.[field]) ? null : row(label, field, display));

  const basic = [
    showsRentalFacts ? null : row('Est. monthly payment', 'estMonthly', (value) => `${formatCurrencyDisplay(value)}/mo`),
    row('Listing ID', 'listingId', null, { hint: listingSays(home, 'listingId') }),
    row('Year built', 'yearBuilt'),
    ...(showsRentalFacts ? [
      optional('Available on', 'availableOn', formatDateOnly),
      isBlank(home?.petsAllowed) ? null : { key: 'petsAllowed', label: 'Pets allowed', value: formatTriState(home.petsAllowed), provenance: provenance('petsAllowed'), hint: null },
      isBlank(home?.utilitiesIncluded) ? null : { key: 'utilitiesIncluded', label: 'Utilities included', value: formatTriState(home.utilitiesIncluded), provenance: provenance('utilitiesIncluded'), hint: null },
      isBlank(home?.inUnitLaundry) ? null : { key: 'inUnitLaundry', label: 'In-unit laundry', value: formatTriState(home.inUnitLaundry), provenance: provenance('inUnitLaundry'), hint: null },
    ] : []),
    // Known purchase costs stay visible (read here, corrected in Basic details).
    showsRentalFacts ? null : optional('HOA fee', 'hoaFeeMonthly', (value) => `${formatCurrencyDisplay(value) || '$0'}/mo`),
    showsRentalFacts ? null : optional('Property taxes', 'propertyTaxAnnual', (value) => `${formatCurrencyDisplay(value)}/yr${home?.propertyTaxYear ? ` (${home.propertyTaxYear})` : ''}`),
  ].filter(Boolean);

  const layouts = [...(home?.homeLayout || []).map(layoutLabel), home?.primaryBedroomLocation === 'Main Floor' ? 'First-Floor Primary' : null].filter(Boolean);
  const details = [
    available.propertyType ? row('Property type', 'propertyType', propertyTypeLabel) : null,
    available.layout ? { key: 'homeLayout', label: 'Home layout', value: layouts.length ? layouts.join(' · ') : null, provenance: layouts.length ? provenance('homeLayout') : 'unknown', hint: home?.primaryBedroomLocation === 'Upstairs' ? 'Primary bedroom upstairs' : null } : null,
    available.condition ? { key: 'homeCondition', label: 'Home condition', value: (home?.homeCondition || []).length ? home.homeCondition.map(conditionLabel).join(' · ') : null, provenance: (home?.homeCondition || []).length ? provenance('homeCondition') : 'unknown', hint: null } : null,
    apartment ? null : row('Heating', 'heating', null, { hint: listingSays(home, 'heating') }),
    apartment ? null : row('Cooling', 'cooling', null, { hint: listingSays(home, 'cooling') }),
    apartment ? null : row('Exterior', 'exterior', null, { hint: listingSays(home, 'exterior') }),
    apartment ? null : row('Roof', 'roof', null, { hint: listingSays(home, 'roof') }),
  ].filter(Boolean);

  const schools = [
    row('District', 'schoolDistrict'), row('Elementary', 'elementarySchool'), row('Middle', 'middleSchool'), row('High', 'highSchool'),
    // Free-text school notes saved before the structured fields stay visible.
    optional('School notes', 'schoolsNotes'),
  ].filter(Boolean);

  const basementNote = isBlank(home?.basementNotes) ? null : String(home.basementNotes).trim();
  const garage = available.garage ? [
    row('Type', 'garageType', (value) => choiceLabel(GARAGE_TYPE_CHOICES, value), { hint: listingSays(home, 'garageType') }),
    row('Spaces', 'garageSpaces', garageSpacesLabel),
  ] : [];
  const basement = available.basement ? [
    // The earlier descriptive basement note (imported or typed) stays readable
    // beside Style; it is never parsed into either structured answer.
    row('Style', 'basementStyle', (value) => choiceLabel(BASEMENT_STYLE_CHOICES, value), { hint: isBlank(home?.basementStyle) && isBlank(home?.basementCondition) ? (basementNote ? `Noted: ${basementNote}` : listingSays(home, 'basement')) : null }),
    row('Condition', 'basementCondition', (value) => choiceLabel(BASEMENT_CONDITION_CHOICES, value)),
  ] : [];

  return [
    { key: 'basic', title: 'Basic details', rows: basic },
    { key: 'details', title: 'Home details', rows: details },
    { key: 'schools', title: 'School details', rows: schools },
    { key: 'garage', title: 'Garage', rows: garage },
    { key: 'basement', title: 'Basement', rows: basement },
  ].filter((section) => section.rows.length);
}

// The property header: what the buyer recognizes the home by.
export function homeFactsHeader(home, priorities) {
  const snapshot = home?.listingImport || null;
  const facts = [
    !isBlank(home?.beds) && { field: 'beds', text: `${home.beds} ${Number(home.beds) === 1 ? 'bed' : 'beds'}` },
    !isBlank(home?.baths) && { field: 'baths', text: `${home.baths} ${Number(home.baths) === 1 ? 'bath' : 'baths'}` },
    !isBlank(home?.sqft) && { field: 'sqft', text: `${parseNum(home.sqft)?.toLocaleString() ?? home.sqft} sq ft` },
    !isBlank(home?.lotSize) && { field: 'lotSize', text: `${formatLotSizeDisplay(home.lotSize)} lot` },
  ].filter(Boolean);
  const fromListing = ['price', 'beds', 'baths', 'sqft', 'lotSize'].filter((field) => fieldProvenance(home?.[field], snapshot, field) === 'listing');
  const missing = [isBlank(home?.price) && 'price', isBlank(home?.beds) && 'beds', isBlank(home?.baths) && 'baths', isBlank(home?.sqft) && 'square footage', isBlank(home?.lotSize) && 'lot size'].filter(Boolean);
  return {
    price: formatHomePrice(home?.price, priorities?.searchType) || null,
    facts,
    fromListing,
    missing,
  };
}

const LISTING_FIELD_NAMES = { price: 'price', beds: 'beds', baths: 'baths', sqft: 'sq ft', lotSize: 'lot size' };
export const fromListingLine = (fields) => (fields.length ? `From listing: ${fields.map((field) => LISTING_FIELD_NAMES[field]).join(' · ')}` : null);

/* ------------------------------- Drafts & saving ------------------------------ */

// The fields each Home Facts group edits. Only shared home fields; nothing
// personal (checks, ratings, pros/cons) is ever in a Home Facts patch.
export const HOME_FACT_GROUP_FIELDS = Object.freeze({
  header: ['photoUrl', 'price', 'address', 'beds', 'baths', 'sqft', 'lotSize', 'listingUrl'],
  basic: ['estMonthly', 'listingId', 'yearBuilt', 'hoaFeeMonthly', 'propertyTaxAnnual'],
  details: ['propertyType', 'homeLayout', 'primaryBedroomLocation', 'homeCondition', 'heating', 'cooling', 'exterior', 'roof'],
  schools: ['schoolDistrict', 'elementarySchool', 'middleSchool', 'highSchool', 'schoolsNotes'],
  garage: ['garageType', 'garageSpaces'],
  basement: ['basementStyle', 'basementCondition'],
});

// Columns that store Unknown as null (the newer and numeric/enum facts); the
// older text columns store it as ''.
const NULL_UNKNOWN_FIELDS = new Set(['listingId', 'heating', 'cooling', 'exterior', 'roof', 'garageType', 'basementStyle', 'basementCondition',
  'schoolDistrict', 'elementarySchool', 'middleSchool', 'highSchool', 'propertyType', 'hoaFeeMonthly', 'propertyTaxAnnual']);

export function homeFactsDraft(home, group) {
  return Object.fromEntries(HOME_FACT_GROUP_FIELDS[group].map((field) => {
    const value = home?.[field];
    if (Array.isArray(value)) return [field, [...value]];
    return [field, isBlank(value) ? '' : String(value)];
  }));
}

function normalizeFieldInput(field, value) {
  if (Array.isArray(value)) return value;
  const text = String(value ?? '').trim();
  if (['price', 'estMonthly'].includes(field)) return digitsOnly(text);
  if (['hoaFeeMonthly', 'propertyTaxAnnual'].includes(field)) { const digits = digitsOnly(text); return digits ? Number(digits) : null; }
  if (field === 'lotSize') return normalizeLotSizeInput(text);
  if (!text) return NULL_UNKNOWN_FIELDS.has(field) ? null : '';
  return text;
}

const comparableValue = (value) => (Array.isArray(value) ? JSON.stringify([...value].sort()) : isBlank(value) ? '' : String(value).trim());

// Only what a person actually changed, normalized for storage. An untouched
// field is never re-written (so a legacy "8712 sq ft" lot or a '4' garage stays
// exactly as stored until someone edits it).
export function homeFactsPatch(home, group, draft) {
  const patch = {};
  for (const field of HOME_FACT_GROUP_FIELDS[group]) {
    if (!(field in draft)) continue;
    const before = comparableValue(home?.[field]);
    const typed = comparableValue(draft[field]);
    if (before === typed) continue;
    patch[field] = normalizeFieldInput(field, draft[field]);
  }
  return patch;
}

/* ---------------------------------- Welcome ---------------------------------- */

// The calm acknowledgement shown once, right after a home is added. It never
// claims the imported details are verified.
export function homeFactsWelcome(home, justAdded) {
  if (!justAdded) return null;
  const count = importedDetailCount(home?.listingImport);
  if (justAdded === 'import' && count > 0 && hasImportSnapshot(home?.listingImport)) {
    return {
      title: 'We found your home.',
      body: `It’s saved to My Homes. Here’s what we know — ${count} detail${count === 1 ? '' : 's'} from the listing. Correct anything, anytime; anything missing stays Unknown and never counts against it.`,
    };
  }
  return {
    title: 'Your home is saved.',
    body: 'It’s in My Homes. Add what you know whenever you’re ready — anything left blank stays Unknown and never counts against it.',
  };
}

/* ------------------------- Home overlay (directly editable) ------------------------- */

// Laundry Location (homes.laundry_location, 2026-10-18-laundry-location.sql).
// Null is Unknown. Separate from the rental In-Unit Laundry fact and from any
// personal laundry answer; never a Match input.
export const LAUNDRY_LOCATION_CHOICES = Object.freeze([
  ['basement', 'Basement'], ['first_floor', 'First Floor'], ['second_floor', 'Second Floor'],
]);

// Suggestions only (a datalist): heating and cooling stay free text so an
// imported "Forced Air, Gas" is kept exactly as the listing said it.
export const HEATING_SUGGESTIONS = Object.freeze(['Forced Air', 'Radiant', 'Boiler', 'Heat Pump', 'Baseboard', 'Geothermal']);
export const COOLING_SUGGESTIONS = Object.freeze(['Central Air', 'Ductless Mini-Split', 'Window Units', 'Heat Pump', 'None']);

// Home layout shows the shared homes.home_layout list and First-Floor Primary
// (homes.primary_bedroom_location = 'Main Floor') as one choose-any control.
export function layoutValues(home) {
  return [...(home?.homeLayout || []), ...(home?.primaryBedroomLocation === 'Main Floor' ? [FIRST_FLOOR_PRIMARY] : [])];
}

// The patch for a new layout selection: only the fields that changed. Turning
// First-Floor Primary off clears 'Main Floor' but never touches another stored
// location (e.g. 'Upstairs'); turning it on is the only way to set 'Main Floor'.
export function layoutPatch(home, nextValues) {
  const patch = {};
  const layouts = nextValues.filter((value) => value !== FIRST_FLOOR_PRIMARY);
  if (JSON.stringify(layouts) !== JSON.stringify(home?.homeLayout || [])) patch.homeLayout = layouts;
  const wantsPrimary = nextValues.includes(FIRST_FLOOR_PRIMARY);
  const hasPrimary = home?.primaryBedroomLocation === 'Main Floor';
  if (wantsPrimary && !hasPrimary) patch.primaryBedroomLocation = 'Main Floor';
  if (!wantsPrimary && hasPrimary) patch.primaryBedroomLocation = '';
  return patch;
}

// Garage: "None" means no garage either way, so the other field follows it.
// Choosing a real type or a count after "None" returns the other to Unknown.
export function garagePatch(home, field, value) {
  const next = value || null;
  if (field === 'garageType') {
    const patch = { garageType: next };
    if (next === 'none') patch.garageSpaces = '0';
    else if (next && String(home?.garageSpaces ?? '') === '0') patch.garageSpaces = '';
    return patch;
  }
  const patch = { garageSpaces: next || '' };
  if (next === '0') patch.garageType = 'none';
  else if (next && home?.garageType === 'none') patch.garageType = null;
  return patch;
}

export function basementPatch(home, field, value) {
  const next = value || null;
  const other = field === 'basementStyle' ? 'basementCondition' : 'basementStyle';
  const patch = { [field]: next };
  if (next === 'none') patch[other] = 'none';
  else if (next && home?.[other] === 'none') patch[other] = null;
  return patch;
}

// The garage-spaces select value for a stored value ('4' shows as 3+ without
// being rewritten); free text that isn't a count stays its own option.
export function garageSpacesSelectValue(value) {
  return garageSpacesChoice(value) || (isBlank(value) ? '' : String(value).trim());
}

// HOA fee (homes.hoa_fee_monthly). Null is Unknown; 0 is a confirmed $0
// monthly fee, stored as the number 0 so it stays distinct from Unknown. A $0
// fee does not prove there is no HOA (there may still be an association, or
// fees billed another way), so it reads "$0/mo", never "No HOA". Never a Match
// input: the personal "No HOA" answer is separate and is not changed here.
export function formatHoaFee(value) {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return amount === 0 ? '$0/mo' : `${formatCurrencyDisplay(amount)}/mo`;
}
// What the input holds while editing: a confirmed $0 stays "0", never blank.
export const editHoaFee = (value) => (value === 0 || value === '0' ? '0' : formatCurrencyDisplay(value));

// Property tax year (homes.property_tax_year): a four-digit year, or blank for
// Unknown. Anything else is not saved: undefined keeps the typed text on screen
// with TAX_YEAR_INVALID_MESSAGE (QuietInput invalidMessage) until it's fixed.
export const TAX_YEAR_INVALID_MESSAGE = 'Not saved. Enter a four-digit year, like 2025, or clear it.';
export function parseTaxYear(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  if (!/^\d{4}$/.test(raw)) return undefined;
  const year = Number(raw);
  return year >= 1900 && year <= new Date().getFullYear() + 1 ? year : undefined;
}

const sameAmount = (a, b) => !isBlank(a) && !isBlank(b) && Number(a) === Number(b);

// The tax year says which bill the amount is. When a person changes an amount
// whose year came from the listing, that year no longer describes it, so it
// returns to Unknown instead of quietly labelling the new figure. Setting the
// amount back to the listing's figure brings the listing's year back with it.
// A year a person entered is theirs and is never touched. The listing snapshot
// itself is never edited, so "From listing" stays provable.
export function propertyTaxPatch(home, value) {
  const patch = { propertyTaxAnnual: value };
  const snapshot = home?.listingImport || null;
  const importedAmount = snapshot?.fields?.propertyTaxAnnual;
  const importedYear = snapshot?.fields?.propertyTaxYear;
  const yearFromListing = fieldProvenance(home?.propertyTaxYear, snapshot, 'propertyTaxYear') === 'listing';
  if (yearFromListing && !sameAmount(value, importedAmount)) patch.propertyTaxYear = null;
  else if (isBlank(home?.propertyTaxYear) && !isBlank(importedYear) && sameAmount(value, importedAmount)) patch.propertyTaxYear = Number(importedYear);
  return patch;
}
