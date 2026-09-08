'use client';

import { DEFAULT_SELECTED_TIER } from '@/lib/constants';

// Phase 6 — Schools relevance gate. The three conceptual states:
//   - schoolsRelevance === 'yes'  -> Schools is an active decision criterion.
//   - schoolsRelevance === 'no'   -> explicitly suppressed (see
//     isSchoolsSuppressed/effectiveTier in constants.js/matching.js — this
//     NEVER touches the underlying stored tier or note, only how Match/
//     display treat Schools while suppressed).
//   - absent (every search created before this gate existed) -> "not
//     answered yet." Existing behavior is preserved exactly; this component
//     renders as neither Yes nor No selected until the user actively picks
//     one, and does nothing to their existing Schools priority in the
//     meantime.
export default function SchoolsRelevanceGate({ priorities, patch }) {
  const relevance = priorities.location?.schoolsRelevance; // 'yes' | 'no' | undefined
  const note = priorities.location?.notes?.Schools || '';

  const setRelevance = (value) => patch((n) => {
    n.location = { ...n.location, schoolsRelevance: value };
    // Only auto-select Schools on a genuinely first-time "yes" — if a real
    // tier already exists (including one restored from before an earlier
    // "no"), it's left completely untouched.
    if (value === 'yes') {
      const currentTier = n.location.tiers?.Schools;
      if (!currentTier || currentTier === 'dontcare') {
        n.location = { ...n.location, tiers: { ...n.location.tiers, Schools: DEFAULT_SELECTED_TIER } };
      }
    }
    return n;
  });

  const setNote = (value) => patch((n) => {
    n.location = { ...n.location, notes: { ...n.location?.notes, Schools: value } };
    return n;
  });

  return (
    <div>
      <div className="hh-label" style={{ marginBottom: 6 }}>Will schools factor into your decision?</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="hh-chip"
          onClick={() => setRelevance('yes')}
          style={relevance === 'yes' ? { background: 'var(--moss)', borderColor: 'var(--moss)', color: '#fff' } : undefined}
        >
          Yes
        </button>
        <button
          type="button"
          className="hh-chip"
          onClick={() => setRelevance('no')}
          style={relevance === 'no' ? { background: 'var(--brick)', borderColor: 'var(--brick)', color: '#fff' } : undefined}
        >
          No
        </button>
      </div>

      {relevance === 'yes' && (
        <div style={{ marginTop: 10 }}>
          <label className="hh-label" style={{ marginBottom: 4 }}>What matters to you about schools?</label>
          <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '0 0 6px' }}>
            District, a specific school, ratings, or anything else that matters to you. Optional.
          </p>
          <input
            className="hh-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Grosse Pointe South; ideally Defer Elementary; elementary rating 8+"
            style={{ width: '100%' }}
          />
        </div>
      )}
    </div>
  );
}
