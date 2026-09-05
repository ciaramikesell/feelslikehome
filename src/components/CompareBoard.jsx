'use client';

import { useState, useMemo, Fragment } from 'react';
import { Columns, Star, Heart, Home as HomeIcon } from 'lucide-react';
import { TOUR_RATING_KEY, criterionDisplayLabel } from '@/lib/constants';
import { parseNum, computeMatch, matchColor } from '@/lib/matching';
import { formatLotSizeDisplay, formatCurrencyDisplay, parseCommaList } from '@/lib/homeDisplay';

const MAX_COMPARE = 4;

// Compare's rows come from computeMatch's `allSelected`, whose `key` is either a plain
// field key (e.g. "budget") or a "categoryKey:label" pair for itemlist criteria (e.g.
// "exterior:Privacy"). Only the latter ever has a display-label override to apply.
function rowDisplayLabel(row) {
  const idx = row.key.indexOf(':');
  if (idx === -1) return row.label;
  return criterionDisplayLabel(row.key.slice(0, idx), row.label);
}

// Purely quantitative reference facts — kept separate from Match/Must-Haves/priorities,
// which use the qualitative satisfied/missed/unknown language instead. A quiet "—" for
// anything unavailable; never treated as a negative.
const HOME_FACT_ROWS = [
  { key: 'price', label: 'Price', betterHigh: false, get: (h) => parseNum(h.price), fmt: (v) => (v === null ? '—' : formatCurrencyDisplay(String(v))) },
  { key: 'estMonthly', label: 'Est. monthly payment', betterHigh: false, get: (h) => parseNum(h.estMonthly), fmt: (v) => (v === null ? '—' : formatCurrencyDisplay(String(v))) },
  { key: 'beds', label: 'Beds', betterHigh: true, get: (h) => parseNum(h.beds), fmt: (v) => (v === null ? '—' : v) },
  { key: 'baths', label: 'Baths', betterHigh: true, get: (h) => parseNum(h.baths), fmt: (v) => (v === null ? '—' : v) },
  { key: 'sqft', label: 'Sq ft', betterHigh: true, get: (h) => parseNum(h.sqft), fmt: (v) => (v === null ? '—' : v.toLocaleString()) },
  { key: 'pps', label: '$/sq ft', betterHigh: false, get: (h) => (parseNum(h.price) && parseNum(h.sqft) ? Math.round(parseNum(h.price) / parseNum(h.sqft)) : null), fmt: (v) => (v === null ? '—' : '$' + v) },
  { key: 'lot', label: 'Lot', betterHigh: null, get: (h) => h.lotSize || null, fmt: (v) => (v ? formatLotSizeDisplay(v) : '—') },
  { key: 'garage', label: 'Garage', betterHigh: true, get: (h) => parseNum(h.garageSpaces), fmt: (v) => (v === null ? '—' : v) },
  { key: 'year', label: 'Year built', betterHigh: null, get: (h) => h.yearBuilt || null, fmt: (v) => v || '—' },
  { key: 'dom', label: 'Days on market', betterHigh: false, get: (h) => parseNum(h.daysOnMarket), fmt: (v) => (v === null ? '—' : v) },
];

function bestIndex(values, betterHigh) {
  if (betterHigh === null || betterHigh === undefined) return -1;
  const nums = values.map((v) => (typeof v === 'number' ? v : null));
  if (nums.every((v) => v === null)) return -1;
  const best = betterHigh ? Math.max(...nums.filter((v) => v !== null)) : Math.min(...nums.filter((v) => v !== null));
  const winners = nums.filter((v) => v === best).length;
  if (winners !== 1) return -1; // no lone winner — don't highlight a tie
  return nums.indexOf(best);
}

function MiniStars({ value }) {
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={12} fill={n <= value ? '#C69245' : 'none'} color={n <= value ? '#C69245' : '#DED2C1'} strokeWidth={1.5} />
      ))}
    </span>
  );
}

// Renders one criterion's value using whichever representation actually fits it —
// never forcing every kind of fact into the same visual shape. `c` is one entry from
// computeMatch's `allSelected` (or null if this home never had this priority evaluated
// at all — kept for symmetry across homes in the grid).
function CriteriaValue({ c }) {
  if (!c || !c.evaluated) {
    return <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Not evaluated yet</span>;
  }
  if (!c.objective) {
    return <MiniStars value={Math.round((c.score || 0) * 5)} />;
  }
  return (
    <span style={{ fontSize: 12.5, color: c.met ? 'var(--moss)' : 'var(--brick)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontWeight: 700 }}>{c.met ? '✓' : '✕'}</span> {c.detail}
    </span>
  );
}

// A row's "signature" for Differences Only: two homes count as "the same" only if
// they're both unevaluated, or both evaluated with the same met/rating outcome.
function rowSignature(c) {
  if (!c || !c.evaluated) return 'unevaluated';
  if (!c.objective) return `r${Math.round((c.score || 0) * 5)}`;
  return c.met ? 'met' : 'missed';
}

function HomeHeaderCard({ home, match, isFavorite }) {
  const [imgError, setImgError] = useState(false);
  const showPhoto = home.photoUrl && !imgError;
  const overallRating = home.ratings?.[TOUR_RATING_KEY] || 0;
  const evaluatedNote = match && match.pct !== null && match.evaluatedCount < match.selectedCount;

  return (
    <div>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', borderRadius: 12, overflow: 'hidden', background: 'var(--line)', marginBottom: 8 }}>
        {showPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={home.photoUrl} alt="" onError={() => setImgError(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HomeIcon size={26} color="var(--ink-soft)" style={{ opacity: 0.5 }} />
          </div>
        )}
        {isFavorite && (
          <span style={{ position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Heart size={13} color="var(--brick)" fill="var(--brick)" />
          </span>
        )}
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{home.address || 'Untitled'}</div>
      <div className="hh-mono" style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
        {[home.price ? formatCurrencyDisplay(home.price) : null, home.beds ? `${home.beds} bd` : null, home.baths ? `${home.baths} ba` : null, home.sqft ? `${Number(home.sqft).toLocaleString()} sqft` : null]
          .filter(Boolean).join(' · ') || '—'}
      </div>

      {match ? (
        match.pct !== null ? (
          <div style={{ marginBottom: 4 }}>
            <span className="hh-mono" style={{ fontSize: 17, fontWeight: 700, color: matchColor(match.pct) }}>{match.pct}% Match</span>
            {evaluatedNote && (
              <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Based on {match.evaluatedCount} of {match.selectedCount} priorities evaluated</div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic', marginBottom: 4 }}>Not enough information yet</div>
        )
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic', marginBottom: 4 }}>Set priorities in My Search to see Match</div>
      )}

      {overallRating > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MiniStars value={overallRating} />
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Your rating</span>
        </div>
      )}
    </div>
  );
}

export default function CompareBoard({ homes, priorities }) {
  const [selectedIds, setSelectedIds] = useState(() => homes.slice(0, Math.min(2, homes.length)).map((h) => h.id));
  const [diffsOnly, setDiffsOnly] = useState(true);

  const toggle = (id) => setSelectedIds((prev) => {
    if (prev.includes(id)) return prev.filter((x) => x !== id);
    if (prev.length >= MAX_COMPARE) return prev;
    return [...prev, id];
  });

  const selected = useMemo(() => selectedIds.map((id) => homes.find((h) => h.id === id)).filter(Boolean), [selectedIds, homes]);
  const matches = useMemo(() => selected.map((h) => computeMatch(h, priorities)), [selected, priorities]);

  // One row per label the user selected as a priority, aligned across homes by label
  // (a priority either exists for every home's computeMatch result or none, since it's
  // driven by the same shared `priorities` object) — pulled from the same shared
  // Match 2.0 calculation, never a separate scoring path.
  const { mustRows, otherRows } = useMemo(() => {
    const byLabel = new Map(); // label -> { tier, perHome: [c|null, ...] }
    matches.forEach((m, i) => {
      (m?.allSelected || []).forEach((c) => {
        if (!byLabel.has(c.label)) byLabel.set(c.label, { key: c.key, tier: c.tier, perHome: new Array(selected.length).fill(null) });
        byLabel.get(c.label).perHome[i] = c;
      });
    });
    const rows = Array.from(byLabel.entries()).map(([label, r]) => ({ label, ...r }));
    const differs = (row) => new Set(row.perHome.map(rowSignature)).size > 1;
    const visible = diffsOnly ? rows.filter(differs) : rows;
    return {
      mustRows: visible.filter((r) => r.tier === 'must'),
      otherRows: visible.filter((r) => r.tier !== 'must'),
    };
  }, [matches, selected.length, diffsOnly]);

  if (homes.length < 2) {
    return (
      <div className="hh-corner" style={{ border: '1px dashed var(--line)', borderRadius: 16, padding: '36px 24px', textAlign: 'center', color: 'var(--ink-soft)' }}>
        <Columns size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
        <p style={{ fontSize: 13.5 }}>Compare becomes useful once you have at least two homes to weigh against each other.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <div className="hh-label" style={{ marginBottom: 8 }}>Choose homes to compare {selectedIds.length >= MAX_COMPARE && <span>(max {MAX_COMPARE})</span>}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {homes.map((h) => {
            const isSelected = selectedIds.includes(h.id);
            const disabled = !isSelected && selectedIds.length >= MAX_COMPARE;
            return (
              <span
                key={h.id}
                className={`hh-chip ${isSelected ? 'on' : ''}`}
                style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                onClick={() => !disabled && toggle(h.id)}
              >
                {h.address || 'Untitled'}
              </span>
            );
          })}
        </div>
      </div>

      {selected.length < 2 ? (
        <div className="hh-corner" style={{ border: '1px dashed var(--line)', borderRadius: 16, padding: '36px 24px', textAlign: 'center', color: 'var(--ink-soft)' }}>
          <Columns size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
          <p style={{ fontSize: 13.5 }}>Pick at least two homes above to compare them.</p>
        </div>
      ) : (
        <>
          {/* Identification + the big picture: Match and Overall Feeling */}
          <div className="hh-scrollx" style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${selected.length}, minmax(160px, 1fr))`, gap: 16, minWidth: selected.length * 160 }}>
              {selected.map((h, i) => (
                <HomeHeaderCard key={h.id} home={h} match={matches[i]} isFavorite={h.reaction === 'love'} />
              ))}
            </div>
          </div>

          {(mustRows.length > 0 || otherRows.length > 0) && (
            <div>
              <button
                type="button"
                className="hh-btn hh-btn-ghost"
                style={{ fontSize: 11.5, padding: '5px 10px' }}
                onClick={() => setDiffsOnly((v) => !v)}
              >
                {diffsOnly ? 'Showing differences only — show all' : 'Showing all — differences only'}
              </button>
            </div>
          )}

          {/* Must-Haves */}
          {mustRows.length > 0 && (
            <section>
              <h3 className="hh-serif" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: 'var(--ink)' }}>Must-Haves</h3>
              <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '0 0 10px' }}>✓ Satisfied · ✕ Confirmed miss · Not evaluated yet means we don't know yet — never a miss.</p>
              <div className="hh-scrollx" style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `200px repeat(${selected.length}, minmax(120px, 1fr))`, minWidth: 200 + selected.length * 120 }}>
                  <div />
                  {selected.map((h) => (
                    <div key={h.id} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', borderBottom: '1px solid var(--ink)' }}>{h.address || 'Untitled'}</div>
                  ))}
                  {mustRows.map((row) => (
                    <Fragment key={row.key}>
                      <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>{rowDisplayLabel(row)}</div>
                      {row.perHome.map((c, i) => (
                        <div key={row.key + '-' + i} style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>
                          <CriteriaValue c={c} />
                        </div>
                      ))}
                    </Fragment>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* What matters to you */}
          {otherRows.length > 0 && (
            <section>
              <h3 className="hh-serif" style={{ fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--ink)' }}>What matters to you</h3>
              <div className="hh-scrollx" style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `200px repeat(${selected.length}, minmax(120px, 1fr))`, minWidth: 200 + selected.length * 120 }}>
                  <div />
                  {selected.map((h) => (
                    <div key={h.id} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', borderBottom: '1px solid var(--ink)' }}>{h.address || 'Untitled'}</div>
                  ))}
                  {otherRows.map((row) => (
                    <Fragment key={row.key}>
                      <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>{rowDisplayLabel(row)}</div>
                      {row.perHome.map((c, i) => (
                        <div key={row.key + '-' + i} style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>
                          <CriteriaValue c={c} />
                        </div>
                      ))}
                    </Fragment>
                  ))}
                </div>
              </div>
            </section>
          )}

          {mustRows.length === 0 && otherRows.length === 0 && diffsOnly && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>These homes look the same on everything you've told us matters — toggle to "show all" to see the full picture.</p>
          )}

          {/* Deeper, optional sections */}
          <details className="hh-details">
            <summary>Home facts</summary>
            <div className="hh-scrollx" style={{ overflowX: 'auto', marginTop: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: `160px repeat(${selected.length}, minmax(100px, 1fr))`, minWidth: 160 + selected.length * 100 }}>
                <div />
                {selected.map((h) => (
                  <div key={h.id} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', borderBottom: '1px solid var(--ink)' }}>{h.address || 'Untitled'}</div>
                ))}
                {HOME_FACT_ROWS.map((row) => {
                  const values = selected.map((h) => row.get(h));
                  const winner = bestIndex(values, row.betterHigh);
                  return (
                    <Fragment key={row.key}>
                      <div style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>{row.label}</div>
                      {values.map((v, i) => (
                        <div key={row.key + '-' + i} className="hh-mono" style={{
                          padding: '8px 12px', fontSize: 12.5, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center',
                          color: i === winner ? 'var(--moss)' : 'var(--ink)', fontWeight: i === winner ? 700 : 500,
                        }}>
                          {row.fmt(v)}
                        </div>
                      ))}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          </details>

          <details className="hh-details">
            <summary>What stood out</summary>
            <div className="hh-compare-notes" style={{ marginTop: 10 }}>
              {selected.map((h) => {
                const liked = parseCommaList(h.pros);
                const disliked = parseCommaList(h.cons);
                return (
                  <div key={h.id} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14, background: 'var(--paper-raised)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>{h.address || 'Untitled'}</div>
                    {liked.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 6 }}><strong style={{ color: 'var(--moss)' }}>Liked: </strong>{liked.join(', ')}</div>
                    )}
                    {disliked.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--ink)' }}><strong style={{ color: 'var(--brick)' }}>Didn't like: </strong>{disliked.join(', ')}</div>
                    )}
                    {liked.length === 0 && disliked.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Nothing noted yet.</div>}
                  </div>
                );
              })}
            </div>
          </details>

          <details className="hh-details">
            <summary>Notes</summary>
            <div className="hh-compare-notes" style={{ marginTop: 10 }}>
              {selected.map((h) => (
                <div key={h.id} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14, background: 'var(--paper-raised)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>{h.address || 'Untitled'}</div>
                  <div style={{ fontSize: 12.5, color: h.notes ? 'var(--ink)' : 'var(--ink-soft)', fontStyle: h.notes ? 'normal' : 'italic', whiteSpace: 'pre-wrap' }}>{h.notes || 'Nothing noted yet.'}</div>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
