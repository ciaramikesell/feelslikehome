'use client';

import { useState, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { Columns, Star, Heart, Home as HomeIcon } from 'lucide-react';
import { TOUR_RATING_KEY, criterionDisplayLabel } from '@/lib/constants';
import { parseNum, computeMatch, matchColor } from '@/lib/matching';
import { homeIdentity, homeVocabulary } from '@/lib/homePresentation';
import { formatDateOnly, formatHomePrice, formatLotSizeDisplay, formatPropertyType, formatTriState, parseCommaList } from '@/lib/homeDisplay';
import { searchIntentCapabilities } from '@/lib/searchIntent';
import { useCommuteMatrix } from '@/lib/useCommuteObserver';
import { commuteResultSignature, evaluateCommute, uniqueShortestIndex } from '@/lib/commute';

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
const PHYSICAL_FACT_ROWS = [
  { key: 'beds', label: 'Beds', betterHigh: true, get: (h) => parseNum(h.beds), fmt: (v) => (v === null ? '—' : v) },
  { key: 'baths', label: 'Baths', betterHigh: true, get: (h) => parseNum(h.baths), fmt: (v) => (v === null ? '—' : v) },
  { key: 'sqft', label: 'Sq ft', betterHigh: true, get: (h) => parseNum(h.sqft), fmt: (v) => (v === null ? '—' : v.toLocaleString()) },
  { key: 'lot', label: 'Lot', betterHigh: null, get: (h) => h.lotSize || null, fmt: (v) => (v ? formatLotSizeDisplay(v) : '—') },
  { key: 'garage', label: 'Garage', betterHigh: true, get: (h) => parseNum(h.garageSpaces), fmt: (v) => (v === null ? '—' : v) },
  { key: 'year', label: 'Year built', betterHigh: null, get: (h) => h.yearBuilt || null, fmt: (v) => v || '—' },
  { key: 'dom', label: 'Days on market', betterHigh: false, get: (h) => parseNum(h.daysOnMarket), fmt: (v) => (v === null ? '—' : v) },
];

function homeFactRows(searchType) {
  const { showsRentalFacts } = searchIntentCapabilities(searchType);
  const price = { key: 'price', label: showsRentalFacts ? 'Monthly Rent' : 'Price', betterHigh: false, get: (h) => parseNum(h.price), fmt: (v) => (v === null ? '—' : formatHomePrice(String(v), searchType)) };
  if (showsRentalFacts) return [price, ...PHYSICAL_FACT_ROWS,
    { key: 'propertyType', label: 'Property Type', betterHigh: null, get: (h) => h.propertyType || null, fmt: formatPropertyType },
    { key: 'availableOn', label: 'Available On', betterHigh: null, get: (h) => h.availableOn || null, fmt: formatDateOnly },
    { key: 'petsAllowed', label: 'Pets Allowed', betterHigh: null, get: (h) => h.petsAllowed, fmt: formatTriState },
    { key: 'utilitiesIncluded', label: 'Utilities Included', betterHigh: null, get: (h) => h.utilitiesIncluded, fmt: formatTriState },
    { key: 'inUnitLaundry', label: 'In-Unit Laundry', betterHigh: null, get: (h) => h.inUnitLaundry, fmt: formatTriState },
  ];
  return [price,
  { key: 'estMonthly', label: 'Est. monthly payment', betterHigh: false, get: (h) => parseNum(h.estMonthly), fmt: (v) => (v === null ? '—' : formatHomePrice(String(v), searchType)) },
  ...PHYSICAL_FACT_ROWS,
  { key: 'pps', label: '$/sq ft', betterHigh: false, get: (h) => (parseNum(h.price) && parseNum(h.sqft) ? Math.round(parseNum(h.price) / parseNum(h.sqft)) : null), fmt: (v) => (v === null ? '—' : '$' + v) },
  { key: 'hoa', label: 'HOA', betterHigh: false, get: (h) => (typeof h.hoaFeeMonthly === 'number' ? h.hoaFeeMonthly : null), fmt: (v) => (v === null ? '—' : `$${v.toLocaleString()}/mo`) },
  { key: 'tax', label: 'Property tax', betterHigh: false, get: (h) => (typeof h.propertyTaxAnnual === 'number' ? h.propertyTaxAnnual : null), fmt: (v, h) => (v === null ? '—' : `$${v.toLocaleString()}/yr${h?.propertyTaxYear ? ` · ${h.propertyTaxYear}` : ''}`) },
  ];
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
    return <span className="hh-criteria-value is-unknown"><b aria-hidden="true">?</b><span>Not evaluated</span></span>;
  }
  // Subjective/experiential criteria are captured in Post-Tour as Liked/Didn't Like,
  // not a star scale — showing stars here would be a stale artifact of a UI that no
  // longer exists. c.met is already exactly "value >= 3" from the shared Match
  // calculation, so a historical fine-grained star rating (e.g. an old 4/5) still
  // displays correctly as "Liked" through this same threshold, with nothing rewritten.
  const text = c.objective ? c.detail : (c.met ? 'Liked' : "Didn't like");
  return <span className={`hh-criteria-value ${c.met ? 'is-met' : 'is-missed'}`}>
    <b aria-hidden="true">{c.met ? '✓' : '—'}</b><span>{text}</span>
  </span>;
}

// A row's "signature" for Differences Only: two homes count as "the same" only if
// they're both unevaluated, or both evaluated with the same met/rating outcome.
function rowSignature(c) {
  if (!c || !c.evaluated) return 'unevaluated';
  if (!c.objective) return `r${Math.round((c.score || 0) * 5)}`;
  return c.met ? 'met' : 'missed';
}

function MatchSummary({ match, emptyCopy }) {
  if (!match) return <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>{emptyCopy}</div>;
  if (match.pct === null) return <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Not enough information yet</div>;
  return (
    <div>
      <span className="hh-mono" style={{ fontSize: 17, fontWeight: 700, color: matchColor(match.pct) }}>{match.pct}% Match</span>
      {match.evaluatedCount < match.selectedCount && (
        <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Based on {match.evaluatedCount} of {match.selectedCount} priorities evaluated</div>
      )}
    </div>
  );
}

function Perspective({ label, match, feeling, emptyCopy }) {
  return (
    <div className="hh-compare-perspective">
      <div className="hh-compare-perspective-label">{label} perspective</div>
      <MatchSummary match={match} emptyCopy={emptyCopy} />
      {feeling > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
          <MiniStars value={feeling} />
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Overall feeling</span>
        </div>
      ) : <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontStyle: 'italic', marginTop: 5 }}>No overall feeling yet</div>}
    </div>
  );
}

function CollaboratorState({ state }) {
  if (!state) return null;
  const choices = [state.isFavorite ? 'Favorite' : null, state.status === 'Want to Tour' ? 'Want to Tour' : null, state.status === 'Archived' ? 'Archived' : null, state.reaction || null].filter(Boolean);
  return choices.length ? <div className="hh-collaborator-state">{choices.join(' · ')}</div> : null;
}

function HomeHeaderCard({ home, match, isFavorite, coBuyerPerspective, searchType, priorities }) {
  const [imgError, setImgError] = useState(false);
  const showPhoto = home.photoUrl && !imgError;
  const overallRating = home.ratings?.[TOUR_RATING_KEY] || 0;

  return (
    <article className="hh-compare-home">
      <div className="hh-compare-photo">
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

      <div className="hh-mono hh-compare-price">{formatHomePrice(home.price, searchType) || 'Price not added'}</div>
      <Link href={`/homes/${encodeURIComponent(home.id)}`} className="hh-address hh-compare-address hh-home-identity-link">{homeIdentity(home, priorities).primary}</Link>{homeIdentity(home, priorities).option && <div className="hh-compare-option">{homeIdentity(home, priorities).option}</div>}{homeIdentity(home, priorities).supporting && <div className="hh-compare-supporting">{homeIdentity(home, priorities).supporting}</div>}
      <div className="hh-mono hh-compare-facts">
        {[home.beds ? `${home.beds} bd` : null, home.baths ? `${home.baths} ba` : null, home.sqft ? `${Number(home.sqft).toLocaleString()} sqft` : null]
          .filter(Boolean).join(' · ') || '—'}
      </div>

      {coBuyerPerspective ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Perspective label="You" match={match} feeling={overallRating} emptyCopy="Set priorities in My Search to see Match" />
          <Perspective label="Collaborator" match={coBuyerPerspective.match} feeling={coBuyerPerspective.overallFeeling} emptyCopy="Your collaborator hasn't set relevant priorities yet" />
          <CollaboratorState state={coBuyerPerspective.state} />
        </div>
      ) : match ? (
        match.pct !== null ? (
          <div style={{ marginBottom: 4 }}>
            <span className="hh-mono" style={{ fontSize: 17, fontWeight: 700, color: matchColor(match.pct) }}>{match.pct}% Match</span>
            {match.evaluatedCount < match.selectedCount && (
              <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Based on {match.evaluatedCount} of {match.selectedCount} priorities evaluated</div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic', marginBottom: 4 }}>Not enough information yet</div>
        )
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic', marginBottom: 4 }}>Set priorities in My Search to see Match</div>
      )}

      {!coBuyerPerspective && overallRating > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MiniStars value={overallRating} />
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Your overall feeling</span>
        </div>
      )}
    </article>
  );
}

function CommuteValue({ result, destination, emphasized }) {
  const known = result?.status === 'ok' && Number.isFinite(result.minutes);
  const overBy = known && destination.maxDriveMinutes != null
    ? result.minutes - destination.maxDriveMinutes : 0;
  const text = known ? `${result.minutes} min`
    : (!result || result.status === 'idle' || result.status === 'loading') ? 'Calculating…' : 'Not available';
  return (
    <div className="hh-commute-value" style={{ color: emphasized ? 'var(--moss)' : 'var(--ink)', fontWeight: emphasized ? 700 : 500 }}>
      <div className="hh-mono">{text}</div>
      {overBy > 0 && <div style={{ color: 'var(--brick)', fontSize: 11, fontWeight: 600, marginTop: 2 }}>Over by {overBy} min</div>}
    </div>
  );
}

function CommuteSection({ homes, destinations, diffsOnly, getResult, priorities }) {
  const rows = destinations.map((destination) => {
    const results = homes.map((home) => getResult(home, destination));
    return { destination, results, shortest: uniqueShortestIndex(results) };
  }).filter(({ results }) => !diffsOnly || new Set(results.map(commuteResultSignature)).size > 1);

  if (!rows.length) return null;
  return (
    <section className="hh-commute-section">
      <h3 className="hh-serif" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: 'var(--ink)' }}>Commute</h3>
      <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '0 0 10px' }}>Your drive times from each home.</p>
      <div className="hh-commute-desktop hh-scrollx">
        <div style={{ display: 'grid', gridTemplateColumns: `200px repeat(${homes.length}, minmax(120px, 1fr))`, minWidth: 200 + homes.length * 120 }}>
          <div />
          {homes.map((home) => <div key={home.id} className="hh-commute-heading">{homeIdentity(home, priorities).primary}</div>)}
          {rows.map(({ destination, results, shortest }) => (
            <Fragment key={destination.id}>
              <div className="hh-commute-label"><strong>{destination.label}</strong>{destination.maxDriveMinutes != null && <span>{destination.maxDriveMinutes} min max</span>}</div>
              {results.map((result, index) => <CommuteValue key={homes[index].id} result={result} destination={destination} emphasized={index === shortest} />)}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="hh-commute-mobile">
        {rows.map(({ destination, results, shortest }) => (
          <div key={destination.id} className="hh-commute-mobile-group">
            <div className="hh-commute-label"><strong>{destination.label}</strong>{destination.maxDriveMinutes != null && <span>{destination.maxDriveMinutes} min max</span>}</div>
            {homes.map((home, index) => <div key={home.id} className="hh-commute-mobile-row"><span>{homeIdentity(home, priorities).primary}</span><CommuteValue result={results[index]} destination={destination} emphasized={index === shortest} /></div>)}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function CompareBoard({ homes, priorities, coBuyerPerspectives = {}, commuteDestinations = [] }) {
  const [selectedIds, setSelectedIds] = useState(() => homes.slice(0, Math.min(2, homes.length)).map((h) => h.id));
  const [diffsOnly, setDiffsOnly] = useState(true);
  const vocabulary = homeVocabulary(priorities);

  const toggle = (id) => setSelectedIds((prev) => {
    if (prev.includes(id)) return prev.filter((x) => x !== id);
    if (prev.length >= MAX_COMPARE) return prev;
    return [...prev, id];
  });

  const selected = useMemo(() => selectedIds.map((id) => homes.find((h) => h.id === id)).filter(Boolean), [selectedIds, homes]);
  const getCommuteResult = useCommuteMatrix(selected, commuteDestinations);
  const matches = selected.map((home) => computeMatch(
    home,
    priorities,
    evaluateCommute(commuteDestinations, (destination) => getCommuteResult(home, destination))
  ));
  const factRows = homeFactRows(priorities.searchType).filter((row) => {
    if (!diffsOnly) return true;
    const values = selected.map((home) => row.get(home));
    return new Set(values.map((value) => value == null ? 'unknown' : String(value))).size > 1;
  });

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
        <p className="hh-serif" style={{ fontSize: 18, color: 'var(--ink)', margin: '0 0 5px' }}>The showdown starts here.</p>
        <p style={{ fontSize: 13.5 }}>{vocabulary.apartment ? 'Pick 2–4 properties and see how they stack up.' : 'Pick 2–4 homes and see how they stack up.'}</p>
        <Link className="hh-btn" href="/homes?add=1">{homes.length === 0 ? (vocabulary.apartment ? 'Add a property' : 'Add a home') : (vocabulary.apartment ? 'Add another property' : 'Add another home')}</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <div className="hh-label" style={{ marginBottom: 8 }}>Choose {vocabulary.pluralLower} to compare {selectedIds.length >= MAX_COMPARE && <span>(max {MAX_COMPARE})</span>}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {homes.map((h) => {
            const isSelected = selectedIds.includes(h.id);
            const disabled = !isSelected && selectedIds.length >= MAX_COMPARE;
            return (
              <button type="button"
                key={h.id}
                className={`hh-chip ${isSelected ? 'on' : ''}`}
                style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                disabled={disabled}
                aria-pressed={isSelected}
                onClick={() => toggle(h.id)}
              >
                {homeIdentity(h, priorities).primary}
              </button>
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
          <div className="hh-compare-identity-scroll">
            <div className="hh-compare-identity-grid" data-count={selected.length} style={{ '--compare-count': selected.length }}>
              {selected.map((h, i) => (
                <HomeHeaderCard key={h.id} home={h} match={matches[i]} isFavorite={h.isFavorite} coBuyerPerspective={coBuyerPerspectives[h.id]} searchType={priorities.searchType} priorities={priorities} />
              ))}
            </div>
          </div>

          {(mustRows.length > 0 || otherRows.length > 0 || commuteDestinations.length > 0 || factRows.length > 0) && (
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
              <p className="hh-compare-legend"><span className="is-met">✓ Satisfied</span><span className="is-missed">— Confirmed mismatch</span><span className="is-unknown">? Not evaluated</span></p>
              <div className="hh-scrollx" style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `200px repeat(${selected.length}, minmax(120px, 1fr))`, minWidth: 200 + selected.length * 120 }}>
                  <div />
                  {selected.map((h) => (
                    <div key={h.id} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', borderBottom: '1px solid var(--ink)' }}>{homeIdentity(h, priorities).primary}</div>
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

          {commuteDestinations.length > 0 && <CommuteSection homes={selected} destinations={commuteDestinations} diffsOnly={diffsOnly} getResult={getCommuteResult} priorities={priorities} />}

          {/* What matters to you */}
          {otherRows.length > 0 && (
            <section>
              <h3 className="hh-serif" style={{ fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--ink)' }}>What matters to you</h3>
              <div className="hh-scrollx" style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `200px repeat(${selected.length}, minmax(120px, 1fr))`, minWidth: 200 + selected.length * 120 }}>
                  <div />
                  {selected.map((h) => (
                    <div key={h.id} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', borderBottom: '1px solid var(--ink)' }}>{homeIdentity(h, priorities).primary}</div>
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

          {/* Participant-specific context returned by the secure perspective boundary. */}
          {selected.some((home) => coBuyerPerspectives[home.id]?.differentTakes?.length > 0) && (
            <details className="hh-details hh-different-takes" open>
              <summary>Different Takes</summary>
              <p className="hh-different-takes-intro">You both evaluated these, and experienced them differently.</p>
              <div className="hh-compare-notes">
                {selected.map((home) => (
                  <div key={home.id} className="hh-different-takes-home">
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>{homeIdentity(home, priorities).primary}</div>
                    {(coBuyerPerspectives[home.id]?.differentTakes || []).map((take) => (
                      <div key={take.key} className="hh-different-take">
                        <strong>{criterionDisplayLabel(take.key.split(':')[0], take.label)}</strong>
                        <div><span><b>You</b> {take.youLiked ? 'Liked' : "Didn't like"}</span><span><b>Collaborator</b> {take.coBuyerLiked ? 'Liked' : "Didn't like"}</span></div>
                      </div>
                    ))}
                    {!coBuyerPerspectives[home.id]?.differentTakes?.length && <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontStyle: 'italic' }}>No different takes here.</div>}
                  </div>
                ))}
              </div>
            </details>
          )}

          <details className="hh-details">
            <summary>{vocabulary.singular} facts</summary>
            <div className="hh-scrollx" style={{ overflowX: 'auto', marginTop: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: `160px repeat(${selected.length}, minmax(100px, 1fr))`, minWidth: 160 + selected.length * 100 }}>
                <div />
                {selected.map((h) => (
                  <div key={h.id} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', borderBottom: '1px solid var(--ink)' }}>{homeIdentity(h, priorities).primary}</div>
                ))}
                {factRows.map((row) => {
                  const values = selected.map((h) => row.get(h));
                  return (
                    <Fragment key={row.key}>
                      <div style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>{row.label}</div>
                      {values.map((v, i) => (
                        <div key={row.key + '-' + i} className="hh-mono" style={{
                          padding: '8px 12px', fontSize: 12.5, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center',
                          color: 'var(--ink)', fontWeight: 500,
                        }}>
                          {row.fmt(v, selected[i])}
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
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>{homeIdentity(h, priorities).primary}</div>
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
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>{homeIdentity(h, priorities).primary}</div>
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
