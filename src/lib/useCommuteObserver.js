'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Session-scoped only, by design — V1 does not persist route durations
// anywhere (see /api/commute's comments on why). A plain module-level Map is
// intentionally NOT React state: it needs to survive a card scrolling out of
// and back into view (a remount-safe cache within the page's lifetime),
// while still disappearing entirely on reload, matching "reload may
// recalculate, that's expected in V1."
const resultCache = new Map(); // cacheKey -> { minutes, status }
const inFlightKeys = new Set(); // cacheKeys currently being requested
let pendingBatch = null; // { homeIds: Set, destinationIds: Set, keyToPair: Map } | null
let batchTimer = null;
const batchListeners = new Set(); // callbacks to notify when a batch resolves

function locationIdentity(home) {
  return home.latitude != null && home.longitude != null
    ? `${home.latitude},${home.longitude}`
    : home.address || '';
}

function cacheKey(home, destination) {
  return `${home.id}:${locationIdentity(home)}:${destination.id}:${destination.address || ''}`;
}

async function flushBatch() {
  const batch = pendingBatch;
  pendingBatch = null;
  batchTimer = null;
  if (!batch || !batch.homeIds.size || !batch.destinationIds.size) return;

  const homeIds = Array.from(batch.homeIds);
  const destinationIds = Array.from(batch.destinationIds);

  try {
    const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
    const requests = [];
    chunks(homeIds, 20).forEach((homeChunk) => chunks(destinationIds, 5).forEach((destinationChunk) => {
      requests.push(fetch('/api/commute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeIds: homeChunk, destinationIds: destinationChunk }),
      }).then(async (res) => res.ok ? (await res.json()).results || {} : {}));
    }));
    const resultSets = await Promise.all(requests);
    const results = {};
    resultSets.forEach((set) => Object.entries(set).forEach(([homeId, byDestination]) => {
      results[homeId] = { ...(results[homeId] || {}), ...byDestination };
    }));
    // Write every requested pair into the cache, even on failure/omission —
    // an "unavailable" result is still cached for the session so a card
    // scrolling back into view doesn't refire the same failed pair.
    for (const [pairKey, meta] of batch.keyToPair.entries()) {
      const { home, destination } = meta;
      const homeResult = results[home.id]?.[destination.id];
      resultCache.set(pairKey, homeResult
        ? { minutes: homeResult.minutes ?? null, status: homeResult.status || 'unavailable' }
        : { minutes: null, status: 'unavailable' });
      inFlightKeys.delete(pairKey);
    }
  } catch (err) {
    console.error('Commute batch request failed', err);
    for (const pairKey of batch.keyToPair.keys()) {
      resultCache.set(pairKey, { minutes: null, status: 'unavailable' });
      inFlightKeys.delete(pairKey);
    }
  }

  batchListeners.forEach((fn) => fn());
}

function scheduleCalculation(home, destinations) {
  if (!destinations.length) return;
  if (!pendingBatch) {
    pendingBatch = { homeIds: new Set(), destinationIds: new Set(), keyToPair: new Map() };
  }
  let anyNew = false;
  destinations.forEach((destination) => {
    const key = cacheKey(home, destination);
    if (resultCache.has(key) || inFlightKeys.has(key)) return;
    inFlightKeys.add(key);
    pendingBatch.homeIds.add(home.id);
    pendingBatch.destinationIds.add(destination.id);
    pendingBatch.keyToPair.set(key, { home, destination });
    anyNew = true;
  });
  if (!anyNew) return;

  // Small debounce window so multiple cards entering the viewport in quick
  // succession (e.g. a fast scroll) collapse into one batched request
  // instead of one request per card.
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(flushBatch, 250);
}

// One IntersectionObserver-backed ref per home card. Fires scheduleCalculation
// at most once per (home, destination-set) per session — re-entering the
// viewport after the pair is already cached or in-flight is a no-op, since
// scheduleCalculation itself checks the cache/in-flight set before adding
// anything to a batch. The dependency array is built from stable primitive
// values (ids/addresses), never a freshly-created array/object reference, so
// this never becomes a rerender-triggered request loop.
export function useCommuteObserver(home, destinations) {
  const elRef = useRef(null);
  const [, forceUpdate] = useState(0);

  const destinationsKey = destinations.map((d) => `${d.id}:${d.address || ''}`).join('|');
  const stableDestinations = useMemo(
    () => destinations,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home.id, locationIdentity(home), destinationsKey]
  );

  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    batchListeners.add(listener);
    return () => batchListeners.delete(listener);
  }, []);

  const setRef = useCallback((node) => {
    elRef.current = node;
    if (!node || !stableDestinations.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          scheduleCalculation(home, stableDestinations);
        }
      });
    }, { rootMargin: '200px' }); // start slightly before the card is fully on-screen
    observer.observe(node);
    return () => observer.disconnect();
  }, [home, stableDestinations]);

  const getState = useCallback((destination) => {
    const key = cacheKey(home, destination);
    if (resultCache.has(key)) return resultCache.get(key);
    if (inFlightKeys.has(key)) return { minutes: null, status: 'loading' };
    return { minutes: null, status: 'idle' }; // not yet scrolled into view
  }, [home]);

  return { setRef, getState };
}
