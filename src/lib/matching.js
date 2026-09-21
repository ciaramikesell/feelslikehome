import { TIER_META, MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, getItemlistCategories, effectiveTier, isExperientialCriterion, isRetiredPurchaseBuiltIn, foldLegacyCheckAliases, isGarageQualifierAny, qualifierFactKey, TOUR_RESPONSE, tourResponseLabel } from './constants.js';
import { normalizeSearchIntent } from './searchIntent.js';
import { EVIDENCE_STRENGTH, findingsFromFields } from './importDomain.js';

export function parseNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function fmtMoney(v) {
  const n = parseNum(v);
  return n === null ? '—' : '$' + n.toLocaleString();
}

export function avgRating(ratings) {
  const vals = Object.values(ratings || {}).filter((v) => v > 0);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function trueCheckLabels(home) {
  return Object.entries(home.checks || {}).filter(([, v]) => v).map(([k]) => k.slice(k.indexOf(':') + 1));
}

export function homeStyleSummary(home) {
  return (home.homeLayout || []).join(', ');
}

// Splits a category's items into core rows, still-available suggestion chips, and user-added custom rows.
export function splitCategoryItems(def, priorities) {
  const catState = priorities[def.key] || { customItems: [], tiers: {}, order: [], hiddenCore: [] };
  const hidden = new Set(catState.hiddenCore || []);
  const core = def.coreItems.filter((i) => !hidden.has(i.label));
  const knownLabels = new Set([...def.coreItems, ...def.suggestedItems, ...(catState.customItems || [])].map((item) => item.label));
  // A removed suggestion remains renderable when a legacy participant selected
  // it. Its stored identity/tier is never rewritten or silently dropped.
  const legacySelected = Object.keys(catState.tiers || {})
    .filter((label) => !knownLabels.has(label) && catState.tiers[label] !== 'dontcare')
    .map((label) => ({ label, kind: ['Commute', 'Proximity to Family / Friends', 'Lease Terms', 'Maintenance Responsibility'].includes(label) ? 'rating' : 'check' }));
  const custom = [...(catState.customItems || []), ...legacySelected];
  const customLabels = new Set(custom.map((i) => i.label));
  const restorable = def.coreItems.filter((i) => hidden.has(i.label) && !customLabels.has(i.label));
  const suggestions = [...def.suggestedItems.filter((i) => !customLabels.has(i.label) && !hidden.has(i.label)), ...restorable];
  return { catState, core, suggestions, custom };
}

// Core/custom items already have a durable identity. A suggested item must be
// promoted when selected so it can leave the bank and render on the priority
// board instead of remaining a chip whose stored tier is otherwise invisible.
export function selectPriorityItem(catState, def, item, tier) {
  const customItems = catState.customItems || [];
  const isDurableItem = def.coreItems.some(({ label }) => label === item.label)
    || customItems.some(({ label }) => label === item.label);

  return {
    ...catState,
    customItems: isDurableItem ? customItems : [...customItems, item],
    tiers: { ...(catState.tiers || {}), [item.label]: tier },
  };
}

// Orders items by a saved label order; anything not yet in the order keeps its natural position at the end.
export function applyOrder(items, order) {
  if (!order || !order.length) return items;
  const idx = new Map(order.map((label, i) => [label, i]));
  const known = items.filter((i) => idx.has(i.label)).sort((a, b) => idx.get(a.label) - idx.get(b.label));
  const unknown = items.filter((i) => !idx.has(i.label));
  return [...known, ...unknown];
}

// The ordered set of a category's items the user has actually selected (tier !== 'dontcare') —
// this is both what shows in "Your priorities" on My Search, and what the home form asks about.
export function selectedOrderedItems(def, priorities) {
  const { catState, core, custom } = splitCategoryItems(def, priorities);
  const ordered = applyOrder([...core, ...custom], catState.order || []);
  return ordered.filter((item) => !isRetiredPurchaseBuiltIn(def.key, item, priorities.searchType)
    && effectiveTier(def.key, item.label, priorities, catState.tiers?.[item.label]) !== 'dontcare');
}

// Backwards-compatible alias.
export const visibleOrderedItems = selectedOrderedItems;

// A criterion's `kind` already distinguishes "objectively observable from a listing"
// (check — Garage, Basement, Fireplace...) from "can only really be judged in person"
// (rating — Natural Light, Privacy, Layout/Flow...). These two helpers reuse that
// existing distinction to drive *when* a selected subjective criterion is surfaced —
// they don't change what's selected, how it's scored, or any stored data.

// True if the user has selected (tier !== 'dontcare') at least one subjective
// (star-rating) criterion anywhere — used to decide whether a Toured home has
// anything worth a "How did it feel?" prompt.
export function hasSelectedSubjectiveCriteria(priorities) {
  if (!priorities) return false;
  return getItemlistCategories(priorities.searchType).some((def) =>
    selectedOrderedItems(def, priorities).some((item) => isExperientialCriterion(def.key, item.label))
  );
}

// The flat, ordered list of the user's selected subjective (star-rating) criteria
// across every category — this is exactly what the post-tour "How did it feel?"
// flow asks about, since these are the ones that can't be reliably judged pre-tour.
export function selectedSubjectiveCriteria(priorities) {
  if (!priorities) return [];
  return getItemlistCategories(priorities.searchType).flatMap((def) =>
    selectedOrderedItems(def, priorities)
      .filter((item) => isExperientialCriterion(def.key, item.label))
      .map((item) => ({ ...item, categoryKey: def.key }))
  );
}

// A short, curated set of rating-kind criteria worth offering a meticulous post-tour
// user even when they weren't selected as a search priority. Pulled only from labels
// that already exist somewhere in the app's own criterion set for this search type —
// never invented — and always excludes anything already shown as a selected priority
// so nothing is offered twice. Rating something here that isn't a selected priority
// has zero effect on Match (computeMatch only scores items with a set, non-'dontcare'
// tier), so this is purely a memory aid, not a hidden scoring input.
const CURATED_TOUR_LABELS = [
  'Natural Light', 'Privacy', 'Layout / Flow', 'Room Sizes', 'Immediate Street / Surroundings',
  'Character / Charm', 'Openness / Ceiling Height', 'Overall Condition', 'Exterior Condition',
  'Neighborhood', 'Noise Level',
];

export function curatedAdditionalSubjectiveCriteria(priorities) {
  if (!priorities) return [];
  const selectedKeys = new Set(selectedSubjectiveCriteria(priorities).map((i) => `${i.categoryKey}:${i.label}`));
  const seen = new Set();
  const out = [];
  getItemlistCategories(priorities.searchType).forEach((def) => {
    [...def.coreItems, ...def.suggestedItems].forEach((item) => {
      if (item.kind !== 'rating' || !CURATED_TOUR_LABELS.includes(item.label)) return;
      const key = `${def.key}:${item.label}`;
      if (selectedKeys.has(key) || seen.has(key)) return;
      seen.add(key);
      out.push({ ...item, categoryKey: def.key });
    });
  });
  return out;
}

/* ----------------------------- listing text parser ----------------------------- */

function listingDate(year, month, day) {
  const y = Number(year); const m = Number(month); const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseExplicitAvailability(text) {
  let m = text.match(/\bavailable(?:\s+on)?\s*[:\-]?\s*((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\b/i);
  if (m) return listingDate(m[1], m[2], m[3]);
  m = text.match(/\bavailable(?:\s+on)?\s*[:\-]?\s*(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})\b/i);
  if (m) return listingDate(m[3], m[1], m[2]);
  m = text.match(/\bavailable(?:\s+on)?\s*[:\-]?\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+((?:19|20)\d{2})\b/i);
  if (!m) return null;
  const month = ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(m[1].toLowerCase()) + 1;
  return listingDate(m[3], month, m[2]);
}

function parseExplicitPropertyType(text) {
  const labelled = text.match(/\b(?:property|home)\s+type\s*[:\-]\s*(apartment|house|townhome|townhouse|condo(?:minium)?|multi[ -]?family|other)\b/i);
  const explicitRental = text.match(/\b(apartment|house|townhome|townhouse|condo(?:minium)?|multi[ -]?family)\s+for\s+rent\b/i);
  const standaloneMultifamily = text.match(/^\s*multi[ -]?family\s*$/im);
  const raw = labelled?.[1] || explicitRental?.[1] || standaloneMultifamily?.[0];
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/[ -]/g, '');
  return ({ townhouse: 'townhome', condominium: 'condo', multifamily: 'multifamily' })[normalized] || normalized;
}

/** Parse pasted listing text in the context of its search intent. */
export function parseListingText(text, searchType = null) {
  const t = text || '';
  const out = {};
  const isRental = normalizeSearchIntent(typeof searchType === 'object' ? searchType?.searchType : searchType) === 'rental';

  let m;
  if (isRental) {
    m = t.match(/\$\s?([\d,]{3,7})\s*(?:\/\s*(?:mo(?:nth)?|month)|per\s+month)\b/i)
      || t.match(/\brent\s*[:\-]\s*\$\s?([\d,]{3,7})\b/i);
    if (m) out.price = m[1].replace(/,/g, '');
  } else {
    m = t.match(/(?:list price|price)\s*[:\-]?\s*\$?\s?([\d,]{4,10})/i);
    if (!m) m = t.match(/\$\s?([\d,]{4,10})(?!\s*\/\s*mo)/);
    if (m) out.price = m[1].replace(/,/g, '');
    m = t.match(/\$\s?([\d,]{3,7})\s*\/\s*mo/i) || t.match(/(?:est\.?\s*(?:payment|monthly)|monthly payment)\s*[:\-]?\s*\$?\s?([\d,]{3,7})/i);
    if (m) out.estMonthly = m[1].replace(/,/g, '');
  }

  m = t.match(/(\d+(?:\.\d+)?)\s*(?:bed(?:room)?s?|bd|br)\b/i);
  if (m) out.beds = m[1];

  m = t.match(/(\d+(?:\.\d+)?)\s*(?:bath(?:room)?s?|ba)\b/i);
  if (m) out.baths = m[1];

  m = t.match(/([\d,]{3,6})\s*(?:sq\.?\s?ft|sqft|square feet|square foot)/i);
  if (m) out.sqft = m[1].replace(/,/g, '');

  m = t.match(/([\d.,]+\s*acres?)\b/i) || t.match(/lot(?:\s*size)?\s*[:\-]?\s*([\d.,]+\s*(?:acres?|sq\.?\s?ft))/i);
  if (m) out.lotSize = m[1].trim();

  m = t.match(/(\d+)\s*(?:-|\s)?car\s*garage/i) || t.match(/garage\s*[:\-]?\s*(\d+)/i);
  if (m) out.garageSpaces = m[1];

  m = t.match(/(?:built\s*(?:in)?|year built)\s*[:\-]?\s*((?:19|20)\d{2})/i);
  if (m) out.yearBuilt = m[1];

  m = t.match(/(\d+)\s*days?\s*on\s*(?:market|zillow|site|realtor)/i);
  if (m) out.daysOnMarket = m[1];

  const propertyType = parseExplicitPropertyType(t);
  if (propertyType) out.propertyType = propertyType;

  if (isRental) {
    const availableOn = parseExplicitAvailability(t);
    if (availableOn) out.availableOn = availableOn; // "Available now" intentionally stays unknown.

    if (/\b(?:no pets|pets (?:are )?not allowed)\b/i.test(t)) out.petsAllowed = false;
    else if (/\b(?:pets allowed|pet[- ]friendly|dogs and cats (?:are )?allowed)\b/i.test(t)) out.petsAllowed = true;

    if (/\b(?:utilities (?:are )?not included|tenant (?:is responsible for|pays)(?: for)? (?:all )?utilities)\b/i.test(t)) out.utilitiesIncluded = false;
    else if (/\b(?:all )?utilities (?:are )?included\b/i.test(t) && !/\bsome utilities (?:are )?included\b/i.test(t)) out.utilitiesIncluded = true;

    if (/\b(?:no in-unit laundry|shared laundry only|laundry room in (?:the )?building[^.\n]*(?:no in-unit|no washer))\b/i.test(t)) out.inUnitLaundry = false;
    else if (/\b(?:in-unit laundry|washer\s*(?:\/|and)\s*dryer in (?:the )?unit|in-unit washer\s*(?:\/|and)\s*dryer)\b/i.test(t)) out.inUnitLaundry = true;
  }

  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const addrLine = lines.find((l) => /^\d+\s+\S+/.test(l) && l.length < 100);
  if (addrLine) out.address = addrLine;

  const urls = t.match(/https?:\/\/\S+/g) || [];
  const imgUrl = urls.find((u) => /\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i.test(u));
  const otherUrl = urls.find((u) => u !== imgUrl);
  if (imgUrl) out.photoUrl = imgUrl.replace(/[),.]+$/, '');
  if (otherUrl) out.listingUrl = otherUrl.replace(/[),.]+$/, '');

  return out;
}

/** Adapt explicit raw listing text facts to the shared import-domain contract. */
export function parseListingTextFindings(text, searchType = null) {
  return findingsFromFields(parseListingText(text, searchType), {
    sourceType: 'listing_prose',
    sourceProvider: 'user_paste',
    evidenceStrength: EVIDENCE_STRENGTH.EXPLICIT,
  });
}

/* -------------------------------- match scoring --------------------------------
 * MATCH 2.0 — "unknown is not failure."
 *
 * Every criterion the user selected (tier !== 'dontcare') is tracked as one of three
 * states: evaluated-and-satisfied, evaluated-and-missed, or not yet evaluated. The
 * percentage is computed only from evaluated criteria — unknowns are excluded from
 * both the numerator and denominator, never counted against the home. Must-Have
 * counts follow the same rule and are reported honestly (e.g. "2/3 met, 1 not
 * evaluated") rather than silently treating an unknown Must-Have as missing.
 *
 * A criterion is "evaluated" only when we have a real, non-inferred answer:
 *   - threshold/objective fields (budget, beds, baths, sqft, lot size): evaluated
 *     once both a target AND the home's actual value are known.
 *   - Home Layout / Home Condition / bedroom location: evaluated once the home has
 *     a non-empty value — an empty value can only mean "not indicated yet," since
 *     there's no way to affirmatively record "this home has no layout."
 *   - check-kind criteria (Garage, Basement, Fireplace, etc.): a genuine three-state
 *     model — Yes (`true`), No (`'no'`), or Unknown (absent, or historical `false`).
 *     See the note just above the check-kind branch below for why `false` and `'no'`
 *     are deliberately NOT the same value.
 *   - star-rating criteria: evaluated only when rated (> 0); an unrated criterion
 *     is excluded entirely, never scored as a 0.
 *
 * Garage is the one exception: `home.garageSpaces` is a separate, reliable numeric
 * field already populated by RentCast import or manual entry, so we use it directly
 * to evaluate the "Garage" criterion (a `garageSpaces` of "0" is a real, distinct,
 * known answer from an empty/unknown value) — this is exactly the "objective
 * auto-data should feed Match when reliable" case, with no extra question asked.
 * ---------------------------------------------------------------------------------- */

export function computeMatch(home, priorities, commuteEvaluation = null) {
  if (!priorities) return null;
  // See foldLegacyCheckAliases: a home fact recorded under a pre-taxonomy-unification
  // legacy label (e.g. 'features:Home Office') still counts once the search's own
  // priority has folded onto the canonical label — never silently forgotten.
  const checks = foldLegacyCheckAliases(home.checks, priorities.searchType);
  const all = []; // every priority the user actually selected, evaluated or not
  const push = (key, label, tier, evaluated, score, met, detail, objective) => {
    all.push({ key, label, tier, evaluated, score, met, detail, objective });
  };
  const notEvaluated = (key, label, tier, objective) => push(key, label, tier, false, null, null, 'Not evaluated yet', objective);

  const propertyTypes = priorities.preferredPropertyTypes;
  if (propertyTypes?.values?.length && propertyTypes.tier !== 'dontcare') {
    if (!home.propertyType) notEvaluated('preferredPropertyTypes', 'Preferred property type', propertyTypes.tier, true);
    else {
      const met = propertyTypes.values.includes(home.propertyType);
      push('preferredPropertyTypes', 'Preferred property type', propertyTypes.tier, true, met ? 1 : 0, met,
        met ? home.propertyType : `${home.propertyType} is not on your preferred list`, true);
    }
  }

  if (priorities.budget?.value && priorities.budget.tier !== 'dontcare') {
    const target = parseNum(priorities.budget.value);
    const price = parseNum(home.price);
    if (target && price !== null) {
      if (price <= target) push('budget', 'Within budget', priorities.budget.tier, true, 1, true, `$${(target - price).toLocaleString()} under budget`, true);
      else { const over = price - target; push('budget', 'Within budget', priorities.budget.tier, true, Math.max(0, 1 - over / target), false, `$${over.toLocaleString()} over budget`, true); }
    } else {
      notEvaluated('budget', 'Within budget', priorities.budget.tier, true);
    }
  }
  if (priorities.sqftTarget?.value && priorities.sqftTarget.tier !== 'dontcare') {
    const target = parseNum(priorities.sqftTarget.value);
    const actual = parseNum(home.sqft);
    if (target && actual !== null) {
      const met = actual >= target;
      push('sqft', 'Target square footage', priorities.sqftTarget.tier, true, met ? 1 : Math.max(0, actual / target), met, met ? `${(actual - target).toLocaleString()} sqft over target` : `${(target - actual).toLocaleString()} sqft under target`, true);
    } else {
      notEvaluated('sqft', 'Target square footage', priorities.sqftTarget.tier, true);
    }
  }
  if (priorities.lotSizeTarget?.value && priorities.lotSizeTarget.tier !== 'dontcare') {
    const target = parseNum(priorities.lotSizeTarget.value);
    const actual = parseNum(home.lotSize);
    if (target && actual !== null) {
      const met = actual >= target;
      push('lotSize', 'Lot size', priorities.lotSizeTarget.tier, true, met ? 1 : Math.max(0, actual / target), met, met ? `${actual} (wanted ${target}+)` : `${actual} below target ${target}`, true);
    } else {
      notEvaluated('lotSize', 'Lot size', priorities.lotSizeTarget.tier, true);
    }
  }
  if (priorities.bedsMin?.value && priorities.bedsMin.tier !== 'dontcare') {
    const min = parseNum(priorities.bedsMin.value);
    const actual = parseNum(home.beds);
    if (min && actual !== null) {
      const met = actual >= min;
      push('beds', 'Minimum bedrooms', priorities.bedsMin.tier, true, met ? 1 : actual / min, met, met ? `${actual} bed(s)` : `${actual} of ${min} desired beds`, true);
    } else {
      notEvaluated('beds', 'Minimum bedrooms', priorities.bedsMin.tier, true);
    }
  }
  if (priorities.bathsMin?.value && priorities.bathsMin.tier !== 'dontcare') {
    const min = parseNum(priorities.bathsMin.value);
    const actual = parseNum(home.baths);
    if (min && actual !== null) {
      const met = actual >= min;
      push('baths', 'Minimum bathrooms', priorities.bathsMin.tier, true, met ? 1 : actual / min, met, met ? `${actual} bath(s)` : `${actual} of ${min} desired baths`, true);
    } else {
      notEvaluated('baths', 'Minimum bathrooms', priorities.bathsMin.tier, true);
    }
  }

  MULTISELECT_CATEGORIES.forEach(({ key, title }) => {
    const pref = priorities[key];
    if (!pref || pref.tier === 'dontcare' || !pref.values?.length) return;
    const homeVals = home[key] || [];
    if (!homeVals.length) { notEvaluated(key, title, pref.tier, true); return; }
    const overlap = homeVals.filter((v) => pref.values.includes(v));
    push(key, title, pref.tier, true, overlap.length ? 1 : 0, overlap.length > 0, overlap.length ? overlap.join(', ') : 'No match on your list', true);
  });

  SINGLESELECT_CATEGORIES.forEach(({ key, title }) => {
    const pref = priorities[key];
    if (!pref || pref.tier === 'dontcare' || !pref.value) return;
    const actual = home[key];
    if (!actual) { notEvaluated(key, title, pref.tier, true); return; }
    const met = actual === pref.value;
    push(key, title, pref.tier, true, met ? 1 : 0, met, met ? pref.value : `${actual} (wanted ${pref.value})`, true);
  });

  getItemlistCategories(priorities.searchType).forEach((def) => {
    const { catState, core, custom } = splitCategoryItems(def, priorities);
    [...core, ...custom].forEach((item) => {
      if (isRetiredPurchaseBuiltIn(def.key, item, priorities.searchType)) return;
      const tier = effectiveTier(def.key, item.label, priorities, catState.tiers?.[item.label]);
      if (tier === 'dontcare') return;
      const ns = `${def.key}:${item.label}`;

      // Thresholded destinations replace the old subjective Commute rating with
      // exactly one objective criterion. The caller supplies runtime-only route
      // evaluation; missing/unavailable route data remains unknown.
      if (def.key === 'location' && item.label === 'Commute' && commuteEvaluation) {
        if (!commuteEvaluation.evaluated) notEvaluated(ns, item.label, tier, true);
        else push(ns, item.label, tier, true, commuteEvaluation.score, commuteEvaluation.met, commuteEvaluation.detail, true);
        return;
      }

      if (item.kind === 'rating' || isExperientialCriterion(def.key, item.label)) {
        const val = home.ratings?.[ns] || 0;
        if (isExperientialCriterion(def.key, item.label) && typeof val === 'string') {
          if (val === TOUR_RESPONSE.POSITIVE) push(ns, item.label, tier, true, 1, true, tourResponseLabel(def.key, item.label, val), false);
          else if (val === TOUR_RESPONSE.NEGATIVE) push(ns, item.label, tier, true, 0, false, tourResponseLabel(def.key, item.label, val), false);
          else if (val === TOUR_RESPONSE.NEUTRAL) push(ns, item.label, tier, true, null, null, tourResponseLabel(def.key, item.label, val), false);
          else notEvaluated(ns, item.label, tier, false);
        } else if (typeof val === 'number' && val > 0) {
          // Backward compatibility: historical 1–5 ratings keep their established score.
          push(ns, item.label, tier, true, val / 5, val >= 3, `${val}/5`, false);
        } else notEvaluated(ns, item.label, tier, false);
        return;
      }

      const sharedBooleanField = {
        'features:Pets Allowed': 'petsAllowed',
        'features:Utilities Included': 'utilitiesIncluded',
        'features:In-Unit Laundry': 'inUnitLaundry',
      }[ns];
      if (sharedBooleanField) {
        const actual = home[sharedBooleanField];
        if (actual === true) push(ns, item.label, tier, true, 1, true, 'Yes', true);
        else if (actual === false) push(ns, item.label, tier, true, 0, false, 'No', true);
        else notEvaluated(ns, item.label, tier, true);
        return;
      }

      // Garage: the priority weight lives only on this parent; Attached/Detached are
      // optional qualifiers, never separate weighted criteria (see CRITERION_QUALIFIERS).
      // "Any" (no qualifier, or both selected — semantically identical, see
      // isGarageQualifierAny) still uses the reliable numeric garageSpaces field
      // exactly as before. A specific qualifier needs its own reliably-recorded fact:
      // confirming ONE type is enough to rule out the other (a garage cannot be both),
      // but an unconfirmed type on a garage known to exist stays Unknown — it is never
      // inferred from "a garage exists" alone.
      if (def.key === 'exterior' && item.label === 'Garage') {
        const qualifiers = catState.qualifiers?.Garage;
        const spaces = parseNum(home.garageSpaces);
        const hasGarage = spaces === null ? null : spaces > 0;
        if (isGarageQualifierAny(qualifiers)) {
          if (hasGarage === null) notEvaluated(ns, item.label, tier, true);
          else push(ns, item.label, tier, true, hasGarage ? 1 : 0, hasGarage, hasGarage ? `${spaces}-car garage` : 'No garage', true);
          return;
        }
        const wanted = qualifiers[0];
        const other = wanted === 'attached' ? 'detached' : 'attached';
        const wantedRaw = checks[qualifierFactKey(def.key, item.label, wanted)];
        const otherRaw = checks[qualifierFactKey(def.key, item.label, other)];
        if (hasGarage === false) push(ns, item.label, tier, true, 0, false, 'No garage', true);
        else if (wantedRaw === true) push(ns, item.label, tier, true, 1, true, `Confirmed ${wanted}`, true);
        else if (wantedRaw === 'no' || otherRaw === true) push(ns, item.label, tier, true, 0, false, `Confirmed ${other}`, true);
        else notEvaluated(ns, item.label, tier, true);
        return;
      }

      // Fenced Yard: Privacy Fence is an optional qualifier of the same weighted
      // priority, not a second criterion. A reliable privacy-fence answer also implies
      // the base "has a fenced yard" fact (Privacy Fence inherently implies Fenced
      // Yard), since the base fact is otherwise fully manual (there is no objective
      // field like garageSpaces backing it).
      if (def.key === 'exterior' && item.label === 'Fenced yard') {
        const qualifiers = catState.qualifiers?.['Fenced yard'] || [];
        const baseRaw = checks[ns];
        const privacyRaw = checks[qualifierFactKey(def.key, item.label, 'privacy')];
        const effectiveBase = privacyRaw === true ? true : baseRaw;
        if (!qualifiers.includes('privacy')) {
          if (effectiveBase === true) push(ns, item.label, tier, true, 1, true, 'Yes', true);
          else if (effectiveBase === 'no') push(ns, item.label, tier, true, 0, false, 'No', true);
          else notEvaluated(ns, item.label, tier, true);
        } else if (effectiveBase === 'no') {
          push(ns, item.label, tier, true, 0, false, 'No fence', true);
        } else if (privacyRaw === true) {
          push(ns, item.label, tier, true, 1, true, 'Privacy fence confirmed', true);
        } else if (privacyRaw === 'no') {
          push(ns, item.label, tier, true, 0, false, 'Not a privacy fence', true);
        } else {
          notEvaluated(ns, item.label, tier, true);
        }
        return;
      }

      // First-Floor Bedroom: Primary and Guest are optional qualifiers of the same
      // weighted priority and, unlike Garage, may both be requested together — every
      // requested qualifier must have a reliably recorded fact before this criterion
      // scores at all (never partially guessed from an incomplete answer); the score
      // is the fraction of requested qualifiers confirmed present.
      if (def.key === 'features' && item.label === 'First-Floor Bedroom') {
        const qualifiers = catState.qualifiers?.['First-Floor Bedroom'] || [];
        if (!qualifiers.length) {
          const baseRaw = checks[ns];
          if (baseRaw === true) push(ns, item.label, tier, true, 1, true, 'Yes', true);
          else if (baseRaw === 'no') push(ns, item.label, tier, true, 0, false, 'No', true);
          else notEvaluated(ns, item.label, tier, true);
          return;
        }
        const results = qualifiers.map((qualifier) => checks[qualifierFactKey(def.key, item.label, qualifier)]);
        const allKnown = results.every((raw) => raw === true || raw === 'no');
        if (!allKnown) { notEvaluated(ns, item.label, tier, true); return; }
        const metCount = results.filter((raw) => raw === true).length;
        const score = metCount / qualifiers.length;
        const detail = qualifiers.map((qualifier, index) => `${qualifier}: ${results[index] === true ? 'yes' : 'no'}`).join(', ');
        push(ns, item.label, tier, true, score, score === 1, detail, true);
        return;
      }

      // Other check-kind criteria: three real states now. `true` continues to
      // mean Yes exactly as it always has (zero behavior change for existing
      // data). The string 'no' is the ONLY value that produces a confirmed
      // Missing — it can only ever be written by the new explicit Yes/No
      // control (see HomeModal's YesNoRow), never by historical data.
      // Historical boolean `false` (an artifact of the old blind-toggle chip,
      // which never let a user distinguish "confirmed absent" from "never
      // touched" — both rendered identically) is deliberately still treated
      // as Unknown here, preserving today's exact Match behavior for every
      // home that predates this UI. UNKNOWN MUST NOT PRODUCE MISSING.
      const raw = checks[ns];
      if (raw === true) { push(ns, item.label, tier, true, 1, true, 'Yes', true); return; }
      if (raw === 'no') { push(ns, item.label, tier, true, 0, false, 'No', true); return; }
      notEvaluated(ns, item.label, tier, true);
    });
  });

  if (!all.length) return null; // nothing selected at all — genuinely nothing to show

  const evaluated = all.filter((c) => c.evaluated);
  const selectedCount = all.length;
  const evaluatedCount = evaluated.length;

  // Neutral is deliberately evaluated but unscored in V1: it is displayed and no
  // longer counted Unknown, yet cannot be coerced into either a pass or a failure.
  const scorable = evaluated.filter((c) => typeof c.score === 'number');
  const totalWeight = scorable.reduce((s, c) => s + TIER_META[c.tier].weight, 0);
  const weightedSum = scorable.reduce((s, c) => s + c.score * TIER_META[c.tier].weight, 0);
  const pct = scorable.length > 0 && totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : null;

  const mustAll = all.filter((c) => c.tier === 'must');
  const mustEvaluated = mustAll.filter((c) => c.evaluated);

  const missing = evaluated.filter((c) => c.objective && c.met === false && (c.tier === 'must' || c.tier === 'important')).sort((a, b) => TIER_META[b.tier].weight - TIER_META[a.tier].weight);
  const satisfied = evaluated.filter((c) => c.objective && c.met === true && (c.tier === 'must' || c.tier === 'important')).sort((a, b) => TIER_META[b.tier].weight - TIER_META[a.tier].weight);

  return {
    pct,
    selectedCount,
    evaluatedCount,
    mustTotal: mustAll.length,
    mustEvaluated: mustEvaluated.length,
    mustMet: mustEvaluated.filter((c) => c.met).length,
    missing,
    satisfied,
    criteria: evaluated,
    // Every selected priority, evaluated or not — additive, for consumers (like
    // Compare) that need to show "Not evaluated yet" rows rather than only the
    // evaluated subset `criteria` exposes. Never a second scoring path — same `all`
    // array the percentage itself is derived from.
    allSelected: all,
  };
}

// Phase 3 Home Card summary: matches/missing/not-confirmed across ALL tiers
// (Must Have, Important, and Nice to Have), sorted by importance, for the
// dedicated card tradeoff display. Distinct from the existing `missing`/
// `satisfied` arrays on the Match result (deliberately restricted to must/
// important for the compact "fulfilled criteria" line elsewhere) — this
// reuses the exact same `allSelected` computation underneath; there is no
// second scoring path. UNKNOWN criteria always land in notConfirmed, never
// missing — this only ever reads computeMatch's own evaluated/met flags.
export function summarizeForCard(match) {
  if (!match) return { matches: [], missing: [], notConfirmed: [], preTourUnknown: [], afterTour: [] };
  const tierRank = { must: 0, important: 1, nice: 2, dontcare: 3 };
  const byTier = (a, b) => (tierRank[a.tier] ?? 3) - (tierRank[b.tier] ?? 3);
  const notConfirmed = match.allSelected.filter((c) => !c.evaluated).sort(byTier);
  const afterTour = notConfirmed.filter((criterion) => {
    const separator = criterion.key.indexOf(':');
    return separator > 0 && isExperientialCriterion(criterion.key.slice(0, separator), criterion.label);
  });
  const afterTourKeys = new Set(afterTour.map((criterion) => criterion.key));
  return {
    matches: match.allSelected.filter((c) => c.evaluated && c.met).sort(byTier),
    missing: match.allSelected.filter((c) => c.evaluated && c.met === false).sort(byTier),
    notConfirmed,
    preTourUnknown: notConfirmed.filter((criterion) => !afterTourKeys.has(criterion.key)),
    afterTour,
  };
}

// The Homes card derives both its bounded Must Have preview and its aggregate
// non-Must-Have coverage from the canonical Match result. No counts are stored.
export function selectHomeCardCriteria(match, mustLimit = 5) {
  if (!match) return { mustHaves: [], mustOverflow: 0, criteriaSummary: null };
  const source = match.allSelected || [];
  const indexed = source.map((criterion, order) => ({ criterion, order }));
  const stateRank = (criterion) => criterion.evaluated ? (criterion.met === false ? 0 : 2) : 1;
  // The compact preview is intentionally limited to concrete property features.
  // Baseline search constraints still live in `source` (and therefore in the
  // canonical score), but budget, size, property type, and similar parameters
  // should not displace feature choices in this small presentation surface.
  const isVisibleMustHave = (criterion) => {
    const category = criterion.key.split(':', 1)[0];
    return criterion.tier === 'must'
      && criterion.objective !== false
      && (category === 'features' || category === 'exterior');
  };
  const mustAll = indexed
    .filter(({ criterion }) => isVisibleMustHave(criterion))
    .sort((a, b) => stateRank(a.criterion) - stateRank(b.criterion) || a.order - b.order)
    .map(({ criterion }) => criterion);
  const mustPreviewLimit = Math.max(mustLimit, mustAll.filter((criterion) => criterion.evaluated && criterion.met === false).length);

  const tierRank = { must: 0, important: 1, nice: 2, dontcare: 3 };
  // Must Haves are already visible immediately above this summary. Excluding
  // them here keeps the coverage number from reading like a second Must Have
  // score, while every remaining item still comes directly from computeMatch's
  // canonical participant-owned `allSelected` result.
  const personalized = indexed
    .filter(({ criterion }) => criterion.tier !== 'must')
    .sort((a, b) => (tierRank[a.criterion.tier] ?? 3) - (tierRank[b.criterion.tier] ?? 3) || a.order - b.order)
    .map(({ criterion }) => criterion);

  const matches = personalized.filter((criterion) => criterion.evaluated && criterion.met === true);
  const mismatches = personalized.filter((criterion) => criterion.evaluated && criterion.met === false);
  const unknown = personalized.filter((criterion) => !criterion.evaluated);

  return {
    mustHaves: mustAll.slice(0, mustPreviewLimit),
    hiddenMustHaves: mustAll.slice(mustPreviewLimit),
    mustOverflow: Math.max(0, mustAll.length - mustPreviewLimit),
    criteriaSummary: {
      total: personalized.length,
      evaluated: matches.length + mismatches.length,
      matches,
      mismatches,
      unknown,
    },
  };
}

// Home Detail's concise hero summary — a deterministic sentence built only
// from computeMatch's own aggregate counts (mustTotal/mustEvaluated/mustMet,
// allSelected), never a qualitative/emotional claim like "Excellent fit for
// your family." A missing Must-Have is always reported, never smoothed over
// by a positive percentage; an unevaluated Must-Have is reported as unknown,
// never silently treated as met. No second scoring path — this only reads
// values computeMatch already produced.
export function matchFactualSummary(match) {
  if (!match || match.pct == null) return null;

  const mustMissing = match.mustEvaluated - match.mustMet;
  const mustUnknown = match.mustTotal - match.mustEvaluated;
  let mustClause = null;
  if (match.mustTotal > 0) {
    if (mustMissing > 0) mustClause = `${mustMissing} Must-Have${mustMissing > 1 ? 's' : ''} missing`;
    else if (mustUnknown > 0) mustClause = `${mustUnknown} Must-Have${mustUnknown > 1 ? 's' : ''} still unknown`;
    else mustClause = 'All Must-Haves met';
  }

  const important = match.allSelected.filter((c) => c.tier === 'important');
  const importantEvaluated = important.filter((c) => c.evaluated);
  const importantMet = importantEvaluated.filter((c) => c.met).length;
  const importantMissed = importantEvaluated.length - importantMet;
  let importantSentence = null;
  if (importantEvaluated.length > 0) {
    importantSentence = `${importantMet} of ${importantEvaluated.length} Important preference${importantEvaluated.length > 1 ? 's' : ''} match.`
      + (importantMissed > 0 ? ` ${importantMissed} doesn't match.` : '');
  }

  return { mustClause, importantSentence };
}

export function matchColor(pct) {
  if (pct === null || pct === undefined) return 'var(--ink-soft)';
  if (pct >= 80) return 'var(--moss)';
  if (pct >= 60) return 'var(--gold)';
  return 'var(--brick)';
}

export function matchTint(pct) {
  if (pct === null || pct === undefined) return 'rgba(156,143,128,0.12)';
  if (pct >= 80) return 'rgba(116,128,79,0.12)';
  if (pct >= 60) return 'rgba(198,146,69,0.14)';
  return 'rgba(193,89,47,0.12)';
}
