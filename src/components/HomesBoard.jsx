'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, Search, MapPin, Link2, Archive as ArchiveIcon, ExternalLink,
  Heart, Home as HomeIcon, Undo2, Trash2, Footprints, MessageCircle, Check,
} from 'lucide-react';
import { StarInput, MatchSummary } from '@/components/ui';
import HomeModal from '@/components/HomeModal';
import PostTourModal from '@/components/PostTourModal';
import { STATUS_COLOR, emptyHome, isRentalType, isArchivedStatus, TOUR_RATING_KEY } from '@/lib/constants';
import { parseNum, fmtMoney, avgRating, trueCheckLabels, homeStyleSummary, computeMatch, matchColor, matchTint } from '@/lib/matching';
import { formatLotSizeDisplay } from '@/lib/homeDisplay';
import { createClient } from '@/lib/supabase/client';
import { saveHome as saveHomeQuery, deleteHome as deleteHomeQuery } from '@/lib/supabase/data';

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

/* --------------------------------- card view --------------------------------- */

function HomeCard({ home, priorities, mode, onEdit, onArchiveRequest, onToggleFavorite, onWantToTour, onOpenPostTour, onRemoveFromTour }) {
  const [imgError, setImgError] = useState(false);
  const avg = avgRating(home.ratings);
  const pps = parseNum(home.price) && parseNum(home.sqft) ? Math.round(parseNum(home.price) / parseNum(home.sqft)) : null;
  const match = computeMatch(home, priorities);
  const checks = trueCheckLabels(home);
  const visibleChecks = checks.slice(0, 4);
  const extraChecks = checks.length - visibleChecks.length;
  const styleSummary = homeStyleSummary(home);
  const showPhoto = home.photoUrl && !imgError;
  const isFavorite = home.reaction === 'love';
  // Normalize lifecycle presentation without touching stored data: any status that
  // isn't 'Want to Tour' or 'Toured' is treated as pre-tour, whether it's the current
  // 'Saved' value or a legacy string like 'Considering' left over from before this
  // lifecycle existed (see rowToHome's 'Considering' fallback in supabase/data.js).
  const isPreTour = home.status !== 'Want to Tour' && home.status !== 'Toured';
  // Heart/Archive as quick one-tap controls only make sense once a home has actually
  // been toured (or we're already inside a decision-workspace view) — not as a
  // pre-tour decision prompt on Homes.
  const showQuickFavorite = mode === 'favorites' || mode === 'archive' || (mode === 'tour' && home.status === 'Toured');
  const statLine = [
    home.beds && `${home.beds} bd`,
    home.baths && `${home.baths} ba`,
    home.sqft && `${parseNum(home.sqft)?.toLocaleString()} sqft`,
    pps && `$${pps}/sqft`,
    home.lotSize && `${formatLotSizeDisplay(home.lotSize)} lot`,
    home.garageSpaces && `${home.garageSpaces}-car garage`,
    styleSummary || null,
  ].filter(Boolean);

  return (
    <div className="hh-corner">
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
        </div>

        <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div className="hh-address" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.28, color: 'var(--ink)' }}>{home.address || 'Untitled'}</div>
            {home.crossroads && <div style={{ fontSize: 12, color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}><MapPin size={11} /> {home.crossroads}</div>}
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="hh-mono" style={{ fontSize: 21, fontWeight: 700, color: 'var(--brick)' }}>{fmtMoney(home.price)}{isRentalType(priorities.searchType) ? '/mo' : ''}</span>
            {home.estMonthly && <span className="hh-mono" style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{fmtMoney(home.estMonthly)}/mo est.</span>}
          </div>

          {match ? (
            <div className="hh-match-panel" style={{ background: matchTint(match.pct), borderLeft: `3px solid ${matchColor(match.pct)}` }}>
              <MatchSummary match={match} />
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Set your priorities in <em>My Search</em> to see a match score.</div>
          )}

          {home.ratings?.[TOUR_RATING_KEY] > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink)' }}>
              <span style={{ color: 'var(--ink-soft)' }}>Your tour rating:</span>
              <StarInput value={home.ratings[TOUR_RATING_KEY]} readOnly size={13} />
              <span className="hh-mono" style={{ color: 'var(--ink-soft)' }}>{home.ratings[TOUR_RATING_KEY]}/5</span>
            </div>
          )}

          {statLine.length > 0 && (
            <div className="hh-mono" style={{ fontSize: 12.5, color: 'var(--ink-soft)', display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
              {statLine.map((item, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
                  {i > 0 && <span style={{ color: 'var(--line)', margin: '0 7px' }}>•</span>}
                  {item}
                </span>
              ))}
            </div>
          )}

          {avg ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <StarInput value={Math.round(avg)} readOnly size={14} />
              <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{avg.toFixed(1)} avg</span>
            </div>
          ) : null}

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

          {visibleChecks.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {visibleChecks.map((t) => <span key={t} className="hh-chip static on" style={{ fontSize: 11, padding: '3px 8px' }}>{t}</span>)}
              {extraChecks > 0 && <span className="hh-chip static" style={{ fontSize: 11, padding: '3px 8px' }}>+{extraChecks} more</span>}
            </div>
          )}

          {(home.pros || home.cons) && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', display: 'grid', gap: 3 }}>
              {home.pros && <div><strong style={{ color: 'var(--moss)' }}>+ </strong>{home.pros}</div>}
              {home.cons && <div><strong style={{ color: 'var(--brick)' }}>− </strong>{home.cons}</div>}
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
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>{fmtMoney(home.price)}{home.rejectionReason ? ` — Ruled out because: ${home.rejectionReason}` : ' — no reason logged'}</div>
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

export default function HomesBoard({ mode, userId, searchId, initialHomes, initialPriorities }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [homes, setHomes] = useState(initialHomes);
  const [priorities] = useState(initialPriorities);
  const [query, setQuery] = useState('');
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

  const saveHome = useCallback(async (home) => {
    const supabase = createClient();
    const saved = await saveHomeQuery(supabase, home, userId, searchId);
    setHomes((prev) => (prev.some((h) => h.id === saved.id) ? prev.map((h) => (h.id === saved.id ? saved : h)) : [...prev, saved]));
    setModalHome(null);
    setSaveError('');
    // Favorites/Archive nav visibility is computed server-side in the layout — refresh
    // it so a first favorite/archive (or the last one being undone) updates the nav
    // right away instead of only after a manual reload.
    router.refresh();
  }, [userId, searchId, router]);

  const toggleFavorite = useCallback((home) => {
    const next = { ...home, reaction: home.reaction === 'love' ? null : 'love' };
    setHomes((prev) => prev.map((h) => (h.id === home.id ? next : h)));
    const supabase = createClient();
    saveHomeQuery(supabase, next, userId, searchId).then(() => router.refresh()).catch(() => {});
  }, [userId, searchId, router]);

  // "This one is worth seeing." One tap, no modal, no confirmation — reuses the
  // existing status field, just moving it to a value it already supports.
  const wantToTour = useCallback((home) => {
    saveHome({ ...home, status: 'Want to Tour' });
  }, [saveHome]);

  // "I'm still considering this home, but not on my tour list." Reverses Want to
  // Tour back to the normal active status — not Archive, not deletion, no
  // confirmation, and every other field (ratings, notes, Match inputs) untouched.
  const removeFromTour = useCallback((home) => {
    saveHome({ ...home, status: 'Saved' });
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
    saveHome({ ...home, ...patch, status: 'Toured', reaction: verdict === 'love' ? 'love' : home.reaction });
  }, [saveHome]);

  const confirmArchive = useCallback(() => {
    if (!archiveTarget) return;
    saveHome({ ...archiveTarget, status: 'Archived' });
    setArchiveTarget(null);
  }, [archiveTarget, saveHome]);

  // Restoring should return the home to where it actually was, not always the very
  // beginning. All star ratings are exclusively captured post-tour (pre-tour "Add
  // more details" only has check/multiselect fields, never stars), so any rating
  // present is a reliable signal this home was genuinely toured before being
  // archived — restoring it should preserve that history rather than silently
  // asking the user to "Want to tour" it again.
  const restoreHome = useCallback((home) => {
    const wasToured = Object.values(home.ratings || {}).some((v) => v > 0);
    saveHome({ ...home, status: wasToured ? 'Toured' : 'Saved', rejectionReason: '' });
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
    () => activeHomes.filter((h) => h.status === 'Want to Tour' || (h.status === 'Toured' && h.reaction !== 'love')),
    [activeHomes]
  );

  const baseList = mode === 'archive' ? archivedHomes : mode === 'favorites' ? favoriteHomes : mode === 'tour' ? tourHomes : activeHomes;

  const filtered = useMemo(() => {
    if (mode !== 'homes') return baseList;
    return baseList.filter((h) => {
      if (query.trim()) {
        const q = query.toLowerCase();
        const hay = [h.address, h.crossroads, ...(h.homeLayout || []), h.primaryBedroomLocation, h.secondaryBedroomLocation, ...trueCheckLabels(h)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [baseList, query, mode]);

  if (mode === 'archive') {
    return (
      <>
        <ArchiveList homes={archivedHomes} onEdit={setModalHome} onRestore={restoreHome} onRequestDelete={setDeleteTarget} />
        {modalHome && <HomeModal initial={modalHome} priorities={priorities} userId={userId} onSave={saveHome} onClose={() => setModalHome(null)} onWantToTour={wantToTour} onArchiveRequest={setArchiveTarget} />}
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', margin: '4px 0 22px' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--ink-soft)' }} />
            <input className="hh-input" style={{ paddingLeft: 30 }} placeholder="Search address, layout, feature..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
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
            <p className="hh-serif" style={{ fontSize: 17, color: 'var(--ink)', marginBottom: 6 }}>{activeHomes.length === 0 ? 'Ready to start?' : 'Nothing matches that search'}</p>
            <p style={{ fontSize: 13, marginBottom: 18 }}>{activeHomes.length === 0 ? 'Find a home on your favorite listing site, copy the link, then click + Add home.' : 'Try a different search or status filter.'}</p>
            {activeHomes.length === 0 && <button className="hh-btn" onClick={() => setModalHome(emptyHome())}><Plus size={15} /> Add home</button>}
          </div>
        )
      ) : (
        <CardGrid
          homes={filtered} priorities={priorities} mode={mode} onEdit={setModalHome} onArchiveRequest={setArchiveTarget}
          onToggleFavorite={toggleFavorite} onWantToTour={wantToTour} onOpenPostTour={setPostTourTarget} onRemoveFromTour={removeFromTour}
        />
      )}

      {modalHome && <HomeModal initial={modalHome} priorities={priorities} userId={userId} onSave={saveHome} onClose={() => setModalHome(null)} onWantToTour={wantToTour} onArchiveRequest={setArchiveTarget} />}

      {postTourTarget && (
        <PostTourModal
          home={postTourTarget}
          priorities={priorities}
          onVerdict={handleVerdict}
          onClose={() => setPostTourTarget(null)}
        />
      )}

      {archiveTarget && (
        <ConfirmModal
          title="Archive this home?"
          body={`${archiveTarget.address || 'This home'} will be removed from your active homes, but we'll keep your ratings and notes. You can restore it anytime from Archive.`}
          confirmLabel="Archive home"
          onCancel={() => setArchiveTarget(null)}
          onConfirm={confirmArchive}
        />
      )}
    </>
  );
}
