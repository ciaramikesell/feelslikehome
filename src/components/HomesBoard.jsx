'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, Search, Archive as ArchiveIcon, ArrowUpRight, Car, ChevronDown,
  Heart, Home as HomeIcon, Undo2, Footprints, MessageCircle, Check, StickyNote, SlidersHorizontal, X,
} from 'lucide-react';
import { CriteriaDisclosure, MatchSummary } from '@/components/ui';
import { useCommuteObserver, readCommuteResult, useCommuteCacheVersion } from '@/lib/useCommuteObserver';
import { evaluateCommute } from '@/lib/commute';
import HomeModal from '@/components/HomeModal';
import PostTourModal from '@/components/PostTourModal';
import ArchiveConfirmModal from '@/components/ArchiveConfirmModal';
import Sheet from '@/components/Sheet';
import HomeFiltersSheet from '@/components/HomeFiltersSheet';
import { useHomesWorkspace } from '@/components/HomesWorkspace';
import {
  EMPTY_FILTERS, SORT_MENU, activeFilterCount, activeFilterLabels, applyContenderFilters, currentUserWantsToTour,
  singleFilterCounts, sortContenders,
} from '@/lib/homesCollection';
import {
  EMPTY_HOME_FILTERS, SHOW_CONFIRMED, SHOW_POSSIBLE, applyHomeFilters, filterableCriteria, possibleMatchNote,
  readStoredHomeFilters, writeStoredHomeFilters,
} from '@/lib/homeFilters';
import { emptyHome, isArchivedStatus } from '@/lib/constants';
import { isLikelyListingUrl, findHomeByListingUrl } from '@/lib/listingUrl';
import { parseNum, fmtMoney, homeStyleSummary, computeMatch, matchColor, matchTint, selectHomeCardCriteria, criterionLabel } from '@/lib/matching';
import { homeCardSnapshot } from '@/lib/homeCardPresentation';
import { homeIdentity, homeVocabulary } from '@/lib/homePresentation';
import { formatHomePrice, formatLotSizeDisplay, noteFieldCount } from '@/lib/homeDisplay';
import { normalizeSearchIntent, searchIntentCapabilities } from '@/lib/searchIntent';
import { isNativeApp } from '@/lib/platform';
import { deriveFlhMoment } from '@/lib/flhMoments';
import { applyPostTourVerdict, archiveHome, hasToured, isFavoriteHome, restoreHome as restoreLifecycleHome } from '@/lib/lifecycle';
import { createClient } from '@/lib/supabase/client';
import { deleteHome as deleteHomeQuery } from '@/lib/supabase/data';
import { refreshMyHomes } from '@/app/(app)/homes/actions';
import {
  deriveWantToTourState, hasSharedHomeChanges, saveHomePersonalAndShared, saveHomePersonalState,
} from '@/lib/supabase/collaboration';

const RETURN_MODES = new Set(['tour', 'favorites', 'archive']);
export function overlayHref(homeId, mode) {
  return `/homes/${encodeURIComponent(homeId)}${RETURN_MODES.has(mode) ? `?from=${mode}` : ''}`;
}

/* -------------------------------- confirm modal -------------------------------- */

function ConfirmModal({ title, body, cancelLabel = 'Cancel', confirmLabel, confirmTone = 'danger', onCancel, onConfirm }) {
  return (
    <Sheet open size="compact" title={title} onClose={onCancel}>
      <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55, margin: '0 0 20px' }}>{body}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="hh-btn hh-btn-ghost" onClick={onCancel}>{cancelLabel}</button>
        <button
          className="hh-btn"
          style={confirmTone === 'danger' ? { background: 'var(--brick)', borderColor: 'var(--brick)' } : undefined}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

/* --------------------------------- card view --------------------------------- */

// Long commute-route labels and pending/failed routes keep an honest status;
// a resolved route reads "Mom 14 min" (label, then the time).
function commuteRouteParts(destination, state) {
  const name = destination.label;
  if (state.status === 'ok') return { name, value: `${state.minutes} min` };
  if (state.status === 'loading') return { name, value: 'Calculating…', quiet: true };
  if (state.status === 'destination_invalid') return { name, value: 'Check the address', quiet: true };
  if (state.status === 'destination_ambiguous') return { name, value: 'Add a city or ZIP', quiet: true };
  if (['unavailable', 'no_route', 'home_unavailable', 'destination_unavailable'].includes(state.status)) return { name, value: 'Not available', quiet: true };
  return { name, value: null };
}

// My Homes card (approved Phase 1 design), shared by Homes, Want to Tour and
// Archive: identity → photo → price/specs → Match → property facts → commute →
// actions. Every value comes from the same helpers as before (computeMatch,
// selectHomeCardCriteria, homeCardSnapshot, evaluateCommute); only the
// presentation changed.
function HomeCard({ home, priorities, commuteDestinations, mode, filterResult = null, onEdit, onOpen, onArchiveRequest, onWantToTour, onOpenPostTour, onRemoveFromTour, onRestore, onRequestDelete }) {
  const [imgError, setImgError] = useState(false);
  const styleSummary = homeStyleSummary(home);
  const showPhoto = home.photoUrl && !imgError;
  const [showAllMustHaves, setShowAllMustHaves] = useState(false);
  const identity = homeIdentity(home, priorities);
  const vocabulary = homeVocabulary(priorities);
  // The home overlay over My Homes. From Want to Tour / Favorites / Archive,
  // Close returns to that page.
  const homeHref = overlayHref(home.id, mode);
  // Normalize lifecycle presentation without touching stored data: any status that
  // isn't 'Want to Tour' or 'Toured' is treated as pre-tour, whether it's the current
  // 'Saved' value or a legacy string like 'Considering' left over from before this
  // lifecycle existed (see rowToHome's 'Considering' fallback in supabase/data.js).
  const toured = hasToured(home);
  const isPreTour = !toured && home.status !== 'Want to Tour';
  const onTourList = !toured && home.status === 'Want to Tour';
  const wantToTourState = home.isCollaborative
    ? deriveWantToTourState(home, home.coBuyerWantsToTour ? [{ status: 'Want to Tour' }] : [])
    : null;
  const moment = deriveFlhMoment(home);

  const { setRef: commuteRef, getState: getCommuteState } = useCommuteObserver(home, commuteDestinations);
  const commuteEvaluation = evaluateCommute(commuteDestinations, getCommuteState);
  const match = computeMatch(home, priorities, commuteEvaluation);
  const cardCriteria = selectHomeCardCriteria(match);
  const { showsPurchaseFinancials } = searchIntentCapabilities(priorities.searchType);

  // Core property specifications — beds/baths/sqft/lot only, on the line under
  // the price. Garage lives in the property facts below.
  const factLine = [
    home.beds && `${home.beds} bd`,
    home.baths && `${home.baths} ba`,
    home.sqft && `${parseNum(home.sqft)?.toLocaleString()} sq ft`,
    home.lotSize && formatLotSizeDisplay(home.lotSize),
  ].filter(Boolean);

  // Descriptive shared facts ("what this home has"). homeCardSnapshot drops a
  // fact with no saved value (or an Unknown one) rather than inventing it.
  const propertyFacts = homeCardSnapshot(home, styleSummary);
  // Pros / cons are freeform text: counted once per field, never split on commas.
  const noteCount = noteFieldCount(home);
  const { mustHaves, hiddenMustHaves, mustOverflow, criteriaSummary } = cardCriteria;
  const displayedMustHaves = showAllMustHaves ? [...mustHaves, ...hiddenMustHaves] : mustHaves;
  const coBuyerActivity = home.coBuyerWantsToTour ? 'Co-buyer wants to tour' : home.coBuyerFavorited ? 'Co-buyer favorited' : null;
  const price = formatHomePrice(home.price, priorities.searchType);
  const monthly = showsPurchaseFinancials && home.estMonthly ? `${fmtMoney(home.estMonthly)}/mo est.` : null;

  return (
    <article className={`hh-home-card ${mode === 'archive' ? 'is-archived' : ''} ${mode === 'homes' ? 'is-contender' : ''} ${mode === 'tour' ? 'is-tour' : ''}`} ref={commuteRef}>
      <div className="hh-home-card-surface">
        <header className="hh-card-identity">
          <Link href={homeHref} scroll={false} onClick={onOpen} className="hh-home-identity-link">
            <h2 className="hh-address">{identity.primary}</h2>
            {identity.option && <p className="hh-card-option">{identity.option}</p>}
            {identity.supporting && <p className="hh-card-locality">{identity.supporting}</p>}
          </Link>
        </header>

        <div className={`hh-home-card-photo ${showPhoto ? '' : 'is-empty'}`}>
          <Link href={homeHref} scroll={false} onClick={onOpen} className="hh-home-card-photo-link" aria-label={`Open ${identity.accessible} details`} tabIndex={-1}>
            {showPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={home.photoUrl} alt={`${identity.accessible} ${vocabulary.singularLower} photo`} onError={() => setImgError(true)} />
            ) : (
              <div className="hh-home-card-photo-fallback">
                <HomeIcon size={34} color="rgba(46,38,33,0.22)" strokeWidth={1.5} aria-hidden="true" />
                <span>No photo yet</span>
              </div>
            )}
            {/* On Homes the Want to Tour button carries this state; the other views keep the tag. */}
            {onTourList && mode !== 'homes' && <span className="hh-card-status">WANT TO TOUR</span>}
            {moment && !coBuyerActivity && (
              <span className="hh-flh-moment" aria-label={moment.hasEyes ? `${moment.label}. Shared home signal.` : `${moment.label}.`}>
                {moment.hasEyes && <span aria-hidden="true">👀 </span>}{moment.label}
              </span>
            )}
            {home.suggestedBy && <span className="hh-image-provenance">Suggested by {home.suggestedBy}</span>}
            {coBuyerActivity && <span className="hh-cobuyer-activity">{coBuyerActivity}</span>}
          </Link>
        </div>

        <div className="hh-home-card-body">
          <hr className="hh-card-divider" />

          <div className="hh-card-pricing">
            <p className="hh-card-price-row">
              <span className={`hh-card-price${price ? '' : ' is-missing'}`}>{price || 'Price not added'}</span>
              {monthly && <span className="hh-card-monthly">{monthly}</span>}
            </p>
            {factLine.length > 0 && <p className="hh-card-factline">{factLine.join(' · ')}</p>}
          </div>

          {/* Filter My Homes: why a shown home is only a possible match. */}
          {filterResult?.status === 'possible' && (
            <p className="hh-card-filter-note"><span>Possible match</span> {possibleMatchNote(filterResult)}</p>
          )}

          {/* On an archived Home, why it was set aside is more decision-relevant than
              whether it had an 89% Match — so this leads, and the Match panel right
              below picks up the .is-secondary treatment instead of its usual weight. */}
          {mode === 'archive' && (
            <div className="hh-archive-reason">
              <span>Why you archived it</span>
              <p>{home.rejectionReason || 'No reason saved yet.'}</p>
            </div>
          )}

          {match ? (
            <section className={`hh-match-panel${mode === 'archive' ? ' is-secondary' : ''}`} style={{ background: matchTint(match.pct), borderLeftColor: matchColor(match.pct) }} aria-label="Match">
              <MatchSummary match={match} />
              {mustHaves.length > 0 && (
                <ul className="hh-must-summary" aria-label="Must Haves">
                  {displayedMustHaves.map((item) => {
                    const neutral = item.evaluated && item.met === null;
                    const tone = !item.evaluated ? 'is-unknown' : neutral ? 'is-neutral' : item.met ? 'is-positive' : 'is-negative';
                    return (
                      <li className={tone} key={item.key}>
                        <span className="hh-must-symbol" aria-hidden="true">{!item.evaluated ? '?' : neutral ? '—' : item.met ? '✓' : '✕'}</span>
                        {criterionLabel(item)}
                        <span className="sr-only">{!item.evaluated ? ' (unknown)' : neutral ? ' (neutral)' : item.met ? ' (met)' : ' (missing)'}</span>
                      </li>
                    );
                  })}
                  {mustOverflow > 0 && <li className="hh-must-overflow"><button type="button" className="hh-criteria-overflow" aria-expanded={showAllMustHaves} onClick={() => setShowAllMustHaves((value) => !value)}>{showAllMustHaves ? 'Show fewer' : `+ ${mustOverflow} more Must Have${mustOverflow === 1 ? '' : 's'}`}</button></li>}
                </ul>
              )}
              {criteriaSummary?.total > 0 && (
                <div className="hh-match-summary-line">
                  <CriteriaDisclosure symbol="✓" tone="positive" heading="Matches" items={criteriaSummary.matches} label={`${criteriaSummary.matches.length} match`} />
                  <span className="hh-match-summary-sep" aria-hidden="true">·</span>
                  <CriteriaDisclosure symbol="✕" tone="negative" heading="Doesn’t match" items={criteriaSummary.mismatches} label={`${criteriaSummary.mismatches.length} don’t match`} />
                  <span className="hh-match-summary-sep" aria-hidden="true">·</span>
                  <CriteriaDisclosure symbol="?" tone="unknown" heading="Still unknown" items={criteriaSummary.unknown} label={`${criteriaSummary.unknown.length} unknown`} />
                </div>
              )}
            </section>
          ) : (
            <p className="hh-match-empty">Set your priorities in <em>My Search</em> to see a match score.</p>
          )}

          {propertyFacts.length > 0 && (
            <dl className="hh-property-facts">
              {propertyFacts.map(({ label, value }) => (
                <div className="hh-property-fact" key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}

          {commuteDestinations.length > 0 && (
            <>
              <hr className="hh-card-divider" />
              {/* Every saved place, in the participant's stored order — never only the
                  first. A pending or failed route keeps its row with an honest status. */}
              <div className="hh-card-commute">
                <div className="hh-card-commute-label"><Car size={13} aria-hidden="true" /> Commute</div>
                <ul className="hh-card-commute-routes">
                  {commuteDestinations.map((d) => {
                    const { name, value, quiet } = commuteRouteParts(d, getCommuteState(d));
                    return (
                      <li className="hh-card-commute-route" key={d.id}>
                        <span>{name}</span>{value && <> <strong className={quiet ? 'is-quiet' : undefined}>{value}</strong></>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}

          {noteCount > 0 && <Link className="hh-notes-indicator" scroll={false} onClick={onOpen} href={`${homeHref}${homeHref.includes('?') ? '&' : '?'}section=tour`}><StickyNote size={13} aria-hidden="true" /> Notes ({noteCount})</Link>}

          {mode === 'tour' && wantToTourState?.wantToTourLabel && (
            <div className="hh-lifecycle-status">
              <Footprints size={12} color="var(--moss)" aria-hidden="true" /> {wantToTourState.wantToTourLabel}
            </div>
          )}

          {onTourList && mode !== 'homes' && (
            <button type="button" className="hh-btn hh-card-tour-action" onClick={() => onOpenPostTour(home)}>
              <MessageCircle size={13} aria-hidden="true" /> I toured this home
            </button>
          )}
          {toured && (
            <button type="button" className="hh-btn hh-btn-ghost hh-card-tour-action is-quiet" onClick={() => onOpenPostTour(home)}>
              <MessageCircle size={13} aria-hidden="true" /> Edit my thoughts
            </button>
          )}

          <div className="hh-home-card-actions">
            <div className="hh-card-secondary-actions">
              {home.listingUrl && (
                <a href={home.listingUrl} target="_blank" rel="noreferrer" className="hh-card-text-action" aria-label="Listing (opens the original listing in a new tab)">
                  Listing <ArrowUpRight size={12} aria-hidden="true" />
                </a>
              )}
              {mode !== 'archive' && (
                <button type="button" className="hh-card-text-action" onClick={() => onArchiveRequest(home)}>Archive</button>
              )}
              <button type="button" className="hh-card-text-action" onClick={() => onEdit(home)}>Edit</button>
              {mode === 'tour' && onTourList && (
                <button type="button" className="hh-card-text-action" onClick={() => onRemoveFromTour(home)} aria-label="Remove from Want to Tour">Remove mine</button>
              )}
              {mode === 'archive' && (
                <button type="button" className="hh-card-text-action is-danger" onClick={() => onRequestDelete(home)}>Delete permanently</button>
              )}
            </div>

            {isPreTour && mode !== 'archive' && (
              <button type="button" className="hh-btn hh-card-primary-action" aria-pressed="false" onClick={() => onWantToTour(home)}>
                Want to Tour
              </button>
            )}
            {onTourList && mode === 'homes' && (
              <button type="button" className="hh-btn hh-card-primary-action is-selected" aria-pressed="true" aria-label="Want to Tour, on your tour list. Remove from Want to Tour" onClick={() => onRemoveFromTour(home)}>
                <Check size={13} strokeWidth={2.6} aria-hidden="true" /> Want to Tour
              </button>
            )}
            {mode === 'archive' && (
              <button type="button" className="hh-btn hh-card-primary-action" onClick={() => onRestore(home)}><Undo2 size={13} aria-hidden="true" /> Restore</button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function CardGrid({ homes, priorities, commuteDestinations, mode, filterResults = null, onEdit, onOpen, onArchiveRequest, onWantToTour, onOpenPostTour, onRemoveFromTour, onRestore, onRequestDelete }) {
  return (
    <div className="hh-homes-grid">
      {homes.map((h) => (
        <HomeCard
          key={h.id} home={h} priorities={priorities} commuteDestinations={commuteDestinations} mode={mode} filterResult={filterResults?.get(h.id) || null} onEdit={onEdit} onOpen={onOpen} onArchiveRequest={onArchiveRequest}
          onWantToTour={onWantToTour} onOpenPostTour={onOpenPostTour} onRemoveFromTour={onRemoveFromTour}
          onRestore={onRestore} onRequestDelete={onRequestDelete}
        />
      ))}
    </div>
  );
}

function EmptyLifecycleState({ icon: Icon, title, body, children }) {
  return (
    <div className="hh-lifecycle-empty hh-corner">
      <div className="hh-lifecycle-empty-icon"><Icon size={22} strokeWidth={1.7} /></div>
      <p className="hh-serif">{title}</p>
      <span>{body}</span>
      {children && <div className="hh-lifecycle-empty-action">{children}</div>}
    </div>
  );
}

/* ---------------------------------- board ---------------------------------- */

export default function HomesBoard({ mode, userId, searchId, initialHomes, initialPriorities, initialCommuteDestinations = [], sharedFactAwareness, isCollaborative = false, collaborationSlot = null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Under My Homes' layout the board shares one copy of the homes with the
  // home overlay (HomesWorkspace); Want to Tour / Favorites / Archive keep
  // their own.
  const workspace = useHomesWorkspace();
  const [localHomes, setLocalHomes] = useState(initialHomes);
  const homes = workspace?.homes ?? localHomes;
  const setHomes = workspace?.setHomes ?? setLocalHomes;
  // Always render from the latest server-authorized criteria. Keeping the first
  // prop in state made unknown counts and Match summaries survive router refreshes.
  const priorities = initialPriorities;
  const vocabulary = homeVocabulary(initialPriorities);
  const [query, setQuery] = useState('');
  // Filters combine (AND). Each one keeps its existing meaning; see homesCollection.
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState('newest');
  // Filter My Homes (src/lib/homeFilters.js): temporary, read-only narrowing of
  // the active saved homes. Remembered for this browser session only.
  const [homeFilters, setHomeFilters] = useState(EMPTY_HOME_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRestored = useRef(false);
  useEffect(() => {
    if (mode !== 'homes') return;
    if (!filtersRestored.current) {
      filtersRestored.current = true;
      const stored = readStoredHomeFilters(typeof window === 'undefined' ? null : window.sessionStorage, searchId);
      setHomeFilters(stored);
      return;
    }
    writeStoredHomeFilters(window.sessionStorage, searchId, homeFilters);
  }, [mode, searchId, homeFilters]);
  const [modalHome, setModalHome] = useState(null);
  // Carries the "this particular modal open should auto-run Find" intent
  // separately from modalHome itself, set at the same moment as the home
  // being opened (see openHomeModal below) rather than derived from the URL
  // at render time — the query param only exists to trigger the open once;
  // it must not be able to un-set this after router.replace clears it.
  const [modalAutoFind, setModalAutoFind] = useState(false);
  const [postTourTarget, setPostTourTarget] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [retrySave, setRetrySave] = useState(null);
  const mutationVersions = useRef(new Map());
  const mutationQueues = useRef(new Map());
  const confirmedHomes = useRef(new Map(initialHomes.map((home) => [home.id, home])));
  const autoOpenedRef = useRef(false);

  // The guard prevents concurrent effects / duplicate native events from
  // opening intake twice, but it must not outlive the consumed query. Without
  // this reset, a second Share Extension handoff while HomesBoard remained
  // mounted was silently ignored after the first handoff cleared the URL.
  useEffect(() => {
    const hasAutoOpenRequest = searchParams.get('add') === '1'
      || searchParams.get('home') !== null
      || searchParams.has('url');
    if (!hasAutoOpenRequest) autoOpenedRef.current = false;
  }, [searchParams]);

  // Single entry point for opening Add/Edit Home — every caller states its
  // own autoFind intent explicitly (defaulting off) instead of any of them
  // reading shared, possibly-stale state, so a later, unrelated open can
  // never accidentally inherit a previous open's auto-find intent.
  const openHomeModal = useCallback((home, { autoFind = false } = {}) => {
    setModalAutoFind(autoFind);
    setModalHome(home);
  }, []);

  useEffect(() => {
    if (mode === 'homes' && !autoOpenedRef.current && searchParams.get('add') === '1') {
      autoOpenedRef.current = true;
      openHomeModal(emptyHome());
      router.replace('/homes');
    }
  }, [mode, searchParams, router, openHomeModal]);

  useEffect(() => {
    const requestedId = searchParams.get('home');
    if (mode !== 'homes' || !requestedId || autoOpenedRef.current) return;
    const requestedHome = homes.find((home) => String(home.id) === requestedId);
    if (!requestedHome) return;
    autoOpenedRef.current = true;
    // Older links (/homes?home=<id>) open the home overlay.
    router.replace(`/homes/${encodeURIComponent(requestedHome.id)}`, { scroll: false });
  }, [mode, searchParams, router, homes]);

  // Share intake contract: /homes?url=<listing URL> opens Add Home pre-filled
  // and auto-looked-up, exactly as if the URL had been pasted into the
  // existing Find-a-home bar by hand — see HomeModal's autoFindOnMount. This
  // is the landing point a future native iOS Share Extension would send a
  // shared listing link to (see docs/share-intake-contract.md); nothing
  // about Share Extensions/Universal Links is implemented here, just this
  // already-web-safe entry point.
  //
  // The autoFind intent is captured into modalAutoFind right here, at the
  // moment the param is consumed — not re-derived from searchParams later —
  // so router.replace clearing the URL immediately afterward can't turn it
  // back off. autoOpenedRef still guarantees this whole effect, URL param
  // included, only ever fires once.
  useEffect(() => {
    const rawUrl = searchParams.get('url');
    if (mode !== 'homes' || rawUrl === null || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    if (isNativeApp()) console.info('[FLH Native QA] share intake received');

    // An already-saved home with this exact listing URL wins over creating
    // another — "the user should add the home once." Anything less certain
    // than an exact URL match (a different query string, a re-shortened
    // link) is left alone rather than guessing two listings are the same
    // property.
    const existing = findHomeByListingUrl(homes, rawUrl);
    if (existing) {
      if (isNativeApp()) console.info('[FLH Native QA] share intake matched existing home');
      router.replace(`/homes/${encodeURIComponent(existing.id)}`);
      return;
    }

    // Empty (`?url=`) or not a real http(s) URL (malformed, an unsupported
    // scheme, plain garbage text) never gets treated as a shared link — that
    // would either fabricate identity from noise or run handleFind's plain-
    // text/address fallback on a value the user never actually typed. Either
    // way the existing Add Home flow still opens, ready for manual entry.
    const validUrl = isLikelyListingUrl(rawUrl);
    if (isNativeApp()) console.info(`[FLH Native QA] share intake ${validUrl ? 'starting import' : 'using manual entry'}`);
    openHomeModal(validUrl ? { ...emptyHome(), listingUrl: rawUrl.trim() } : emptyHome(), { autoFind: validUrl });
    router.replace('/homes');
  }, [mode, searchParams, router, homes, openHomeModal]);

  const saveHome = useCallback(async (home, { shared = true, optimistic = false, keepModalOpen = false } = {}) => {
    const supabase = createClient();
    const previous = homes.find((candidate) => candidate.id === home.id);
    const version = (mutationVersions.current.get(home.id) || 0) + 1;
    mutationVersions.current.set(home.id, version);
    if (optimistic) setHomes((current) => current.map((candidate) => candidate.id === home.id ? home : candidate));
    let saved;
    try {
      const write = () => shared
        ? saveHomePersonalAndShared(supabase, home, userId, searchId)
        : saveHomePersonalState(supabase, home, userId, searchId);
      const pending = (mutationQueues.current.get(home.id) || Promise.resolve()).then(write, write);
      mutationQueues.current.set(home.id, pending.catch(() => {}));
      saved = await pending;
    } catch (err) {
      // Previously uncaught: any Supabase error here (a missing column from a
      // migration that hasn't been applied yet, a network hiccup, etc.) threw
      // straight past setModalHome(null) below, leaving Edit Home permanently
      // stuck open with no explanation and Cancel as the only way out. Now it's
      // logged, surfaced here (visible once the modal closes), and re-thrown so
      // HomeModal's own catch can show it immediately, right where the user is
      // looking, without losing anything they'd entered.
      console.error('saveHome failed', err);
      // If the shared `homes` row was already persisted before this failure
      // (see saveHomePersonalAndShared), adopt its id so a retry updates that
      // row instead of inserting a duplicate for what was a brand-new home.
      const recoveredHome = err?.partialHomeId && !home.id ? { ...home, id: err.partialHomeId } : home;
      if (mutationVersions.current.get(home.id) === version) {
        const confirmed = confirmedHomes.current.get(home.id) || previous;
        if (optimistic && confirmed) setHomes((current) => current.map((candidate) => candidate.id === home.id ? confirmed : candidate));
        setSaveError("Couldn't save that change. Try again.");
        setRetrySave(() => () => saveHome(recoveredHome, { shared, optimistic }));
      }
      throw err;
    }
    // Keep server-derived co-buyer signals while replacing only this user's
    // freshly saved personal state and the shared home fields.
    confirmedHomes.current.set(saved.id, { ...(confirmedHomes.current.get(saved.id) || {}), ...saved });
    if (mutationVersions.current.get(home.id) === version) {
      setHomes((prev) => (prev.some((h) => h.id === saved.id) ? prev.map((h) => (h.id === saved.id ? { ...h, ...saved } : h)) : [...prev, saved]));
    }
    // A new home keeps Add Home on "Adding…" until Home Facts opens.
    if (!keepModalOpen) setModalHome(null);
    setSaveError('');
    setRetrySave(null);
    // Favorites/Archive nav visibility is computed server-side in the layout — refresh
    // it so a first favorite/archive (or the last one being undone) updates the nav
    // right away instead of only after a manual reload.
    router.refresh();
    return saved;
  }, [userId, searchId, router, homes]);

  // A brand-new home lands on its Home Facts once it is actually saved — never
  // before. "New" comes from the home the modal was opened with, so a retry
  // that adopted a partially-saved row's id (partialHomeId) still lands there.
  const saveEditedHome = useCallback(async (home) => {
    const isNew = !modalHome?.id;
    const shared = !home.id || hasSharedHomeChanges(home, modalHome);
    const saved = await saveHome(home, { shared, keepModalOpen: isNew });
    if (isNew && saved?.id) {
      // The disappearing home. saveHome's router.refresh() is discarded by the
      // navigation below, so the client Router Cache kept My Homes' pre-save
      // payload — and Back (button or browser) restores that cache as is: the
      // just-saved home was missing until a reload, unless a later edit on Home
      // Facts happened to refresh. (A refresh dispatched after the push is no
      // fix either: while the navigation is in flight it cancels it.) Awaiting
      // a revalidating Server Action rebuilds the whole cache from the server
      // first; the macrotask lets the router commit that state before the
      // navigation starts, so nothing pending can be discarded.
      await refreshMyHomes().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The new home opens in the overlay over this board (which stays
      // mounted), so Close steps back to exactly this view.
      if (workspace) workspace.openedFromBoard.current = true;
      router.push(`/homes/${encodeURIComponent(saved.id)}`, { scroll: false });
      setModalHome(null);
    }
    return saved;
  }, [modalHome, saveHome, router, workspace]);

  // Opening a home (card, Edit): the overlay route. On My Homes the board stays
  // underneath, so Close can step Back to it.
  const markOpenedFromBoard = useCallback(() => {
    if (workspace && mode === 'homes') workspace.openedFromBoard.current = true;
  }, [workspace, mode]);
  const openHome = useCallback((home) => {
    if (!home?.id) { openHomeModal(home); return; }
    markOpenedFromBoard();
    router.push(overlayHref(home.id, mode), { scroll: false });
  }, [markOpenedFromBoard, router, mode, openHomeModal]);

  // "This one is worth seeing." One tap, no modal, no confirmation — reuses the
  // existing status field, just moving it to a value it already supports.
  const wantToTour = useCallback((home) => {
    const next = { ...home, status: 'Want to Tour' };
    const savedVersion = homes.find((candidate) => candidate.id === home.id);
    saveHome(next, { shared: hasSharedHomeChanges(next, savedVersion), optimistic: true }).catch(() => {});
  }, [homes, saveHome]);

  // "I'm still considering this home, but not on my tour list." Reverses Want to
  // Tour back to the normal active status — not Archive, not deletion, no
  // confirmation, and every other field (ratings, notes, Match inputs) untouched.
  const removeFromTour = useCallback((home) => {
    saveHome({ ...home, status: 'Saved' }, { shared: false, optimistic: true }).catch(() => {});
  }, [saveHome]);

  // A tour reaction is participant-owned feedback, not a home-status command.
  // In particular, "Definitely not" never archives implicitly.
  const handleVerdict = useCallback((home, verdict, patch) => {
    const next = applyPostTourVerdict(home, verdict, patch);
    return saveHome(next, { shared: hasSharedHomeChanges(next, home) });
  }, [saveHome]);

  const confirmArchive = useCallback((reason) => {
    if (!archiveTarget) return;
    const next = archiveHome(archiveTarget, reason);
    const savedVersion = homes.find((home) => home.id === archiveTarget.id);
    saveHome(next, { shared: hasSharedHomeChanges(next, savedVersion), optimistic: true }).catch(() => {});
    setArchiveTarget(null);
  }, [archiveTarget, homes, saveHome]);

  const restoreHome = useCallback((home) => {
    saveHome(restoreLifecycleHome(home), { shared: false, optimistic: true }).catch(() => {});
  }, [saveHome]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const previous = deleteTarget;
    const id = deleteTarget.id;
    setHomes((prev) => prev.filter((h) => h.id !== id));
    setDeleteTarget(null);
    const supabase = createClient();
    try {
      await deleteHomeQuery(supabase, id);
      router.refresh();
    } catch {
      setHomes((current) => current.some((home) => home.id === id) ? current : [...current, previous]);
      setSaveError("Couldn't delete that home. Try again.");
      setRetrySave(() => async () => {
        await deleteHomeQuery(createClient(), id);
        setHomes((current) => current.filter((home) => home.id !== id));
        setSaveError('');
        setRetrySave(null);
        router.refresh();
      });
    }
  }, [deleteTarget, router]);

  const activeHomes = useMemo(() => homes.filter((h) => !isArchivedStatus(h.status)), [homes]);
  const archivedHomes = useMemo(() => homes.filter((h) => isArchivedStatus(h.status)), [homes]);
  const favoriteHomes = useMemo(() => activeHomes.filter(isFavoriteHome), [activeHomes]);
  const tourHomes = useMemo(
    () => activeHomes.filter((h) => (
      currentUserWantsToTour(h) || h.coBuyerWantsToTour
    )),
    [activeHomes]
  );

  const baseList = mode === 'archive' ? archivedHomes : mode === 'favorites' ? favoriteHomes : mode === 'tour' ? tourHomes : activeHomes;

  // The one canonical Match evaluation for filtering, sorting, and counting:
  // computeMatch with the same Commute route results (session cache) each card
  // renders from — never a second, commute-less pathway.
  const commuteCacheVersion = useCommuteCacheVersion();
  const evaluate = useMemo(() => {
    const cache = new Map();
    return (home) => {
      if (!cache.has(home)) {
        const commuteEvaluation = evaluateCommute(initialCommuteDestinations, (destination) => readCommuteResult(home, destination));
        cache.set(home, computeMatch(home, priorities, commuteEvaluation));
      }
      return cache.get(home);
    };
    // commuteCacheVersion invalidates the memo whenever route results arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorities, initialCommuteDestinations, commuteCacheVersion]);

  // Search text and the quick chips narrow first; Filter My Homes then
  // classifies what is left. The buyer's sort is applied last and never changed.
  const filterCriteria = useMemo(() => filterableCriteria(priorities), [priorities]);
  const isRental = normalizeSearchIntent(priorities.searchType) === 'rental';
  const quickFiltered = useMemo(() => (mode === 'homes' ? applyContenderFilters(baseList, filters, evaluate, query) : baseList), [baseList, query, mode, filters, evaluate]);
  const refinement = useMemo(
    () => applyHomeFilters(quickFiltered, mode === 'homes' ? homeFilters : EMPTY_HOME_FILTERS, evaluate, { criteria: filterCriteria, rental: isRental }),
    [quickFiltered, mode, homeFilters, evaluate, filterCriteria, isRental]
  );
  const previewHomeFilters = useCallback((draft) => {
    const preview = applyHomeFilters(quickFiltered, draft, evaluate, { criteria: filterCriteria, rental: isRental });
    return { ...preview.counts, active: preview.active };
  }, [quickFiltered, evaluate, filterCriteria, isRental]);
  const filtered = useMemo(() => {
    if (mode !== 'homes') return baseList;
    return sortContenders(refinement.visible, sortBy, evaluate);
  }, [baseList, mode, refinement, sortBy, evaluate]);
  const clearAllFilters = () => { setFilters({ ...EMPTY_FILTERS }); setHomeFilters({ ...EMPTY_HOME_FILTERS }); };
  const removeHomeFilter = (key) => setHomeFilters((current) => {
    if (key === 'price') return { ...current, priceMin: '', priceMax: '' };
    if (key === 'sqft') return { ...current, sqftMin: '', sqftMax: '' };
    if (key === 'lot') return { ...current, lotMinAcres: '' };
    if (key === 'beds') return { ...current, bedsMin: '' };
    if (key === 'baths') return { ...current, bathsMin: '' };
    if (key === 'propertyType') return { ...current, propertyTypes: [] };
    return { ...current, criteria: current.criteria.filter((criterion) => `criterion:${criterion}` !== key) };
  });

  const filterCounts = useMemo(() => singleFilterCounts(activeHomes, evaluate), [activeHomes, evaluate]);
  const activeLabels = activeFilterLabels(filters);
  const toggleChip = (key) => (key === 'all' ? clearAllFilters() : setFilters((current) => {
    if (key === 'match90') return { ...current, minMatch: current.minMatch === 90 ? null : 90 };
    return { ...current, [key]: !current[key] };
  }));
  const chipOn = (key) => (key === 'all' ? activeFilterCount(filters) === 0 && !refinement.active : key === 'match90' ? filters.minMatch === 90 : !!filters[key]);

  if (mode === 'archive') {
    return (
      <>
        {saveError && <div className="hh-save-error" role="alert">{saveError}{retrySave && <> <button type="button" onClick={() => retrySave().catch(() => {})}>Retry</button></>}</div>}
        {archivedHomes.length === 0 ? (
          <EmptyLifecycleState icon={ArchiveIcon} title="Nothing archived." body="Homes you set aside will stay here with your notes and history intact." />
        ) : (
          <CardGrid homes={archivedHomes} priorities={priorities} commuteDestinations={initialCommuteDestinations} mode={mode} onEdit={openHome} onOpen={markOpenedFromBoard} onRestore={restoreHome} onRequestDelete={setDeleteTarget} />
        )}
        {modalHome && <HomeModal initial={modalHome} priorities={priorities} sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative} userId={userId} onSave={saveEditedHome} onClose={() => setModalHome(null)} onWantToTour={wantToTour} onArchiveRequest={setArchiveTarget} />}
        {deleteTarget && (
          <ConfirmModal
            title="Delete this home permanently?"
            body={`${deleteTarget.address || 'This home'} and everything attached to it — ratings, notes, photos — will be gone for good. This can't be undone.`}
            confirmLabel="Delete permanently"
            onCancel={() => setDeleteTarget(null)}
            onConfirm={confirmDelete}
          />
        )}
      </>
    );
  }

  const chips = [
    { key: 'all', label: 'All' },
    { key: 'match90', label: '90%+ Matches' },
    { key: 'noMustMissing', label: 'No Must-Haves Missing' },
    { key: 'wantToTour', label: 'Want to Tour' },
  ];

  return (
    <>
      {mode === 'homes' && (
        <section className="hh-homes-toolbar" aria-label={`Search, sort and filter ${vocabulary.pluralLower}`}>
          <div className="hh-homes-toolbar-row">
            <label className="hh-homes-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search your {vocabulary.pluralLower}</span>
              <input type="search" placeholder="Search address, city, or feature..." value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label className="hh-homes-sort">
              <span className="hh-homes-sort-prefix">Sort By:</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label={`Sort ${vocabulary.pluralLower}`}>
                {SORT_MENU.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
            <button type="button" className="hh-btn hh-homes-add" onClick={() => openHomeModal(emptyHome())}>
              <span aria-hidden="true">+</span> Add a {vocabulary.singular}
            </button>
          </div>
          <div className="hh-homes-toolbar-row is-secondary">
            <div className="hh-filter-chips" role="group" aria-label={`Filter ${vocabulary.pluralLower}`}>
              <button
                type="button" className={`hh-filter-open${refinement.active ? ' is-active' : ''}`} aria-haspopup="dialog"
                aria-label={refinement.active ? `Filter, ${refinement.conditions.length} active` : `Filter ${vocabulary.pluralLower}`}
                onClick={() => setFiltersOpen(true)}
              >
                <SlidersHorizontal size={14} aria-hidden="true" /> Filter
                {refinement.active && <span className="hh-filter-open-count" aria-hidden="true">{refinement.conditions.length}</span>}
              </button>
              <span className="hh-filter-divider" aria-hidden="true" />
              {chips.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`hh-chip ${chipOn(f.key) ? 'on' : ''}`}
                  aria-pressed={chipOn(f.key)}
                  onClick={() => toggleChip(f.key)}
                >
                  {f.label} ({filterCounts[f.key]})
                </button>
              ))}
            </div>
            {collaborationSlot && <div className="hh-homes-collaboration">{collaborationSlot}</div>}
          </div>
          {refinement.active && (
            <div className="hh-refine-summary" role="status" aria-live="polite">
              <p className="hh-refine-summary-counts">
                <strong>{refinement.counts.confirmed} confirmed</strong>
                <span>{refinement.counts.possible} possible</span>
                <span>{refinement.counts.excluded} don’t match</span>
                <span className="hh-refine-summary-of">of {refinement.counts.total} {refinement.counts.total === 1 ? vocabulary.singularLower : vocabulary.pluralLower}</span>
              </p>
              <ul className="hh-refine-pills" aria-label="Active filters">
                {refinement.conditions.map((condition) => (
                  <li key={condition.key}>
                    <button type="button" className="hh-refine-pill" onClick={() => removeHomeFilter(condition.key)} aria-label={`Remove filter: ${condition.label}`}>
                      {condition.label} <X size={12} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="hh-refine-summary-actions">
                <div className="hh-refine-segments is-compact" role="radiogroup" aria-label="Which matches to show">
                  <button type="button" role="radio" aria-checked={refinement.show === SHOW_CONFIRMED} className={`hh-refine-segment${refinement.show === SHOW_CONFIRMED ? ' on' : ''}`} onClick={() => setHomeFilters((current) => ({ ...current, show: SHOW_CONFIRMED }))}>Confirmed only</button>
                  <button type="button" role="radio" aria-checked={refinement.show === SHOW_POSSIBLE} className={`hh-refine-segment${refinement.show === SHOW_POSSIBLE ? ' on' : ''}`} onClick={() => setHomeFilters((current) => ({ ...current, show: SHOW_POSSIBLE }))}>Confirmed + possible</button>
                </div>
                <button type="button" className="hh-refine-clear" onClick={() => setHomeFilters({ ...EMPTY_HOME_FILTERS })}>Clear filters</button>
              </div>
            </div>
          )}
        </section>
      )}

      {saveError && <div className="hh-save-error" role="alert">{saveError}{retrySave && <> <button type="button" onClick={() => retrySave().catch(() => {})}>Retry</button></>}</div>}

      {filtered.length === 0 ? (
        mode === 'favorites' ? (
          <EmptyLifecycleState icon={Heart} title="No favorites yet." body={`Favorite a ${vocabulary.singularLower} from its details page to keep it close.`}>
            <Link href="/homes" className="hh-btn hh-btn-ghost">Go to My Homes</Link>
          </EmptyLifecycleState>
        ) : mode === 'tour' ? (
          <EmptyLifecycleState icon={Footprints} title="Nothing on the tour list yet." body="When a home feels worth seeing in person, mark it Want to Tour.">
            <Link href="/homes" className="hh-btn hh-btn-ghost">Go to My Homes</Link>
          </EmptyLifecycleState>
        ) : (
          activeHomes.length > 0 && refinement.active && quickFiltered.length > 0 ? (
            <div className="hh-homes-empty is-filtered">
              <p className="hh-homes-empty-title">No {vocabulary.pluralLower} meet every filter yet</p>
              <p>
                {refinement.show === SHOW_CONFIRMED && refinement.counts.possible > 0
                  ? `${refinement.counts.possible} ${refinement.counts.possible === 1 ? `${vocabulary.singularLower} might` : `${vocabulary.pluralLower} might`} — something is still unknown.`
                  : `Try relaxing a filter. Your saved ${vocabulary.pluralLower} are all still here.`}
              </p>
              <div className="hh-homes-empty-actions">
                {refinement.show === SHOW_CONFIRMED && refinement.counts.possible > 0 && (
                  <button type="button" className="hh-btn" onClick={() => setHomeFilters((current) => ({ ...current, show: SHOW_POSSIBLE }))}>Show possible matches</button>
                )}
                <button type="button" className="hh-btn hh-btn-ghost" onClick={() => setFiltersOpen(true)}>Adjust filters</button>
                <button type="button" className="hh-btn hh-btn-ghost" onClick={clearAllFilters}>Clear filters</button>
              </div>
            </div>
          ) : (
          <div className="hh-homes-empty">
            <p className="hh-homes-empty-title">{activeHomes.length === 0 ? vocabulary.apartment ? "No properties yet" : "You found the homes. We'll help you choose." : 'Nothing matches that search'}</p>
            <p>{activeHomes.length === 0 ? 'Paste a listing link from anywhere to get started.' : 'Try a different search or filter.'}</p>
            {activeHomes.length > 0 && (activeLabels.length > 0 || refinement.active) && <button type="button" className="hh-btn hh-btn-ghost" onClick={clearAllFilters}>Clear filters</button>}
            {activeHomes.length === 0 && <button type="button" className="hh-btn" onClick={() => openHomeModal(emptyHome())}><Plus size={15} aria-hidden="true" /> Add a {vocabulary.singular}</button>}
          </div>
          )
        )
      ) : (
        <CardGrid
          homes={filtered} priorities={priorities} commuteDestinations={initialCommuteDestinations} mode={mode} filterResults={refinement.active ? refinement.byId : null} onEdit={openHome} onOpen={markOpenedFromBoard} onArchiveRequest={setArchiveTarget}
          onWantToTour={wantToTour} onOpenPostTour={setPostTourTarget} onRemoveFromTour={removeFromTour}
          onRestore={restoreHome} onRequestDelete={setDeleteTarget}
        />
      )}

      {mode === 'homes' && (
        <HomeFiltersSheet
          open={filtersOpen} initial={homeFilters} criteria={filterCriteria} vocabulary={vocabulary} rental={isRental} showLot={!vocabulary.apartment}
          preview={previewHomeFilters} onApply={(next) => { setHomeFilters(next); setFiltersOpen(false); }} onClose={() => setFiltersOpen(false)}
        />
      )}

      {modalHome && (
        <HomeModal
          initial={modalHome} priorities={priorities} sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative} userId={userId}
          onSave={saveEditedHome} onClose={() => setModalHome(null)} onWantToTour={wantToTour} onArchiveRequest={setArchiveTarget}
          autoFindOnMount={modalAutoFind} existingHomes={homes} importLanding
        />
      )}

      {postTourTarget && (
        <PostTourModal
          key={`${postTourTarget.id}:${postTourTarget.reaction ?? 'none'}`}
          home={postTourTarget}
          priorities={priorities}
          isCollaborative={isCollaborative}
          onVerdict={handleVerdict}
          onClose={() => setPostTourTarget(null)}
        />
      )}

      {archiveTarget && (
        <ArchiveConfirmModal
          home={archiveTarget}
          onCancel={() => setArchiveTarget(null)}
          onConfirm={confirmArchive}
        />
      )}
    </>
  );
}
