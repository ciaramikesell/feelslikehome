import { TIER_META, ITEMLIST_CATEGORIES, MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES } from './constants';

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

// The ordered set of a category's items that are NOT set to "Don't care" — what actually shows on the home form.
export function visibleOrderedItems(def, priorities) {
  const { catState, core, custom } = splitCategoryItems(def, priorities);
  const ordered = applyOrder([...core, ...custom], catState.order || []);
  return ordered.filter((item) => (catState.tiers?.[item.label] || 'dontcare') !== 'dontcare');
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

/* -------------------------------- match scoring -------------------------------- */

export function computeMatch(home, priorities) {
  if (!priorities) return null;
  const criteria = [];
  const push = (key, label, tier, score, met, detail) => {
    if (!tier || tier === 'dontcare' || score === null) return;
    criteria.push({ key, label, tier, score, met, detail });
  };

  if (priorities.budget?.value) {
    const target = parseNum(priorities.budget.value);
    const price = parseNum(home.price);
    if (target && price !== null) {
      if (price <= target) push('budget', 'Within budget', priorities.budget.tier, 1, true, `$${(target - price).toLocaleString()} under budget`);
      else { const over = price - target; push('budget', 'Within budget', priorities.budget.tier, Math.max(0, 1 - over / target), false, `$${over.toLocaleString()} over budget`); }
    }
  }
  if (priorities.sqftTarget?.value) {
    const target = parseNum(priorities.sqftTarget.value);
    const actual = parseNum(home.sqft);
    if (target && actual !== null) {
      const met = actual >= target;
      push('sqft', 'Target square footage', priorities.sqftTarget.tier, met ? 1 : Math.max(0, actual / target), met, met ? `${(actual - target).toLocaleString()} sqft over target` : `${(target - actual).toLocaleString()} sqft under target`);
    }
  }
  if (priorities.lotSizeTarget?.value) {
    const target = parseNum(priorities.lotSizeTarget.value);
    const actual = parseNum(home.lotSize);
    if (target && actual !== null) {
      const met = actual >= target;
      push('lotSize', 'Lot size', priorities.lotSizeTarget.tier, met ? 1 : Math.max(0, actual / target), met, met ? `${actual} (wanted ${target}+)` : `${actual} below target ${target}`);
    }
  }
  if (priorities.bedsMin?.value) {
    const min = parseNum(priorities.bedsMin.value);
    const actual = parseNum(home.beds);
    if (min && actual !== null) { const met = actual >= min; push('beds', 'Minimum bedrooms', priorities.bedsMin.tier, met ? 1 : actual / min, met, met ? `${actual} bed(s)` : `${actual} of ${min} desired beds`); }
  }
  if (priorities.bathsMin?.value) {
    const min = parseNum(priorities.bathsMin.value);
    const actual = parseNum(home.baths);
    if (min && actual !== null) { const met = actual >= min; push('baths', 'Minimum bathrooms', priorities.bathsMin.tier, met ? 1 : actual / min, met, met ? `${actual} bath(s)` : `${actual} of ${min} desired baths`); }
  }

  MULTISELECT_CATEGORIES.forEach(({ key, title }) => {
    const pref = priorities[key];
    if (!pref || pref.tier === 'dontcare' || !pref.values?.length) return;
    const homeVals = home[key] || [];
    const overlap = homeVals.filter((v) => pref.values.includes(v));
    push(key, title, pref.tier, overlap.length ? 1 : 0, overlap.length > 0, overlap.length ? overlap.join(', ') : 'No match on your list');
  });

  SINGLESELECT_CATEGORIES.forEach(({ key, title }) => {
    const pref = priorities[key];
    if (!pref || pref.tier === 'dontcare' || !pref.value) return;
    const actual = home[key];
    const met = !!actual && actual === pref.value;
    push(key, title, pref.tier, met ? 1 : 0, met, met ? pref.value : (actual ? `${actual} (wanted ${pref.value})` : 'Not set'));
  });

  ITEMLIST_CATEGORIES.forEach((def) => {
    const { catState, core, custom } = splitCategoryItems(def, priorities);
    [...core, ...custom].forEach((item) => {
      const tier = catState.tiers?.[item.label];
      if (!tier || tier === 'dontcare') return;
      const ns = `${def.key}:${item.label}`;
      if (item.kind === 'rating') {
        const val = home.ratings?.[ns] || 0;
        if (val > 0) push(ns, item.label, tier, val / 5, val >= 3, `${val}/5`);
      } else if (item.kind === 'check') {
        const met = !!home.checks?.[ns];
        push(ns, item.label, tier, met ? 1 : 0, met, met ? 'Present' : 'Missing');
      }
    });
  });

  if (!criteria.length) return null;

  const totalWeight = criteria.reduce((s, c) => s + TIER_META[c.tier].weight, 0);
  const weightedSum = criteria.reduce((s, c) => s + c.score * TIER_META[c.tier].weight, 0);
  const pct = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : null;
  const musts = criteria.filter((c) => c.tier === 'must');
  const mustMet = musts.filter((c) => c.met).length;
  const missing = criteria.filter((c) => c.met === false && (c.tier === 'must' || c.tier === 'important')).sort((a, b) => TIER_META[b.tier].weight - TIER_META[a.tier].weight);
  const satisfied = criteria.filter((c) => c.met === true && (c.tier === 'must' || c.tier === 'important')).sort((a, b) => TIER_META[b.tier].weight - TIER_META[a.tier].weight);

  return { pct, mustTotal: musts.length, mustMet, missing, satisfied, criteria };
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
