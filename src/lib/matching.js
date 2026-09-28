import { TIER_META, MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, getItemlistCategories, effectiveTier, isExperientialCriterion, isRetiredPurchaseBuiltIn, foldLegacyCheckAliases, TOUR_RESPONSE, tourResponseLabel, criterionDisplayLabel } from './constants.js';
import { lotSizeAcres } from './homeDisplay.js';
import { PROPERTY_TYPE_LABELS } from './searchIntent.js';
import { normalizeSearchIntent } from './searchIntent.js';
import { EVIDENCE_STRENGTH, findingsFromFields } from './importDomain.js';

// A value with no digits at all ("Contact agent", "—", "N/A") is Unknown (null),
// never 0 — Number('') is 0, which would silently turn an unknown price into
// "$0" and an unknown fact into a met or missed comparison.
export function parseNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const cleaned = String(v).replace(/[^0-9.]/g, '');
  if (!/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
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

  // Search Basics (budget, beds, baths, square footage, lot size, home type,
  // layout, condition, bedroom locations) define the search; they are not
  // weighted Match criteria. See evaluateSearchBasics for their factual,
  // unweighted comparison. Match is built only from ranked priorities.

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

      // Garage: a reliable numeric field already exists (garageSpaces), so use it
      // directly instead of the separate manual checkbox — see comment above.
      if (def.key === 'exterior' && item.label === 'Garage') {
        const spaces = parseNum(home.garageSpaces);
        if (spaces !== null) {
          const met = spaces > 0;
          push(ns, item.label, tier, true, met ? 1 : 0, met, met ? `${spaces}-car garage` : 'No garage', true);
        } else {
          notEvaluated(ns, item.label, tier, true);
        }
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

// Search Basics are the search's factual definition, not Match criteria. This
// compares a home's known facts with each Basic the participant has filled in —
// tier is ignored entirely, and nothing here feeds a score. A fact the home
// doesn't establish yet is Unknown (evaluated: false), never a miss.
const NO_PREFERENCE = 'No Preference';
const hasValue = (value) => String(value ?? '').trim() !== '';
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function evaluateSearchBasics(home, rawPriorities) {
  if (!home || !rawPriorities) return [];
  const p = rawPriorities;
  const out = [];
  const add = (key, label, wanted, evaluated, met, detail) => out.push({ key, label, wanted, evaluated, met: evaluated ? met : null, detail });

  const budget = parseNum(p.budget?.value);
  if (budget) {
    const price = parseNum(home.price);
    const wanted = `$${budget.toLocaleString()} max`;
    if (price === null) add('budget', 'Budget', wanted, false, null, 'Price unknown');
    else add('budget', 'Budget', wanted, true, price <= budget, price <= budget ? `$${(budget - price).toLocaleString()} under your budget` : `$${(price - budget).toLocaleString()} over your budget`);
  }
  const minimum = (key, label, target, actual, unit, units) => {
    if (!target) return;
    const wanted = `${target.toLocaleString()}+ ${units}`;
    if (actual === null) add(key, label, wanted, false, null, `${label} unknown`);
    else add(key, label, wanted, true, actual >= target, plural(actual, unit, units));
  };
  minimum('beds', 'Bedrooms', parseNum(p.bedsMin?.value), parseNum(home.beds), 'bed', 'beds');
  minimum('baths', 'Bathrooms', parseNum(p.bathsMin?.value), parseNum(home.baths), 'bath', 'baths');
  minimum('sqft', 'Square footage', parseNum(p.sqftTarget?.value), parseNum(home.sqft), 'sq ft', 'sq ft');

  const lotTarget = parseNum(p.lotSizeTarget?.value);
  if (lotTarget) {
    const acres = lotSizeAcres(home.lotSize);
    const wanted = `${lotTarget}+ acres`;
    if (acres === null) add('lotSize', 'Lot size', wanted, false, null, 'Lot size unknown');
    else add('lotSize', 'Lot size', wanted, true, acres >= lotTarget, `${acres.toFixed(2)} acres`);
  }

  const types = (p.preferredPropertyTypes?.values || []).filter((value) => value && value !== NO_PREFERENCE);
  if (types.length) {
    const wanted = types.map((value) => PROPERTY_TYPE_LABELS[value] || value).join(' · ');
    if (!home.propertyType) add('preferredPropertyTypes', 'Home type', wanted, false, null, 'Home type unknown');
    else add('preferredPropertyTypes', 'Home type', wanted, true, types.includes(home.propertyType), PROPERTY_TYPE_LABELS[home.propertyType] || home.propertyType);
  }

  MULTISELECT_CATEGORIES.forEach(({ key, title }) => {
    const wantedValues = (p[key]?.values || []).filter((value) => value && value !== NO_PREFERENCE);
    if (!wantedValues.length) return;
    const homeValues = home[key] || [];
    if (!homeValues.length) { add(key, title, wantedValues.join(' · '), false, null, `${title} unknown`); return; }
    const overlap = homeValues.filter((value) => wantedValues.includes(value));
    add(key, title, wantedValues.join(' · '), true, overlap.length > 0, homeValues.join(' · '));
  });

  SINGLESELECT_CATEGORIES.forEach(({ key, title }) => {
    const wanted = p[key]?.value;
    if (!hasValue(wanted) || wanted === NO_PREFERENCE) return;
    if (!hasValue(home[key])) { add(key, title, wanted, false, null, `${title} unknown`); return; }
    add(key, title, wanted, true, home[key] === wanted, home[key]);
  });

  return out;
}

// Every ranked (weighted) priority, counted once from computeMatch's own
// allSelected — Must Haves included — so an aggregate can never claim that
// everything matches while a Must Have beside it reads as missing.
export function weightedPrioritySummary(match) {
  const all = match?.allSelected || [];
  const matches = all.filter((criterion) => criterion.evaluated && criterion.met === true);
  const mismatches = all.filter((criterion) => criterion.evaluated && criterion.met === false);
  const neutral = all.filter((criterion) => criterion.evaluated && criterion.met === null);
  const unknown = all.filter((criterion) => !criterion.evaluated);
  return { total: all.length, evaluated: matches.length + mismatches.length + neutral.length, matches, mismatches, neutral, unknown };
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
  // Every Must Have is eligible for the preview, whatever its category (location,
  // features, exterior, a custom priority, a baseline like budget, or an
  // after-tour criterion) — the same set mustHaveStatus, Home Detail, and the
  // "No Must-Haves missing" filter read. Space is handled by the bounded preview
  // plus explicit overflow below, never by excluding a category.
  const isVisibleMustHave = (criterion) => criterion.tier === 'must';
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
  // A neutral tour response is evaluated but deliberately neither a match nor a
  // miss (see computeMatch). It is reported as its own group, never folded into
  // either count, so total = evaluated + unknown + neutral.
  const neutral = personalized.filter((criterion) => criterion.evaluated && criterion.met === null);

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
      neutral,
    },
  };
}

// The name a participant sees for a criterion on every surface (card, Home
// Detail, Compare): the display label for a category criterion, the evaluated
// label otherwise (e.g. "Within budget").
export function criterionLabel(criterion) {
  const separator = criterion?.key?.indexOf(':') ?? -1;
  return separator > 0 ? criterionDisplayLabel(criterion.key.slice(0, separator), criterion.label) : criterion?.label;
}

// The one canonical reading of a home's Must Haves, shared by My Homes' "No
// Must-Haves missing" filter, Home Detail's Match panel, and matchFactualSummary.
// Only a CONFIRMED miss (evaluated, met === false) is missing. Unknown is not
// failure, and a neutral tour response is evaluated but neither met nor missed.
export function mustHaveStatus(match) {
  const all = (match?.allSelected || []).filter((criterion) => criterion.tier === 'must');
  return {
    all,
    total: all.length,
    met: all.filter((criterion) => criterion.evaluated && criterion.met === true).length,
    missed: all.filter((criterion) => criterion.evaluated && criterion.met === false).length,
    neutral: all.filter((criterion) => criterion.evaluated && criterion.met === null).length,
    unknown: all.filter((criterion) => !criterion.evaluated).length,
  };
}

export function hasNoMustHaveMisses(match) {
  return mustHaveStatus(match).missed === 0;
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

  // Confirmed misses only (see mustHaveStatus): a neutral tour response is
  // evaluated but is not a miss, so it must never be reported as "missing".
  const { missed: mustMissing, unknown: mustUnknown } = mustHaveStatus(match);
  let mustClause = null;
  if (match.mustTotal > 0) {
    if (mustMissing > 0) mustClause = `${mustMissing} Must-Have${mustMissing > 1 ? 's' : ''} missing`;
    else if (mustUnknown > 0) mustClause = `${mustUnknown} Must-Have${mustUnknown > 1 ? 's' : ''} still unknown`;
    else mustClause = 'All Must-Haves met';
  }

  const important = match.allSelected.filter((c) => c.tier === 'important');
  const importantEvaluated = important.filter((c) => c.evaluated);
  const importantMet = importantEvaluated.filter((c) => c.met).length;
  const importantMissed = importantEvaluated.filter((c) => c.met === false).length;
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
