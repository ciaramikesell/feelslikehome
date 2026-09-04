'use client';

import { useState, useMemo, Fragment } from 'react';
import { Columns, Star } from 'lucide-react';
import { getItemlistCategories } from '@/lib/constants';
import { parseNum, fmtMoney, computeMatch, matchColor, splitCategoryItems } from '@/lib/matching';
import { formatLotSizeDisplay } from '@/lib/homeDisplay';

const MAX_COMPARE = 4;

const QUICK_FACT_ROWS = [
  { key: 'match', label: 'Match', betterHigh: true, get: (h, p) => computeMatch(h, p)?.pct, fmt: (v) => (v === undefined || v === null ? '—' : `${v}%`) },
  { key: 'price', label: 'Price', betterHigh: false, get: (h) => parseNum(h.price), fmt: (v) => (v === null ? '—' : '$' + v.toLocaleString()) },
  { key: 'estMonthly', label: 'Est. payment', betterHigh: false, get: (h) => parseNum(h.estMonthly), fmt: (v) => (v === null ? '—' : '$' + v.toLocaleString()) },
  { key: 'beds', label: 'Beds', betterHigh: true, get: (h) => parseNum(h.beds), fmt: (v) => (v === null ? '—' : v) },
  { key: 'baths', label: 'Baths', betterHigh: true, get: (h) => parseNum(h.baths), fmt: (v) => (v === null ? '—' : v) },
  { key: 'sqft', label: 'Sq ft', betterHigh: true, get: (h) => parseNum(h.sqft), fmt: (v) => (v === null ? '—' : v.toLocaleString()) },
  { key: 'pps', label: '$/sq ft', betterHigh: false, get: (h) => (parseNum(h.price) && parseNum(h.sqft) ? Math.round(parseNum(h.price) / parseNum(h.sqft)) : null), fmt: (v) => (v === null ? '—' : '$' + v) },
  { key: 'lot', label: 'Lot', betterHigh: null, get: (h) => h.lotSize || null, fmt: (v) => (v ? formatLotSizeDisplay(v) : '—') },
  { key: 'garage', label: 'Garage', betterHigh: true, get: (h) => parseNum(h.garageSpaces), fmt: (v) => (v === null ? '—' : v) },
  { key: 'year', label: 'Year', betterHigh: null, get: (h) => h.yearBuilt || null, fmt: (v) => v || '—' },
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

export default function CompareBoard({ homes, priorities }) {
  const [selectedIds, setSelectedIds] = useState(() => homes.slice(0, Math.min(2, homes.length)).map((h) => h.id));

  const toggle = (id) => setSelectedIds((prev) => {
    if (prev.includes(id)) return prev.filter((x) => x !== id);
    if (prev.length >= MAX_COMPARE) return prev;
    return [...prev, id];
  });

  const selected = useMemo(() => selectedIds.map((id) => homes.find((h) => h.id === id)).filter(Boolean), [selectedIds, homes]);

  const priorityRows = useMemo(() => {
    const rows = [];
    getItemlistCategories(priorities.searchType).forEach((def) => {
      const { catState, core, custom } = splitCategoryItems(def, priorities);
      [...core, ...custom].forEach((item) => {
        const tier = catState.tiers?.[item.label];
        if (!tier || tier === 'dontcare') return;
        rows.push({ ns: `${def.key}:${item.label}`, label: item.label, tier, kind: item.kind });
      });
    });
    return rows;
  }, [priorities]);

  if (homes.length === 0) {
    return <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', padding: '30px 0' }}>Add a few homes first, then come back here to see them side by side.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 className="hh-serif" style={{ fontSize: 20, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Compare your homes</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '5px 0 0' }}>See your top contenders side by side and how each one measures up to what matters to you.</p>
      </div>

      <div>
        <div className="hh-label" style={{ marginBottom: 8 }}>Choose 2–4 homes {selectedIds.length >= MAX_COMPARE && <span>(max {MAX_COMPARE})</span>}</div>
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
          {/* Quick Facts */}
          <section>
            <h3 className="hh-serif" style={{ fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--ink)' }}>Quick Facts</h3>
            <div className="hh-scrollx" style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(${selected.length}, minmax(110px, 1fr))`, minWidth: 140 + selected.length * 110 }}>
                <div />
                {selected.map((h) => (
                  <div key={h.id} style={{ padding: '10px 12px', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', borderBottom: '1px solid var(--ink)' }}>{h.address || 'Untitled'}</div>
                ))}
                {QUICK_FACT_ROWS.map((row) => {
                  const values = selected.map((h) => row.get(h, priorities));
                  const winner = bestIndex(values, row.betterHigh);
                  return (
                    <Fragment key={row.key}>
                      <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>{row.label}</div>
                      {values.map((v, i) => (
                        <div key={row.key + '-' + i} className="hh-mono" style={{
                          padding: '10px 12px', fontSize: 13.5, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center',
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
          </section>

          {/* Your priorities */}
          {priorityRows.length > 0 && (
            <section>
              <h3 className="hh-serif" style={{ fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--ink)' }}>What matters to you</h3>
              <div className="hh-scrollx" style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `200px repeat(${selected.length}, minmax(90px, 1fr))`, minWidth: 200 + selected.length * 90 }}>
                  <div />
                  {selected.map((h) => (
                    <div key={h.id} style={{ padding: '10px 12px', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', borderBottom: '1px solid var(--ink)' }}>{h.address || 'Untitled'}</div>
                  ))}
                  {priorityRows.map((row) => (
                    <Fragment key={row.ns}>
                      <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>
                        {row.label} <span style={{ marginLeft: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.02em', color: 'var(--ink-soft)' }}>· {row.tier === 'must' ? 'Must have' : row.tier === 'important' ? 'Important' : 'Nice to have'}</span>
                      </div>
                      {selected.map((h) => (
                        <div key={row.ns + '-' + h.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>
                          {row.kind === 'check'
                            ? (h.checks?.[row.ns] ? <span style={{ color: 'var(--moss)', fontWeight: 700 }}>✓</span> : <span style={{ color: 'var(--ink-soft)' }}>—</span>)
                            : <MiniStars value={h.ratings?.[row.ns] || 0} />}
                        </div>
                      ))}
                    </Fragment>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Pros / Cons / Notes */}
          <section>
            <h3 className="hh-serif" style={{ fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--ink)' }}>Pros, Cons &amp; Notes</h3>
            <div className="hh-compare-notes">
              {selected.map((h) => (
                <div key={h.id} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 16, background: 'var(--paper-raised)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{h.address || 'Untitled'}</div>
                  {h.pros && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}><strong style={{ color: 'var(--moss)' }}>+ </strong>{h.pros}</div>}
                  {h.cons && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}><strong style={{ color: 'var(--brick)' }}>− </strong>{h.cons}</div>}
                  {h.notes && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{h.notes}</div>}
                  {!h.pros && !h.cons && !h.notes && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Nothing noted yet.</div>}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
