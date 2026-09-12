'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, Search, MapPin, Link2, Archive as ArchiveIcon, ExternalLink,
  Heart, Home as HomeIcon, Undo2, Trash2, Footprints, MessageCircle, Check,
  Building2, StickyNote, Minus,
} from 'lucide-react';
import { MatchSummary, MatchTradeoffs } from '@/components/ui';
import { useCommuteObserver } from '@/lib/useCommuteObserver';
import { evaluateCommute } from '@/lib/commute';
import HomeModal from '@/components/HomeModal';
import PostTourModal from '@/components/PostTourModal';
import ArchiveConfirmModal from '@/components/ArchiveConfirmModal';
import Sheet from '@/components/Sheet';
import MobileDisclosure from '@/components/MobileDisclosure';
import { STATUS_COLOR, emptyHome, isArchivedStatus } from '@/lib/constants';
import { isLikelyListingUrl, findHomeByListingUrl } from '@/lib/listingUrl';
import { parseNum, fmtMoney, trueCheckLabels, homeStyleSummary, computeMatch, matchColor, matchTint } from '@/lib/matching';
import { homeIdentity, homeVocabulary } from '@/lib/homePresentation';
import { formatHomePrice, formatLotSizeDisplay, parseCommaList } from '@/lib/homeDisplay';
import { searchIntentCapabilities } from '@/lib/searchIntent';
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
  const propertyFacts = [
    home.garageSpaces && { label: 'Garage', text: home.garageSpaces },
    home.basementNotes && { label: 'Basement', text: home.basementNotes },
    home.homeCondition?.length && { label: 'Home condition', text: home.homeCondition.join(', ') },
    home.schoolsNotes && { label: 'Schools', text: home.schoolsNotes },
  ].filter(Boolean);

  // Objective context rows — only ever built from data that already exists; no new
  // lookups happen here. Crossroads and Home Style come from the home's own stored
  // fields.
  const objectiveFacts = [
    home.crossroads && { icon: MapPin, text: home.crossroads },
    styleSummary && { icon: Building2, text: styleSummary },
  ].filter(Boolean).slice(0, 2);

  const pros = parseCommaList(home.pros);
  const cons = parseCommaList(home.cons);
  // Secondary, already-known context (facts/commute/notes) — kept out of the
  // way behind "More details" on narrow viewports so a mobile card reads as
  // price/address/Match/status first, not a full restack of every field.
  // Desktop keeps this always open (see .hh-card-context-details in
  // globals.css); nothing here is ever hidden from desktop.
  const hasCardContext = propertyFacts.length > 0 || commuteDestinations.length > 0 || objectiveFacts.length > 0 || !!home.conditionNotes || pros.length > 0 || cons.length > 0 || !!home.notes;

  return (
    <article className={`hh-home-card hh-corner ${mode === 'archive' ? 'is-archived' : ''}`} ref={commuteRef}>
      <div className="hh-home-card-surface">
        <Link href={`/homes/${encodeURIComponent(home.id)}`} className={`hh-home-card-photo ${showPhoto ? '' : 'is-empty'}`} aria-label={`Open ${identity.accessible} details`}>
          {showPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={home.photoUrl} alt={`${identity.accessible} ${homeVocabulary(priorities).singularLower} photo`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={() => setImgError(true)} />
          ) : (
            <div className="hh-home-card-photo-fallback">
              <HomeIcon size={34} color="rgba(46,38,33,0.22)" strokeWidth={1.5} />
            </div>
          )}
          {!isPreTour && (
            <span className="hh-card-status hh-mono" style={{ background: STATUS_COLOR[home.status] || 'var(--ink-soft)' }}>{home.status}</span>
          )}
          {moment && (
            <span className="hh-flh-moment" aria-label={moment.hasEyes ? `${moment.label}. Shared home signal.` : `${moment.label}.`}>
              {moment.hasEyes && <span aria-hidden="true">👀 </span>}{moment.label}
            </span>
          )}
          {home.coBuyerArchivedCount > 0 && (
            <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
              {home.coBuyerArchivedCount > 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink)', background: 'rgba(255,255,255,0.92)', padding: '4px 9px', borderRadius: 999, boxShadow: '0 2px 8px rgba(46,38,33,0.15)' }}>
                  Archived by collaborator
                </span>
              )}
            </div>
          )}
        </Link>

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

          {match ? (
            <div className="hh-match-panel" style={{ background: matchTint(match.pct), borderLeft: `3px solid ${matchColor(match.pct)}` }}>
              <MatchSummary match={match} />
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

          {mode === 'favorites' && (
            <div className="hh-lifecycle-status is-favorite">
              <Heart size={12} color="var(--brick)" fill="var(--brick)" /> Your favorite
            </div>
          )}

          {mode === 'archive' && home.rejectionReason && (
            <div className="hh-archive-reason">
              <span>Why you archived it</span>
              <p>{home.rejectionReason}</p>
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
              {propertyFacts.map(({ label, text }, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{label}</span>{' '}
                  <span>{text}</span>
                </div>
              ))}
            </div>
          )}

          {commuteDestinations.length > 0 && (() => {
            const shown = commuteDestinations.slice(0, 2);
            const overflow = commuteDestinations.length - shown.length;
            return (
              <div className="hh-card-commute">
                <div className="hh-card-commute-label">Commute</div>
                {shown.map((d) => {
                  const state = getCommuteState(d);
                  const name = d.label;
                  const text = state.status === 'ok' ? `${name} · ${state.minutes} min`
                    : state.status === 'loading' ? `${name} · Calculating…`
                    : state.status === 'destination_invalid' ? `${name} · Check the address`
                    : state.status === 'destination_ambiguous' ? `${name} · Add a city or ZIP`
                    : ['unavailable', 'no_route', 'home_unavailable', 'destination_unavailable'].includes(state.status) ? `${name} · Not available`
                    : name;
                  return <div className="hh-card-commute-route" key={d.id}>{text}</div>;
                })}
                {overflow > 0 && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>+{overflow} more</div>}
              </div>
            );
          })()}

          {objectiveFacts.length > 0 && (
            <div className="hh-card-context-group">
              {objectiveFacts.map(({ icon: Icon, text }, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-soft)' }}>
                  <Icon size={13} style={{ flexShrink: 0 }} /> <span>{text}</span>
                </div>
              ))}
            </div>
          )}

          {home.conditionNotes && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontStyle: 'italic', lineHeight: 1.4 }}>
              <span style={{ fontWeight: 600, fontStyle: 'normal' }}>Condition</span>{' '}
              <span style={{
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {home.conditionNotes}
              </span>
            </div>
          )}

          {pros.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12.5, color: 'var(--ink)' }}>
              <Plus size={13} color="var(--moss)" strokeWidth={2.5} style={{ flexShrink: 0, marginTop: 2 }} />
              <span className="hh-card-clamp">{pros.join(', ')}</span>
            </div>
          )}

          {cons.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12.5, color: 'var(--ink)' }}>
              <Minus size={13} color="var(--brick)" strokeWidth={2.5} style={{ flexShrink: 0, marginTop: 2 }} />
              <span className="hh-card-clamp">{cons.join(', ')}</span>
            </div>
          )}

          {home.notes && (
            <div style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--ink-soft)', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px' }}>
              <StickyNote size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span className="hh-card-clamp" style={{ whiteSpace: 'pre-wrap' }}>{home.notes}</span>
            </div>
          )}
          </MobileDisclosure>
          )}

          <div className="hh-home-card-actions" style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 6, marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            {home.listingUrl && (
              <a href={home.listingUrl} target="_blank" rel="noreferrer" className="hh-btn hh-btn-ghost" style={{ padding: '5px 7px', flexShrink: 0 }} title="Open listing">
                <ExternalLink size={13} />
              </a>
            )}
            {mode !== 'archive' && (
              <button className="hh-btn hh-btn-ghost" style={{ padding: '5px 7px', flexShrink: 0 }} onClick={() => onArchiveRequest(home)} title="Archive" aria-label="Archive home">
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
            {showQuickFavorite && (
              <button
                type="button"
                className="hh-btn hh-btn-ghost"
                style={{ padding: '5px 7px', flexShrink: 0 }}
                onClick={handleFavorite}
                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart className={favoritePop ? 'hh-favorite-pop' : undefined} size={13} color={isFavorite ? 'var(--brick)' : undefined} fill={isFavorite ? 'var(--brick)' : 'none'} />
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

            {mode === 'archive' && (
              <button className="hh-btn hh-card-primary-action" onClick={() => onRestore(home)}><Undo2 size={13} /> Restore</button>
            )}
            <button className="hh-btn hh-card-secondary-action" onClick={() => onEdit(home)}>Edit</button>
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
  const [priorities] = useState(initialPriorities);
  const vocabulary = homeVocabulary(initialPriorities);
  const [query, setQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [sortBy, setSortBy] = useState('default');
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

    // An already-saved home with this exact listing URL wins over creating
    // another — "the user should add the home once." Anything less certain
    // than an exact URL match (a different query string, a re-shortened
    // link) is left alone rather than guessing two listings are the same
    // property.
    const existing = findHomeByListingUrl(homes, rawUrl);
    if (existing) {
      router.replace(`/homes/${encodeURIComponent(existing.id)}`);
      return;
    }

    // Empty (`?url=`) or not a real http(s) URL (malformed, an unsupported
    // scheme, plain garbage text) never gets treated as a shared link — that
    // would either fabricate identity from noise or run handleFind's plain-
    // text/address fallback on a value the user never actually typed. Either
    // way the existing Add Home flow still opens, ready for manual entry.
    const validUrl = isLikelyListingUrl(rawUrl);
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
      if (mutationVersions.current.get(home.id) === version) {
        const confirmed = confirmedHomes.current.get(home.id) || previous;
        if (optimistic && confirmed) setHomes((current) => current.map((candidate) => candidate.id === home.id ? confirmed : candidate));
        setSaveError("Couldn't save that change. Try again.");
        setRetrySave(() => () => saveHome(home, { shared, optimistic }));
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
        const hay = [h.propertyName, h.address, h.selectedFloorPlanName, h.selectedUnitLabel, h.crossroads, ...(h.homeLayout || []), h.primaryBedroomLocation, h.secondaryBedroomLocation, ...trueCheckLabels(h)].join(' ').toLowerCase();
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

    if (sortBy === 'match') {
      list = [...list].sort((a, b) => (computeMatch(b, priorities)?.pct ?? -1) - (computeMatch(a, priorities)?.pct ?? -1));
    } else if (sortBy === 'price') {
      list = [...list].sort((a, b) => (parseNum(a.price) ?? Infinity) - (parseNum(b.price) ?? Infinity));
    } else if (sortBy === 'newest') {
      list = [...list].reverse(); // homes load oldest-first; reversing gives newest-first
    }

    return list;
  }, [baseList, query, mode, quickFilter, sortBy, priorities]);

  if (mode === 'archive') {
    return (
      <>
        {saveError && <div className="hh-save-error" role="alert">{saveError}{retrySave && <> <button type="button" onClick={() => retrySave().catch(() => {})}>Retry</button></>}</div>}
        {archivedHomes.length === 0 ? (
          <EmptyLifecycleState icon={ArchiveIcon} title="The ones that weren't meant to be." body="They're still here if you change your mind." />
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
          <button className="hh-btn" onClick={() => openHomeModal(emptyHome())}><Plus size={15} /> Add {vocabulary.singularLower}</button>
        </div>
      )}

      {saveError && <div className="hh-save-error" role="alert">{saveError}{retrySave && <> <button type="button" onClick={() => retrySave().catch(() => {})}>Retry</button></>}</div>}

      {mode === 'homes' && (
        <section className="hh-homes-toolbar" aria-label={`Search and filter ${vocabulary.pluralLower}`}>
        <div className="hh-homes-toolbar-row">
          <div className="hh-homes-search">
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--ink-soft)' }} />
            <input className="hh-input" style={{ paddingLeft: 30 }} placeholder={vocabulary.apartment ? "Search property, address, floor plan, unit..." : "Search address, layout, feature..."} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className="hh-input hh-homes-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label={`Sort ${vocabulary.pluralLower}`}>
            <option value="default">Sort: Date added</option>
            <option value="newest">Sort: Newest first</option>
            <option value="match">Sort: Match</option>
            <option value="price">Sort: Price</option>
          </select>
        </div>
        <div className="hh-filter-chips" aria-label="Filter homes">
          {[
            { key: 'all', label: 'All' },
            { key: 'match90', label: '90%+ Match' },
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
              {f.label}
            </button>
          ))}
        </div>
        </section>
      )}

      {filtered.length === 0 ? (
        mode === 'favorites' ? (
          <EmptyLifecycleState icon={Heart} title="No favorites... yet." body="You'll know one when you see one." />
        ) : mode === 'tour' ? (
          <EmptyLifecycleState icon={Footprints} title="Nothing calling your name yet." body="Homes you want to see in person will show up here.">
            <Link href="/homes" className="hh-btn hh-btn-ghost">View my homes →</Link>
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
