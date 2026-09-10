'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ExternalLink, Heart, Footprints, Home as HomeIcon, Minus, Pencil, RotateCcw, Star, X } from 'lucide-react';
import HomeModal from '@/components/HomeModal';
import PostTourModal from '@/components/PostTourModal';
import ArchiveConfirmModal from '@/components/ArchiveConfirmModal';
import { criterionDisplayLabel, isArchivedStatus, TOUR_RATING_KEY } from '@/lib/constants';
import { computeMatch, parseNum } from '@/lib/matching';
import { evaluateCommute } from '@/lib/commute';
import { formatDateOnly, formatHomePrice, formatLotSizeDisplay, formatPropertyType, formatTriState, parseCommaList, splitAddressLines } from '@/lib/homeDisplay';
import { searchIntentCapabilities } from '@/lib/searchIntent';
import { useCommuteObserver } from '@/lib/useCommuteObserver';
import { createClient } from '@/lib/supabase/client';
import { hasSharedHomeChanges, saveHomePersonalAndShared, saveHomePersonalState } from '@/lib/supabase/collaboration';
import { applyPostTourVerdict, archiveHome, hasToured, restoreHome, toggleFavorite } from '@/lib/lifecycle';

const TIER_LABELS = { must: 'Must-haves', important: 'Important', nice: 'Nice to have' };

function Stars({ value }) {
  return <span className="hh-detail-stars" aria-label={`${value} out of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={17} fill={n <= value ? '#C69245' : 'none'} color={n <= value ? '#C69245' : '#DED2C1'} />)}</span>;
}

function Section({ eyebrow, title, children, className = '' }) {
  return <section className={`hh-detail-section ${className}`}><div className="hh-detail-eyebrow">{eyebrow}</div>{title && <h2 className="hh-serif">{title}</h2>}{children}</section>;
}

export default function HomeDetail({ home: initialHome, priorities, commuteDestinations, coBuyerPerspective, sharedFactAwareness, userId, searchId, isCollaborative = false }) {
  const router = useRouter();
  const [home, setHome] = useState(initialHome);
  const [editing, setEditing] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [thoughts, setThoughts] = useState({ pros: home.pros || '', cons: home.cons || '', notes: home.notes || '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const personalQueue = useRef(Promise.resolve());
  const confirmedHome = useRef(initialHome);
  const personalVersion = useRef(0);
  const retryPersonal = useRef(null);
  const { setRef, getState } = useCommuteObserver(home, commuteDestinations);
  const commuteEvaluation = evaluateCommute(commuteDestinations, getState);
  const match = computeMatch(home, priorities, commuteEvaluation);
  const overall = home.ratings?.[TOUR_RATING_KEY] || 0;
  const experiential = (match?.allSelected || []).filter((item) => !item.objective && item.evaluated);
  const likedExperiences = experiential.filter((item) => item.met);
  const dislikedExperiences = experiential.filter((item) => !item.met);
  const hasPostTourFeedback = Boolean(home.reaction || overall > 0 || experiential.length > 0);
  const hasCoBuyerPerspective = Boolean(coBuyerPerspective && (
    coBuyerPerspective.match ||
    coBuyerPerspective.overallFeeling > 0 ||
    (coBuyerPerspective.differentTakes?.length ?? 0) > 0
  ));
  const { showsRentalFacts } = searchIntentCapabilities(priorities.searchType);
  const facts = [
    ['Property Type', home.propertyType && formatPropertyType(home.propertyType)],
    ...(showsRentalFacts ? [
      ['Available On', home.availableOn && formatDateOnly(home.availableOn)],
      ['Pets Allowed', formatTriState(home.petsAllowed)],
      ['Utilities Included', formatTriState(home.utilitiesIncluded)],
      ['In-Unit Laundry', formatTriState(home.inUnitLaundry)],
    ] : []),
    ['Home layout', (home.homeLayout || []).join(', ')], ['Condition', (home.homeCondition || []).join(', ')],
    ['Garage', home.garageSpaces], ['Basement', home.basementNotes], ['Year built', home.yearBuilt],
    ['Lot', home.lotSize && formatLotSizeDisplay(home.lotSize)], ['Primary bedroom', home.primaryBedroomLocation],
    ['Secondary bedrooms', home.secondaryBedroomLocation],
    ...(!showsRentalFacts ? [
      ['HOA', home.hoaFeeMonthly != null && `$${Number(home.hoaFeeMonthly).toLocaleString()}/mo`],
      ['Property tax', home.propertyTaxAnnual != null && `$${Number(home.propertyTaxAnnual).toLocaleString()}/yr`],
    ] : []),
  ].filter(([, value]) => value);
  const { line1, line2 } = splitAddressLines(home.address);

  const savePersonal = async (patch) => {
    const next = { ...home, ...patch };
    const requestVersion = ++personalVersion.current;
    setHome(next);
    setSaveError('');
    retryPersonal.current = patch;
    const run = async () => {
      try {
        const saved = await saveHomePersonalState(createClient(), next, userId, searchId);
        confirmedHome.current = { ...confirmedHome.current, ...saved };
        if (requestVersion === personalVersion.current) retryPersonal.current = null;
        router.refresh();
        return saved;
      } catch (error) {
        if (requestVersion === personalVersion.current) {
          setHome(confirmedHome.current);
          setSaveError("Couldn't save that change. Try again.");
        }
        throw error;
      }
    };
    const result = personalQueue.current.then(run, run);
    personalQueue.current = result.catch(() => {});
    return result;
  };
  const saveWhole = async (next) => {
    setSaveError('');
    try {
      const saved = await saveHomePersonalAndShared(createClient(), next, userId, searchId);
      confirmedHome.current = saved;
      setHome(saved); setEditing(false); router.refresh();
      return saved;
    } catch (error) {
      setSaveError("Couldn't save that change. Try again.");
      throw error;
    }
  };
  const saveThoughts = async () => {
    setSaving(true);
    try { await saveWhole({ ...home, ...thoughts }); setNotesOpen(false); } catch {} finally { setSaving(false); }
  };
  const handleVerdict = async (current, verdict, patch) => {
    const next = applyPostTourVerdict(current, verdict, patch);
    setReflecting(false);
    if (verdict === 'not_for_me') {
      setArchiveTarget(next);
      return;
    }
    await (hasSharedHomeChanges(next, home) ? saveWhole(next) : savePersonal(next));
  };
  const confirmArchive = async (reason) => {
    const next = archiveHome(archiveTarget, reason);
    setArchiveTarget(null);
    await (hasSharedHomeChanges(next, home) ? saveWhole(next) : savePersonal(next));
  };
  const back = () => window.history.length > 1 ? router.back() : router.push('/homes');

  return <main className="hh-home-detail" ref={setRef}>
    <button type="button" className="hh-detail-back" onClick={back}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
    <header className="hh-detail-hero">
      <div className="hh-detail-photo">{home.photoUrl ? <img src={home.photoUrl} alt={`Exterior of ${home.address}`} /> : <HomeIcon size={50} />}</div>
      <div className="hh-detail-identity">
        <div className="hh-detail-eyebrow">Home</div>
        <h1 className="hh-serif">{line1 || 'Untitled home'}</h1>{line2 && <p className="hh-detail-locality">{line2}</p>}
        <div className="hh-detail-price">{formatHomePrice(home.price, priorities.searchType) || 'Price not added'}</div>
        <div className="hh-detail-core-facts">{[home.beds && `${home.beds} beds`, home.baths && `${home.baths} baths`, home.sqft && `${parseNum(home.sqft)?.toLocaleString()} sq ft`, home.lotSize && formatLotSizeDisplay(home.lotSize)].filter(Boolean).map((fact) => <span key={fact}>{fact}</span>)}</div>
        <div className="hh-detail-summary-row">{match?.pct != null && <strong>{match.pct}% Match</strong>}<span className="hh-detail-lifecycle">{home.status}</span>{home.isFavorite && <span className="hh-detail-favorite"><Heart size={13} fill="currentColor" aria-hidden="true" /> Favorite</span>}</div>
        <div className="hh-detail-links">{home.listingUrl && <a href={home.listingUrl} target="_blank" rel="noreferrer">Original listing <ExternalLink size={13} /></a>}<button type="button" onClick={() => setEditing(true)}><Pencil size={13} /> Edit home information</button></div>
      </div>
    </header>

    {facts.length > 0 && <Section eyebrow="Property facts" className="hh-detail-section-wide"><dl className="hh-detail-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{home.conditionNotes && <p className="hh-detail-condition">{home.conditionNotes}</p>}</Section>}

    {commuteDestinations.length > 0 && <Section eyebrow="Location & commute" title="Your everyday routes"><div className="hh-detail-commutes">{commuteDestinations.map((destination) => { const state = getState(destination); const resolved = state.status === 'ok'; return <div className={resolved ? 'resolved' : 'unresolved'} key={destination.id}><span>{destination.label}</span><strong>{resolved ? `${state.minutes} min drive` : state.status === 'loading' || state.status === 'idle' ? 'Calculating…' : 'Not available yet'}</strong></div>; })}</div></Section>}

    {match && <Section eyebrow="How it fits your search" title={match.pct == null ? 'More will come into focus' : `Why this home is a ${match.pct}% Match for you`}><div className="hh-detail-match-groups">{['must', 'important', 'nice'].map((tier) => { const rows = match.allSelected.filter((item) => item.tier === tier); return rows.length ? <div className={`hh-detail-match-tier ${tier}`} key={tier}><h3>{TIER_LABELS[tier]}</h3>{rows.map((item) => { const detail = !item.evaluated ? (item.objective ? 'Needs more information' : 'Evaluate after tour') : item.objective ? item.detail : item.met ? 'Liked' : "Didn't like"; const stateLabel = !item.evaluated ? 'Unknown' : item.met ? 'Satisfied' : 'Missed'; return <div className={`hh-detail-criterion ${!item.evaluated ? 'unknown' : item.met ? 'met' : 'missed'}`} key={item.key}><b aria-hidden="true">{!item.evaluated ? <Minus size={14} /> : item.met ? <Check size={14} /> : <X size={14} />}</b><span><strong>{item.key.includes(':') ? criterionDisplayLabel(item.key.split(':')[0], item.label) : item.label}</strong><small>{detail}</small></span><span className="sr-only">{stateLabel}</span></div>; })}</div> : null; })}</div></Section>}

    <Section eyebrow="Your take" title="Your relationship with this home" className="hh-detail-relationship hh-detail-section-wide">
      {isCollaborative && <p className="hh-detail-context">These choices are yours. Your co-buyer keeps their own.</p>}
      <div className="hh-detail-actions">
        {hasToured(home) ? <span className="hh-detail-toured-state"><Check size={15} aria-hidden="true" /> Toured</span> : <button className="hh-btn" aria-pressed={home.status === 'Want to Tour'} onClick={() => savePersonal({ status: home.status === 'Want to Tour' ? 'Saved' : 'Want to Tour' }).catch(() => {})}><Footprints size={15} aria-hidden="true" />{home.status === 'Want to Tour' ? 'On your Want to Tour list' : 'Want to tour'}</button>}
        <button className="hh-btn hh-btn-ghost" aria-pressed={home.isFavorite} onClick={() => savePersonal(toggleFavorite(home)).catch(() => {})}><Heart size={15} aria-hidden="true" fill={home.isFavorite ? 'currentColor' : 'none'} />{home.isFavorite ? 'Favorited' : 'Favorite'}</button>
        <button className="hh-detail-archive-action" onClick={() => isArchivedStatus(home.status) ? savePersonal(restoreHome(home)).catch(() => {}) : setArchiveTarget(home)}>{isArchivedStatus(home.status) ? <><RotateCcw size={14} aria-hidden="true" /> Restore</> : 'Archive'}</button>
      </div>
      {home.coBuyerWantsToTour && <p className="hh-detail-context">Co-Buyer still wants to tour this home.</p>}
      {saveError && <p className="hh-save-error" role="alert">{saveError}{retryPersonal.current && <> <button type="button" onClick={() => savePersonal(retryPersonal.current).catch(() => {})}>Retry</button></>}</p>}
      {hasToured(home) ? <div className="hh-detail-evaluation">{overall > 0 && <div className="hh-detail-overall"><h3>Overall feeling</h3><Stars value={overall} /></div>}{experiential.length > 0 && <div className="hh-detail-reactions">{likedExperiences.length > 0 && <div><h3 className="liked">Liked</h3>{likedExperiences.map((item) => <p key={item.key}>{criterionDisplayLabel(item.key.split(':')[0], item.label)}</p>)}</div>}{dislikedExperiences.length > 0 && <div><h3 className="disliked">Didn't like</h3>{dislikedExperiences.map((item) => <p key={item.key}>{criterionDisplayLabel(item.key.split(':')[0], item.label)}</p>)}</div>}</div>}<div className="hh-detail-after-tour"><strong>After your tour</strong><p>{hasPostTourFeedback ? 'Keep your take current as this home stays in consideration.' : 'Come back to record how the home actually felt.'}</p><button className="hh-btn hh-btn-ghost hh-detail-take-action" onClick={() => setReflecting(true)}>{hasPostTourFeedback ? 'Edit your take' : 'Record your take'}</button></div></div> : <div className="hh-detail-after-tour"><strong>After your tour</strong><p>Come back after seeing this home to record how it actually felt.</p><button className="hh-btn hh-btn-ghost hh-detail-take-action" onClick={() => setReflecting(true)}>Record your take</button></div>}
    </Section>

    {hasCoBuyerPerspective && <Section eyebrow="Co-buyer perspective" title="Another view, kept distinct"><div className="hh-detail-cobuyer">{coBuyerPerspective.match?.pct != null && <strong>{coBuyerPerspective.match.pct}% Match</strong>}{coBuyerPerspective.overallFeeling > 0 && <span><Stars value={coBuyerPerspective.overallFeeling} /> Overall feeling</span>}</div>{coBuyerPerspective.differentTakes?.length > 0 && <div className="hh-detail-differences"><h3>Different takes</h3>{coBuyerPerspective.differentTakes.map((take) => { const category = take.key?.split(':')[0]; return <p key={take.key}><strong>{criterionDisplayLabel(category, take.label)}</strong><span>{take.youLiked ? 'You liked it' : "You didn't like it"} · {take.coBuyerLiked ? 'Co-Buyer did' : "Co-Buyer didn't"}</span></p>; })}</div>}</Section>}

    <Section eyebrow="Property notes" title={isCollaborative ? "Shared notes" : "What you want to remember"}>{isCollaborative && <p className="hh-detail-context">Pros, cons, and notes are visible to both of you.</p>}{!notesOpen ? <><div className="hh-detail-notes">{parseCommaList(home.pros).length > 0 && <div><h3>Pros</h3>{parseCommaList(home.pros).map((x) => <p key={x}><span aria-hidden="true">+</span>{x}</p>)}</div>}{parseCommaList(home.cons).length > 0 && <div><h3>Cons</h3>{parseCommaList(home.cons).map((x) => <p key={x}><span aria-hidden="true">−</span>{x}</p>)}</div>}{home.notes && <div className="wide"><h3>Notes</h3><p>{home.notes}</p></div>}</div><button className="hh-btn hh-btn-ghost hh-detail-notes-action" onClick={() => setNotesOpen(true)}>{home.pros || home.cons || home.notes ? 'Edit property notes' : 'Add pros, cons, or a note'}</button></> : <div className="hh-detail-notes-form"><label>Pros<input className="hh-input" value={thoughts.pros} onChange={(e) => setThoughts({ ...thoughts, pros: e.target.value })} placeholder="Great kitchen, quiet street" /></label><label>Cons<input className="hh-input" value={thoughts.cons} onChange={(e) => setThoughts({ ...thoughts, cons: e.target.value })} placeholder="Busy road" /></label><label className="wide">Notes<textarea className="hh-textarea" value={thoughts.notes} onChange={(e) => setThoughts({ ...thoughts, notes: e.target.value })} /></label><div className="wide hh-detail-form-actions"><button className="hh-btn hh-btn-ghost" onClick={() => setNotesOpen(false)}>Cancel</button><button className="hh-btn" disabled={saving} onClick={saveThoughts}>{saving ? 'Saving…' : 'Save notes'}</button></div></div>}</Section>
    {editing && <HomeModal presentation="detail-panel" initial={home} priorities={priorities} sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative} userId={userId} onSave={saveWhole} onClose={() => setEditing(false)} onWantToTour={() => savePersonal({ status: 'Want to Tour' })} onArchiveRequest={setArchiveTarget} />}
    {archiveTarget && <ArchiveConfirmModal home={archiveTarget} onCancel={() => setArchiveTarget(null)} onConfirm={(reason) => confirmArchive(reason).catch(() => {})} />}
    {reflecting && <PostTourModal home={home} priorities={priorities} isCollaborative={isCollaborative} saveError={saveError} onVerdict={handleVerdict} onClose={() => setReflecting(false)} />}
  </main>;
}
