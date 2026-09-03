'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus, Search, LayoutGrid, List, MapPin, Link2, Trash2, ExternalLink,
  ChevronUp, ChevronDown, Undo2, Home as HomeIcon,
} from 'lucide-react';
import { StarInput, ReactionButtons, MatchSummary } from '@/components/ui';
import HomeModal from '@/components/HomeModal';
import { STATUS_OPTIONS, STATUS_COLOR, emptyHome, isRentalType } from '@/lib/constants';
import { parseNum, fmtMoney, avgRating, trueCheckLabels, homeStyleSummary, computeMatch, matchColor, matchTint } from '@/lib/matching';
import { createClient } from '@/lib/supabase/client';
import { saveHome as saveHomeQuery, deleteHome as deleteHomeQuery } from '@/lib/supabase/data';

/* --------------------------------- card view --------------------------------- */

function HomeCard({ home, priorities, onEdit, onDelete, onReact }) {
  const [imgError, setImgError] = useState(false);
  const avg = avgRating(home.ratings);
  const pps = parseNum(home.price) && parseNum(home.sqft) ? Math.round(parseNum(home.price) / parseNum(home.sqft)) : null;
  const match = computeMatch(home, priorities);
  const checks = trueCheckLabels(home);
  const visibleChecks = checks.slice(0, 4);
  const extraChecks = checks.length - visibleChecks.length;
  const styleSummary = homeStyleSummary(home);
  const showPhoto = home.photoUrl && !imgError;
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
            <ReactionButtons home={home} onReact={onReact} />
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {home.listingUrl && <a href={home.listingUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', display: 'flex', alignItems: 'center', marginRight: 4 }}><Link2 size={13} /></a>}
              <button className="hh-btn hh-btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => onEdit(home)}>Edit</button>
              <button className="hh-btn hh-btn-danger" onClick={() => onDelete(home.id)}><Trash2 size={14} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardGrid({ homes, priorities, onEdit, onDelete, onReact }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
      {homes.map((h) => <HomeCard key={h.id} home={h} priorities={priorities} onEdit={onEdit} onDelete={onDelete} onReact={onReact} />)}
    </div>
  );
}

/* --------------------------------- table view --------------------------------- */

const COLUMNS = [
  { key: 'address', label: 'Address' }, { key: 'match', label: 'Match' }, { key: 'status', label: 'Status' },
  { key: 'price', label: 'Price' }, { key: 'estMonthly', label: 'Est./mo' }, { key: 'pps', label: '$/sqft' },
  { key: 'beds', label: 'Bd' }, { key: 'baths', label: 'Ba' }, { key: 'sqft', label: 'Sqft' },
  { key: 'lotSize', label: 'Lot' }, { key: 'garageSpaces', label: 'Garage' }, { key: 'style', label: 'Layout' },
  { key: 'yearBuilt', label: 'Year' }, { key: 'dom', label: 'DOM' }, { key: 'avg', label: 'Rating' }, { key: 'tags', label: 'Features' },
];

function TableView({ homes, priorities, sort, setSort, onEdit, onDelete }) {
  const rows = homes.map((h) => ({
    ...h,
    pps: parseNum(h.price) && parseNum(h.sqft) ? Math.round(parseNum(h.price) / parseNum(h.sqft)) : null,
    avg: avgRating(h.ratings),
    match: computeMatch(h, priorities),
    style: homeStyleSummary(h),
    checksList: trueCheckLabels(h),
  }));

  const sorted = useMemo(() => {
    const arr = [...rows];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      let av = a[key], bv = b[key];
      if (key === 'address' || key === 'style' || key === 'status') { av = (av || '').toLowerCase(); bv = (bv || '').toLowerCase(); return dir * av.localeCompare(bv); }
      if (key === 'avg') { av = a.avg ?? -Infinity; bv = b.avg ?? -Infinity; return dir * (av - bv); }
      if (key === 'match') { av = a.match?.pct ?? -Infinity; bv = b.match?.pct ?? -Infinity; return dir * (av - bv); }
      av = parseNum(av) ?? -Infinity; bv = parseNum(bv) ?? -Infinity;
      return dir * (av - bv);
    });
    return arr;
  }, [rows, sort]);

  const clickSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));

  return (
    <div className="hh-scrollx">
      <table className="hh-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => <th key={c.key} onClick={() => clickSort(c.key)}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{c.label}{sort.key === c.key && (sort.dir === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</span></th>)}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => (
            <tr key={h.id}>
              <td>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {h.photoUrl && <img src={h.photoUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)', flexShrink: 0 }} onError={(e) => { e.target.style.display = 'none'; }} />}
                  <div><div style={{ fontWeight: 500 }}>{h.address}</div>{h.crossroads && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{h.crossroads}</div>}</div>
                </div>
              </td>
              <td title={h.match ? h.match.missing.map((c) => 'Missing: ' + c.label).join('\n') : ''}>
                {h.match ? <span className="hh-mono" style={{ color: matchColor(h.match.pct), fontWeight: 600 }}>{h.match.pct}%</span> : <span style={{ color: 'var(--ink-soft)' }}>—</span>}
              </td>
              <td><span className="hh-mono" style={{ fontSize: 10.5, color: '#fff', background: STATUS_COLOR[h.status] || 'var(--ink-soft)', padding: '3px 8px', borderRadius: 999 }}>{h.status}</span></td>
              <td className="hh-mono" style={{ color: 'var(--brick)' }}>{fmtMoney(h.price)}</td>
              <td className="hh-mono">{h.estMonthly ? fmtMoney(h.estMonthly) : '—'}</td>
              <td className="hh-mono">{h.pps ? '$' + h.pps : '—'}</td>
              <td className="hh-mono">{h.beds || '—'}</td>
              <td className="hh-mono">{h.baths || '—'}</td>
              <td className="hh-mono">{h.sqft ? parseNum(h.sqft)?.toLocaleString() : '—'}</td>
              <td>{h.lotSize || '—'}</td>
              <td className="hh-mono">{h.garageSpaces || '—'}</td>
              <td>{h.style || '—'}</td>
              <td className="hh-mono">{h.yearBuilt || '—'}</td>
              <td className="hh-mono">{h.daysOnMarket || '—'}</td>
              <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><StarInput value={Math.round(h.avg || 0)} readOnly size={12} /><span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{h.avg ? h.avg.toFixed(1) : '—'}</span></div></td>
              <td style={{ whiteSpace: 'normal', minWidth: 160 }}><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{h.checksList.map((t) => <span key={t} className="hh-chip static on" style={{ fontSize: 10.5, padding: '2px 7px' }}>{t}</span>)}</div></td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  {h.listingUrl && <a href={h.listingUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', display: 'flex', alignItems: 'center' }}><ExternalLink size={14} /></a>}
                  <button className="hh-btn hh-btn-ghost" style={{ padding: '4px 8px', fontSize: 11.5 }} onClick={() => onEdit(h)}>Edit</button>
                  <button className="hh-btn hh-btn-danger" onClick={() => onDelete(h.id)}><Trash2 size={13} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------- archive list -------------------------------- */

function ArchiveList({ homes, onEdit, onRestore, onDelete }) {
  if (!homes.length) return <div style={{ fontSize: 13, color: 'var(--ink-soft)', padding: '30px 0' }}>Nothing archived yet. Homes you mark &quot;Passed&quot; show up here with your reason, so you never lose track of why.</div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {homes.map((h) => (
        <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 18px', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--paper-raised)', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 14 }}>{h.address}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{fmtMoney(h.price)}{h.rejectionReason ? ` — Passed because: ${h.rejectionReason}` : ' — no reason logged'}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="hh-btn hh-btn-ghost" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => onEdit(h)}>Edit</button>
            <button className="hh-btn hh-btn-ghost" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => onRestore(h)}><Undo2 size={13} /> Restore</button>
            <button className="hh-btn hh-btn-danger" onClick={() => onDelete(h.id)}><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------- board ---------------------------------- */

export default function HomesBoard({ mode, userId, searchId, initialHomes, initialPriorities }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [homes, setHomes] = useState(initialHomes);
  const [priorities] = useState(initialPriorities);
  const [view, setView] = useState('cards');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sort, setSort] = useState({ key: 'price', dir: 1 });
  const [modalHome, setModalHome] = useState(null);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (mode === 'homes' && searchParams.get('add') === '1') {
      setModalHome(emptyHome());
      router.replace('/homes');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveHome = useCallback(async (home) => {
    const supabase = createClient();
    const saved = await saveHomeQuery(supabase, home, userId, searchId);
    setHomes((prev) => (prev.some((h) => h.id === saved.id) ? prev.map((h) => (h.id === saved.id ? saved : h)) : [...prev, saved]));
    setModalHome(null);
    setSaveError('');
  }, [userId, searchId]);

  const deleteHome = useCallback(async (id) => {
    setHomes((prev) => prev.filter((h) => h.id !== id));
    const supabase = createClient();
    try { await deleteHomeQuery(supabase, id); } catch (e) { /* already removed locally */ }
  }, []);

  const reactToHome = useCallback((id, reaction) => {
    setHomes((prev) => {
      const home = prev.find((h) => h.id === id);
      if (!home) return prev;
      const next = { ...home, reaction };
      const supabase = createClient();
      saveHomeQuery(supabase, next, userId, searchId).catch(() => {});
      return prev.map((h) => (h.id === id ? next : h));
    });
  }, [userId, searchId]);

  const restoreHome = useCallback((home) => { saveHome({ ...home, status: 'Considering', rejectionReason: '' }); }, [saveHome]);

  const activeHomes = useMemo(() => homes.filter((h) => h.status !== 'Passed'), [homes]);
  const archivedHomes = useMemo(() => homes.filter((h) => h.status === 'Passed'), [homes]);
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
        <ArchiveList homes={archivedHomes} onEdit={setModalHome} onRestore={restoreHome} onDelete={deleteHome} />
        {modalHome && <HomeModal initial={modalHome} priorities={priorities} onSave={saveHome} onClose={() => setModalHome(null)} />}
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
            {STATUS_OPTIONS.filter((s) => s !== 'Passed').map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', marginLeft: 'auto' }}>
            <button onClick={() => setView('cards')} className="hh-btn" style={{ borderRadius: 0, border: 'none', background: view === 'cards' ? 'var(--ink)' : 'transparent', color: view === 'cards' ? 'var(--paper)' : 'var(--ink)' }}><LayoutGrid size={14} /> Cards</button>
            <button onClick={() => setView('table')} className="hh-btn" style={{ borderRadius: 0, border: 'none', background: view === 'table' ? 'var(--ink)' : 'transparent', color: view === 'table' ? 'var(--paper)' : 'var(--ink)' }}><List size={14} /> Table</button>
          </div>
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
      ) : view === 'cards' || mode === 'favorites' ? (
        <CardGrid homes={filtered} priorities={priorities} onEdit={setModalHome} onDelete={deleteHome} onReact={reactToHome} />
      ) : (
        <TableView homes={filtered} priorities={priorities} sort={sort} setSort={setSort} onEdit={setModalHome} onDelete={deleteHome} />
      )}

      {modalHome && <HomeModal initial={modalHome} priorities={priorities} onSave={saveHome} onClose={() => setModalHome(null)} />}
    </>
  );
}
