'use client';

import { useMemo, useState } from 'react';
import Onboarding from '@/components/onboarding/Onboarding';
import { normalizePriorities } from '@/lib/constants';
import { applySearchChoice } from '@/lib/onboarding';
import { beginOnboarding } from '@/lib/onboardingFlow';
import { googleAreaSuggestions } from '@/lib/areaSearchProvider';
import { searchAreasOf } from '@/lib/searchAreas';

// TEMPORARY Preview QA harness for Onboarding V2 Step 2 (see
// docs/onboarding-step2-preview-qa.md). The real <Onboarding> on the inactive
// six-step flow, with:
//   • LIVE Google Places for area search and place addresses (no fixtures);
//   • in-memory saves only — nothing reaches Supabase;
//   • a log of exactly what Google returned for each search, beside how the
//     step classified it, so provider data is never confused with fixtures.

const USER_ID = '00000000-0000-4000-8000-0000000000a1';
const SEARCH_ID = '00000000-0000-4000-8000-0000000000a2';

const fail = () => Promise.reject(new Error('Simulated provider failure (QA toggle)'));

export default function Step2Harness() {
  const [log, setLog] = useState([]);
  const [saved, setSaved] = useState({ priorities: null, places: [] });
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [round, setRound] = useState(0);

  const initial = useMemo(() => {
    const context = { searchId: SEARCH_ID, role: 'owner' };
    return {
      priorities: saved.priorities || applySearchChoice(normalizePriorities({}), 'home_buy'),
      progress: beginOnboarding({ storedState: { step: 'locations', completed: ['basics'], startedAt: '2026-01-01T00:00:00.000Z', context }, storedVersion: 3, targetVersion: 3, context }),
      places: saved.places,
    };
    // Re-created only when "Reload from saved" bumps the round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const services = useMemo(() => {
    let nextPlace = 1;
    return {
      savePriorities: (searchId, userId, priorities) => { setSaved((current) => ({ ...current, priorities })); return Promise.resolve(true); },
      saveProgress: () => Promise.resolve(true),
      completeOnboarding: () => Promise.resolve(true),
      setActiveSearch: () => Promise.resolve(true),
      submitFeedback: () => Promise.resolve(true),
      createPlace: (searchId, userId, place) => {
        const row = { id: `qa-place-${nextPlace++}`, label: place.label, address: place.address, maxDriveMinutes: null };
        setSaved((current) => ({ ...current, places: [...current.places, row] }));
        return Promise.resolve(row);
      },
      deletePlace: (id) => { setSaved((current) => ({ ...current, places: current.places.filter((place) => place.id !== id) })); return Promise.resolve(); },
      searchAreas: async (query) => {
        const at = new Date().toISOString().slice(11, 19);
        if (simulateFailure) {
          setLog((entries) => [{ at, query, error: 'Simulated provider failure (QA toggle)' }, ...entries].slice(0, 30));
          return fail();
        }
        try {
          const response = await googleAreaSuggestions(query);
          setLog((entries) => [{ at, query, ...response }, ...entries].slice(0, 30));
          return response;
        } catch (error) {
          setLog((entries) => [{ at, query, error: `${error?.name || 'Error'}: ${error?.message || 'unknown'}` }, ...entries].slice(0, 30));
          throw error;
        }
      },
    };
  }, [simulateFailure]);

  const shown = (entry) => new Map((entry.results || []).map((result) => [result.placeId, result.type]));
  return (
    <>
      <div role="note" style={{ padding: '10px 16px', background: '#2E2621', color: '#fff', font: '600 13px/1.4 var(--font-sans)' }}>
        Preview QA harness — Step 2 only. Area and address suggestions are <u>live Google Places</u>. Saves stay in this tab; nothing is written to the database.
        {' '}
        <label style={{ marginLeft: 8, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={simulateFailure} onChange={(event) => setSimulateFailure(event.target.checked)} /> Simulate provider failure
        </label>
        {' '}
        <button type="button" onClick={() => setRound((value) => value + 1)} style={{ marginLeft: 8 }}>Reload from saved</button>
      </div>
      <Onboarding
        key={round}
        userId={USER_ID}
        searchId={SEARCH_ID}
        initialPriorities={initial.priorities}
        initialProgress={initial.progress}
        initialPlaces={initial.places}
        mode="account"
        services={services}
      />
      <section aria-label="QA log" style={{ maxWidth: 960, margin: '24px auto 160px', padding: '0 16px', font: '13px/1.45 var(--font-sans)', color: 'var(--ink)' }}>
        <h2 style={{ font: '600 18px var(--font-serif)' }}>Saved in this tab (in memory)</h2>
        <pre data-qa="saved" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#fff', padding: 12, borderRadius: 8 }}>{JSON.stringify({ searchAreas: searchAreasOf(saved.priorities || {}), places: saved.places }, null, 2)}</pre>
        <h2 style={{ font: '600 18px var(--font-serif)' }}>Google Places responses (newest first)</h2>
        {log.length === 0 && <p>No searches yet.</p>}
        {log.map((entry, index) => (
          <div key={`${entry.at}-${index}`} data-qa="provider-entry" style={{ marginBottom: 12, padding: 12, background: '#fff', borderRadius: 8 }}>
            <strong>{entry.at} · “{entry.query}”</strong>
            {entry.error ? <p style={{ color: 'var(--negative)' }}>{entry.error}</p> : (
              <>
                <p>Requested types: {entry.requestedTypes?.join(', ')}{entry.schoolDistrictsRejection ? ` — school_district rejected by Google: ${entry.schoolDistrictsRejection}` : ''}</p>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th align="left">Google text</th><th align="left">Google types</th><th align="left">Shown as</th></tr></thead>
                  <tbody>
                    {entry.provider.length === 0 && <tr><td colSpan={3}>Google returned no predictions.</td></tr>}
                    {entry.provider.map((prediction) => (
                      <tr key={prediction.placeId} style={{ borderTop: '1px solid var(--line)' }}>
                        <td>{prediction.text}</td>
                        <td><code>{prediction.types.join(', ')}</code></td>
                        <td>{shown(entry).get(prediction.placeId) || 'not shown (unsupported type)'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
