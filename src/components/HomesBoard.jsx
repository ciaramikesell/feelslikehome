'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, Search, MapPin, Link2, Archive as ArchiveIcon, ExternalLink,
  Heart, Home as HomeIcon, Undo2, Trash2, Footprints, MessageCircle, Check,
  GraduationCap, Building2, StickyNote, Minus,
} from 'lucide-react';
import { MatchSummary, MatchTradeoffs } from '@/components/ui';
import { useCommuteObserver } from '@/lib/useCommuteObserver';
import HomeModal from '@/components/HomeModal';
import PostTourModal from '@/components/PostTourModal';
import { STATUS_COLOR, emptyHome, isRentalType, isArchivedStatus } from '@/lib/constants';
import { parseNum, fmtMoney, trueCheckLabels, homeStyleSummary, computeMatch, matchColor, matchTint } from '@/lib/matching';
import { formatLotSizeDisplay, splitAddressLines, parseCommaList } from '@/lib/homeDisplay';
import { createClient } from '@/lib/supabase/client';
import { deleteHome as deleteHomeQuery } from '@/lib/supabase/data';
import {
  deriveWantToTourState, hasSharedHomeChanges, saveHomePersonalAndShared, saveHomePersonalState,
} from '@/lib/supabase/collaboration';

/* -------------------------------- confirm modal -------------------------------- */

function ConfirmModal({ title, body, cancelLabel = 'Cancel', confirmLabel, confirmTone = 'danger', onCancel, onConfirm }) {
  return (
    <div className="hh-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="hh-modal hh-corner" style={{ maxWidth: 420, padding: 26 }}>
        <h3 className="hh-serif" style={{ fontSize: 18, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>{title}</h3>
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55, margin: '10px 0 20px' }}>{body}</p>
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
      </div>
    </div>
  );
}

// Archiving is the one confirmation that also wants a piece of information — why —
// without turning into a second step. The reason is optional and pre-filled from
// any reason the home already has, so re-confirming an already-archived home (or
// re-archiving a restored one) never silently blanks out an existing note.
function ArchiveConfirmModal({ home, onCancel, onConfirm }) {
  const [reason, setReason] = useState(home.rejectionReason || '');
  return (
    <div className="hh-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="hh-modal hh-corner" style={{ maxWidth: 440, padding: 26 }}>
        <h3 className="hh-serif" style={{ fontSize: 18, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Archive this home?</h3>
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55, margin: '10px 0 16px' }}>
          {home.address || 'This home'} will be removed from your active homes, but we'll keep your ratings and notes. You can restore it anytime from Archive.
        </p>
        <label className="hh-label" style={{ marginBottom: 6, display: 'block' }}>Why are you ruling it out? (optional)</label>
        <textarea
          className="hh-textarea"
          style={{ minHeight: 70, width: '100%' }}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Busy road, no basement, taxes too high"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button className="hh-btn hh-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="hh-btn" style={{ background: 'var(--brick)', borderColor: 'var(--brick)' }} onClick={() => onConfirm(reason.trim())}>
            Archive home
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- card view --------------------------------- */

function HomeCard({ home, priorities, mode, onEdit, onArchiveRequest, onToggleFavorite, onWantToTour, onOpenPostTour, onRemoveFromTour }) {
  const [imgError, setImgError] = useState(false);
  const match = computeMatch(home, priorities);
  const styleSummary = homeStyleSummary(home);
  const showPhoto = home.photoUrl && !imgError;
  const isFavorite = home.reaction === 'love';
  const { line1: addressLine1, line2: addressLine2 } = splitAddressLines(home.address);
  // Normalize lifecycle presentation without touching stored data: any status that
  // isn't 'Want to Tour' or 'Toured' is treated as pre-tour, whether it's the current
  // 'Saved' value or a legacy string like 'Considering' left over from before this
  // lifecycle existed (see rowToHome's 'Considering' fallback in supabase/data.js).
  const isPreTour = home.status !== 'Want to Tour' && home.status !== 'Toured';
  // Heart/Archive as quick one-tap controls only make sense once favoriting is
  // itself the primary job of the view. In Want to Tour, "Love it" is reached only
  // through the Post-Tour reflection ("Edit my thoughts") — never a shortcut that
  // bypasses recording ratings/notes for a toured home.
  const showQuickFavorite = mode === 'favorites' || mode === 'archive';
  const wantToTourState = home.isCollaborative
    ? deriveWantToTourState(home.status, home.coBuyerWantsToTour ? ['Want to Tour'] : [])
    : null;

  // Personal commute destinations, tier-ordered (Must Have -> Important ->
  // Nice to Have), matching every other tiered display in this app. Personal
  // only for V1 — a co-buyer's own destinations never appear here, since
  // `priorities` is already the current user's own resolved priorities.
  const commuteDestinations = useMemo(() => {
    const tierRank = { must: 0, important: 1, nice: 2, dontcare: 3 };
    return [...(priorities.location?.commuteDestinations || [])].sort(
      (a, b) => (tierRank[a.tier] ?? 3) - (tierRank[b.tier] ?? 3)
    );
  }, [priorities.location?.commuteDestinations]);
  const { setRef: commuteRef, getState: getCommuteState } = useCommuteObserver(home, commuteDestinations);

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
    home.schoolsNotes && { label: 'Schools', text: home.schoolsNotes },
  ].filter(Boolean);

  // Objective context rows — only ever built from data that already exists; no new
  // lookups happen here. Crossroads and Home Style come from the home's own stored
  // fields; School District comes from the already-approved Geocodio enrichment.
  const objectiveFacts = [
    home.crossroads && { icon: MapPin, text: home.crossroads },
    home.schoolDistrict && { icon: GraduationCap, text: home.schoolDistrict },
    styleSummary && { icon: Building2, text: styleSummary },
  ].filter(Boolean);

  const pros = parseCommaList(home.pros);
  const cons = parseCommaList(home.cons);

  return (
    <div className="hh-corner" ref={commuteRef}>
      <div style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'relative', width: '100%', height: 148, background: showPhoto ? 'var(--line)' : 'linear-gradient(135deg, #F2E6D6, #E8D8C1)' }}>
          {showPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={home.photoUrl} alt={home.address} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={() => setImgError(true)} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <HomeIcon size={34} color="rgba(46,38,33,0.22)" strokeWidth={1.5} />
            </div>
          )}
          {!isPreTour && (
            <span className="hh-mono" style={{ position: 'absolute', top: 10, left: 10, fontSize: 10.5, fontWeight: 700, color: '#fff', background: STATUS_COLOR[home.status] || 'var(--ink-soft)', padding: '4px 9px', borderRadius: 999, boxShadow: '0 2px 8px rgba(46,38,33,0.2)' }}>{home.status}</span>
          )}
          {(home.coBuyerArchivedCount > 0 || home.favoriteLabel) && (
            <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
              {home.favoriteLabel && (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink)', background: 'rgba(255,255,255,0.92)', padding: '4px 9px', borderRadius: 999, boxShadow: '0 2px 8px rgba(46,38,33,0.15)' }}>
                  {home.favoriteLabel}
                </span>
              )}
              {home.coBuyerArchivedCount > 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink)', background: 'rgba(255,255,255,0.92)', padding: '4px 9px', borderRadius: 999, boxShadow: '0 2px 8px rgba(46,38,33,0.15)' }}>
                  Archived by Co-Buyer
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div className="hh-address" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.28, color: 'var(--ink)' }}>{addressLine1 || 'Untitled'}</div>
            {addressLine2 && <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginTop: 1 }}>{addressLine2}</div>}
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="hh-mono" style={{ fontSize: 21, fontWeight: 700, color: 'var(--brick)' }}>{fmtMoney(home.price)}{isRentalType(priorities.searchType) ? '/mo' : ''}</span>
            {home.estMonthly && <span className="hh-mono" style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{fmtMoney(home.estMonthly)}/mo est.</span>}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 'fit-content', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 999, padding: '4px 9px' }}>
              <Footprints size={12} color="var(--moss)" /> {wantToTourState.wantToTourLabel}
            </div>
          )}

          {!isPreTour && home.status === 'Want to Tour' && mode === 'homes' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>
              <Check size={14} color="var(--moss)" /> Want to tour
            </div>
          )}
          {!isPreTour && home.status === 'Want to Tour' && mode !== 'homes' && (
            <button type="button" className="hh-btn" style={{ fontSize: 12.5, padding: '7px 12px', justifyContent: 'center' }} onClick={() => onOpenPostTour(home)}>
              <MessageCircle size={13} /> I toured this home
            </button>
          )}
          {home.status === 'Toured' && (
            <button
              type="button"
              className="hh-btn hh-btn-ghost"
              style={{ fontSize: 12.5, padding: '7px 12px', justifyContent: 'center', borderColor: 'rgba(193,89,47,0.4)', color: 'var(--brick)' }}
              onClick={() => onOpenPostTour(home)}
            >
              <MessageCircle size={13} /> Edit my thoughts
            </button>
          )}

          {propertyFacts.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.03em' }}>Commute</div>
                {shown.map((d) => {
                  const state = getCommuteState(d);
                  const text = state.status === 'ok' ? `${d.name} · ${state.minutes} min`
                    : state.status === 'loading' ? `${d.name} · Calculating…`
                    : state.status === 'unavailable' ? `${d.name} · Not available`
                    : d.name; // idle — not yet scrolled into view, show just the name
                  return <div key={d.id} style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{text}</div>;
                })}
                {overflow > 0 && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>+{overflow} more</div>}
              </div>
            );
          })()}

          {objectiveFacts.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
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
              <span>{pros.join(', ')}</span>
            </div>
          )}

          {cons.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12.5, color: 'var(--ink)' }}>
              <Minus size={13} color="var(--brick)" strokeWidth={2.5} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{cons.join(', ')}</span>
            </div>
          )}

          {home.notes && (
            <div style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--ink-soft)', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px' }}>
              <StickyNote size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ whiteSpace: 'pre-wrap' }}>{home.notes}</span>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 6, marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            {home.listingUrl && (
              <a href={home.listingUrl} target="_blank" rel="noreferrer" className="hh-btn hh-btn-ghost" style={{ padding: '5px 7px', flexShrink: 0 }} title="Open listing">
                <ExternalLink size={13} />
              </a>
            )}
            <button className="hh-btn hh-btn-ghost" style={{ padding: '5px 7px', flexShrink: 0 }} onClick={() => onArchiveRequest(home)} title="Archive">
              <ArchiveIcon size={13} />
            </button>
            {mode === 'tour' && home.status === 'Want to Tour' && (
              <button
                type="button"
                className="hh-btn hh-btn-ghost"
                style={{ padding: '5px 7px', flexShrink: 0 }}
                onClick={() => onRemoveFromTour(home)}
                title="Remove from Want to Tour"
                aria-label="Remove from Want to Tour"
              >
                <Undo2 size={13} />
              </button>
            )}
            {showQuickFavorite && (
              <button
                type="button"
                className="hh-btn hh-btn-ghost"
                style={{ padding: '5px 7px', flexShrink: 0 }}
                onClick={() => onToggleFavorite(home)}
                title={isFavorite ? 'Remove from favorites' : 'Love it / Favorite'}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart size={13} color={isFavorite ? 'var(--brick)' : undefined} fill={isFavorite ? 'var(--brick)' : 'none'} />
              </button>
            )}

            <div style={{ flex: 1 }} />

            {isPreTour && (
              <button
                type="button"
                className="hh-btn"
                style={{ fontSize: 11.5, padding: '6px 10px', flexShrink: 0 }}
                onClick={() => onWantToTour(home)}
              >
                <Footprints size={12} /> Want to tour
              </button>
            )}

            <button
              className="hh-btn"
              style={{
                padding: '6px 11px', fontSize: 11.5, flexShrink: 0,
                background: 'var(--paper)', border: '1px solid var(--ink-soft)', color: 'var(--ink)', fontWeight: 700,
              }}
              onClick={() => onEdit(home)}
            >
              Edit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardGrid({ homes, priorities, mode, onEdit, onArchiveRequest, onToggleFavorite, onWantToTour, onOpenPostTour, onRemoveFromTour }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {homes.map((h) => (
        <HomeCard
          key={h.id} home={h} priorities={priorities} mode={mode} onEdit={onEdit} onArchiveRequest={onArchiveRequest}
          onToggleFavorite={onToggleFavorite} onWantToTour={onWantToTour} onOpenPostTour={onOpenPostTour} onRemoveFromTour={onRemoveFromTour}
        />
      ))}
    </div>
  );
}

/* -------------------------------- archive list -------------------------------- */

function ArchiveRow({ home, onEdit, onRestore, onRequestDelete }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 18px', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--paper-raised)', flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontWeight: 500, fontSize: 14 }}>{home.address}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>{fmtMoney(home.price)}</div>
        {home.rejectionReason && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 3, fontStyle: 'italic' }}>Passed because: {home.rejectionReason}</div>}
        {home.favoriteLabel && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 5, fontWeight: 600 }}>{home.favoriteLabel}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          className="hh-btn"
          style={{ fontSize: 12, padding: '6px 11px', background: 'var(--paper)', border: '1px solid var(--ink-soft)', color: 'var(--ink)', fontWeight: 700 }}
          onClick={() => onEdit(home)}
        >
          Edit
        </button>
        <button className="hh-btn hh-btn-ghost" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => onRestore(home)}><Undo2 size={13} /> Restore</button>
        <button type="button" onClick={() => onRequestDelete(home)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: 11.5, cursor: 'pointer', padding: '6px 4px', textDecoration: 'underline' }}>
          Delete permanently
        </button>
      </div>
    </div>
  );
}

function ArchiveList({ homes, onEdit, onRestore, onRequestDelete }) {
  if (!homes.length) return <div style={{ fontSize: 13, color: 'var(--ink-soft)', padding: '30px 0' }}>Homes you've archived stay here with your notes and ratings, so you can remember why you ruled them out — or bring one back.</div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {homes.map((h) => <ArchiveRow key={h.id} home={h} onEdit={onEdit} onRestore={onRestore} onRequestDelete={onRequestDelete} />)}
    </div>
  );
}

/* ---------------------------------- board ---------------------------------- */

export default function HomesBoard({ mode, userId, searchId, initialHomes, initialPriorities, sharedFactAwareness }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [homes, setHomes] = useState(initialHomes);
  const [priorities] = useState(initialPriorities);
  const [query, setQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [sortBy, setSortBy] = useState('default');
  const [modalHome, setModalHome] = useState(null);
  const [postTourTarget, setPostTourTarget] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saveError, setSaveError] = useState('');
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    if (mode === 'homes' && !autoOpenedRef.current && searchParams.get('add') === '1') {
      autoOpenedRef.current = true;
      setModalHome(emptyHome());
      router.replace('/homes');
    }
  }, [mode, searchParams, router]);

  const saveHome = useCallback(async (home, { shared = true } = {}) => {
    const supabase = createClient();
    let saved;
    try {
      saved = await (shared
        ? saveHomePersonalAndShared(supabase, home, userId, searchId)
        : saveHomePersonalState(supabase, home, userId, searchId));
    } catch (err) {
      // Previously uncaught: any Supabase error here (a missing column from a
      // migration that hasn't been applied yet, a network hiccup, etc.) threw
      // straight past setModalHome(null) below, leaving Edit Home permanently
      // stuck open with no explanation and Cancel as the only way out. Now it's
      // logged, surfaced here (visible once the modal closes), and re-thrown so
      // HomeModal's own catch can show it immediately, right where the user is
      // looking, without losing anything they'd entered.
      console.error('saveHome failed', err);
      setSaveError("We couldn't save that home. Please try again.");
      throw err;
    }
    // Keep server-derived co-buyer signals while replacing only this user's
    // freshly saved personal state and the shared home fields.
    setHomes((prev) => (prev.some((h) => h.id === saved.id) ? prev.map((h) => (h.id === saved.id ? { ...h, ...saved } : h)) : [...prev, saved]));
    setModalHome(null);
    setSaveError('');
    // Favorites/Archive nav visibility is computed server-side in the layout — refresh
    // it so a first favorite/archive (or the last one being undone) updates the nav
    // right away instead of only after a manual reload.
    router.refresh();
  }, [userId, searchId, router]);

  const saveEditedHome = useCallback((home) => {
    const shared = !home.id || hasSharedHomeChanges(home, modalHome);
    return saveHome(home, { shared });
  }, [modalHome, saveHome]);

  const toggleFavorite = useCallback((home) => {
    const next = { ...home, reaction: home.reaction === 'love' ? null : 'love' };
    setHomes((prev) => prev.map((h) => (h.id === home.id ? next : h)));
    const supabase = createClient();
    saveHomePersonalState(supabase, next, userId, searchId).then(() => router.refresh()).catch(() => {});
  }, [userId, searchId, router]);

  // "This one is worth seeing." One tap, no modal, no confirmation — reuses the
  // existing status field, just moving it to a value it already supports.
  const wantToTour = useCallback((home) => {
    const next = { ...home, status: 'Want to Tour' };
    const savedVersion = homes.find((candidate) => candidate.id === home.id);
    saveHome(next, { shared: hasSharedHomeChanges(next, savedVersion) });
  }, [homes, saveHome]);

  // "I'm still considering this home, but not on my tour list." Reverses Want to
  // Tour back to the normal active status — not Archive, not deletion, no
  // confirmation, and every other field (ratings, notes, Match inputs) untouched.
  const removeFromTour = useCallback((home) => {
    saveHome({ ...home, status: 'Saved' }, { shared: false });
  }, [saveHome]);

  // What the post-tour verdict means, conceptually:
  //   Love it          -> Toured + Favorite (reaction: 'love')
  //   Still considering -> Toured only, reaction left as-is
  //   Not for me        -> NOT saved immediately — routed into the existing
  //                        archive-confirmation flow so the destructive step still
  //                        gets a confirm, with all the collected ratings/notes/
  //                        impressions carried along so nothing is lost.
  const handleVerdict = useCallback((home, verdict, patch) => {
    if (verdict === 'not_for_me') {
      setPostTourTarget(null);
      setArchiveTarget({ ...home, ...patch });
      return;
    }
    setPostTourTarget(null);
    const next = { ...home, ...patch, status: 'Toured', reaction: verdict === 'love' ? 'love' : home.reaction };
    saveHome(next, { shared: hasSharedHomeChanges(next, home) });
  }, [saveHome]);

  const confirmArchive = useCallback((reason) => {
    if (!archiveTarget) return;
    const next = { ...archiveTarget, status: 'Archived', rejectionReason: reason };
    const savedVersion = homes.find((home) => home.id === archiveTarget.id);
    saveHome(next, { shared: hasSharedHomeChanges(next, savedVersion) });
    setArchiveTarget(null);
  }, [archiveTarget, homes, saveHome]);

  // Restoring should return the home to where it actually was, not always the very
  // beginning. All star ratings are exclusively captured post-tour (pre-tour "Add
  // more details" only has check/multiselect fields, never stars), so any rating
  // present is a reliable signal this home was genuinely toured before being
  // archived — restoring it should preserve that history rather than silently
  // asking the user to "Want to tour" it again.
  const restoreHome = useCallback((home) => {
    const wasToured = Object.values(home.ratings || {}).some((v) => v > 0);
    saveHome({ ...home, status: wasToured ? 'Toured' : 'Saved', rejectionReason: '' }, { shared: false });
  }, [saveHome]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setHomes((prev) => prev.filter((h) => h.id !== id));
    setDeleteTarget(null);
    const supabase = createClient();
    try { await deleteHomeQuery(supabase, id); router.refresh(); } catch (e) { /* already removed locally */ }
  }, [deleteTarget, router]);

  const activeHomes = useMemo(() => homes.filter((h) => !isArchivedStatus(h.status)), [homes]);
  const archivedHomes = useMemo(() => homes.filter((h) => isArchivedStatus(h.status)), [homes]);
  const favoriteHomes = useMemo(() => activeHomes.filter((h) => h.reaction === 'love'), [activeHomes]);
  // The Want to Tour workspace holds homes not yet toured, PLUS toured homes still
  // actively "considering" (not yet loved) — once a home is loved it graduates fully
  // to Favorites rather than cluttering both lists.
  const tourHomes = useMemo(
    () => activeHomes.filter((h) => (
      h.status === 'Want to Tour'
      || h.coBuyerWantsToTour
      || (h.status === 'Toured' && h.reaction !== 'love')
    )),
    [activeHomes]
  );

  const baseList = mode === 'archive' ? archivedHomes : mode === 'favorites' ? favoriteHomes : mode === 'tour' ? tourHomes : activeHomes;

  const filtered = useMemo(() => {
    if (mode !== 'homes') return baseList;
    let list = baseList.filter((h) => {
      if (query.trim()) {
        const q = query.toLowerCase();
        const hay = [h.address, h.crossroads, ...(h.homeLayout || []), h.primaryBedroomLocation, h.secondaryBedroomLocation, ...trueCheckLabels(h)].join(' ').toLowerCase();
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
      list = list.filter((h) => h.status === 'Want to Tour');
    } else if (quickFilter === 'favorites') {
      list = list.filter((h) => h.reaction === 'love');
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
        <ArchiveList homes={archivedHomes} onEdit={setModalHome} onRestore={restoreHome} onRequestDelete={setDeleteTarget} />
        {modalHome && <HomeModal initial={modalHome} priorities={priorities} sharedFactAwareness={sharedFactAwareness} userId={userId} onSave={saveEditedHome} onClose={() => setModalHome(null)} onWantToTour={wantToTour} onArchiveRequest={setArchiveTarget} />}
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '4px 0 14px' }}>
          <button className="hh-btn" onClick={() => setModalHome(emptyHome())}><Plus size={15} /> Add home</button>
        </div>
      )}

      {saveError && <div style={{ background: 'rgba(193,89,47,0.09)', border: '1px solid var(--brick)', color: 'var(--brick)', fontSize: 12.5, padding: '9px 14px', borderRadius: 12, marginBottom: 14 }}>{saveError}</div>}

      {mode === 'homes' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', margin: '4px 0 14px' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--ink-soft)' }} />
            <input className="hh-input" style={{ paddingLeft: 30 }} placeholder="Search address, layout, feature..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className="hh-input" value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ flex: '0 0 auto', width: 'auto', fontSize: 12.5 }} aria-label="Sort">
            <option value="default">Sort: Date added</option>
            <option value="newest">Sort: Newest first</option>
            <option value="match">Sort: Match</option>
            <option value="price">Sort: Price</option>
          </select>
        </div>
      )}

      {mode === 'homes' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '0 0 22px' }}>
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
              className="hh-chip"
              onClick={() => setQuickFilter(f.key)}
              style={quickFilter === f.key ? { background: 'var(--brick)', borderColor: 'var(--brick)', color: '#fff' } : undefined}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        mode === 'favorites' ? (
          <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', padding: '30px 0' }}>Nothing favorited yet. Tour a home and choose Love it to see it here.</div>
        ) : mode === 'tour' ? (
          <div className="hh-corner" style={{ border: '1px dashed var(--line)', borderRadius: 16, padding: '48px 24px', textAlign: 'center', color: 'var(--ink-soft)' }}>
            <p className="hh-serif" style={{ fontSize: 17, color: 'var(--ink)', marginBottom: 6 }}>No homes to tour yet</p>
            <p style={{ fontSize: 13, marginBottom: 18 }}>When you find a home you'd like to see in person, mark it Want to tour from Homes.</p>
            <Link href="/homes" className="hh-btn hh-btn-ghost">View my homes →</Link>
          </div>
        ) : (
          <div className="hh-corner" style={{ border: '1px dashed var(--line)', borderRadius: 16, padding: '48px 24px', textAlign: 'center', color: 'var(--ink-soft)' }}>
            <p className="hh-serif" style={{ fontSize: 17, color: 'var(--ink)', marginBottom: 6 }}>{activeHomes.length === 0 ? "You found the homes. We'll help you choose." : 'Nothing matches that search'}</p>
            <p style={{ fontSize: 13, marginBottom: 18 }}>{activeHomes.length === 0 ? 'Paste a listing link from anywhere to get started.' : 'Try a different search or status filter.'}</p>
            {activeHomes.length === 0 && <button className="hh-btn" onClick={() => setModalHome(emptyHome())}><Plus size={15} /> Add home</button>}
          </div>
        )
      ) : (
        <CardGrid
          homes={filtered} priorities={priorities} mode={mode} onEdit={setModalHome} onArchiveRequest={setArchiveTarget}
          onToggleFavorite={toggleFavorite} onWantToTour={wantToTour} onOpenPostTour={setPostTourTarget} onRemoveFromTour={removeFromTour}
        />
      )}

      {modalHome && <HomeModal initial={modalHome} priorities={priorities} sharedFactAwareness={sharedFactAwareness} userId={userId} onSave={saveEditedHome} onClose={() => setModalHome(null)} onWantToTour={wantToTour} onArchiveRequest={setArchiveTarget} />}

      {postTourTarget && (
        <PostTourModal
          home={postTourTarget}
          priorities={priorities}
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
