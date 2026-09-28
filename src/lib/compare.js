// Pure helpers behind Compare's "At a glance" overview. Everything is derived
// from real home data and the canonical computeMatch results the caller passes
// in — Compare never scores anything itself.

import { mustHaveStatus, parseNum } from './matching.js';

// Index of the single best known value, or -1. Unknown (null/undefined) values
// never win, lose, or count; a tie, or fewer than two known values, marks nothing.
export function uniqueBest(values, better) {
  const known = values.map((value, index) => ({ value, index })).filter(({ value }) => value !== null && value !== undefined);
  if (known.length < 2) return -1;
  const best = known.reduce((a, b) => (better(b.value, a.value) ? b : a));
  return known.filter(({ value }) => value === best.value).length === 1 ? best.index : -1;
}

export function compareGlance(homes, matches) {
  const prices = homes.map((home) => parseNum(home.price));
  const pcts = matches.map((match) => match?.pct ?? null);
  const musts = matches.map((match) => mustHaveStatus(match));
  const hasMust = musts.some((must) => must.total > 0);
  return {
    prices,
    bestPrice: uniqueBest(prices, (a, b) => a < b),
    pcts,
    bestMatch: uniqueBest(pcts, (a, b) => a > b),
    musts,
    hasMust,
    // Most Must Haves confirmed met, among homes with no confirmed miss. Unknown
    // Must Haves neither help nor hurt.
    bestMust: hasMust ? uniqueBest(musts.map((must) => (must.missed === 0 ? must.met : null)), (a, b) => a > b) : -1,
  };
}

export function mustGlanceText(must) {
  return `${must.met} of ${must.total}${must.missed ? ` · ${must.missed} missing` : ''}${must.unknown ? ` · ${must.unknown} unknown` : ''}`;
}
