'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Check, Loader2, NotebookText, X } from 'lucide-react';
import HomeFacts from '@/components/HomeFacts';
import MatchCriteria from '@/components/MatchCriteria';
import TourFeedback from '@/components/TourFeedback';
import RealtorContributions from '@/components/RealtorContributions';
import PostTourModal from '@/components/PostTourModal';
import ArchiveConfirmModal from '@/components/ArchiveConfirmModal';
import HomeModal from '@/components/HomeModal';
import { useHomesWorkspace } from '@/components/HomesWorkspace';
import { isArchivedStatus } from '@/lib/constants';
import { computeMatch, matchFactualSummary } from '@/lib/matching';
import { criterionAnswerPatch, inPersonAnswerPatch } from '@/lib/matchCriteria';
import { searchIntentCapabilities } from '@/lib/searchIntent';
import { evaluateCommute } from '@/lib/commute';
import { homeIdentity, homeVocabulary } from '@/lib/homePresentation';
import { useCommuteObserver } from '@/lib/useCommuteObserver';
import { useHomeAutosave } from '@/lib/useHomeAutosave';
import { applyPostTourVerdict, archiveHome, restoreHome, toggleFavorite } from '@/lib/lifecycle';
import { createClient } from '@/lib/supabase/client';
import { saveHomePersonalAndShared, saveHomePersonalState, saveHomeSharedFields, sharedFieldChanges } from '@/lib/supabase/collaboration';
import { refreshMyHomes } from '@/app/(app)/homes/actions';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const PERSONAL_FIELDS = ['status', 'touredAt', 'isFavorite', 'reaction', 'rejectionReason', 'ratings', 'checks'];

function SaveState({ status, onRetry }) {
  if (status === 'saving') return <span className="flh-overlay-save is-saving" role="status"><Loader2 size={14} aria-hidden="true" /> Saving…</span>;
  if (status === 'error') return <span className="flh-overlay-save is-error" role="alert"><AlertCircle size={14} aria-hidden="true" /> Couldn’t save <button type="button" onClick={onRetry}>Retry</button></span>;
  if (status === 'saved') return <span className="flh-overlay-save is-saved" role="status"><Check size={14} aria-hidden="true" /> Saved</span>;
  return <span className="flh-overlay-save is-saved" role="status"><Check size={14} aria-hidden="true" /> Saved</span>;
}

// The home overlay: one continuous, autosaving workspace over My Homes —
// property, Home Facts, then Your Match — in a single scroll. Tour Feedback
// (reactions, notes, the post-tour survey) keeps its own view of the same
// overlay (?section=tour) so the research flow never turns into a survey.
export default function HomeOverlay({ serverHome, coBuyerPerspective = null, realtorContributions = { notes: [], tours: [] }, section = 'facts', returnTo = '/homes' }) {
  const router = useRouter();
  const workspace = useHomesWorkspace();
  const { priorities, commuteDestinations, sharedFactAwareness, isCollaborative, userId, searchId, updateHome, adoptServerHome, setBusy, openedFromBoard } = workspace;
  // The freshly read home replaces the board's copy (unless a save is mid-air).
  useEffect(() => { adoptServerHome(serverHome); }, [serverHome, adoptServerHome]);
  const home = workspace.homes.find((candidate) => candidate.id === serverHome.id) || serverHome;
  const homeRef = useRef(home);
  homeRef.current = home;

  const [view, setView] = useState(section === 'tour' ? 'tour' : 'research');
  const [closing, setClosing] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [fullEditor, setFullEditor] = useState(false);
  const dialogRef = useRef(null);
  const scrollRef = useRef(null);
  const titleRef = useRef(null);
  const matchRef = useRef(null);
  const nestedOpen = reflecting || !!archiveTarget || fullEditor;
  const nestedRef = useRef(nestedOpen);
  nestedRef.current = nestedOpen;

  const applyLocal = useCallback((patch) => updateHome(serverHome.id, patch), [updateHome, serverHome.id]);
  const autosave = useHomeAutosave({
    home,
    applyLocal,
    writeShared: (patch) => saveHomeSharedFields(createClient(), serverHome.id, patch),
    writePersonal: (snapshot) => saveHomePersonalState(createClient(), snapshot, userId, searchId),
    onBusyChange: (busy) => setBusy(serverHome.id, busy),
  });
  const editor = useMemo(() => ({ saveShared: autosave.saveShared, registerDraft: autosave.registerDraft, failed: autosave.failed, settle: autosave.settle }), [autosave.saveShared, autosave.registerDraft, autosave.failed, autosave.settle]);

  const { setRef, getState } = useCommuteObserver(home, commuteDestinations);
  const match = computeMatch(home, priorities, evaluateCommute(commuteDestinations, getState));
  const summary = matchFactualSummary(match);
  const identity = homeIdentity(home, priorities);
  const vocabulary = homeVocabulary(priorities);
  const usesFullEditor = vocabulary.apartment || searchIntentCapabilities(priorities.searchType).showsRentalFacts;
  const homePath = `/homes/${encodeURIComponent(home.id)}`;

  // Any change that may touch both shared facts and this buyer's own state
  // (a post-tour verdict appends a shared note; archiving is personal).
  const applyChange = useCallback((next) => {
    const current = homeRef.current;
    const shared = sharedFieldChanges(next, current);
    const personal = Object.fromEntries(PERSONAL_FIELDS.filter((field) => JSON.stringify(next[field] ?? null) !== JSON.stringify(current[field] ?? null)).map((field) => [field, next[field]]));
    if (Object.keys(shared).length) autosave.saveShared(shared);
    if (Object.keys(personal).length) autosave.savePersonal(personal);
  }, [autosave]);
  const applyAndConfirm = useCallback(async (next) => {
    applyChange(next);
    if (!(await autosave.settle())) throw new Error('Not saved');
  }, [applyChange, autosave]);

  const answerCriterion = (item, next) => {
    const patch = criterionAnswerPatch(homeRef.current, item.key, next, priorities.searchType);
    if (patch.shared) autosave.saveShared(patch.shared); else autosave.savePersonal(patch.personal);
  };

  const leave = useCallback(() => {
    if (openedFromBoard.current) { openedFromBoard.current = false; router.back(); }
    else router.push(returnTo, { scroll: false });
  }, [openedFromBoard, router, returnTo]);

  // Close never discards an edit: typed text is committed, every queued save
  // finishes, and a failed save stops here with Retry / Close anyway.
  const close = useCallback(async ({ force = false } = {}) => {
    if (closing && !force) return;
    setClosing(true);
    const ok = force || await autosave.settle();
    if (!ok) { setCloseBlocked(true); setClosing(false); return; }
    // Saved changes: rebuild the client Router Cache so no page restored later
    // by Back/Forward shows this home as it was (see refreshMyHomes).
    if (autosave.savedCount() > 0) {
      await refreshMyHomes().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    leave();
  }, [closing, autosave, leave]);
  const closeRef = useRef(close);
  closeRef.current = close;

  // Switching views is client-only and keeps the same history entry (Back
  // always closes the overlay). The URL still says which view is open, so a
  // reload or a shared link returns to it. A router navigation here would
  // remount the page segment (search params are part of its key) and lose the
  // overlay's autosave state, so this uses the history API, which Next.js syncs.
  const showView = (next) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.delete('added');
    if (next === 'tour') url.searchParams.set('section', 'tour'); else url.searchParams.delete('section');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    requestAnimationFrame(() => { scrollRef.current?.scrollTo?.({ top: 0 }); titleRef.current?.focus({ preventScroll: true }); });
  };

  const openFact = (fieldId) => {
    const node = document.getElementById(fieldId);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.focus({ preventScroll: true });
  };

  // Focus, Escape, the focus trap, and page scroll lock.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    titleRef.current?.focus({ preventScroll: true });
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (nestedRef.current) return;
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return;
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null || node === document.activeElement);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      root.style.overflow = previousOverflow;
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?section=match (older links) lands on Your Match, then the URL settles on
  // the overlay's own address; ?added= from older Add Home builds is dropped.
  useEffect(() => {
    if (section === 'match') requestAnimationFrame(() => matchRef.current?.scrollIntoView({ block: 'start' }));
    const url = new URL(window.location.href);
    if (url.searchParams.has('added') || url.searchParams.get('section') === 'match' || url.searchParams.get('section') === 'facts') {
      url.searchParams.delete('added');
      if (url.searchParams.get('section') !== 'tour') url.searchParams.delete('section');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tourHref = `${homePath}?section=tour`;

  return <div className="flh-overlay-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !nestedOpen) close(); }}>
    <div ref={(node) => { dialogRef.current = node; setRef(node); }} className="flh-overlay" role="dialog" aria-modal="true" aria-labelledby="flh-overlay-title">
      <header className="flh-overlay-bar">
        <div className="flh-overlay-bar-title">
          {view === 'tour' && <button type="button" className="flh-overlay-back" onClick={() => showView('research')}><ArrowLeft size={15} aria-hidden="true" /> Home details</button>}
          <h1 id="flh-overlay-title" ref={titleRef} tabIndex={-1}>{view === 'tour' ? 'Tour Feedback · ' : ''}{identity.primary}</h1>
          {identity.supporting && <p>{identity.supporting}</p>}
        </div>
        <div className="flh-overlay-bar-actions">
          <SaveState status={autosave.status} onRetry={autosave.retry} />
          <button type="button" className="flh-overlay-close" onClick={() => close()} disabled={closing}>{closing ? 'Saving…' : 'Close'} <X size={15} aria-hidden="true" /></button>
        </div>
      </header>

      {closeBlocked && <div className="flh-overlay-blocked" role="alert">
        <p><strong>Some changes couldn’t be saved.</strong> They’re still on screen. Check your connection and try again.</p>
        <div>
          <button type="button" className="hh-btn" onClick={() => { setCloseBlocked(false); autosave.retry(); }}>Retry</button>
          <button type="button" className="hh-btn hh-btn-ghost" onClick={() => { setCloseBlocked(false); close({ force: true }); }}>Close without saving them</button>
        </div>
      </div>}

      <div className="flh-overlay-scroll" ref={scrollRef}>
        {view === 'research' ? <>
          <HomeFacts home={home} priorities={priorities} vocabulary={vocabulary} editor={editor} userId={userId} onEditAll={usesFullEditor ? () => setFullEditor(true) : null} />

          <section className="flh-overlay-match" aria-labelledby="flh-match-title" ref={matchRef} tabIndex={-1}>
            <header className="flh-hf2-section-head">
              <h2 id="flh-match-title" className="flh-overlay-heading">Your Match</h2>
              {match?.pct != null && <span className={`flh-match-pill is-${match.pct >= 80 ? 'high' : match.pct >= 60 ? 'mid' : 'low'}`}>{match.pct}% Match</span>}
            </header>
            <p className="flh-overlay-match-lead">Unknown isn’t No. Fact-based results update from Home Facts.</p>
            {summary?.mustClause && <p className="flh-overlay-match-context">{summary.mustClause}.{summary.importantSentence ? ` ${summary.importantSentence}` : ''}</p>}
            {coBuyerPerspective?.match?.pct != null && <p className="flh-overlay-match-context">Your co-buyer’s Match: <strong>{coBuyerPerspective.match.pct}%</strong>, from their own priorities and answers.</p>}
            {match ? <MatchCriteria home={home} priorities={priorities} match={match} onAnswer={answerCriterion} onOpenFact={openFact} tourHref={tourHref} />
              : <p className="flh-overlay-match-context">No priorities are set for this search yet. <a href="/search">Set them in My Search</a>.</p>}
          </section>

          <footer className="flh-overlay-foot">
            <p>Come back to this home whenever you like.</p>
            <button type="button" className="flh-overlay-tour-link" onClick={() => showView('tour')}><NotebookText size={15} aria-hidden="true" /> Tour feedback &amp; notes</button>
          </footer>
        </> : <div className="flh-overlay-tour">
          {/* Tour Feedback, unchanged: reactions, survey, notes, in-person
              criteria and the Realtor's context. */}
          <TourFeedback
            home={home} match={match} vocabulary={vocabulary} isCollaborative={isCollaborative} coBuyerPerspective={coBuyerPerspective}
            saveError={autosave.status === 'error' ? 'Couldn’t save that change. Try again.' : ''} onRetry={autosave.retry}
            onRecordTake={() => setReflecting(true)}
            onToggleWantToTour={() => autosave.savePersonal({ status: home.status === 'Want to Tour' ? 'Saved' : 'Want to Tour' })}
            onToggleFavorite={() => applyChange({ ...home, ...toggleFavorite(home) })}
            onArchive={() => setArchiveTarget(home)}
            onRestore={() => applyChange({ ...home, ...restoreHome(home) })}
            onSaveNotes={(draft) => applyAndConfirm({ ...homeRef.current, ...draft })}
            onAnswerInPerson={(item, next) => autosave.savePersonal(inPersonAnswerPatch(homeRef.current, item.key, next))}
          >
            <RealtorContributions searchId={searchId} homeId={home.id} contributions={realtorContributions} viewerId={userId} realtorView={false} archived={isArchivedStatus(home.status)} />
          </TourFeedback>
        </div>}
      </div>

      {reflecting && <PostTourModal home={home} priorities={priorities} isCollaborative={isCollaborative} onVerdict={(current, verdict, patch) => applyAndConfirm(applyPostTourVerdict(current, verdict, patch))} onClose={() => setReflecting(false)} />}
      {archiveTarget && <ArchiveConfirmModal home={archiveTarget} onCancel={() => setArchiveTarget(null)} onConfirm={(reason) => { applyChange(archiveHome(homeRef.current, reason)); setArchiveTarget(null); }} />}
      {/* Apartments and rentals keep the full editor for the details Home Facts doesn't cover. */}
      {fullEditor && <HomeModal presentation="detail-panel" initial={home} priorities={priorities} sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative} userId={userId}
        onSave={async (next) => { const saved = await saveHomePersonalAndShared(createClient(), next, userId, searchId); updateHome(home.id, saved); setFullEditor(false); return saved; }}
        onClose={() => setFullEditor(false)} onWantToTour={() => autosave.savePersonal({ status: 'Want to Tour' })} onArchiveRequest={(target) => { setFullEditor(false); setArchiveTarget(target); }} />}
    </div>
  </div>;
}
