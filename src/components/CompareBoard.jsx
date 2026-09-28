'use client';

import { useState, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, Columns, Star, Heart, Home as HomeIcon, Footprints } from 'lucide-react';
import { MatchBadge, StatusTag } from '@/components/MobileSystem';
import PostTourRecap from '@/components/PostTourRecap';
import { TOUR_RATING_KEY, criterionDisplayLabel, isApartmentRental } from '@/lib/constants';
import { parseNum, computeMatch, matchColor } from '@/lib/matching';
import { hasToured } from '@/lib/lifecycle';
import { postTourEvaluationLabel, reactionLabel } from '@/lib/postTour';
import { compareGlance, mustGlanceText } from '@/lib/compare';
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

// Apartment-to-Rent communities don't have a meaningful per-listing lot the
// way a standalone home does — showing it just because the shared `homes`
// model has the column would present an irrelevant Home field as if it were
// an apartment fact. Garage and Year built, by contrast, are real, valid
// apartment/community facts when known (assigned parking, when the building
// was built) — they're only suppressed here if genuinely unset, the same as
// every other fact row, never categorically hidden for apartments. Beds/
// baths/sqft/days-on-market are equally per-unit facts for both.
const APARTMENT_IRRELEVANT_FACT_KEYS = new Set(['lot']);

function homeFactRows(priorities) {
  const apartment = isApartmentRental(priorities);
  const searchType = priorities.searchType;
  const { showsRentalFacts } = searchIntentCapabilities(searchType);
  const physicalRows = apartment ? PHYSICAL_FACT_ROWS.filter((row) => !APARTMENT_IRRELEVANT_FACT_KEYS.has(row.key)) : PHYSICAL_FACT_ROWS;
  const price = { key: 'price', label: showsRentalFacts ? 'Monthly Rent' : 'Price', betterHigh: false, get: (h) => parseNum(h.price), fmt: (v) => (v === null ? '—' : formatHomePrice(String(v), searchType)) };
  if (showsRentalFacts) return [price, ...physicalRows,
    { key: 'propertyType', label: 'Property Type', betterHigh: null, get: (h) => h.propertyType || null, fmt: formatPropertyType },
    { key: 'availableOn', label: 'Available On', betterHigh: null, get: (h) => h.availableOn || null, fmt: formatDateOnly },
    { key: 'petsAllowed', label: 'Pets Allowed', betterHigh: null, get: (h) => h.petsAllowed, fmt: formatTriState },
    { key: 'utilitiesIncluded', label: 'Utilities Included', betterHigh: null, get: (h) => h.utilitiesIncluded, fmt: formatTriState },
    { key: 'inUnitLaundry', label: 'In-Unit Laundry', betterHigh: null, get: (h) => h.inUnitLaundry, fmt: formatTriState },
  ];
  return [price,
  { key: 'estMonthly', label: 'Est. monthly payment', betterHigh: false, get: (h) => parseNum(h.estMonthly), fmt: (v) => (v === null ? '—' : formatHomePrice(String(v), searchType)) },
  ...physicalRows,
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
  if (c.met === null) {
    return <span className="hh-criteria-value is-neutral"><b aria-hidden="true">—</b><span>{c.detail || 'Neutral'}</span></span>;
  }
  // Subjective/experiential criteria are captured in Post-Tour as Liked/Didn't Like,
  // not a star scale — showing stars here would be a stale artifact of a UI that no
  // longer exists. c.met is already exactly "value >= 3" from the shared Match
  // calculation, so a historical fine-grained star rating (e.g. an old 4/5) still
  // displays correctly as "Liked" through this same threshold, with nothing rewritten.
  const text = c.objective ? c.detail : (c.met ? 'Liked' : "Didn't like");
  // A confirmed miss is its own mark (✕), never the same "—" a neutral answer uses.
  return <span className={`hh-criteria-value ${c.met ? 'is-met' : 'is-missed'}`}>
    <b aria-hidden="true">{c.met ? '✓' : '✕'}</b><span>{text}</span>
  </span>;
}

// A row's "signature" for Differences Only: two homes count as "the same" only if
// they're both unevaluated, or both evaluated with the same met/rating outcome.
function rowSignature(c) {
  if (!c || !c.evaluated) return 'unevaluated';
  if (c.met === null) return 'neutral';
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
      <div className="hh-compare-perspective-label">{label === 'You' ? 'Your' : `${label}’s`} perspective</div>
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

// The collaborator's own lifecycle choices, attributed and in plain language
// (never a raw stored value like "not_for_me"). Never merged with yours.
function CollaboratorState({ state, name }) {
  if (!state) return null;
  const toured = Boolean(state.touredAt) || state.status === 'Toured';
  const choices = [
    state.isFavorite ? 'Favorite' : null,
    toured ? 'Toured' : state.status === 'Want to Tour' ? 'Wants to tour' : null,
    state.status === 'Archived' ? 'Archived' : null,
    reactionLabel(state.reaction),
  ].filter(Boolean);
  return choices.length ? <div className="hh-collaborator-state"><strong>{name}:</strong> {choices.join(' · ')}</div> : null;
}

function HomeHeaderCard({ home, match, isFavorite, coBuyerPerspective, searchType, priorities, basePath = '/homes', vocabulary, isCollaborative, collaboratorName = 'Your collaborator' }) {
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
      {home.suggestedBy && <span className="hh-provenance">Suggested by {home.suggestedBy}</span>}
      <Link href={`${basePath}/${encodeURIComponent(home.id)}`} className="hh-address hh-compare-address hh-home-identity-link">{homeIdentity(home, priorities).primary}</Link>{homeIdentity(home, priorities).option && <div className="hh-compare-option">{homeIdentity(home, priorities).option}</div>}{homeIdentity(home, priorities).supporting && <div className="hh-compare-supporting">{homeIdentity(home, priorities).supporting}</div>}
      <div className="hh-mono hh-compare-facts">
        {[home.beds ? `${home.beds} bd` : null, home.baths ? `${home.baths} ba` : null, home.sqft ? `${Number(home.sqft).toLocaleString()} sqft` : null]
          .filter(Boolean).join(' · ') || '—'}
      </div>
      {/* Existing lifecycle state, never invented for the card -- Saved is
          the default and not worth a badge; Want to Tour/Toured are. */}
      {(hasToured(home) || (home.status && home.status !== 'Saved')) && (
        <div className="hh-lifecycle-status">
          <Footprints size={12} color="var(--moss)" /> {hasToured(home) ? 'Toured' : home.status}
        </div>
      )}
      {hasToured(home) && <PostTourRecap home={home} compact ownerLabel={coBuyerPerspective ? 'You' : null} />}

      {coBuyerPerspective ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Perspective label="You" match={match} feeling={overallRating} emptyCopy="Set priorities in My Search to see Match" />
          <Perspective label={collaboratorName} match={coBuyerPerspective.match} feeling={coBuyerPerspective.overallFeeling} emptyCopy={`${collaboratorName} hasn't set relevant priorities yet`} />
          <CollaboratorState state={coBuyerPerspective.state} name={collaboratorName} />
        </div>
      ) : match ? (
        match.pct !== null ? (
          <div style={{ marginBottom: 4 }}>
            <MatchBadge pct={match.pct} size="md" />
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

      {/* Notes are a shared field on the home record itself, not a
          per-participant one (see SHARED_FIELDS in collaboration.js) --
          "Shared notes"/"What you want to remember" is the same truthful
          language Home Detail already uses for this exact same tension,
          reused here rather than a new "Your notes" label that would claim
          personal ownership this data doesn't actually have. Clamped to two
          lines so one long note never stretches a card past its neighbors;
          the full text is still one tap away via View home. */}
      <div className="hh-compare-note">
        <span className="hh-compare-note-label">{isCollaborative ? 'Shared notes' : 'What you want to remember'}</span>
        <p className={`hh-compare-note-text ${home.notes ? '' : 'is-empty'} hh-card-clamp`}>{home.notes || 'Nothing noted yet.'}</p>
      </div>

      <Link href={`${basePath}/${encodeURIComponent(home.id)}`} className="hh-btn hh-btn-ghost hh-compare-view-home">View {vocabulary?.singularLower || 'home'}</Link>
    </article>
  );
}

// Compact visual contender selector — a plain text chip answers "is this
// selected" but not "which home is this, at a glance," especially once
// several candidates have similar-sounding addresses/property names. A
// thumbnail + identity + Match keeps that answerable without turning
// selection into its own control surface (falls back to the same empty-photo
// icon Home cards use elsewhere — no new placeholder system).
//
// `matchTrustworthy` gates whether `match`'s percentage is shown at all — see
// the comment on pickerMatches/commuteIsSelectedPriority below for why: this
// component itself has no opinion on trust, it just doesn't render a number
// it wasn't told to trust.
function PickerChip({ home, priorities, match, matchTrustworthy, isSelected, disabled, onToggle }) {
  const [imgError, setImgError] = useState(false);
  const identity = homeIdentity(home, priorities);
  const showPhoto = home.photoUrl && !imgError;
  return (
    <button
      type="button"
      className={`hh-compare-picker-chip ${isSelected ? 'on' : ''}`}
      disabled={disabled}
      aria-pressed={isSelected}
      onClick={onToggle}
    >
      <span className="hh-compare-picker-thumb">
        {showPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={home.photoUrl} alt="" onError={() => setImgError(true)} />
        ) : (
          <HomeIcon size={13} color="var(--ink-soft)" style={{ opacity: 0.6 }} />
        )}
      </span>
      <span className="hh-compare-picker-text">
        <span className="hh-compare-picker-name">{identity.primary}</span>
        {matchTrustworthy && match?.pct != null ? (
          <span className="hh-compare-picker-match" style={{ color: matchColor(match.pct) }}>{match.pct}% Match</span>
        ) : matchTrustworthy ? (
          <span className="hh-compare-picker-match is-unset">Match unavailable</span>
        ) : (
          <span className="hh-compare-picker-match is-unset">Select to see Match</span>
        )}
      </span>
    </button>
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

// Shared row-comparison layout for Must-Haves, What matters to you, and
// {Singular} facts — each is "one row per criterion/fact, one value per
// home," which a desktop table reads fine but a 390px screen does not (see
// CommuteSection above, which already solved exactly this: render both a
// desktop grid and a vertical mobile grouping, then let CSS pick one per
// breakpoint instead of reproducing the table at phone width). `renderValue`
// stays a plain per-cell renderer so this has no opinion on what a "value"
// looks like — CriteriaValue's met/missed/unknown treatment for priority
// rows, or a formatted fact string for the Facts table, both pass through
// unchanged.
function CompareRowsSection({ title, legend, rows, homes, priorities, renderValue, labelColWidth = 200, minColWidth = 120 }) {
  if (!rows.length) return null;
  return (
    <section>
      {title && <h3 className="hh-serif" style={{ fontSize: 16, fontWeight: 600, marginBottom: legend ? 4 : 10, color: 'var(--ink)' }}>{title}</h3>}
      {legend}
      <div className="hh-compare-rows-desktop hh-scrollx">
        <div style={{ display: 'grid', gridTemplateColumns: `${labelColWidth}px repeat(${homes.length}, minmax(${minColWidth}px, 1fr))`, minWidth: labelColWidth + homes.length * minColWidth }}>
          <div />
          {homes.map((h) => <div key={h.id} className="hh-compare-rows-heading">{homeIdentity(h, priorities).primary}</div>)}
          {rows.map((row) => (
            <Fragment key={row.key}>
              <div className="hh-compare-rows-label">{row.label}</div>
              {row.values.map((value, i) => (
                <div key={row.key + '-' + i} className="hh-compare-rows-cell">{renderValue(value, homes[i], row)}</div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="hh-compare-rows-mobile">
        {rows.map((row) => (
          <div key={row.key} className="hh-compare-rows-mobile-group">
            <div className="hh-compare-rows-label">{row.label}</div>
            {row.values.map((value, i) => (
              <div key={row.key + '-' + i} className="hh-compare-rows-mobile-row">
                <span>{homeIdentity(homes[i], priorities).primary}</span>
                {renderValue(value, homes[i], row)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// "At a glance": the few facts that separate contenders, each read from real
// data — price from the home, Match and Must Haves from the same canonical
// computeMatch results the rest of Compare uses. "Best" is marked only when at
// least two homes have a known value and exactly one is best; Unknown is shown
// as Unknown and never wins, loses, or counts as a miss.
function AtAGlance({ homes, matches, priorities }) {
  const { prices, bestPrice, pcts, bestMatch, musts, hasMust, bestMust } = compareGlance(homes, matches);
  const cell = (index, best, content, tone = '') => <td key={homes[index].id} className={`${index === best ? 'is-best' : ''} ${tone}`}>{content}{index === best && <span className="sr-only"> (best in this row)</span>}</td>;
  return (
    <section className="flh-card flh-compare-glance" aria-labelledby="compare-glance-heading">
      <div className="flh-section-label"><h2 id="compare-glance-heading">At a glance</h2><span>Best in each row</span></div>
      <div className="flh-compare-glance-scroll">
        <table>
          <thead><tr><th scope="col"><span className="sr-only">Compare</span></th>{homes.map((home) => <th scope="col" key={home.id}>{homeIdentity(home, priorities).primary}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row">{searchIntentCapabilities(priorities.searchType).showsRentalFacts ? 'Rent' : 'Price'}</th>{homes.map((home, index) => cell(index, bestPrice, prices[index] === null ? 'Unknown' : formatHomePrice(home.price, priorities.searchType), prices[index] === null ? 'is-unknown' : ''))}</tr>
            <tr><th scope="row">Match</th>{homes.map((home, index) => cell(index, bestMatch, pcts[index] === null ? 'Not enough info' : `${pcts[index]}%`, pcts[index] === null ? 'is-unknown' : ''))}</tr>
            {hasMust && <tr><th scope="row">Must Haves</th>{homes.map((home, index) => {
              const must = musts[index];
              return cell(index, bestMust, mustGlanceText(must), must.missed ? 'is-negative' : '');
            })}</tr>}
            <tr><th scope="row">Home facts</th>{homes.map((home, index) => cell(index, -1, [home.beds && `${home.beds} bd`, home.baths && `${home.baths} ba`, parseNum(home.sqft) && `${parseNum(home.sqft).toLocaleString()} sq ft`].filter(Boolean).join(' · ') || 'Unknown', (home.beds || home.baths || home.sqft) ? '' : 'is-unknown'))}</tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function CompareBoard({ homes, priorities, coBuyerPerspectives = {}, commuteDestinations = [], readOnly = false, basePath = '/homes', collaboratorName = null }) {
  const [selectedIds, setSelectedIds] = useState(() => homes.slice(0, Math.min(2, homes.length)).map((h) => h.id));
  const [diffsOnly, setDiffsOnly] = useState(true);
  // Two-stage Compare: an overview first, then the deeper side-by-side view.
  const [stage, setStage] = useState('overview');
  const [section, setSection] = useState('match');
  const partner = collaboratorName || 'Your collaborator';
  const vocabulary = homeVocabulary(priorities);

  const toggle = (id) => setSelectedIds((prev) => {
    if (prev.includes(id)) return prev.filter((x) => x !== id);
    if (prev.length >= MAX_COMPARE) return prev;
    return [...prev, id];
  });

  // A quick Match badge for every candidate in the picker, not just the ones
  // currently selected — deliberately without commute evaluation, since that
  // needs an active comparison's commute matrix (see useCommuteMatrix below),
  // not a request fired for every home just to decorate the picker. Same
  // shared computeMatch as everywhere else, never a separate scoring path.
  //
  // Trust guard: a percentage is only ever labeled "Match" if it is provably
  // identical to what the same home would show once actually selected and
  // fully evaluated. That's true whenever the user hasn't selected "Commute"
  // as a location priority at all — computeMatch never looks at commute in
  // that case, with or without evaluation data, so the two calculations are
  // the same calculation. The moment Commute IS a selected priority, this
  // no-commute calculation and the real, commute-aware one selecting the
  // home would trigger can genuinely diverge (different evaluatedCount,
  // different pct) — so the picker shows no percentage at all rather than
  // one that might not match what the user sees a moment later. Detected
  // structurally from computeMatch's own `allSelected` (whether a
  // 'location:Commute' row was selected at all), not by re-deriving tier
  // logic here.
  const pickerMatches = useMemo(() => {
    const byId = new Map();
    homes.forEach((home) => byId.set(home.id, computeMatch(home, priorities)));
    return byId;
  }, [homes, priorities]);

  const commuteIsSelectedPriority = useMemo(
    () => Array.from(pickerMatches.values()).some((m) => m?.allSelected?.some((c) => c.key === 'location:Commute')),
    [pickerMatches]
  );
  const pickerMatchTrustworthy = !commuteIsSelectedPriority;

  const selected = useMemo(() => selectedIds.map((id) => homes.find((h) => h.id === id)).filter(Boolean), [selectedIds, homes]);
  const getCommuteResult = useCommuteMatrix(selected, commuteDestinations);
  const matches = selected.map((home) => computeMatch(
    home,
    priorities,
    evaluateCommute(commuteDestinations, (destination) => getCommuteResult(home, destination))
  ));
  const factRows = homeFactRows(priorities).filter((row) => {
    if (!diffsOnly) return true;
    const values = selected.map((home) => row.get(home));
    return new Set(values.map((value) => value == null ? 'unknown' : String(value))).size > 1;
  });

  // One row per priority the user selected, aligned across homes by criterion key
  // (a priority either exists for every home's computeMatch result or none, since it's
  // driven by the same shared `priorities` object) — pulled from the same shared
  // Match 2.0 calculation, never a separate scoring path.
  const { mustRows, otherRows, allCriteriaCount } = useMemo(() => {
    // Aligned by canonical criterion key (never by display label, which two
    // different criteria can share across categories).
    const byKey = new Map(); // key -> { label, tier, perHome: [c|null, ...] }
    matches.forEach((m, i) => {
      (m?.allSelected || []).forEach((c) => {
        if (!byKey.has(c.key)) byKey.set(c.key, { key: c.key, label: c.label, tier: c.tier, perHome: new Array(selected.length).fill(null) });
        byKey.get(c.key).perHome[i] = c;
      });
    });
    const rows = Array.from(byKey.values());
    const differs = (row) => new Set(row.perHome.map(rowSignature)).size > 1;
    const visible = diffsOnly ? rows.filter(differs) : rows;
    return {
      mustRows: visible.filter((r) => r.tier === 'must'),
      otherRows: visible.filter((r) => r.tier !== 'must'),
      allCriteriaCount: rows.length,
    };
  }, [matches, selected.length, diffsOnly]);

  // Compare stays participant-aware, never a merged view: coBuyerPerspectives
  // only has entries for a home when the current search actually has another
  // participant (see resolveCoBuyerComparePerspectives) -- this never blends
  // Match, it just decides whether the collaboration copy below is shown at all.
  const isCollaborative = selected.some((home) => coBuyerPerspectives[home.id]);

  if (homes.length < 2) {
    return (
      <div className="hh-corner" style={{ border: '1px dashed var(--line)', borderRadius: 16, padding: '36px 24px', textAlign: 'center', color: 'var(--ink-soft)' }}>
        <Columns size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
        <p className="hh-serif" style={{ fontSize: 18, color: 'var(--ink)', margin: '0 0 5px' }}>The showdown starts here.</p>
        <p style={{ fontSize: 13.5 }}>{vocabulary.apartment ? 'Pick 2–4 properties and see how they stack up.' : 'Pick 2–4 homes and see how they stack up.'}</p>
        {!readOnly && <Link className="hh-btn" href="/homes?add=1">{homes.length === 0 ? (vocabulary.apartment ? 'Add a property' : 'Add a home') : (vocabulary.apartment ? 'Add another property' : 'Add another home')}</Link>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {stage === 'overview' && <div>
        <div className="hh-label" style={{ marginBottom: 8 }}>Choose {vocabulary.pluralLower} to compare {selectedIds.length >= MAX_COMPARE && <span>(max {MAX_COMPARE})</span>}</div>
        <div className="hh-compare-picker">
          {homes.map((h) => {
            const isSelected = selectedIds.includes(h.id);
            const disabled = !isSelected && selectedIds.length >= MAX_COMPARE;
            return (
              <PickerChip
                key={h.id}
                home={h}
                priorities={priorities}
                match={pickerMatches.get(h.id)}
                matchTrustworthy={pickerMatchTrustworthy}
                isSelected={isSelected}
                disabled={disabled}
                onToggle={() => toggle(h.id)}
              />
            );
          })}
        </div>
      </div>}

      {selected.length < 2 ? (
        <div className="hh-corner" style={{ border: '1px dashed var(--line)', borderRadius: 16, padding: '36px 24px', textAlign: 'center', color: 'var(--ink-soft)' }}>
          <Columns size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
          <p style={{ fontSize: 13.5 }}>Pick at least two homes above to compare them.</p>
        </div>
      ) : stage === 'overview' ? (
        <>
          <AtAGlance homes={selected} matches={matches} priorities={priorities} />
          {/* Identification + the big picture: Match and Overall Feeling */}
          <div className="hh-compare-identity-scroll">
            <div className="hh-compare-identity-grid" data-count={selected.length} style={{ '--compare-count': selected.length }}>
              {selected.map((h, i) => (
                <HomeHeaderCard key={h.id} home={h} match={matches[i]} isFavorite={h.isFavorite} coBuyerPerspective={coBuyerPerspectives[h.id]} searchType={priorities.searchType} priorities={priorities} basePath={basePath} vocabulary={vocabulary} isCollaborative={isCollaborative} collaboratorName={partner} />
              ))}
            </div>
          </div>

          <button type="button" className="flh-button flh-button-primary flh-button-block flh-compare-go" onClick={() => { setStage('detail'); setSection('match'); }}><Columns size={16} aria-hidden="true" /> Compare side by side</button>
        </>
      ) : (
        <>
          <div className="flh-compare-detail-head">
            <button type="button" className="flh-icon-button" onClick={() => setStage('overview')} aria-label="Back to overview"><ArrowLeft size={18} aria-hidden="true" /></button>
            <div><h2 className="hh-serif">Side by side</h2><p>{selected.length} {vocabulary.pluralLower} · context stays pinned</p></div>
          </div>
          <div className="flh-compare-pinned" style={{ '--compare-count': selected.length }}>
            {selected.map((home, index) => (
              <Link key={home.id} href={`${basePath}/${encodeURIComponent(home.id)}`} className="flh-compare-pin">
                <strong>{homeIdentity(home, priorities).primary}</strong>
                <span>{formatHomePrice(home.price, priorities.searchType) || 'Price unknown'}</span>
                {matches[index]?.pct != null ? <MatchBadge pct={matches[index].pct} /> : <StatusTag tone="unknown">Match unknown</StatusTag>}
              </Link>
            ))}
          </div>
          <div className="flh-segmented flh-segmented-block flh-compare-tabs" role="tablist" aria-label="Comparison sections">
            {[['match', 'Match'], ...(commuteDestinations.length ? [['commutes', 'Commutes']] : []), ['facts', `${vocabulary.singular} facts`], ['notes', 'Notes']].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={section === key} className={section === key ? 'is-selected' : ''} onClick={() => setSection(key)}>{label}</button>
            ))}
          </div>
          {(mustRows.length > 0 || otherRows.length > 0 || commuteDestinations.length > 0 || factRows.length > 0 || allCriteriaCount > 0) && (
            <div className="hh-compare-diff-toggle" role="group" aria-label="Comparison detail level">
              <button type="button" className={diffsOnly ? 'active' : ''} aria-pressed={diffsOnly} onClick={() => setDiffsOnly(true)}>Showing differences only</button>
              <button type="button" className={!diffsOnly ? 'active' : ''} aria-pressed={!diffsOnly} onClick={() => setDiffsOnly(false)}>Show all ({allCriteriaCount})</button>
            </div>
          )}

          {section === 'match' && <>
          {/* Must-Haves */}
          <CompareRowsSection
            title="Must-Haves"
            legend={<p className="hh-compare-legend"><span className="is-met">✓ Meets preference</span><span className="is-missed">✕ Doesn't meet</span><span className="is-neutral">— Neutral</span><span className="is-unknown">? Unknown</span></p>}
            rows={mustRows.map((row) => ({ key: row.key, label: rowDisplayLabel(row), values: row.perHome }))}
            homes={selected}
            priorities={priorities}
            renderValue={(c) => <CriteriaValue c={c} />}
          />

          {/* What Matters to You */}
          <CompareRowsSection
            title="What Matters to You"
            rows={otherRows.map((row) => ({ key: row.key, label: rowDisplayLabel(row), values: row.perHome }))}
            homes={selected}
            priorities={priorities}
            renderValue={(c) => <CriteriaValue c={c} />}
          />

          {mustRows.length === 0 && otherRows.length === 0 && diffsOnly && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>These homes look the same on everything you've told us matters — toggle to "show all" to see the full picture.</p>
          )}

          </>}
          {section === 'commutes' && <>
          {commuteDestinations.length > 0 && <CommuteSection homes={selected} destinations={commuteDestinations} diffsOnly={diffsOnly} getResult={getCommuteResult} priorities={priorities} />}

          </>}
          {section === 'facts' && <>
          <section aria-label={`${vocabulary.singular} facts`}>
            <div>
              <CompareRowsSection
                rows={factRows.map((row) => ({ key: row.key, label: row.label, values: selected.map((h) => row.get(h)), fmt: row.fmt }))}
                homes={selected}
                priorities={priorities}
                labelColWidth={160}
                minColWidth={100}
                renderValue={(v, h, row) => <span className="hh-mono" style={{ color: 'var(--ink)', fontWeight: 500 }}>{row.fmt(v, h)}</span>}
              />
            </div>
          </section>

          </>}
          {section === 'notes' && <>
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
                        <strong>{postTourEvaluationLabel(take.key) || criterionDisplayLabel(take.key.split(':')[0], take.label)}</strong>
                        <div><span><b>You</b> {take.youLiked ? 'Liked' : "Didn't like"}</span><span><b>{partner}</b> {take.coBuyerLiked ? 'Liked' : "Didn't like"}</span></div>
                      </div>
                    ))}
                    {!coBuyerPerspectives[home.id]?.differentTakes?.length && <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontStyle: 'italic' }}>No different takes here.</div>}
                  </div>
                ))}
              </div>
            </details>
          )}

          <section aria-label="What stood out">
            <h3 className="hh-serif flh-compare-subhead">What stood out</h3>
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
          </section>
          {/* The dedicated "Notes" section that used to live here duplicated
              the exact same home.notes text now surfaced on each contender
              card above (see HomeHeaderCard's note excerpt) -- this was
              presentation deduplication only, home.notes and its Home Detail
              edit path are untouched. */}
          </>}
        </>
      )}
    </div>
  );
}
