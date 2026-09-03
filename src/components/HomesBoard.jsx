'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus, Search, MapPin, Link2, Archive as ArchiveIcon, ExternalLink,
  Heart, Home as HomeIcon, Undo2, Trash2,
} from 'lucide-react';
import { StarInput, MatchSummary } from '@/components/ui';
import HomeModal from '@/components/HomeModal';
import { STATUS_OPTIONS, STATUS_COLOR, emptyHome, isRentalType, isArchivedStatus, TOUR_RATING_KEY } from '@/lib/constants';
import { parseNum, fmtMoney, avgRating, trueCheckLabels, homeStyleSummary, computeMatch, matchColor, matchTint } from '@/lib/matching';
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

function HomeCard({ home, priorities, onEdit, onArchiveRequest, onToggleFavorite }) {
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
  const statLine = [
    home.beds && `${home.beds} bd`,
    home.baths && `${home.baths} ba`,
    home.sqft && `${parseNum(home.sqft)?.toLocaleString()} sqft`,
    pps && `$${pps}/sqft`,
    home.lotSize && `${home.lotSize} lot`,
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
          <span className="hh-mono" style={{ position: 'absolute', top: 10, left: 10, fontSize: 10.5, fontWeight: 700, color: '#fff', background: STATUS_COLOR[home.status] || 'var(--ink-soft)', padding: '4px 9px', borderRadius: 999, boxShadow: '0 2px 8px rgba(46,38,33,0.2)' }}>{home.status}</span>
          <button
            type="button" onClick={() => onToggleFavorite(home)} aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            style={{
              position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: isFavorite ? 'var(--brick)' : 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(46,38,33,0.2)',
            }}
          >
            <Heart size={15} color={isFavorite ? '#fff' : 'var(--brick)'} fill={isFavorite ? '#fff' : 'none'} />
          </button>
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

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <StarInput value={Math.round(avg || 0)} readOnly size={14} />
            <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{avg ? avg.toFixed(1) : '—'} avg</span>
          </div>

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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {home.listingUrl && (
                <a href={home.listingUrl} target="_blank" rel="noreferrer" className="hh-btn hh-btn-ghost" style={{ padding: '5px 8px' }} title="Open listing">
                  <ExternalLink size={13} />
                </a>
              )}
              <button className="hh-btn hh-btn-ghost" style={{ padding: '5px 8px' }} onClick={() => onArchiveRequest(home)} title="Archive">
                <ArchiveIcon size={13} />
              </button>
            </div>
            <button className="hh-btn hh-btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => onEdit(home)}>Edit</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardGrid({ homes, priorities, onEdit, onArchiveRequest, onToggleFavorite }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {homes.map((h) => <HomeCard key={h.id} home={h} priorities={priorities} onEdit={onEdit} onArchiveRequest={onArchiveRequest} onToggleFavorite={onToggleFavorite} />)}
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
        <button className="hh-btn hh-btn-ghost" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => onEdit(home)}>Edit</button>
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
  const [statusFilter, setStatusFilter] = useState('All');
  const [modalHome, setModalHome] = useState(null);
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
  }, [userId, searchId]);

  const toggleFavorite = useCallback((home) => {
    const next = { ...home, reaction: home.reaction === 'love' ? null : 'love' };
    setHomes((prev) => prev.map((h) => (h.id === home.id ? next : h)));
    const supabase = createClient();
    saveHomeQuery(supabase, next, userId, searchId).catch(() => {});
  }, [userId, searchId]);

  const confirmArchive = useCallback(() => {
    if (!archiveTarget) return;
    saveHome({ ...archiveTarget, status: 'Archived' });
    setArchiveTarget(null);
  }, [archiveTarget, saveHome]);

  const restoreHome = useCallback((home) => { saveHome({ ...home, status: 'Saved', rejectionReason: '' }); }, [saveHome]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setHomes((prev) => prev.filter((h) => h.id !== id));
    setDeleteTarget(null);
    const supabase = createClient();
    try { await deleteHomeQuery(supabase, id); } catch (e) { /* already removed locally */ }
  }, [deleteTarget]);

  const activeHomes = useMemo(() => homes.filter((h) => !isArchivedStatus(h.status)), [homes]);
  const archivedHomes = useMemo(() => homes.filter((h) => isArchivedStatus(h.status)), [homes]);
  const favoriteHomes = useMemo(() => activeHomes.filter((h) => h.reaction === 'love'), [activeHomes]);

  const baseList = mode === 'archive' ? archivedHomes : mode === 'favorites' ? favoriteHomes : activeHomes;

  const filtered = useMemo(() => {
    if (mode !== 'homes') return baseList;
    return baseList.filter((h) => {
      if (statusFilter !== 'All' && h.status !== statusFilter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const hay = [h.address, h.crossroads, ...(h.homeLayout || []), h.primaryBedroomLocation, h.secondaryBedroomLocation, ...trueCheckLabels(h)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [baseList, query, statusFilter, mode]);

  if (mode === 'archive') {
    return (
      <>
        <ArchiveList homes={archivedHomes} onEdit={setModalHome} onRestore={restoreHome} onRequestDelete={setDeleteTarget} />
        {modalHome && <HomeModal initial={modalHome} priorities={priorities} onSave={saveHome} onClose={() => setModalHome(null)} />}
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '4px 0 14px' }}>
        <button className="hh-btn" onClick={() => setModalHome(emptyHome())}><Plus size={15} /> Add home</button>
      </div>

      {saveError && <div style={{ background: 'rgba(193,89,47,0.09)', border: '1px solid var(--brick)', color: 'var(--brick)', fontSize: 12.5, padding: '9px 14px', borderRadius: 12, marginBottom: 14 }}>{saveError}</div>}

      {mode === 'homes' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', margin: '4px 0 22px' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--ink-soft)' }} />
            <input className="hh-input" style={{ paddingLeft: 30 }} placeholder="Search address, layout, feature..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className="hh-select" style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="All">All statuses</option>
            {STATUS_OPTIONS.filter((s) => s !== 'Archived').map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {filtered.length === 0 ? (
        mode === 'favorites' ? (
          <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', padding: '30px 0' }}>Nothing favorited yet. Tap the heart on a home to add it here.</div>
        ) : (
          <div className="hh-corner" style={{ border: '1px dashed var(--line)', borderRadius: 16, padding: '48px 24px', textAlign: 'center', color: 'var(--ink-soft)' }}>
            <p className="hh-serif" style={{ fontSize: 17, color: 'var(--ink)', marginBottom: 6 }}>{activeHomes.length === 0 ? 'No homes yet' : 'Nothing matches that search'}</p>
            <p style={{ fontSize: 13, marginBottom: 18 }}>{activeHomes.length === 0 ? "Add the first listing you're considering to start comparing." : 'Try a different search or status filter.'}</p>
            {activeHomes.length === 0 && <button className="hh-btn" onClick={() => setModalHome(emptyHome())}><Plus size={15} /> Add your first home</button>}
          </div>
        )
      ) : (
        <CardGrid homes={filtered} priorities={priorities} onEdit={setModalHome} onArchiveRequest={setArchiveTarget} onToggleFavorite={toggleFavorite} />
      )}

      {modalHome && <HomeModal initial={modalHome} priorities={priorities} onSave={saveHome} onClose={() => setModalHome(null)} />}

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
