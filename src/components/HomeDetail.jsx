'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight, ExternalLink, Heart, Footprints, Home as HomeIcon, ListChecks, MapPin, NotebookText, Pencil } from 'lucide-react';
import MobileDisclosure from '@/components/MobileDisclosure';
import { IconBadge } from '@/components/MobileSystem';
import HomeModal from '@/components/HomeModal';
import PostTourModal from '@/components/PostTourModal';
import ArchiveConfirmModal from '@/components/ArchiveConfirmModal';
import RealtorContributions from '@/components/RealtorContributions';
import HomeFacts from '@/components/HomeFacts';
import MatchCriteria from '@/components/MatchCriteria';
import TourFeedback from '@/components/TourFeedback';
import HomeDetailLocation from '@/components/HomeDetailLocation';
import { isArchivedStatus, TOUR_RATING_KEY } from '@/lib/constants';
import { computeMatch, matchFactualSummary } from '@/lib/matching';
import { criterionAnswerPatch, inPersonAnswerPatch } from '@/lib/matchCriteria';
import { searchIntentCapabilities } from '@/lib/searchIntent';
import { evaluateCommute } from '@/lib/commute';
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

export default function HomeDetail({ home: initialHome, priorities, commuteDestinations = [], coBuyerPerspective, sharedFactAwareness = {}, userId, searchId, isCollaborative = false, readOnly = false, backHref = null, realtorContributions = { notes: [], tours: [] }, justAdded = null, initialSection = 'facts', perspectiveName = null, coBuyerName = null }) {
  const router = useRouter();
  const [home, setHome] = useState(initialHome);
  const [editing, setEditing] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
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
  const hasPostTourFeedback = Boolean(home.reaction || (home.ratings?.[TOUR_RATING_KEY] || 0) > 0 || (match?.allSelected || []).some((item) => !item.objective && item.evaluated));
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
  // Match Criteria answers go exactly where the editor always wrote them: the
  // buyer's own checks, or (Pets / Utilities / In-Unit Laundry) the shared field.
  const answerCriterion = (item, next) => {
    const patch = criterionAnswerPatch(home, item.key, next, priorities.searchType);
    return patch.shared ? saveWhole({ ...home, ...patch.shared }) : savePersonal(patch.personal);
  };
  // "Things to check in person" (Tour Feedback): this buyer's own tour response
  // for one selected in-person criterion — ratings[key], the value Match already
  // scores. Personal path only; status, tour date, reaction, survey and notes are
  // carried as they are, so answering never marks the home toured.
  const answerInPerson = (item, next) => savePersonal(inPersonAnswerPatch(home, item.key, next));
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
  // A Realtor reads the buyers' Tour Feedback, not "Your take": name whose it is.
  const eyebrow = readOnly && section === 'tour' ? ([perspectiveName, coBuyerName].filter(Boolean).join(' & ') || 'The buyers') : sectionMeta.eyebrow;

  return <main className="hh-home-detail flh-workspace" ref={setRef}>
    {/* One home workspace: the property stays in view while the buyer moves
        between what the home IS (Home Facts), how it fits their search (Match
        Criteria), and how it felt (Tour Feedback). Each area keeps its own
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
          <p className="flh-eyebrow">{eyebrow}</p>
          <h1 className="hh-serif" tabIndex={-1} ref={titleRef}>{sectionMeta.label}</h1>
          <p>{readOnly ? sectionMeta.readOnlyIntro : sectionMeta.intro}</p>
        </div>
        {/* Home Facts carries the listing link and its own Edit controls. */}
        {section !== 'facts' && (home.listingUrl || (!readOnly && usesFullEditor)) && <div className="hh-detail-links">{home.listingUrl && <a href={home.listingUrl} target="_blank" rel="noreferrer">Original listing <ExternalLink size={15} /></a>}{!readOnly && usesFullEditor && <button type="button" onClick={() => setEditing(true)}><Pencil size={15} /> Edit {vocabulary.singularLower} information</button>}</div>}
      </header>

      {section === 'facts' && <>
        {/* Home Facts: what the property is. Shared facts save through the same
            shared-home path as Edit Home (saveWhole). */}
        <HomeFacts home={home} priorities={priorities} vocabulary={vocabulary} readOnly userId={userId} showHeading={false} />
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
      <MatchCriteria home={home} priorities={priorities} match={match} readOnly={readOnly} onAnswer={answerCriterion} onOpenFact={(id) => { goTo('facts'); setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'center' }), 50); }} />
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

    {/* Their Match, from their own priorities and answers. Their take (overall
        feeling, where you see it differently) lives in Tour Feedback. */}
    {coBuyerPerspective?.match?.pct != null && <Section eyebrow="Co-buyer perspective" title={coBuyerName ? `${coBuyerName}’s Match` : 'How your co-buyer sees this home'}><div className="hh-detail-cobuyer"><div><strong>{coBuyerPerspective.match.pct}% Match</strong><small>Based on their priorities and their own answers.</small></div></div></Section>}
      </>}

      {section === 'tour' && <>
        {/* Tour Feedback: the buyer's own reaction and in-person take (recorded
            only through PostTourModal), the shared pros / cons / notes, and the
            Realtor's professional context. Nothing here answers a Match criterion. */}
        <TourFeedback
          home={home} match={match} vocabulary={vocabulary} readOnly={readOnly} isCollaborative={isCollaborative}
          perspectiveName={perspectiveName} coBuyerPerspective={coBuyerPerspective} coBuyerName={coBuyerName}
          saveError={saveError} onRetry={retryPersonal.current ? () => savePersonal(retryPersonal.current).catch(() => {}) : null}
          onRecordTake={() => setReflecting(true)}
          onToggleWantToTour={() => savePersonal({ status: home.status === 'Want to Tour' ? 'Saved' : 'Want to Tour' }).catch(() => {})}
          onToggleFavorite={() => savePersonal(toggleFavorite(home)).catch(() => {})}
          onArchive={() => setArchiveTarget(home)}
          onRestore={() => savePersonal(restoreHome(home)).catch(() => {})}
          onSaveNotes={(draft) => saveWhole({ ...home, ...draft })}
          onAnswerInPerson={answerInPerson}
        >
          <RealtorContributions searchId={searchId} homeId={home.id} contributions={realtorContributions} viewerId={userId} realtorView={readOnly} archived={isArchivedStatus(home.status)} />
        </TourFeedback>
      </>}
    </div>

    {/* Phone: on Match Criteria the primary personal actions sit in a sticky bar
        above the bottom navigation. Tour Feedback carries the same actions inline
        (plans row and take button), so the bar would only repeat them there. */}
    {!readOnly && !isArchivedStatus(home.status) && section === 'match' && <div className="flh-mobile-only flh-detail-action-bar">
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
