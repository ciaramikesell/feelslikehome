'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ChevronRight, ExternalLink, Heart, Footprints, Home as HomeIcon, ListChecks, MapPin, NotebookText, Pencil, RotateCcw, Star } from 'lucide-react';
import MobileDisclosure from '@/components/MobileDisclosure';
import { IconBadge } from '@/components/MobileSystem';
import HomeModal from '@/components/HomeModal';
import PostTourModal from '@/components/PostTourModal';
import ArchiveConfirmModal from '@/components/ArchiveConfirmModal';
import RealtorContributions from '@/components/RealtorContributions';
import HomeFacts from '@/components/HomeFacts';
import MatchCriteria from '@/components/MatchCriteria';
import HomeDetailLocation from '@/components/HomeDetailLocation';
import { criterionDisplayLabel, isArchivedStatus, TOUR_RATING_KEY } from '@/lib/constants';
import { computeMatch, matchFactualSummary, SHARED_BOOLEAN_FACT_FIELDS, sharedFactValue } from '@/lib/matching';
import { searchIntentCapabilities } from '@/lib/searchIntent';
import { evaluateCommute } from '@/lib/commute';
import { parseCommaList } from '@/lib/homeDisplay';
import { homeIdentity, homeVocabulary } from '@/lib/homePresentation';
import { useCommuteObserver } from '@/lib/useCommuteObserver';
import { createClient } from '@/lib/supabase/client';
import { hasSharedHomeChanges, saveHomePersonalAndShared, saveHomePersonalState } from '@/lib/supabase/collaboration';
import { applyPostTourVerdict, archiveHome, hasToured, restoreHome, toggleFavorite } from '@/lib/lifecycle';

// The three areas of the home workspace. Keys are also the ?section= values
// (Home Facts is the default and carries no parameter).
export const WORKSPACE_SECTIONS = Object.freeze([
  { key: 'facts', label: 'Home Facts', icon: HomeIcon, eyebrow: 'The property', intro: 'What FLH knows about this home. Imported details are a starting point — correct or add anything, anytime.', readOnlyIntro: 'What’s known about this home, from the listing and the buyers.' },
  { key: 'match', label: 'Match Criteria', icon: ListChecks, eyebrow: 'Your search', intro: 'Does it have what matters to you? Answer what you know — Unknown never counts against it.', readOnlyIntro: 'How this home lines up with the buyer’s priorities. Unknown never counts against it.' },
  { key: 'tour', label: 'Tour Feedback', icon: NotebookText, eyebrow: 'Your take', intro: 'How it felt in person, plus the notes you want to remember.', readOnlyIntro: 'The buyer’s take and notes, plus your professional context.' },
]);
const SECTION_KEYS = new Set(WORKSPACE_SECTIONS.map((item) => item.key));


function Stars({ value }) {
  return <span className="hh-detail-stars" aria-label={`${value} out of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={17} fill={n <= value ? '#C69245' : 'none'} color={n <= value ? '#C69245' : '#DED2C1'} />)}</span>;
}

function Section({ eyebrow, title, children, className = '' }) {
  return <section className={`hh-detail-section ${className}`}><div className="hh-detail-eyebrow">{eyebrow}</div>{title && <h2 className="hh-serif">{title}</h2>}{children}</section>;
}

// A compact phone row (Home Detail's "More details" / "Places that matter" /
// "Every criterion"). On desktop the same content is simply always open.
function DetailRow({ icon, title, subtitle, tone = 'default', children }) {
  return (
    <MobileDisclosure breakpoint={700} label={title} variant={`detail-row is-${tone}`} className="flh-detail-row-body" summary={
      <span className="flh-card-row"><IconBadge icon={icon} tone={tone === 'sage' ? 'sage' : 'terracotta'} /><span className="flh-card-heading"><span className="flh-card-title flh-card-title-small">{title}</span>{subtitle && <span className="flh-card-sub">{subtitle}</span>}</span></span>
    }>{children}</MobileDisclosure>
  );
}

export default function HomeDetail({ home: initialHome, priorities, commuteDestinations = [], coBuyerPerspective, sharedFactAwareness = {}, userId, searchId, isCollaborative = false, readOnly = false, backHref = null, realtorContributions = { notes: [], tours: [] }, justAdded = null, initialSection = 'facts' }) {
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
  const [section, setSection] = useState(SECTION_KEYS.has(initialSection) ? initialSection : 'facts');
  // Captured once: a later router.refresh() re-renders this page without the
  // ?added= marker, and the welcome must not vanish mid-read.
  const [welcomeKind] = useState(justAdded);
  const mainRef = useRef(null);
  const titleRef = useRef(null);
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
  const identity = homeIdentity(home, priorities);
  const vocabulary = homeVocabulary(priorities);
  // Apartments (property name, unit, floor plan) and rentals (availability)
  // keep the full editor for the details Home Facts doesn't cover.
  const usesFullEditor = vocabulary.apartment || searchIntentCapabilities(priorities.searchType).showsRentalFacts;

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
  // Match Criteria answers go exactly where the editor always wrote them: the
  // buyer's own checks, or (Pets / Utilities / In-Unit Laundry) the shared field.
  const answerCriterion = (item, next) => {
    const sharedField = SHARED_BOOLEAN_FACT_FIELDS[item.key];
    if (sharedField) return saveWhole({ ...home, [sharedField]: sharedFactValue(next) });
    const checks = { ...(home.checks || {}) };
    if (next === undefined) delete checks[item.key];
    else checks[item.key] = next;
    return savePersonal({ checks });
  };
  const handleVerdict = async (current, verdict, patch) => {
    const next = applyPostTourVerdict(current, verdict, patch);
    return hasSharedHomeChanges(next, home) ? saveWhole(next) : savePersonal(next);
  };
  const confirmArchive = async (reason) => {
    const next = archiveHome(archiveTarget, reason);
    setArchiveTarget(null);
    await (hasSharedHomeChanges(next, home) ? saveWhole(next) : savePersonal(next));
  };
  // The ?added= marker only exists to show the welcome once; drop it from the
  // address bar so a refresh or a shared link doesn't repeat it.
  useEffect(() => {
    if (justAdded && typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname);
  }, [justAdded]);
  // Switching areas never reloads data or adds history entries: the URL keeps
  // ?section= (so refresh and shared links return here) via replaceState.
  // The state argument must be null: Next.js only syncs its router with a
  // replaceState whose state isn't already its own (__NA). Passing
  // window.history.state left the router on the old URL, so the next
  // router.refresh() (after any save) silently dropped ?section=.
  const goTo = (next) => {
    if (!SECTION_KEYS.has(next)) return;
    setSection(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('added');
      if (next === 'facts') url.searchParams.delete('section'); else url.searchParams.set('section', next);
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }
    requestAnimationFrame(() => {
      if (mainRef.current && mainRef.current.getBoundingClientRect().top < 0) mainRef.current.scrollIntoView({ block: 'start' });
      titleRef.current?.focus({ preventScroll: true });
    });
  };
  const scrollToMatch = () => { matchSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); matchSection.current?.focus({ preventScroll: true }); };
  const nextFromFacts = () => {
    goTo('match');
    requestAnimationFrame(() => window.scrollTo?.({ top: 0, behavior: 'smooth' }));
  };
  const back = () => backHref ? router.push(backHref) : window.history.length > 1 ? router.back() : router.push('/homes');

  const sectionMeta = WORKSPACE_SECTIONS.find((item) => item.key === section) || WORKSPACE_SECTIONS[0];

  return <main className="hh-home-detail flh-workspace" ref={setRef}>
    {/* One home workspace: the property stays in view while the buyer moves
        between what the home IS (Home Facts), how it fits their search (Check
        the Match), and how it felt (Tour Feedback). Each area keeps its own
        existing sections and save paths; only the navigation is shared. */}
    <aside className="flh-workspace-nav">
      <button type="button" className="flh-workspace-back" onClick={back}><ArrowLeft size={16} aria-hidden="true" /> {backHref ? 'Back' : 'Back to My Homes'}</button>
      <div className="flh-workspace-identity">
        <div className="flh-workspace-photo">{home.photoUrl ? <img src={home.photoUrl} alt="" /> : <HomeIcon size={22} aria-hidden="true" />}</div>
        <div><strong className="hh-serif">{identity.primary}</strong>{identity.supporting && <span>{identity.supporting}</span>}</div>
      </div>
      <nav aria-label={`${vocabulary.singular} sections`}>
        <ul>{WORKSPACE_SECTIONS.map((item) => {
          const Icon = item.icon;
          const meta = item.key === 'match' && match?.pct != null ? `${match.pct}%` : item.key === 'tour' && hasToured(home) ? 'Toured' : null;
          return <li key={item.key}><button type="button" className={section === item.key ? 'is-active' : ''} aria-current={section === item.key ? 'page' : undefined} onClick={() => goTo(item.key)}><Icon size={17} aria-hidden="true" /><span>{item.label}</span>{meta && <small>{meta}</small>}</button></li>;
        })}</ul>
      </nav>
    </aside>

    <div className="flh-workspace-main" ref={mainRef}>
      <header className="flh-workspace-head">
        <div>
          <p className="flh-eyebrow">{sectionMeta.eyebrow}</p>
          <h1 className="hh-serif" tabIndex={-1} ref={titleRef}>{sectionMeta.label}</h1>
          <p>{readOnly ? sectionMeta.readOnlyIntro : sectionMeta.intro}</p>
        </div>
        {/* Home Facts carries the listing link and its own Edit controls. */}
        {section !== 'facts' && (home.listingUrl || (!readOnly && usesFullEditor)) && <div className="hh-detail-links">{home.listingUrl && <a href={home.listingUrl} target="_blank" rel="noreferrer">Original listing <ExternalLink size={15} /></a>}{!readOnly && usesFullEditor && <button type="button" onClick={() => setEditing(true)}><Pencil size={15} /> Edit {vocabulary.singularLower} information</button>}</div>}
      </header>

      {section === 'facts' && <>
        {/* Home Facts: what the property is. Shared facts save through the same
            shared-home path as Edit Home (saveWhole). */}
        <HomeFacts home={home} priorities={priorities} vocabulary={vocabulary} readOnly={readOnly} justAdded={welcomeKind} userId={userId}
          onSaveFacts={(patch) => saveWhole({ ...home, ...patch })} onNext={() => nextFromFacts()}
          onEditAll={usesFullEditor ? () => setEditing(true) : null} />
      </>}

      {section === 'match' && <>
        {match ? <div className="flh-match-summary">
          {match?.pct != null && <button type="button" className="hh-detail-match-card" onClick={scrollToMatch} aria-label={`View why this home is a ${match.pct}% Match`}><span className="hh-detail-match-ring">{match.pct}%</span><span><strong>Your Match</strong><small>{factualSummary?.mustClause || 'Based on your known priorities'}{factualSummary?.importantSentence ? ` · ${factualSummary.importantSentence}` : ''}</small></span><ChevronRight size={20} aria-hidden="true" /></button>}
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
        </div> : <p className="hh-detail-context">No priorities are set for this search yet, so there’s nothing to match against.</p>}
    {/* Must-Haves / Important / Nice to Have, answered Yes / No / Unknown.
        Same allSelected rows the Match % is scored from (no second path). */}
    {match && <div ref={matchSection} tabIndex={-1} className="hh-detail-match-anchor">
      <MatchCriteria home={home} priorities={priorities} match={match} readOnly={readOnly} onAnswer={answerCriterion} onEditFacts={() => goTo('facts')} />
    </div>}

    {commuteDestinations.length > 0 && (() => {
      return (
        <Section eyebrow="Places that matter" title="Location & Commute" className="hh-detail-section-wide hh-detail-surface flh-detail-row-section">
          {/* Every saved place, in stored order (HomeDetailLocation lists them all).
              Drive times are decision context; they only affect Match if the
              participant has made Commute itself a priority. */}
          <DetailRow icon={MapPin} tone="sage" title="Places that matter" subtitle={`${commuteDestinations.map((destination) => destination.label).join(' · ')} · ${commuteDestinations.length} ${commuteDestinations.length === 1 ? 'place' : 'places'}`}>
            <HomeDetailLocation home={home} destinations={commuteDestinations} getState={getState} />
          </DetailRow>
        </Section>
      );
    })()}

    {hasCoBuyerPerspective && <Section eyebrow="Co-buyer perspective" title="How your co-buyer sees this home"><div className="hh-detail-cobuyer">{coBuyerPerspective.match?.pct != null && <div><strong>{coBuyerPerspective.match.pct}% Match</strong><small>Based on their priorities.</small></div>}{coBuyerPerspective.overallFeeling > 0 && <span><Stars value={coBuyerPerspective.overallFeeling} /> Overall feeling</span>}</div>{coBuyerPerspective.differentTakes?.length > 0 && <div className="hh-detail-differences"><h3>Different takes</h3>{coBuyerPerspective.differentTakes.map((take) => { const category = take.key?.split(':')[0]; return <p key={take.key}><strong>{criterionDisplayLabel(category, take.label)}</strong><span>{take.youLiked ? 'You liked it' : "You didn't like it"} · {take.coBuyerLiked ? 'Co-buyer did' : "Co-buyer didn't"}</span></p>; })}</div>}</Section>}
      </>}

      {section === 'tour' && <>
        {/* Tour Feedback keeps today's sections unchanged. Pros, cons and notes
            live here (not in Home Facts or Match); their redesign is a later pass. */}
    <Section eyebrow={readOnly ? 'Buyer perspective' : 'Your take'} title={readOnly ? 'Their relationship with this home' : 'Your relationship with this home'} className="hh-detail-relationship hh-detail-section-wide hh-detail-surface">
      {isCollaborative && <p className="hh-detail-context">{readOnly ? 'Each buyer’s perspective stays separate.' : 'These choices are yours. Your co-buyer can see them and keeps their own.'}</p>}
      {!readOnly && <div className="hh-detail-actions flh-detail-inline-actions">
        {hasToured(home) ? <span className="hh-detail-toured-state"><Check size={15} aria-hidden="true" /> Toured</span> : <button className="hh-btn" aria-pressed={home.status === 'Want to Tour'} onClick={() => savePersonal({ status: home.status === 'Want to Tour' ? 'Saved' : 'Want to Tour' }).catch(() => {})}><Footprints size={15} aria-hidden="true" />{home.status === 'Want to Tour' ? 'On your Want to Tour list' : 'Want to tour'}</button>}
        <button className="hh-btn hh-btn-ghost" aria-pressed={home.isFavorite} onClick={() => savePersonal(toggleFavorite(home)).catch(() => {})}><Heart size={15} aria-hidden="true" fill={home.isFavorite ? 'currentColor' : 'none'} />{home.isFavorite ? 'Favorited' : 'Favorite'}</button>
        <button className="hh-detail-archive-action" onClick={() => isArchivedStatus(home.status) ? savePersonal(restoreHome(home)).catch(() => {}) : setArchiveTarget(home)}>{isArchivedStatus(home.status) ? <><RotateCcw size={14} aria-hidden="true" /> Restore</> : 'Archive'}</button>
      </div>}
      {home.coBuyerWantsToTour && <p className="hh-detail-context">Your co-buyer still wants to tour this home.</p>}
      {saveError && <p className="hh-save-error" role="alert">{saveError}{retryPersonal.current && <> <button type="button" onClick={() => savePersonal(retryPersonal.current).catch(() => {})}>Retry</button></>}</p>}
      {hasToured(home) ? <div className="hh-detail-evaluation">{overall > 0 && <div className="hh-detail-overall"><h3>Overall feeling</h3><Stars value={overall} /></div>}{experiential.length > 0 && <div className="hh-detail-reactions">{likedExperiences.length > 0 && <div><h3 className="liked">Liked</h3>{likedExperiences.map((item) => <p key={item.key}>{criterionDisplayLabel(item.key.split(':')[0], item.label)}</p>)}</div>}{dislikedExperiences.length > 0 && <div><h3 className="disliked">Didn't like</h3>{dislikedExperiences.map((item) => <p key={item.key}>{criterionDisplayLabel(item.key.split(':')[0], item.label)}</p>)}</div>}</div>}<div className="hh-detail-after-tour"><strong>After your tour</strong><p>{hasPostTourFeedback ? 'Keep your take current as this home stays in consideration.' : 'Come back to record how the home actually felt.'}</p>{!readOnly && <button className="hh-btn hh-btn-ghost hh-detail-take-action" onClick={() => setReflecting(true)}>{hasPostTourFeedback ? 'Edit your take' : 'Record your take'}</button>}</div></div> : <div className="hh-detail-after-tour"><strong>After your tour</strong><p>Come back after seeing this home to record how it actually felt.</p>{!readOnly && <button className="hh-btn hh-btn-ghost hh-detail-take-action" onClick={() => setReflecting(true)}>Record your take</button>}</div>}
    </Section>

    {/* Professional context and buyer/search context are two different kinds of
        human input — never merged into one data model or card — but on wide
        desktop they read fine side by side rather than as one long stack. */}
    <div className="hh-detail-context-row">
    <RealtorContributions searchId={searchId} homeId={home.id} contributions={realtorContributions} viewerId={userId} realtorView={readOnly} archived={isArchivedStatus(home.status)} />

    <Section eyebrow="Property notes" title={isCollaborative ? "Shared notes" : "What you want to remember"}>{isCollaborative && <p className="hh-detail-context">Pros, cons, and notes are visible to both of you.</p>}{!notesOpen ? <><div className="hh-detail-notes">{parseCommaList(home.pros).length > 0 && <div><h3>Pros</h3>{parseCommaList(home.pros).map((x) => <p key={x}><span aria-hidden="true">+</span>{x}</p>)}</div>}{parseCommaList(home.cons).length > 0 && <div><h3>Cons</h3>{parseCommaList(home.cons).map((x) => <p key={x}><span aria-hidden="true">−</span>{x}</p>)}</div>}{home.notes && <div className="wide"><h3>Notes</h3><p>{home.notes}</p></div>}</div>{!readOnly && <button className="hh-btn hh-btn-ghost hh-detail-notes-action" onClick={() => setNotesOpen(true)}>{home.pros || home.cons || home.notes ? 'Edit property notes' : 'Add pros, cons, or a note'}</button>}</> : <div className="hh-detail-notes-form"><label>Pros<input className="hh-input" value={thoughts.pros} onChange={(e) => setThoughts({ ...thoughts, pros: e.target.value })} placeholder="Great kitchen, quiet street" /></label><label>Cons<input className="hh-input" value={thoughts.cons} onChange={(e) => setThoughts({ ...thoughts, cons: e.target.value })} placeholder="Busy road" /></label><label className="wide">Anything else you want to remember?<textarea className="hh-textarea" value={thoughts.notes} onChange={(e) => setThoughts({ ...thoughts, notes: e.target.value })} placeholder="HOA details, sewer/water, financing options, recent updates, listing terms, or anything else worth noting." /></label><div className="wide hh-detail-form-actions"><button className="hh-btn hh-btn-ghost" onClick={() => setNotesOpen(false)}>Cancel</button><button className="hh-btn" disabled={saving} onClick={saveThoughts}>{saving ? 'Saving…' : 'Save notes'}</button></div></div>}</Section>
    </div>
      </>}
    </div>

    {/* Phone: the primary personal actions sit in a sticky bar above the bottom
        navigation. Same handlers, same meaning as the inline buttons above. */}
    {!readOnly && !isArchivedStatus(home.status) && section !== 'facts' && <div className="flh-mobile-only flh-detail-action-bar">
      <button type="button" className="flh-icon-button" aria-pressed={home.isFavorite} aria-label={home.isFavorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => savePersonal(toggleFavorite(home)).catch(() => {})}><Heart size={18} aria-hidden="true" fill={home.isFavorite ? 'var(--brick)' : 'none'} color={home.isFavorite ? 'var(--brick)' : 'currentColor'} /></button>
      {hasToured(home)
        ? <button type="button" className="flh-button flh-button-primary flh-button-block" onClick={() => setReflecting(true)}>{hasPostTourFeedback ? 'Edit your take' : 'Record your take'}</button>
        : <button type="button" className={`flh-button flh-button-block ${home.status === 'Want to Tour' ? 'flh-button-outline' : 'flh-button-primary'}`} aria-pressed={home.status === 'Want to Tour'} onClick={() => savePersonal({ status: home.status === 'Want to Tour' ? 'Saved' : 'Want to Tour' }).catch(() => {})}><Footprints size={16} aria-hidden="true" /> {home.status === 'Want to Tour' ? 'On your Want to Tour list' : 'Want to tour'}</button>}
    </div>}
    {!readOnly && editing && <HomeModal presentation="detail-panel" initial={home} priorities={priorities} sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative} userId={userId} onSave={saveWhole} onClose={() => setEditing(false)} onWantToTour={() => savePersonal({ status: 'Want to Tour' })} onArchiveRequest={setArchiveTarget} />}
    {!readOnly && archiveTarget && <ArchiveConfirmModal home={archiveTarget} onCancel={() => setArchiveTarget(null)} onConfirm={(reason) => confirmArchive(reason).catch(() => {})} />}
    {!readOnly && reflecting && <PostTourModal home={home} priorities={priorities} isCollaborative={isCollaborative} saveError={saveError} onVerdict={handleVerdict} onClose={() => setReflecting(false)} />}
  </main>;
}
