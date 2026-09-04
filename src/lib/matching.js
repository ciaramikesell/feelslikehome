import { TIER_META, MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, getItemlistCategories } from './constants';

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
  const custom = catState.customItems || [];
  const customLabels = new Set(custom.map((i) => i.label));
  const restorable = def.coreItems.filter((i) => hidden.has(i.label) && !customLabels.has(i.label));
  const suggestions = [...def.suggestedItems.filter((i) => !customLabels.has(i.label) && !hidden.has(i.label)), ...restorable];
  return { catState, core, suggestions, custom };
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
  return ordered.filter((item) => (catState.tiers?.[item.label] || 'dontcare') !== 'dontcare');
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
    selectedOrderedItems(def, priorities).some((item) => item.kind === 'rating')
  );
}

// The flat, ordered list of the user's selected subjective (star-rating) criteria
// across every category — this is exactly what the post-tour "How did it feel?"
// flow asks about, since these are the ones that can't be reliably judged pre-tour.
export function selectedSubjectiveCriteria(priorities) {
  if (!priorities) return [];
  return getItemlistCategories(priorities.searchType).flatMap((def) =>
    selectedOrderedItems(def, priorities)
      .filter((item) => item.kind === 'rating')
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

export function parseListingText(text) {
  const t = text || '';
  const out = {};

  let m = t.match(/(?:list price|price)\s*[:\-]?\s*\$?\s?([\d,]{4,10})/i);
  if (!m) m = t.match(/\$\s?([\d,]{4,10})(?!\s*\/\s*mo)/);
  if (m) out.price = m[1].replace(/,/g, '');

  m = t.match(/\$\s?([\d,]{3,7})\s*\/\s*mo/i) || t.match(/(?:est\.?\s*(?:payment|monthly)|monthly payment)\s*[:\-]?\s*\$?\s?([\d,]{3,7})/i);
  if (m) out.estMonthly = m[1].replace(/,/g, '');

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

/* -------------------------------- match scoring --------------------------------
 * Only criteria the user has actually selected (tier !== 'dontcare') ever affect the
 * score — unselected criteria are worth zero weight and never appear in the summary.
 *
 * Every criterion is tagged "objective" (a plain yes/no or numeric threshold — beds,
 * budget, a feature checkbox) or not (a 1-5 star rating). The "Must-haves X/Y" count
 * and the Missing/Satisfied callouts only ever include objective criteria, since a
 * missing objective must-have is a clean pass/fail, but a 3-star rating on a subjective
 * must-have isn't a "failure" — it still pulls the score down proportionally to how
 * important it was marked, without being flagged as a binary miss.
 * ---------------------------------------------------------------------------------- */

export function computeMatch(home, priorities) {
  if (!priorities) return null;
  const criteria = [];
  const push = (key, label, tier, score, met, detail, objective) => {
    if (!tier || tier === 'dontcare' || score === null) return;
    criteria.push({ key, label, tier, score, met, detail, objective });
  };

  if (priorities.budget?.value) {
    const target = parseNum(priorities.budget.value);
    const price = parseNum(home.price);
    if (target && price !== null) {
      if (price <= target) push('budget', 'Within budget', priorities.budget.tier, 1, true, `$${(target - price).toLocaleString()} under budget`, true);
      else { const over = price - target; push('budget', 'Within budget', priorities.budget.tier, Math.max(0, 1 - over / target), false, `$${over.toLocaleString()} over budget`, true); }
    }
  }
  if (priorities.sqftTarget?.value) {
    const target = parseNum(priorities.sqftTarget.value);
    const actual = parseNum(home.sqft);
    if (target && actual !== null) {
      const met = actual >= target;
      push('sqft', 'Target square footage', priorities.sqftTarget.tier, met ? 1 : Math.max(0, actual / target), met, met ? `${(actual - target).toLocaleString()} sqft over target` : `${(target - actual).toLocaleString()} sqft under target`, true);
    }
  }
  if (priorities.lotSizeTarget?.value) {
    const target = parseNum(priorities.lotSizeTarget.value);
    const actual = parseNum(home.lotSize);
    if (target && actual !== null) {
      const met = actual >= target;
      push('lotSize', 'Lot size', priorities.lotSizeTarget.tier, met ? 1 : Math.max(0, actual / target), met, met ? `${actual} (wanted ${target}+)` : `${actual} below target ${target}`, true);
    }
  }
  if (priorities.bedsMin?.value) {
    const min = parseNum(priorities.bedsMin.value);
    const actual = parseNum(home.beds);
    if (min && actual !== null) { const met = actual >= min; push('beds', 'Minimum bedrooms', priorities.bedsMin.tier, met ? 1 : actual / min, met, met ? `${actual} bed(s)` : `${actual} of ${min} desired beds`, true); }
  }
  if (priorities.bathsMin?.value) {
    const min = parseNum(priorities.bathsMin.value);
    const actual = parseNum(home.baths);
    if (min && actual !== null) { const met = actual >= min; push('baths', 'Minimum bathrooms', priorities.bathsMin.tier, met ? 1 : actual / min, met, met ? `${actual} bath(s)` : `${actual} of ${min} desired baths`, true); }
  }

  MULTISELECT_CATEGORIES.forEach(({ key, title }) => {
    const pref = priorities[key];
    if (!pref || pref.tier === 'dontcare' || !pref.values?.length) return;
    const homeVals = home[key] || [];
    const overlap = homeVals.filter((v) => pref.values.includes(v));
    push(key, title, pref.tier, overlap.length ? 1 : 0, overlap.length > 0, overlap.length ? overlap.join(', ') : 'No match on your list', true);
  });

  SINGLESELECT_CATEGORIES.forEach(({ key, title }) => {
    const pref = priorities[key];
    if (!pref || pref.tier === 'dontcare' || !pref.value) return;
    const actual = home[key];
    const met = !!actual && actual === pref.value;
    push(key, title, pref.tier, met ? 1 : 0, met, met ? pref.value : (actual ? `${actual} (wanted ${pref.value})` : 'Not set'), true);
  });

  getItemlistCategories(priorities.searchType).forEach((def) => {
    const { catState, core, custom } = splitCategoryItems(def, priorities);
    [...core, ...custom].forEach((item) => {
      const tier = catState.tiers?.[item.label];
      if (!tier || tier === 'dontcare') return;
      const ns = `${def.key}:${item.label}`;
      if (item.kind === 'rating') {
        const val = home.ratings?.[ns] || 0;
        if (val > 0) push(ns, item.label, tier, val / 5, val >= 3, `${val}/5`, false);
      } else if (item.kind === 'check') {
        const met = !!home.checks?.[ns];
        push(ns, item.label, tier, met ? 1 : 0, met, met ? 'Present' : 'Missing', true);
      }
    });
  });

  if (!criteria.length) return null;

  const totalWeight = criteria.reduce((s, c) => s + TIER_META[c.tier].weight, 0);
  const weightedSum = criteria.reduce((s, c) => s + c.score * TIER_META[c.tier].weight, 0);
  const pct = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : null;

  const objectiveMusts = criteria.filter((c) => c.tier === 'must' && c.objective);
  const mustMet = objectiveMusts.filter((c) => c.met).length;
  const missing = criteria.filter((c) => c.objective && c.met === false && (c.tier === 'must' || c.tier === 'important')).sort((a, b) => TIER_META[b.tier].weight - TIER_META[a.tier].weight);
  const satisfied = criteria.filter((c) => c.objective && c.met === true && (c.tier === 'must' || c.tier === 'important')).sort((a, b) => TIER_META[b.tier].weight - TIER_META[a.tier].weight);

  return { pct, mustTotal: objectiveMusts.length, mustMet, missing, satisfied, criteria };
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
