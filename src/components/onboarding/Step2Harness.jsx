'use client';

import { useEffect, useMemo, useState } from 'react';
import Onboarding from '@/components/onboarding/Onboarding';
import { normalizePriorities } from '@/lib/constants';
import { applySearchChoice } from '@/lib/onboarding';
import { beginOnboarding } from '@/lib/onboardingFlow';
import { googleAreaSuggestions } from '@/lib/areaSearchProvider';
import { searchAreasOf } from '@/lib/searchAreas';
import { capturedGoogleErrors, describeError, installGoogleErrorCapture, interpret, runPlacesDiagnostics } from '@/lib/placesDiagnostics';

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

function DiagnosticsReport({ report }) {
  const cell = { padding: '6px 8px', borderTop: '1px solid var(--line)', verticalAlign: 'top', overflowWrap: 'anywhere' };
  const text = (detail) => (typeof detail === 'string' ? detail : [detail.name, detail.code && `code ${detail.code}`, detail.endpoint && `endpoint ${detail.endpoint}`, detail.message].filter(Boolean).join(' · '));
  return (
    <section data-qa="diagnostics" aria-label="Google diagnostics" style={{ maxWidth: 960, margin: '16px auto', padding: 16, background: '#fff', borderRadius: 8, font: '13px/1.45 var(--font-sans)', color: 'var(--ink)' }}>
      <h2 style={{ margin: '0 0 8px', font: '600 18px var(--font-serif)' }}>Google diagnostics — {report.host} · “{report.query}” · {report.at}</h2>
      <p style={{ margin: '0 0 8px' }}>The Maps script and Places library load even with a bad key; the Autocomplete rows are the real test.</p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr><td style={cell}>Key in this build</td><td style={cell}>{report.config.keyPresentInBuild ? `present${report.config.keyLooksLikeBrowserKey ? '' : ' (unexpected format)'}` : 'MISSING'}</td></tr>
          {report.stages.map((entry) => <tr key={entry.name}><td style={cell}>{entry.ok ? '✅' : '❌'} {entry.name}</td><td style={cell}>{text(entry.detail)}{!entry.ok && <><br /><strong>Likely cause ({interpret(entry.detail).where}):</strong> {interpret(entry.detail).cause}</>}</td></tr>)}
          {report.probes.map((probe) => (
            <tr key={probe.label}>
              <td style={cell}>{probe.ok ? '✅' : '❌'} Autocomplete: {probe.label}</td>
              <td style={cell}>{probe.ok ? `${probe.count} result(s)${probe.sample.length ? ` — ${probe.sample.map((item) => `${item.text} [${item.types.join(', ')}]`).join('; ')}` : ''}` : <>{text(probe.error)}<br /><strong>Likely cause ({interpret(probe.error).where}):</strong> {interpret(probe.error).cause}</>}</td>
            </tr>
          ))}
          <tr><td style={cell}>Google authorisation failure (gm_authFailure)</td><td style={cell}>{report.google.authFailure ? 'YES — Google rejected this key for this page' : 'not reported'}</td></tr>
          <tr><td style={cell}>Google console messages</td><td style={cell}>{report.google.console.length ? report.google.console.join(' | ') : 'none captured'}</td></tr>
        </tbody>
      </table>
    </section>
  );
}

export default function Step2Harness() {
  const [log, setLog] = useState([]);
  const [saved, setSaved] = useState({ priorities: null, places: [] });
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [round, setRound] = useState(0);
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosing, setDiagnosing] = useState(false);
  // Record Google's own key/referrer/API errors (redacted) from the first load.
  useEffect(() => { installGoogleErrorCapture(); }, []);
  const lastError = log[0]?.error ? log[0] : null;
  const diagnose = async () => {
    setDiagnosing(true);
    try { setDiagnostics(await runPlacesDiagnostics('grosse')); } finally { setDiagnosing(false); }
  };

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
          const detail = describeError(error);
          const google = capturedGoogleErrors();
          setLog((entries) => [{ at, query, error: [detail.name, detail.code && `code ${detail.code}`, detail.message].filter(Boolean).join(' · '), google }, ...entries].slice(0, 30));
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
        {' '}
        <button type="button" onClick={diagnose} disabled={diagnosing} style={{ marginLeft: 8 }}>{diagnosing ? 'Running…' : 'Run Google diagnostics'}</button>
        {lastError && (
          <p data-qa="last-error" role="alert" style={{ margin: '8px 0 0', padding: '8px 10px', borderRadius: 6, background: '#5A1F17', fontWeight: 500, overflowWrap: 'anywhere' }}>
            Last search failed (“{lastError.query}”): {lastError.error}
            <br />Likely cause ({interpret(lastError.error).where}): {interpret(lastError.error).cause}
            {lastError.google?.authFailure && ' · Google reported an authorisation failure for this key (gm_authFailure).'}
            {lastError.google?.console?.length > 0 && <><br />Google console: {lastError.google.console.join(' | ')}</>}
          </p>
        )}
      </div>
      {diagnostics && <DiagnosticsReport report={diagnostics} />}
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
