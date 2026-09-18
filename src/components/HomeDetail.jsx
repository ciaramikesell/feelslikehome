'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ChevronRight, ExternalLink, Heart, Footprints, Home as HomeIcon, Minus, Pencil, RotateCcw, Star, X } from 'lucide-react';
import HomeModal from '@/components/HomeModal';
import PostTourModal from '@/components/PostTourModal';
import ArchiveConfirmModal from '@/components/ArchiveConfirmModal';
import RealtorContributions from '@/components/RealtorContributions';
import HomeDetailLocation from '@/components/HomeDetailLocation';
import { criterionDisplayLabel, isArchivedStatus, TOUR_RATING_KEY } from '@/lib/constants';
import { computeMatch, matchFactualSummary, parseNum } from '@/lib/matching';
import { evaluateCommute } from '@/lib/commute';
import { formatDateOnly, formatHomePrice, formatLotSizeDisplay, formatPropertyType, formatTriState, parseCommaList } from '@/lib/homeDisplay';
import { homeIdentity, homeVocabulary } from '@/lib/homePresentation';
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

function tierSummary(rows) {
  const met = rows.filter((item) => item.evaluated && item.met).length;
  const missed = rows.filter((item) => item.evaluated && item.met === false).length;
  const neutral = rows.filter((item) => item.evaluated && item.met === null).length;
  const unknown = rows.filter((item) => !item.evaluated).length;
  return [met ? `${met} met` : null, missed ? `${missed} missing` : null, neutral ? `${neutral} neutral` : null, unknown ? `${unknown} unknown` : null].filter(Boolean).join(' · ');
}

export default function HomeDetail({ home: initialHome, priorities, commuteDestinations = [], coBuyerPerspective, sharedFactAwareness = {}, userId, searchId, isCollaborative = false, readOnly = false, backHref = null, realtorContributions = { notes: [], tours: [] } }) {
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
  const matchSection = useRef(null);
  const confirmedHome = useRef(initialHome);
  const personalVersion = useRef(0);
  const retryPersonal = useRef(null);
  const { setRef, getState } = useCommuteObserver(home, commuteDestinations);
  const commuteEvaluation = evaluateCommute(commuteDestinations, getState);
  const match = computeMatch(home, priorities, commuteEvaluation);
  const factualSummary = matchFactualSummary(match);
  const overall = home.ratings?.[TOUR_RATING_KEY] || 0;
  const experiential = (match?.allSelected || []).filter((item) => !item.objective && item.evaluated);
  const likedExperiences = experiential.filter((item) => item.met);
  const dislikedExperiences = experiential.filter((item) => item.met === false);
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
  const identity = homeIdentity(home, priorities);
  const vocabulary = homeVocabulary(priorities);

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
  const back = () => backHref ? router.push(backHref) : window.history.length > 1 ? router.back() : router.push('/homes');

  return <main className="hh-home-detail" ref={setRef}>
    <button type="button" className="hh-detail-back" onClick={back}><ArrowLeft size={16} aria-hidden="true" /> Back to homes</button>
    <header className="hh-detail-hero">
      <div className="hh-detail-photo">{home.photoUrl ? <img src={home.photoUrl} alt={`${identity.accessible} ${vocabulary.singularLower} photo`} /> : <HomeIcon size={50} />}</div>
      <div className="hh-detail-identity">
        <div className="hh-detail-status-chips"><span>{home.status}</span>{home.isFavorite && <span className="favorite"><Heart size={12} fill="currentColor" aria-hidden="true" /> Favorite</span>}</div>
        <h1 className="hh-serif">{identity.primary}</h1>{identity.option && <p className="hh-detail-option">{identity.option}</p>}{identity.supporting && <p className="hh-detail-locality">{identity.supporting}</p>}
        <div className="hh-detail-price-row"><div className="hh-detail-price">{formatHomePrice(home.price, priorities.searchType) || 'Price not added'}</div>{home.estMonthly && <span>${Number(home.estMonthly).toLocaleString()}/mo est.</span>}</div>
        <div className="hh-detail-core-facts">{[home.beds && `${home.beds} beds`, home.baths && `${home.baths} baths`, home.sqft && `${parseNum(home.sqft)?.toLocaleString()} sq ft`, home.lotSize && formatLotSizeDisplay(home.lotSize)].filter(Boolean).map((fact) => <span key={fact}>{fact}</span>)}</div>
        {home.suggestedBy && <span className="hh-provenance">Suggested by {home.suggestedBy}</span>}
        {match?.pct != null && <button type="button" className="hh-detail-match-card" onClick={() => { matchSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); matchSection.current?.focus({ preventScroll: true }); }} aria-label={`View why this home is a ${match.pct}% Match`}><span className="hh-detail-match-ring">{match.pct}%</span><span><strong>Your Match</strong><small>{factualSummary?.mustClause || 'Based on your known priorities'}{factualSummary?.importantSentence ? ` · ${factualSummary.importantSentence}` : ''}</small></span><ChevronRight size={20} aria-hidden="true" /></button>}
        {/* A concise, deterministic readout of the same aggregate counts computeMatch
            already produced — never a qualitative claim like "Great fit for your
            family," and a missing/unknown Must-Have is always named, never smoothed
            over by the headline percentage above. */}
        {factualSummary && (factualSummary.mustClause || factualSummary.importantSentence) && (
          <p className="hh-detail-match-factual">
            {factualSummary.mustClause && <strong>{factualSummary.mustClause}.</strong>}
            {factualSummary.importantSentence && <span> {factualSummary.importantSentence}</span>}
          </p>
        )}
        <div className="hh-detail-links">{home.listingUrl && <a href={home.listingUrl} target="_blank" rel="noreferrer">Original listing <ExternalLink size={15} /></a>}{!readOnly && <button type="button" onClick={() => setEditing(true)}><Pencil size={15} /> Edit {vocabulary.singularLower} information</button>}</div>
      </div>
    </header>

    {facts.length > 0 && <Section eyebrow="The home" title="Property Facts" className="hh-detail-section-wide hh-detail-surface"><dl className="hh-detail-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{home.conditionNotes && <p className="hh-detail-condition">{home.conditionNotes}</p>}</Section>}

    {commuteDestinations.length > 0 && (() => {
      return (
        <Section eyebrow="Places that matter" title="Location & Commute" className="hh-detail-section-wide hh-detail-surface">
          <HomeDetailLocation home={home} destinations={commuteDestinations} getState={getState} />
        </Section>
      );
    })()}

    {match && <div ref={matchSection} tabIndex={-1} className="hh-detail-match-anchor"><Section eyebrow="How it fits your search" title={match.pct == null ? 'More will come into focus' : `Why this home is a ${match.pct}% Match${readOnly ? '' : ' for you'}`} className="hh-detail-section-wide hh-detail-surface"><div className="hh-detail-match-groups">{['must', 'important', 'nice'].map((tier) => { const rows = match.allSelected.filter((item) => item.tier === tier); return rows.length ? <div className={`hh-detail-match-tier ${tier}`} key={tier}><h3>{TIER_LABELS[tier]}<small>{tierSummary(rows)}</small></h3>{rows.map((item) => { const neutral = item.evaluated && item.met === null; const detail = !item.evaluated ? (item.objective ? 'Needs more information' : 'Evaluate after tour') : item.detail || (item.objective ? 'Evaluated' : neutral ? 'Neutral' : item.met ? 'Matches' : 'Does not match'); const stateLabel = !item.evaluated ? 'Unknown' : neutral ? 'Neutral' : item.met ? 'Satisfied' : 'Missed'; return <div className={`hh-detail-criterion ${!item.evaluated ? 'unknown' : neutral ? 'neutral' : item.met ? 'met' : 'missed'}`} key={item.key}><b aria-hidden="true">{!item.evaluated ? <span className="hh-detail-question">?</span> : neutral ? <span>—</span> : item.met ? <Check size={14} /> : <X size={14} />}</b><span><strong>{item.key.includes(':') ? criterionDisplayLabel(item.key.split(':')[0], item.label) : item.label}</strong><small>{detail}</small></span><span className="sr-only">{stateLabel}</span></div>; })}</div> : null; })}</div></Section></div>}

    <Section eyebrow={readOnly ? 'Buyer perspective' : 'Your take'} title={readOnly ? 'Their relationship with this home' : 'Your relationship with this home'} className="hh-detail-relationship hh-detail-section-wide hh-detail-surface">
      {isCollaborative && <p className="hh-detail-context">{readOnly ? 'Each buyer’s perspective stays separate.' : 'These choices are yours. Your co-buyer can see them and keeps their own.'}</p>}
      {!readOnly && <div className="hh-detail-actions">
        {hasToured(home) ? <span className="hh-detail-toured-state"><Check size={15} aria-hidden="true" /> Toured</span> : <button className="hh-btn" aria-pressed={home.status === 'Want to Tour'} onClick={() => savePersonal({ status: home.status === 'Want to Tour' ? 'Saved' : 'Want to Tour' }).catch(() => {})}><Footprints size={15} aria-hidden="true" />{home.status === 'Want to Tour' ? 'On your Want to Tour list' : 'Want to tour'}</button>}
        <button className="hh-btn hh-btn-ghost" aria-pressed={home.isFavorite} onClick={() => savePersonal(toggleFavorite(home)).catch(() => {})}><Heart size={15} aria-hidden="true" fill={home.isFavorite ? 'currentColor' : 'none'} />{home.isFavorite ? 'Favorited' : 'Favorite'}</button>
        <button className="hh-detail-archive-action" onClick={() => isArchivedStatus(home.status) ? savePersonal(restoreHome(home)).catch(() => {}) : setArchiveTarget(home)}>{isArchivedStatus(home.status) ? <><RotateCcw size={14} aria-hidden="true" /> Restore</> : 'Archive'}</button>
      </div>}
      {home.coBuyerWantsToTour && <p className="hh-detail-context">Your co-buyer still wants to tour this home.</p>}
      {saveError && <p className="hh-save-error" role="alert">{saveError}{retryPersonal.current && <> <button type="button" onClick={() => savePersonal(retryPersonal.current).catch(() => {})}>Retry</button></>}</p>}
      {hasToured(home) ? <div className="hh-detail-evaluation">{overall > 0 && <div className="hh-detail-overall"><h3>Overall feeling</h3><Stars value={overall} /></div>}{experiential.length > 0 && <div className="hh-detail-reactions">{likedExperiences.length > 0 && <div><h3 className="liked">Liked</h3>{likedExperiences.map((item) => <p key={item.key}>{criterionDisplayLabel(item.key.split(':')[0], item.label)}</p>)}</div>}{dislikedExperiences.length > 0 && <div><h3 className="disliked">Didn't like</h3>{dislikedExperiences.map((item) => <p key={item.key}>{criterionDisplayLabel(item.key.split(':')[0], item.label)}</p>)}</div>}</div>}<div className="hh-detail-after-tour"><strong>After your tour</strong><p>{hasPostTourFeedback ? 'Keep your take current as this home stays in consideration.' : 'Come back to record how the home actually felt.'}</p>{!readOnly && <button className="hh-btn hh-btn-ghost hh-detail-take-action" onClick={() => setReflecting(true)}>{hasPostTourFeedback ? 'Edit your take' : 'Record your take'}</button>}</div></div> : <div className="hh-detail-after-tour"><strong>After your tour</strong><p>Come back after seeing this home to record how it actually felt.</p>{!readOnly && <button className="hh-btn hh-btn-ghost hh-detail-take-action" onClick={() => setReflecting(true)}>Record your take</button>}</div>}
    </Section>

    {hasCoBuyerPerspective && <Section eyebrow="Co-buyer perspective" title="How your co-buyer sees this home"><div className="hh-detail-cobuyer">{coBuyerPerspective.match?.pct != null && <div><strong>{coBuyerPerspective.match.pct}% Match</strong><small>Based on their priorities.</small></div>}{coBuyerPerspective.overallFeeling > 0 && <span><Stars value={coBuyerPerspective.overallFeeling} /> Overall feeling</span>}</div>{coBuyerPerspective.differentTakes?.length > 0 && <div className="hh-detail-differences"><h3>Different takes</h3>{coBuyerPerspective.differentTakes.map((take) => { const category = take.key?.split(':')[0]; return <p key={take.key}><strong>{criterionDisplayLabel(category, take.label)}</strong><span>{take.youLiked ? 'You liked it' : "You didn't like it"} · {take.coBuyerLiked ? 'Co-buyer did' : "Co-buyer didn't"}</span></p>; })}</div>}</Section>}

    {/* Professional context and buyer/search context are two different kinds of
        human input — never merged into one data model or card — but on wide
        desktop they read fine side by side rather than as one long stack. */}
    <div className="hh-detail-context-row">
    <RealtorContributions searchId={searchId} homeId={home.id} contributions={realtorContributions} viewerId={userId} realtorView={readOnly} archived={isArchivedStatus(home.status)} />

    <Section eyebrow="Property notes" title={isCollaborative ? "Shared notes" : "What you want to remember"}>{isCollaborative && <p className="hh-detail-context">Pros, cons, and notes are visible to both of you.</p>}{!notesOpen ? <><div className="hh-detail-notes">{parseCommaList(home.pros).length > 0 && <div><h3>Pros</h3>{parseCommaList(home.pros).map((x) => <p key={x}><span aria-hidden="true">+</span>{x}</p>)}</div>}{parseCommaList(home.cons).length > 0 && <div><h3>Cons</h3>{parseCommaList(home.cons).map((x) => <p key={x}><span aria-hidden="true">−</span>{x}</p>)}</div>}{home.notes && <div className="wide"><h3>Notes</h3><p>{home.notes}</p></div>}</div>{!readOnly && <button className="hh-btn hh-btn-ghost hh-detail-notes-action" onClick={() => setNotesOpen(true)}>{home.pros || home.cons || home.notes ? 'Edit property notes' : 'Add pros, cons, or a note'}</button>}</> : <div className="hh-detail-notes-form"><label>Pros<input className="hh-input" value={thoughts.pros} onChange={(e) => setThoughts({ ...thoughts, pros: e.target.value })} placeholder="Great kitchen, quiet street" /></label><label>Cons<input className="hh-input" value={thoughts.cons} onChange={(e) => setThoughts({ ...thoughts, cons: e.target.value })} placeholder="Busy road" /></label><label className="wide">Anything else you want to remember?<textarea className="hh-textarea" value={thoughts.notes} onChange={(e) => setThoughts({ ...thoughts, notes: e.target.value })} placeholder="HOA details, sewer/water, financing options, recent updates, listing terms, or anything else worth noting." /></label><div className="wide hh-detail-form-actions"><button className="hh-btn hh-btn-ghost" onClick={() => setNotesOpen(false)}>Cancel</button><button className="hh-btn" disabled={saving} onClick={saveThoughts}>{saving ? 'Saving…' : 'Save notes'}</button></div></div>}</Section>
    </div>
    {!readOnly && editing && <HomeModal presentation="detail-panel" initial={home} priorities={priorities} sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative} userId={userId} onSave={saveWhole} onClose={() => setEditing(false)} onWantToTour={() => savePersonal({ status: 'Want to Tour' })} onArchiveRequest={setArchiveTarget} />}
    {!readOnly && archiveTarget && <ArchiveConfirmModal home={archiveTarget} onCancel={() => setArchiveTarget(null)} onConfirm={(reason) => confirmArchive(reason).catch(() => {})} />}
    {!readOnly && reflecting && <PostTourModal home={home} priorities={priorities} isCollaborative={isCollaborative} saveError={saveError} onVerdict={handleVerdict} onClose={() => setReflecting(false)} />}
  </main>;
}
