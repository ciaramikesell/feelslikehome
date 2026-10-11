'use client';

import { loadGoogleMaps } from '@/lib/googleMaps';

// TEMPORARY: used only by the Step 2 Preview QA harness (remove with it; see
// docs/onboarding-step2-preview-qa.md). Pinpoints where Google Places area
// search fails — configuration, Maps script load / key authorisation, the
// Places library, or a specific Autocomplete request — without ever showing
// the API key.

const KEY_PATTERN = /AIza[0-9A-Za-z_-]{10,}/g;

export function redact(value) {
  return String(value ?? '')
    .replace(KEY_PATTERN, '[key redacted]')
    .replace(/([?&](?:key|token)=)[^&\s"')]+/gi, '$1[redacted]')
    .slice(0, 600);
}

export function describeError(error) {
  return {
    name: redact(error?.name || 'Error'),
    code: error?.code != null ? redact(error.code) : (error?.status != null ? redact(error.status) : null),
    endpoint: error?.endpoint != null ? redact(error.endpoint) : null,
    message: redact(error?.message || String(error || 'Unknown error')),
  };
}

// Known Google failures → where the fix belongs. Matched on Google's own
// message text; anything unrecognised is reported as-is.
const CAUSES = [
  [/missing|not set in this build|not configured/i, 'Vercel', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not available to this Preview build. Add it to the Preview environment in Vercel, then redeploy.'],
  [/referer|referrer/i, 'Google Cloud', 'The key\'s website restrictions don\'t allow this Preview hostname. Add the Preview host to the key\'s allowed websites.'],
  [/has not been used in project|is disabled|SERVICE_DISABLED|not enabled/i, 'Google Cloud', 'Places API (New) is not enabled in the Google Cloud project that owns this key.'],
  [/API_KEY_SERVICE_BLOCKED|not authorized to use this (API|service)|are blocked/i, 'Google Cloud', 'The key\'s API restrictions don\'t include Places API (New). Add it to the key\'s allowed APIs.'],
  [/API key not valid|API_KEY_INVALID|InvalidKey/i, 'Vercel or Google Cloud', 'Google does not recognise this key. The Preview build\'s key value is wrong, or the key was deleted or regenerated.'],
  [/billing/i, 'Google Cloud', 'Billing is not enabled on the key\'s Google Cloud project.'],
  [/RESOURCE_EXHAUSTED|quota|OVER_QUERY_LIMIT/i, 'Google Cloud', 'A quota or rate limit was reached.'],
  [/primary ?type|includedPrimaryTypes|Invalid.*type/i, 'Application code', 'Google rejected one of the requested place types (see which probe failed).'],
  [/Google Maps could not load|did not finish/i, 'Network or Google', 'The Maps script did not load (blocked network, content blocker, or a Google outage).'],
];

export function interpret(detail) {
  const text = typeof detail === 'string' ? detail : [detail?.name, detail?.code, detail?.message].filter(Boolean).join(' ');
  const match = CAUSES.find(([pattern]) => pattern.test(text));
  return match ? { where: match[1], cause: match[2] } : { where: 'Unknown', cause: 'Not a recognised Google error; see the message.' };
}

// Google reports key/referrer/API-activation problems for the Maps JavaScript
// API by calling window.gm_authFailure and writing to the console, not by
// rejecting a promise. Record both (redacted) for the harness.
const captured = { authFailure: false, console: [] };
let installed = false;
export function installGoogleErrorCapture() {
  if (installed || typeof window === 'undefined') return captured;
  installed = true;
  const previousAuth = window.gm_authFailure;
  window.gm_authFailure = () => {
    captured.authFailure = true;
    if (typeof previousAuth === 'function') previousAuth();
  };
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      const text = args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : typeof arg === 'string' ? arg : '')).join(' ');
      if (/google|maps|places|MapError|googleapis/i.test(text)) captured.console = [...captured.console, `${level}: ${redact(text)}`].slice(-12);
      original(...args);
    };
  }
  return captured;
}

export function capturedGoogleErrors() {
  return { authFailure: captured.authFailure, console: [...captured.console] };
}

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`${label} did not finish within ${ms / 1000}s`), { name: 'Timeout' })), ms)),
]);

// Each probe is one Autocomplete request: no type filter, each requested type
// on its own, then the exact combination Step 2 sends.
export const PROBES = [
  ['no type filter', null],
  ['locality', ['locality']],
  ['sublocality', ['sublocality']],
  ['neighborhood', ['neighborhood']],
  ['postal_code', ['postal_code']],
  ['school_district', ['school_district']],
  ['Step 2 combination', ['locality', 'sublocality', 'neighborhood', 'postal_code', 'school_district']],
  ['Step 2 without school_district', ['locality', 'sublocality', 'neighborhood', 'postal_code']],
];

export async function runPlacesDiagnostics(query = 'grosse') {
  installGoogleErrorCapture();
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const report = {
    at: new Date().toISOString(),
    host: window.location.host,
    query,
    config: {
      keyPresentInBuild: Boolean(key),
      keyLooksLikeBrowserKey: Boolean(key) && /^AIza/.test(key),
    },
    stages: [],
    probes: [],
  };
  const stage = (name, ok, detail) => report.stages.push({ name, ok, detail });

  if (!key) {
    stage('Configuration', false, 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set in this build, so the browser never contacts Google.');
    return { ...report, google: capturedGoogleErrors() };
  }
  stage('Configuration', true, 'A Maps key is present in this build (value not shown).');

  let maps;
  try {
    maps = await withTimeout(loadGoogleMaps(key), 12000, 'Loading the Maps JavaScript API');
    stage('Maps JavaScript API loaded', true, 'The Maps script loaded and called back.');
  } catch (error) {
    stage('Maps JavaScript API loaded', false, describeError(error));
    return { ...report, google: capturedGoogleErrors() };
  }

  let places;
  try {
    places = await withTimeout(maps.importLibrary('places'), 12000, 'Loading the Places library');
    stage('Places library', Boolean(places?.AutocompleteSuggestion), places?.AutocompleteSuggestion ? 'AutocompleteSuggestion is available.' : 'The Places library loaded without AutocompleteSuggestion.');
  } catch (error) {
    stage('Places library', false, describeError(error));
    return { ...report, google: capturedGoogleErrors() };
  }
  if (!places?.AutocompleteSuggestion) return { ...report, google: capturedGoogleErrors() };

  for (const [label, types] of PROBES) {
    const request = { input: query, includedRegionCodes: ['us'] };
    if (types) request.includedPrimaryTypes = types;
    try {
      const { suggestions = [] } = await withTimeout(places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request), 12000, `Autocomplete (${label})`);
      const predictions = suggestions.map((suggestion) => suggestion.placePrediction).filter(Boolean);
      report.probes.push({
        label,
        ok: true,
        count: predictions.length,
        sample: predictions.slice(0, 5).map((prediction) => ({ text: prediction.text?.text || '', types: [...(prediction.types || [])] })),
      });
    } catch (error) {
      report.probes.push({ label, ok: false, error: describeError(error) });
    }
  }
  report.authFailure = captured.authFailure;
  return { ...report, google: capturedGoogleErrors() };
}
