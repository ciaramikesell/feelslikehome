'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, Search, Archive as ArchiveIcon, ExternalLink,
  Heart, Home as HomeIcon, Undo2, Footprints, MessageCircle, Check,
  StickyNote, Pencil,
} from 'lucide-react';
import { MatchSummary, MatchTradeoffs } from '@/components/ui';
import { useCommuteObserver } from '@/lib/useCommuteObserver';
import { evaluateCommute } from '@/lib/commute';
import HomeModal from '@/components/HomeModal';
import PostTourModal from '@/components/PostTourModal';
import ArchiveConfirmModal from '@/components/ArchiveConfirmModal';
import Sheet from '@/components/Sheet';
import MobileDisclosure from '@/components/MobileDisclosure';
import { emptyHome, isArchivedStatus } from '@/lib/constants';
import { isLikelyListingUrl, findHomeByListingUrl } from '@/lib/listingUrl';
import { parseNum, fmtMoney, trueCheckLabels, homeStyleSummary, computeMatch, matchColor, matchTint, summarizeForCard } from '@/lib/matching';
import { homeIdentity, homeVocabulary } from '@/lib/homePresentation';
import { formatHomePrice, formatLotSizeDisplay, parseCommaList } from '@/lib/homeDisplay';
import { searchIntentCapabilities } from '@/lib/searchIntent';
import { isNativeApp } from '@/lib/platform';
import { deriveFlhMoment } from '@/lib/flhMoments';
import { applyPostTourVerdict, archiveHome, hasToured, isFavoriteHome, restoreHome as restoreLifecycleHome, toggleFavorite as toggleFavoriteState } from '@/lib/lifecycle';
import { createClient } from '@/lib/supabase/client';
import { deleteHome as deleteHomeQuery } from '@/lib/supabase/data';
import {
  deriveWantToTourState, hasSharedHomeChanges, saveHomePersonalAndShared, saveHomePersonalState,
} from '@/lib/supabase/collaboration';

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

function HomeCard({ home, priorities, commuteDestinations, mode, onEdit, onArchiveRequest, onToggleFavorite, onWantToTour, onOpenPostTour, onRemoveFromTour, onRestore, onRequestDelete }) {
  const [imgError, setImgError] = useState(false);
  const styleSummary = homeStyleSummary(home);
  const showPhoto = home.photoUrl && !imgError;
  const isFavorite = home.isFavorite;
  const [favoritePop, setFavoritePop] = useState(false);
  const favoritePopTimer = useRef(null);
  const identity = homeIdentity(home, priorities);
  // Normalize lifecycle presentation without touching stored data: any status that
  // isn't 'Want to Tour' or 'Toured' is treated as pre-tour, whether it's the current
  // 'Saved' value or a legacy string like 'Considering' left over from before this
  // lifecycle existed (see rowToHome's 'Considering' fallback in supabase/data.js).
  const toured = hasToured(home);
  const isPreTour = !toured && home.status !== 'Want to Tour';
  // Heart/Archive as quick one-tap controls only make sense once favoriting is
  // itself the primary job of the view. In Want to Tour, "Love it" is reached only
  // through the Post-Tour reflection ("Edit my thoughts") — never a shortcut that
  // bypasses recording ratings/notes for a toured home.
  const showQuickFavorite = mode !== 'archive';
  const wantToTourState = home.isCollaborative
    ? deriveWantToTourState(home, home.coBuyerWantsToTour ? [{ status: 'Want to Tour' }] : [])
    : null;
  const moment = deriveFlhMoment(home);

  useEffect(() => () => clearTimeout(favoritePopTimer.current), []);

  const handleFavorite = () => {
    if (!isFavorite) {
      clearTimeout(favoritePopTimer.current);
      setFavoritePop(true);
      favoritePopTimer.current = setTimeout(() => setFavoritePop(false), 220);
    }
    onToggleFavorite(home);
  };

  const { setRef: commuteRef, getState: getCommuteState } = useCommuteObserver(home, commuteDestinations);
  const commuteEvaluation = evaluateCommute(commuteDestinations, getCommuteState);
  const match = computeMatch(home, priorities, commuteEvaluation);
  const matchState = summarizeForCard(match);
  const { showsPurchaseFinancials } = searchIntentCapabilities(priorities.searchType);

  // Core property facts — beds/baths/sqft/lot only. Garage is deliberately not
  // repeated here: when it's actually a priority the user selected, it already
  // surfaces through the Match box's fulfilled-criteria line below, rather than
  // being shown twice regardless of whether the user cares about it.
  const factLine = [
    home.beds && `${home.beds} bd`,
    home.baths && `${home.baths} ba`,
    home.sqft && `${parseNum(home.sqft)?.toLocaleString()} sq ft`,
    home.lotSize && formatLotSizeDisplay(home.lotSize),
  ].filter(Boolean);

  // Compact descriptive property-facts strip — purely descriptive shared facts
  // ("what this home has"), never a Match input and never duplicated into the
  // Matches/Missing/Not Confirmed section ("whether I care"). Garage reuses the
  // existing shared descriptive field; Basement/Schools are the new Property
  // Details text fields. Condition Notes is deliberately NOT included here —
  // see the separate placement near Pros/Cons/Notes below.
  const schoolName = home.schoolsNotes?.replace(/\s*(?:—|-)\s*\d+(?:\.\d+)?\s*\/\s*10\s*$/i, '').trim();
  const propertyFacts = [
    home.garageSpaces && { label: 'Garage', text: home.garageSpaces },
    home.basementNotes && { label: 'Basement', text: home.basementNotes },
    home.homeCondition?.length && { label: 'Home condition', text: home.homeCondition.join(', ') },
    styleSummary && { label: 'Style', text: styleSummary },
    schoolName && { label: 'Schools', text: schoolName },
  ].filter(Boolean);

  const pros = parseCommaList(home.pros);
  const cons = parseCommaList(home.cons);
  const noteCount = [home.notes, home.conditionNotes, ...pros, ...cons].filter(Boolean).length;
  const mustMissing = matchState.missing.filter((item) => item.tier === 'must');
  const mustUnknown = matchState.notConfirmed.filter((item) => item.tier === 'must');
  const positives = matchState.matches.filter((item) => item.tier !== 'must').slice(0, 3);
  const negatives = matchState.missing.filter((item) => item.tier !== 'must').slice(0, 3);
  // Secondary, already-known context (facts/commute/notes) — kept out of the
  // way behind "More details" on narrow viewports so a mobile card reads as
  // price/address/Match/status first, not a full restack of every field.
  // Desktop keeps this always open (see .hh-card-context-details in
  // globals.css); nothing here is ever hidden from desktop.
  const hasCardContext = propertyFacts.length > 0 || commuteDestinations.length > 0 || !!home.conditionNotes || pros.length > 0 || cons.length > 0 || !!home.notes;
  const coBuyerActivity = home.coBuyerWantsToTour ? 'Co-buyer wants to tour' : home.coBuyerFavorited ? 'Co-buyer favorited' : null;

  return (
    <article className={`hh-home-card hh-corner ${mode === 'archive' ? 'is-archived' : ''}`} ref={commuteRef}>
      <div className="hh-home-card-surface">
        <div className={`hh-home-card-photo ${showPhoto ? '' : 'is-empty'}`}>
        <Link href={`/homes/${encodeURIComponent(home.id)}`} className="hh-home-card-photo-link" aria-label={`Open ${identity.accessible} details`}>
          {showPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={home.photoUrl} alt={`${identity.accessible} ${homeVocabulary(priorities).singularLower} photo`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={() => setImgError(true)} />
          ) : (
            <div className="hh-home-card-photo-fallback">
              <HomeIcon size={34} color="rgba(46,38,33,0.22)" strokeWidth={1.5} />
            </div>
          )}
          {!toured && home.status === 'Want to Tour' && (
            <span className="hh-card-status hh-mono">WANT TO TOUR</span>
          )}
          {moment && !coBuyerActivity && (
            <span className="hh-flh-moment" aria-label={moment.hasEyes ? `${moment.label}. Shared home signal.` : `${moment.label}.`}>
              {moment.hasEyes && <span aria-hidden="true">👀 </span>}{moment.label}
            </span>
          )}
          {home.suggestedBy && <span className="hh-image-provenance">Suggested by {home.suggestedBy}</span>}
          {coBuyerActivity && <span className="hh-cobuyer-activity">{coBuyerActivity}</span>}
        </Link>
          {showQuickFavorite && (
            <button type="button" className="hh-card-favorite hh-tooltip" onClick={handleFavorite} aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'} data-tooltip={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
              <Heart className={favoritePop ? 'hh-favorite-pop' : undefined} size={18} color={isFavorite ? 'var(--brick)' : 'var(--ink)'} fill={isFavorite ? 'var(--brick)' : 'none'} />
            </button>
          )}
        </div>

        <div className="hh-home-card-body" style={{ padding: '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="hh-card-price-row">
            <span className="hh-mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--brick)' }}>{formatHomePrice(home.price, priorities.searchType) || 'Price not added'}</span>
            {showsPurchaseFinancials && home.estMonthly && <span className="hh-mono" style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{fmtMoney(home.estMonthly)}/mo est.</span>}
          </div>

          <div>
            <Link href={`/homes/${encodeURIComponent(home.id)}`} className="hh-home-identity-link">
              <div className="hh-address" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.28, color: 'var(--ink)' }}>{identity.primary}</div>
              {identity.option && <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>{identity.option}</div>}
              {identity.supporting && <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginTop: 1 }}>{identity.supporting}</div>}
            </Link>
          </div>

          {factLine.length > 0 && (
            <div className="hh-mono" style={{ fontSize: 12.5, color: 'var(--ink-soft)', display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
              {factLine.map((item, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
                  {i > 0 && <span style={{ color: 'var(--line)', margin: '0 7px' }}>•</span>}
                  {item}
                </span>
              ))}
            </div>
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
            <div className={`hh-match-panel${mode === 'archive' ? ' is-secondary' : ''}`} style={{ background: matchTint(match.pct), borderLeft: `${mode === 'archive' ? 2 : 3}px solid ${matchColor(match.pct)}` }}>
              <div className="hh-match-eyebrow">Personalized Match</div>
              <MatchSummary match={match} />
              {match.mustTotal > 0 && <div className="hh-must-summary"><strong>Must Haves</strong><span className={mustMissing.length ? 'is-negative' : 'is-positive'}>{mustMissing.length ? `✕ ${match.mustMet}/${match.mustTotal} met` : `✓ ${match.mustMet}/${match.mustTotal} met`}</span>{mustMissing.slice(0, 2).map((item) => <span className="is-negative" key={item.key}>✕ {item.label}</span>)}{mustUnknown.length > 0 && <span className="is-unknown">? {mustUnknown.length} Must Have{mustUnknown.length > 1 ? 's' : ''} not evaluated</span>}</div>}
              {(positives.length > 0 || negatives.length > 0) && <div className="hh-personalized-criteria"><strong>Personalized Criteria</strong>{negatives.map((item) => <span className="is-negative" key={item.key}>✕ {item.label}</span>)}{positives.map((item) => <span className="is-positive" key={item.key}>✓ {item.label}</span>)}</div>}
              <MatchTradeoffs match={match} />
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Set your priorities in <em>My Search</em> to see a match score.</div>
          )}

          {mode === 'tour' && wantToTourState?.wantToTourLabel && (
            <div className="hh-lifecycle-status">
              <Footprints size={12} color="var(--moss)" /> {wantToTourState.wantToTourLabel}
            </div>
          )}

          {!toured && home.status === 'Want to Tour' && mode === 'homes' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>
              <Check size={14} color="var(--moss)" /> Want to tour
            </div>
          )}
          {!toured && home.status === 'Want to Tour' && mode !== 'homes' && (
            <button type="button" className="hh-btn" style={{ fontSize: 12.5, padding: '7px 12px', justifyContent: 'center' }} onClick={() => onOpenPostTour(home)}>
              <MessageCircle size={13} /> I toured this home
            </button>
          )}
          {toured && (
            <button
              type="button"
              className="hh-btn hh-btn-ghost"
              style={{ fontSize: 12.5, padding: '7px 12px', justifyContent: 'center', borderColor: 'rgba(193,89,47,0.4)', color: 'var(--brick)' }}
              onClick={() => onOpenPostTour(home)}
            >
              <MessageCircle size={13} /> Edit my thoughts
            </button>
          )}

          {hasCardContext && (
          <MobileDisclosure>
          {propertyFacts.length > 0 && (
            <div className="hh-card-context-group">
              <div className="hh-context-heading">Home Snapshot</div>
              {propertyFacts.map(({ label, text }, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{label}</span>{' '}
                  <span>{text}</span>
                </div>
              ))}
            </div>
          )}

          {commuteDestinations.length > 0 && (() => {
            const shown = commuteDestinations.slice(0, 1);
            return (
              <div className="hh-card-commute">
                <div className="hh-card-commute-label">Commute</div>
                {shown.map((d) => {
                  const state = getCommuteState(d);
                  const name = d.label;
                  const text = state.status === 'ok' ? `${name}: ${state.minutes} min`
                    : state.status === 'loading' ? `${name} · Calculating…`
                    : state.status === 'destination_invalid' ? `${name} · Check the address`
                    : state.status === 'destination_ambiguous' ? `${name} · Add a city or ZIP`
                    : ['unavailable', 'no_route', 'home_unavailable', 'destination_unavailable'].includes(state.status) ? `${name} · Not available`
                    : name;
                  return <div className="hh-card-commute-route" key={d.id}>{text}</div>;
                })}
              </div>
            );
          })()}

          {noteCount > 0 && <Link className="hh-notes-indicator" href={`/homes/${encodeURIComponent(home.id)}`}><StickyNote size={13} /> Notes ({noteCount})</Link>}
          </MobileDisclosure>
          )}

          <div className="hh-home-card-actions" style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 6, marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            {home.listingUrl && (
              <a href={home.listingUrl} target="_blank" rel="noreferrer" className="hh-btn hh-btn-ghost hh-tooltip" data-tooltip="View original listing" aria-label="View original listing">
                <ExternalLink size={13} />
              </a>
            )}
            {mode !== 'archive' && (
              <button className="hh-btn hh-btn-ghost hh-tooltip" onClick={() => onArchiveRequest(home)} data-tooltip="Archive home" aria-label="Archive home">
                <ArchiveIcon size={13} />
              </button>
            )}
            {mode === 'tour' && !toured && home.status === 'Want to Tour' && (
              <button
                type="button"
                className="hh-btn hh-btn-quiet-action"
                onClick={() => onRemoveFromTour(home)}
                title="Remove from Want to Tour"
                aria-label="Remove from Want to Tour"
              >
                <Undo2 size={13} /> Remove mine
              </button>
            )}
            <div style={{ flex: 1 }} />

            {isPreTour && mode !== 'archive' && (
              <button
                type="button"
                className="hh-btn"
                style={{ fontSize: 11.5, padding: '6px 10px', flexShrink: 0 }}
                onClick={() => onWantToTour(home)}
              >
                <Footprints size={12} /> Want to tour
              </button>
            )}
            {!toured && home.status === 'Want to Tour' && mode === 'homes' && (
              <button type="button" className="hh-btn hh-card-primary-action is-selected" aria-pressed="true" onClick={() => onRemoveFromTour(home)}>
                <Check size={13} /> Want to Tour
              </button>
            )}

            {mode === 'archive' && (
              <button className="hh-btn hh-card-primary-action" onClick={() => onRestore(home)}><Undo2 size={13} /> Restore</button>
            )}
            <button className="hh-btn hh-card-secondary-action hh-tooltip" data-tooltip="Edit home" aria-label="Edit home" onClick={() => onEdit(home)}><Pencil size={13} /></button>
            {mode === 'archive' && (
              <button type="button" className="hh-card-text-action" onClick={() => onRequestDelete(home)}>Delete permanently</button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function CardGrid({ homes, priorities, commuteDestinations, mode, onEdit, onArchiveRequest, onToggleFavorite, onWantToTour, onOpenPostTour, onRemoveFromTour, onRestore, onRequestDelete }) {
  return (
    <div className="hh-homes-grid">
      {homes.map((h) => (
        <HomeCard
          key={h.id} home={h} priorities={priorities} commuteDestinations={commuteDestinations} mode={mode} onEdit={onEdit} onArchiveRequest={onArchiveRequest}
          onToggleFavorite={onToggleFavorite} onWantToTour={onWantToTour} onOpenPostTour={onOpenPostTour} onRemoveFromTour={onRemoveFromTour}
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

export default function HomesBoard({ mode, userId, searchId, initialHomes, initialPriorities, initialCommuteDestinations = [], sharedFactAwareness, isCollaborative = false }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [homes, setHomes] = useState(initialHomes);
  // Always render from the latest server-authorized criteria. Keeping the first
  // prop in state made unknown counts and Match summaries survive router refreshes.
  const priorities = initialPriorities;
  const vocabulary = homeVocabulary(initialPriorities);
  const [query, setQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
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
    openHomeModal(requestedHome);
    router.replace('/homes');
  }, [mode, searchParams, router, homes, openHomeModal]);

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

  const saveHome = useCallback(async (home, { shared = true, optimistic = false } = {}) => {
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
    setModalHome(null);
    setSaveError('');
    setRetrySave(null);
    // Favorites/Archive nav visibility is computed server-side in the layout — refresh
    // it so a first favorite/archive (or the last one being undone) updates the nav
    // right away instead of only after a manual reload.
    router.refresh();
  }, [userId, searchId, router, homes]);

  const saveEditedHome = useCallback((home) => {
    const shared = !home.id || hasSharedHomeChanges(home, modalHome);
    return saveHome(home, { shared });
  }, [modalHome, saveHome]);

  const toggleFavorite = useCallback((home) => {
    const next = toggleFavoriteState(home);
    saveHome(next, { shared: false, optimistic: true }).catch(() => {});
  }, [saveHome]);

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

  // What the post-tour verdict means, conceptually:
  //   Love it          -> durable tour history + verdict + Favorite
  //   Still considering -> durable tour history + considering verdict
  //   Not for me        -> NOT saved immediately — routed into the existing
  //                        archive-confirmation flow so the destructive step still
  //                        gets a confirm, with all the collected ratings/notes/
  //                        impressions carried along so nothing is lost.
  const handleVerdict = useCallback((home, verdict, patch) => {
    if (verdict === 'not_for_me') {
      setPostTourTarget(null);
      setArchiveTarget(applyPostTourVerdict(home, verdict, patch));
      return;
    }
    setPostTourTarget(null);
    const next = applyPostTourVerdict(home, verdict, patch);
    saveHome(next, { shared: hasSharedHomeChanges(next, home) }).catch(() => {});
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
      deriveWantToTourState(h).currentUserWantsToTour || h.coBuyerWantsToTour
    )),
    [activeHomes]
  );

  const baseList = mode === 'archive' ? archivedHomes : mode === 'favorites' ? favoriteHomes : mode === 'tour' ? tourHomes : activeHomes;

  const filtered = useMemo(() => {
    if (mode !== 'homes') return baseList;
    let list = baseList.filter((h) => {
      if (query.trim()) {
        const q = query.toLowerCase();
        const hay = [h.propertyName, h.address, h.selectedFloorPlanName, h.selectedUnitLabel, ...(h.homeLayout || []), h.primaryBedroomLocation, h.secondaryBedroomLocation, ...trueCheckLabels(h)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // Quick filters — a first, restrained layer for narrowing 30+ homes down
    // to a serious short list. Reuses the exact same computeMatch every card
    // already uses; no separate scoring path.
    if (quickFilter === 'match90') {
      list = list.filter((h) => { const m = computeMatch(h, priorities); return m && m.pct !== null && m.pct >= 90; });
    } else if (quickFilter === 'noMustMissing') {
      // "No Must-Haves missing" means no CONFIRMED miss — an unconfirmed
      // Must-Have does not disqualify a home from this filter. Unknown is
      // not failure here either.
      list = list.filter((h) => {
        const m = computeMatch(h, priorities);
        if (!m || m.mustTotal === 0) return true;
        return m.mustMet === m.mustEvaluated;
      });
    } else if (quickFilter === 'wantToTour') {
      list = list.filter((h) => deriveWantToTourState(h).currentUserWantsToTour);
    } else if (quickFilter === 'favorites') {
      list = list.filter((h) => h.isFavorite);
    }

    if (sortBy === 'matchDesc' || sortBy === 'matchAsc') {
      list = [...list].sort((a, b) => (computeMatch(b, priorities)?.pct ?? -1) - (computeMatch(a, priorities)?.pct ?? -1));
      if (sortBy === 'matchAsc') list.reverse();
    } else if (sortBy === 'priceAsc' || sortBy === 'priceDesc') {
      list = [...list].sort((a, b) => (parseNum(a.price) ?? Infinity) - (parseNum(b.price) ?? Infinity));
      if (sortBy === 'priceDesc') list.reverse();
    } else if (sortBy === 'newest' || sortBy === 'oldest') {
      list = [...list].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      if (sortBy === 'newest') list.reverse();
    }

    return list;
  }, [baseList, query, mode, quickFilter, sortBy, priorities]);

  const filterCounts = useMemo(() => ({
    all: activeHomes.length,
    match90: activeHomes.filter((h) => (computeMatch(h, priorities)?.pct ?? -1) >= 90).length,
    noMustMissing: activeHomes.filter((h) => { const m = computeMatch(h, priorities); return !m || m.mustMet === m.mustEvaluated; }).length,
    wantToTour: activeHomes.filter((h) => deriveWantToTourState(h).currentUserWantsToTour).length,
    favorites: activeHomes.filter(isFavoriteHome).length,
  }), [activeHomes, priorities]);

  if (mode === 'archive') {
    return (
      <>
        {saveError && <div className="hh-save-error" role="alert">{saveError}{retrySave && <> <button type="button" onClick={() => retrySave().catch(() => {})}>Retry</button></>}</div>}
        {archivedHomes.length === 0 ? (
          <EmptyLifecycleState icon={ArchiveIcon} title="Nothing archived." body="Homes you set aside will stay here with your notes and history intact." />
        ) : (
          <CardGrid homes={archivedHomes} priorities={priorities} commuteDestinations={initialCommuteDestinations} mode={mode} onEdit={openHomeModal} onRestore={restoreHome} onRequestDelete={setDeleteTarget} />
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

  return (
    <>
      {mode === 'homes' && (
        <div className="hh-homes-primary-action">
          <button className="hh-btn" onClick={() => openHomeModal(emptyHome())}><Plus size={15} /> Add Home Listing</button>
        </div>
      )}

      {saveError && <div className="hh-save-error" role="alert">{saveError}{retrySave && <> <button type="button" onClick={() => retrySave().catch(() => {})}>Retry</button></>}</div>}

      {mode === 'homes' && (
        <section className="hh-homes-toolbar" aria-label={`Search and filter ${vocabulary.pluralLower}`}>
        <div className="hh-homes-toolbar-row">
          <div className="hh-homes-search">
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--ink-soft)' }} />
            <input className="hh-input" style={{ paddingLeft: 30 }} placeholder="Search address, city, or feature..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className="hh-input hh-homes-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label={`Sort ${vocabulary.pluralLower}`}>
            <option value="newest">Date added — newest</option>
            <option value="oldest">Date added — oldest</option>
            <option value="matchDesc">Match score — highest</option>
            <option value="matchAsc">Match score — lowest</option>
            <option value="priceAsc">Price — low to high</option>
            <option value="priceDesc">Price — high to low</option>
          </select>
        </div>
        <div className="hh-filter-chips" aria-label="Filter homes">
          {[
            { key: 'all', label: 'All' },
            { key: 'match90', label: '90%+ Matches' },
            { key: 'noMustMissing', label: 'No Must-Haves Missing' },
            { key: 'wantToTour', label: 'Want to Tour' },
            { key: 'favorites', label: 'Favorites' },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              className={`hh-chip ${quickFilter === f.key ? 'on' : ''}`}
              aria-pressed={quickFilter === f.key}
              onClick={() => setQuickFilter(f.key)}
            >
              {f.label} ({filterCounts[f.key]})
            </button>
          ))}
        </div>
        </section>
      )}

      {filtered.length === 0 ? (
        mode === 'favorites' ? (
          <EmptyLifecycleState icon={Heart} title="No favorites yet." body="Tap the heart on any home you want to keep close.">
            <Link href="/homes" className="hh-btn hh-btn-ghost">Go to My Homes</Link>
          </EmptyLifecycleState>
        ) : mode === 'tour' ? (
          <EmptyLifecycleState icon={Footprints} title="Nothing on the tour list yet." body="When a home feels worth seeing in person, mark it Want to Tour.">
            <Link href="/homes" className="hh-btn hh-btn-ghost">Go to My Homes</Link>
          </EmptyLifecycleState>
        ) : (
          <div className="hh-corner" style={{ border: '1px dashed var(--line)', borderRadius: 16, padding: '48px 24px', textAlign: 'center', color: 'var(--ink-soft)' }}>
            <p className="hh-serif" style={{ fontSize: 17, color: 'var(--ink)', marginBottom: 6 }}>{activeHomes.length === 0 ? vocabulary.apartment ? "No properties yet" : "You found the homes. We'll help you choose." : 'Nothing matches that search'}</p>
            <p style={{ fontSize: 13, marginBottom: 18 }}>{activeHomes.length === 0 ? 'Paste a listing link from anywhere to get started.' : 'Try a different search or status filter.'}</p>
            {activeHomes.length === 0 && <button className="hh-btn" onClick={() => openHomeModal(emptyHome())}><Plus size={15} /> Add {vocabulary.singularLower}</button>}
          </div>
        )
      ) : (
        <CardGrid
          homes={filtered} priorities={priorities} commuteDestinations={initialCommuteDestinations} mode={mode} onEdit={openHomeModal} onArchiveRequest={setArchiveTarget}
          onToggleFavorite={toggleFavorite} onWantToTour={wantToTour} onOpenPostTour={setPostTourTarget} onRemoveFromTour={removeFromTour}
          onRestore={restoreHome} onRequestDelete={setDeleteTarget}
        />
      )}

      {modalHome && (
        <HomeModal
          initial={modalHome} priorities={priorities} sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative} userId={userId}
          onSave={saveEditedHome} onClose={() => setModalHome(null)} onWantToTour={wantToTour} onArchiveRequest={setArchiveTarget}
          autoFindOnMount={modalAutoFind}
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
