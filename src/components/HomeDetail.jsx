'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Heart, Footprints, Home as HomeIcon, ListChecks, MapPin, NotebookText, Pencil } from 'lucide-react';
import MobileDisclosure from '@/components/MobileDisclosure';
import { IconBadge } from '@/components/MobileSystem';
import HomeModal from '@/components/HomeModal';
import PostTourModal from '@/components/PostTourModal';
import ArchiveConfirmModal from '@/components/ArchiveConfirmModal';
import RealtorContributions from '@/components/RealtorContributions';
import HomeFacts from '@/components/HomeFacts';
import CheckTheMatch from '@/components/CheckTheMatch';
import TourFeedback from '@/components/TourFeedback';
import HomeDetailLocation from '@/components/HomeDetailLocation';
import { isArchivedStatus, TOUR_RATING_KEY } from '@/lib/constants';
import { computeMatch, parseNum } from '@/lib/matching';
import { evaluateCommute } from '@/lib/commute';
import { formatHomePrice, formatLotSizeDisplay } from '@/lib/homeDisplay';
import { homeIdentity, homeVocabulary } from '@/lib/homePresentation';
import { useCommuteObserver } from '@/lib/useCommuteObserver';
import { answerPatch } from '@/lib/matchReview';
import { createClient } from '@/lib/supabase/client';
import { hasSharedHomeChanges, saveHomePersonalAndShared, saveHomePersonalState } from '@/lib/supabase/collaboration';
import { applyPostTourVerdict, archiveHome, hasToured, restoreHome, toggleFavorite } from '@/lib/lifecycle';

// The three areas of the home workspace. Keys are also the ?section= values
// (Home Facts is the default and carries no parameter).
export const WORKSPACE_SECTIONS = Object.freeze([
  { key: 'facts', label: 'Home Facts', icon: HomeIcon, eyebrow: 'The property', intro: 'What FLH knows about this home. Imported details are a starting point — correct or add anything, anytime.', readOnlyIntro: 'What’s known about this home, from the listing and the buyers.' },
  { key: 'match', label: 'Check the Match', icon: ListChecks, eyebrow: 'Your search', intro: 'How this home lines up with the priorities in your search. Unknown never counts against it.', readOnlyIntro: 'How this home lines up with the buyer’s priorities. Unknown never counts against it.' },
  { key: 'tour', label: 'Tour Feedback', icon: NotebookText, eyebrow: 'Your take', intro: 'How it felt in person, plus the notes you want to remember.', readOnlyIntro: 'The buyer’s take and notes, plus your professional context.' },
]);
// The two existing save paths. Injectable only so the development preview can
// run without Supabase; production always uses these defaults.
const DEFAULT_PERSISTENCE = Object.freeze({
  personal: (next, userId, searchId) => saveHomePersonalState(createClient(), next, userId, searchId),
  whole: (next, userId, searchId) => saveHomePersonalAndShared(createClient(), next, userId, searchId),
});
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

export default function HomeDetail({ home: initialHome, priorities, commuteDestinations = [], coBuyerPerspective, sharedFactAwareness = {}, userId, searchId, isCollaborative = false, readOnly = false, backHref = null, realtorContributions = { notes: [], tours: [] }, justAdded = null, initialSection = 'facts', perspectiveName = null, coBuyerName = null, persistence = DEFAULT_PERSISTENCE }) {
  const router = useRouter();
  const [home, setHome] = useState(initialHome);
  const [editing, setEditing] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [saveError, setSaveError] = useState('');
  const personalQueue = useRef(Promise.resolve());
  const matchSection = useRef(null);
  const [section, setSection] = useState(SECTION_KEYS.has(initialSection) ? initialSection : 'facts');
  const mainRef = useRef(null);
  const titleRef = useRef(null);
  const confirmedHome = useRef(initialHome);
  const personalVersion = useRef(0);
  const retryPersonal = useRef(null);
  const { setRef, getState } = useCommuteObserver(home, commuteDestinations);
  const commuteEvaluation = evaluateCommute(commuteDestinations, getState);
  const match = computeMatch(home, priorities, commuteEvaluation);
  const hasPostTourFeedback = Boolean(home.reaction || (home.ratings?.[TOUR_RATING_KEY] || 0) > 0 || (match?.allSelected || []).some((item) => !item.objective && item.evaluated));
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
        const saved = await persistence.personal(next, userId, searchId);
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
      const saved = await persistence.whole(next, userId, searchId);
      confirmedHome.current = saved;
      setHome(saved); setEditing(false); router.refresh();
      return saved;
    } catch (error) {
      setSaveError("Couldn't save that change. Try again.");
      throw error;
    }
  };
  // One answer from Check the Match, written through the path that owns it.
  const answerPriority = async (criterion, value) => {
    const patch = answerPatch(home, criterion, value, priorities.searchType);
    if (!patch) return null;
    return patch.shared ? saveWhole({ ...home, ...patch.shared }) : savePersonal(patch.personal);
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
    if (justAdded && typeof window !== 'undefined') window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [justAdded]);
  // Switching areas never reloads data or adds history entries: the URL keeps
  // ?section= (so refresh and shared links return here) via replaceState.
  const goTo = (next) => {
    if (!SECTION_KEYS.has(next)) return;
    setSection(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('added');
      if (next === 'facts') url.searchParams.delete('section'); else url.searchParams.set('section', next);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
    }
    requestAnimationFrame(() => {
      if (mainRef.current && mainRef.current.getBoundingClientRect().top < 0) mainRef.current.scrollIntoView({ block: 'start' });
      titleRef.current?.focus({ preventScroll: true });
    });
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
        <div className="hh-detail-links">{home.listingUrl && <a href={home.listingUrl} target="_blank" rel="noreferrer">Original listing <ExternalLink size={15} /></a>}{!readOnly && <button type="button" onClick={() => setEditing(true)}><Pencil size={15} /> Edit {vocabulary.singularLower} information</button>}</div>
      </header>

      {section === 'facts' && <>
        {/* Home Facts: what the property is. Shared facts save through the same
            shared-home path as Edit Home (saveWhole). */}
        <HomeFacts home={home} priorities={priorities} vocabulary={vocabulary} readOnly={readOnly} justAdded={justAdded} onSaveFacts={(patch) => saveWhole({ ...home, ...patch })} onEditAll={() => setEditing(true)} onSeeMatch={match ? () => goTo('match') : null}
          summary={<div className="flh-property-card">
            <div className="flh-property-photo">{home.photoUrl ? <img src={home.photoUrl} alt={`${identity.accessible} ${vocabulary.singularLower} photo`} /> : <HomeIcon size={40} />}</div>
            <div className="flh-property-identity">
              <div className="hh-detail-status-chips"><span>{home.status}</span>{home.isFavorite && <span className="favorite"><Heart size={12} fill="currentColor" aria-hidden="true" /> Favorite</span>}</div>
              <div className="hh-detail-price-row"><div className="hh-detail-price">{formatHomePrice(home.price, priorities.searchType) || 'Price not added'}</div>{home.estMonthly && <span>${Number(home.estMonthly).toLocaleString()}/mo est.</span>}</div>
              <h2 className="hh-serif flh-property-address">{identity.primary}</h2>{identity.option && <p className="hh-detail-option">{identity.option}</p>}{identity.supporting && <p className="hh-detail-locality">{identity.supporting}</p>}
              <div className="hh-detail-core-facts">{[home.beds && `${home.beds} beds`, home.baths && `${home.baths} baths`, home.sqft && `${parseNum(home.sqft)?.toLocaleString()} sq ft`, home.lotSize && formatLotSizeDisplay(home.lotSize)].filter(Boolean).map((fact) => <span key={fact}>{fact}</span>)}</div>
              {home.suggestedBy && <span className="hh-provenance">Suggested by {home.suggestedBy}</span>}
            </div>
          </div>}
        />
      </>}

      {section === 'match' && <>
        {/* Check the Match: every answer goes through the existing save paths —
            a personal answer only ever touches this buyer's own row; a shared
            property fact the shared home. Scoring is computeMatch, unchanged. */}
        <CheckTheMatch
          home={home} match={match} priorities={priorities} vocabulary={vocabulary} readOnly={readOnly}
          perspectiveName={perspectiveName} coBuyerPerspective={coBuyerPerspective} coBuyerName={coBuyerName}
          toured={hasToured(home)} saveError={saveError} onAnswer={answerPriority} onGoToFacts={() => goTo('facts')} matchRef={matchSection}
        >
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
        </CheckTheMatch>
      </>}

      {section === 'tour' && <>
        {/* Tour Feedback: the buyer's own reaction and in-person take (recorded
            only through PostTourModal), the shared pros / cons / notes, and the
            Realtor's professional context. Pros and cons are edited here. */}
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
        >
          <RealtorContributions searchId={searchId} homeId={home.id} contributions={realtorContributions} viewerId={userId} realtorView={readOnly} archived={isArchivedStatus(home.status)} />
        </TourFeedback>
      </>}
    </div>

    {/* Phone: the primary personal actions sit in a sticky bar above the bottom
        navigation. Same handlers, same meaning as the inline buttons above. */}
    {!readOnly && !isArchivedStatus(home.status) && section === 'match' && <div className="flh-mobile-only flh-detail-action-bar">
      <button type="button" className="flh-icon-button" aria-pressed={home.isFavorite} aria-label={home.isFavorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => savePersonal(toggleFavorite(home)).catch(() => {})}><Heart size={18} aria-hidden="true" fill={home.isFavorite ? 'var(--brick)' : 'none'} color={home.isFavorite ? 'var(--brick)' : 'currentColor'} /></button>
      {hasToured(home)
        ? <button type="button" className="flh-button flh-button-primary flh-button-block" onClick={() => setReflecting(true)}>{hasPostTourFeedback ? 'Edit your take' : 'Record your take'}</button>
        : <button type="button" className={`flh-button flh-button-block ${home.status === 'Want to Tour' ? 'flh-button-outline' : 'flh-button-primary'}`} aria-pressed={home.status === 'Want to Tour'} onClick={() => savePersonal({ status: home.status === 'Want to Tour' ? 'Saved' : 'Want to Tour' }).catch(() => {})}><Footprints size={16} aria-hidden="true" /> {home.status === 'Want to Tour' ? 'On your Want to Tour list' : 'Want to tour'}</button>}
    </div>}
    {!readOnly && editing && <HomeModal presentation="detail-panel" evaluationElsewhere initial={home} priorities={priorities} sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative} userId={userId} onSave={saveWhole} onClose={() => setEditing(false)} onWantToTour={() => savePersonal({ status: 'Want to Tour' })} onArchiveRequest={setArchiveTarget} />}
    {!readOnly && archiveTarget && <ArchiveConfirmModal home={archiveTarget} onCancel={() => setArchiveTarget(null)} onConfirm={(reason) => confirmArchive(reason).catch(() => {})} />}
    {!readOnly && reflecting && <PostTourModal home={home} priorities={priorities} isCollaborative={isCollaborative} saveError={saveError} onVerdict={handleVerdict} onClose={() => setReflecting(false)} />}
  </main>;
}
