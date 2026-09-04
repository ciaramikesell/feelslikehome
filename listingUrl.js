// Extracts a *candidate* property address from a listing URL's path string only.
//
// Important: this never fetches the URL. It only pattern-matches the way each
// listing site already encodes a human-readable address into its own link
// (a courtesy those sites add for search-engine indexing). If a site's pattern
// isn't recognized, we return null and the caller falls back to asking the
// user for the address directly — we never guess by loading the page.
//
// The result is always meant to be shown to the user in an editable field
// before it's used for anything else, so "good enough to edit" beats "perfect."

const STREET_SUFFIXES = [
  'st', 'street', 'ave', 'avenue', 'rd', 'road', 'dr', 'drive', 'ln', 'lane',
  'ct', 'court', 'blvd', 'boulevard', 'way', 'pl', 'place', 'ter', 'terrace',
  'cir', 'circle', 'pkwy', 'parkway', 'hwy', 'highway', 'trl', 'trail',
  'sq', 'square', 'loop', 'run', 'path', 'pass', 'row', 'walk',
];

function toWords(segment) {
  return decodeURIComponent(segment || '')
    .replace(/\+/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(words) {
  return words.replace(/\S+/g, (w) => {
    if (/^\d/.test(w)) return w; // leave numbers as-is
    if (/^[A-Za-z]{2}$/.test(w) && w === w.toUpperCase()) return w; // already-uppercase 2-letter (state code)
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  });
}

// Splits a flat "123 Maple St Ann Arbor" blob into "123 Maple St, Ann Arbor" by
// finding the first recognized street-suffix word and inserting a comma after it.
// Best-effort only — this is why extraction confidence for flat-blob sources is 'low'.
function insertCityComma(words) {
  const tokens = words.split(' ');
  const suffixIdx = tokens.findIndex((t) => STREET_SUFFIXES.includes(t.toLowerCase()));
  if (suffixIdx === -1 || suffixIdx === tokens.length - 1) return words;
  const street = tokens.slice(0, suffixIdx + 1).join(' ');
  const rest = tokens.slice(suffixIdx + 1).join(' ');
  return `${street}, ${rest}`;
}

function splitZipAndState(words) {
  const zipMatch = words.match(/(\d{5})(?:-\d{4})?\s*$/);
  const zip = zipMatch ? zipMatch[1] : '';
  let withoutZip = zip ? words.slice(0, words.lastIndexOf(zipMatch[0])).trim() : words;
  const stateMatch = withoutZip.match(/\b([A-Za-z]{2})\s*$/);
  const state = stateMatch ? stateMatch[1].toUpperCase() : '';
  const withoutState = state ? withoutZip.slice(0, withoutZip.lastIndexOf(stateMatch[0])).trim() : withoutZip;
  return { rest: withoutState, state, zip };
}

function buildAddress({ streetCity, city, state, zip }) {
  const line1 = city ? `${titleCase(streetCity)}, ${titleCase(city)}` : titleCase(insertCityComma(streetCity));
  const tail = [state, zip].filter(Boolean).join(' ');
  return tail ? `${line1}, ${tail}` : line1;
}

// Redfin: /<STATE>/<City-Name>/<Street-Address>-<Zip>/home/<id>
// Structured: state and city are already their own path segments.
function parseRedfin(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  const [stateSeg, citySeg, streetZipSeg] = parts;
  if (!/^[A-Za-z]{2}$/.test(stateSeg)) return null;
  const streetZipWords = toWords(streetZipSeg);
  const zipMatch = streetZipWords.match(/(\d{5})\s*$/);
  const streetOnly = zipMatch ? streetZipWords.replace(/\d{5}\s*$/, '').trim() : streetZipWords;
  if (!/^\d/.test(streetOnly)) return null;
  return {
    address: buildAddress({
      streetCity: streetOnly,
      city: toWords(citySeg),
      state: stateSeg.toUpperCase(),
      zip: zipMatch ? zipMatch[1] : '',
    }),
    confidence: 'high',
    source: 'redfin',
  };
}

// Realtor.com: /realestateandhomes-detail/<Street>_<City>_<ST>_<Zip>_M<mlsid>
// Structured: underscore-delimited segments give a clean street/city/state/zip split.
function parseRealtor(pathname) {
  const m = pathname.match(/\/realestateandhomes-detail\/([^/]+)/);
  if (!m) return null;
  const segs = m[1].split('_');
  if (segs.length < 4) return null;
  const [streetSeg, citySeg, stateSeg, zipSeg] = segs;
  if (!/^\d/.test(streetSeg)) return null;
  const zip = (zipSeg.match(/\d{5}/) || [])[0] || '';
  return {
    address: buildAddress({ streetCity: toWords(streetSeg), city: toWords(citySeg), state: stateSeg.toUpperCase(), zip }),
    confidence: 'high',
    source: 'realtor.com',
  };
}

// Zillow: /homedetails/<flat-address-blob>/<zpid>_zpid/
// Homes.com: /property/<flat-address-blob>/<id>/
// Flat blob has no separator between street and city, so we heuristically split
// on the first street-suffix word (see insertCityComma) — lower confidence.
function parseFlatBlob(pathname, marker, source) {
  const re = new RegExp(`/${marker}/([^/]+)/`);
  const m = pathname.match(re);
  if (!m) return null;
  const words = toWords(m[1]);
  if (!/^\d/.test(words)) return null;
  const { rest, state, zip } = splitZipAndState(words);
  if (!rest) return null;
  return {
    address: buildAddress({ streetCity: rest, city: '', state, zip }),
    confidence: 'low',
    source,
  };
}

function parseGeneric(pathname) {
  // Last resort: look for any path segment that starts with a number and, once
  // de-dashed, contains a recognized street suffix — a loose signal this segment
  // is an address rather than a listing ID or category slug.
  const segs = pathname.split('/').filter(Boolean);
  for (const seg of segs) {
    const words = toWords(seg);
    if (!/^\d{1,6}\s/.test(words)) continue;
    const lower = words.toLowerCase();
    if (!STREET_SUFFIXES.some((s) => lower.includes(` ${s} `) || lower.endsWith(` ${s}`))) continue;
    const { rest, state, zip } = splitZipAndState(words);
    return {
      address: buildAddress({ streetCity: rest || words, city: '', state, zip }),
      confidence: 'low',
      source: 'generic',
    };
  }
  return null;
}

/**
 * Attempts to extract a candidate address from a listing URL string.
 * Never fetches the URL — pattern-matches the path only.
 *
 * @param {string} url
 * @returns {{ address: string, confidence: 'high'|'low', source: string } | null}
 */
export function extractAddressFromListingUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const pathname = parsed.pathname;

  try {
    if (host.includes('redfin.com')) return parseRedfin(pathname);
    if (host.includes('realtor.com')) return parseRealtor(pathname);
    if (host.includes('zillow.com')) return parseFlatBlob(pathname, 'homedetails', 'zillow');
    if (host.includes('homes.com')) return parseFlatBlob(pathname, 'property', 'homes.com');
    return parseGeneric(pathname);
  } catch {
    // Any unexpected shape from a site we don't fully recognize -> graceful fallback.
    return null;
  }
}
