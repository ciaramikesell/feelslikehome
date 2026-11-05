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
import MatchReveal from '@/components/MatchReveal';
import { useHomesWorkspace } from '@/components/HomesWorkspace';
import { isArchivedStatus } from '@/lib/constants';
import { computeMatch, matchFactualSummary } from '@/lib/matching';
import { crossedRevealThreshold, matchCompleteness } from '@/lib/matchReveal';
import { criterionAnswerPatch, inPersonAnswerPatch } from '@/lib/matchCriteria';
import { searchIntentCapabilities } from '@/lib/searchIntent';
import { evaluateCommute } from '@/lib/commute';
import { homeIdentity, homeVocabulary } from '@/lib/homePresentation';
import { useCommuteObserver } from '@/lib/useCommuteObserver';
import { useHomeAutosave } from '@/lib/useHomeAutosave';
import { applyPostTourVerdict, archiveHome, restoreHome, toggleFavorite } from '@/lib/lifecycle';
import { createClient } from '@/lib/supabase/client';
import {
  SHARED_NOTE_FIELDS, SHARED_NOTES_CONFLICT, claimMatchReveal, saveHomePersonalAndShared, saveHomePersonalState, saveHomeSharedFields, sharedFieldChanges,
} from '@/lib/supabase/collaboration';
import { noteEntries } from '@/lib/homeDisplay';
import { refreshMyHomes } from '@/app/(app)/homes/actions';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const PERSONAL_FIELDS = ['status', 'touredAt', 'isFavorite', 'reaction', 'rejectionReason', 'ratings', 'checks'];
const NOTE_LABELS = { notes: 'Notes', pros: 'Pros', cons: 'Cons' };
const pickNotes = (home) => Object.fromEntries(SHARED_NOTE_FIELDS.map((field) => [field, home?.[field] ?? '']));
const listJoin = (items) => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// Shared Notes / Pros / Cons someone else changed while this buyer was
// editing: their version is shown, nothing is overwritten until they choose.
function NotesConflict({ conflict, onKeepMine, onUseTheirs }) {
  const fields = Object.keys(conflict);
  return <div className="flh-overlay-blocked flh-notes-conflict" role="alert">
    <p><strong>{listJoin(fields.map((field) => NOTE_LABELS[field]))} {fields.length === 1 ? 'was' : 'were'} changed by someone else in this search while you were editing.</strong> Your version is still on screen and hasn’t been saved.</p>
    {fields.map((field) => {
      const entries = noteEntries(conflict[field]);
      return <div className="flh-notes-conflict-theirs" key={field}><span>Their {NOTE_LABELS[field]}</span>{entries.length ? <ul>{entries.map((entry, i) => <li key={`${i}-${entry}`}>{entry}</li>)}</ul> : <em>Empty</em>}</div>;
    })}
    <div>
      <button type="button" className="hh-btn" onClick={onKeepMine}>Keep mine</button>
      <button type="button" className="hh-btn hh-btn-ghost" onClick={onUseTheirs}>Use theirs</button>
    </div>
  </div>;
}

function SaveState({ status, onRetry, conflict = false }) {
  // A notes conflict needs a choice (Keep mine / Use theirs), not a retry.
  if (conflict) return <span className="flh-overlay-save is-error" role="status"><AlertCircle size={14} aria-hidden="true" /> Notes not saved — choose a version</span>;
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
  const [revealOpen, setRevealOpen] = useState(false);
  const dialogRef = useRef(null);
  const scrollRef = useRef(null);
  const titleRef = useRef(null);
  const matchRef = useRef(null);
  const nestedOpen = reflecting || !!archiveTarget || fullEditor || revealOpen;
  const nestedRef = useRef(nestedOpen);
  nestedRef.current = nestedOpen;

  const applyLocal = useCallback((patch) => updateHome(serverHome.id, patch), [updateHome, serverHome.id]);
  // Shared Notes / Pros / Cons: the text this buyer last saw saved. A note write
  // succeeds only if the saved text is still that (saveHomeSharedFields'
  // `expected`); otherwise the conflict is shown and nothing is overwritten.
  // Every other shared fact keeps its column-level write.
  const notesSeen = useRef(null);
  if (notesSeen.current === null) notesSeen.current = pickNotes(serverHome);
  const [notesConflict, setNotesConflict] = useState(null);
  // Bumped by "Use theirs": Tour Feedback's notes editor (which keeps its own
  // draft of all three fields) starts over from the saved text, so a later
  // Save can't push the older draft back over their version.
  const [notesEditorKey, setNotesEditorKey] = useState(0);
  const writeShared = async (patch) => {
    const noteFields = SHARED_NOTE_FIELDS.filter((field) => field in patch);
    const other = Object.fromEntries(Object.entries(patch).filter(([field]) => !noteFields.includes(field)));
    if (Object.keys(other).length) await saveHomeSharedFields(createClient(), serverHome.id, other);
    if (!noteFields.length) return;
    const notes = Object.fromEntries(noteFields.map((field) => [field, patch[field] ?? '']));
    try {
      await saveHomeSharedFields(createClient(), serverHome.id, notes, { expected: Object.fromEntries(noteFields.map((field) => [field, notesSeen.current[field]])) });
    } catch (error) {
      if (error?.code === SHARED_NOTES_CONFLICT) setNotesConflict((current) => ({ ...current, ...error.current }));
      throw error;
    }
    Object.assign(notesSeen.current, notes);
    setNotesConflict((current) => {
      if (!current) return current;
      const rest = Object.fromEntries(Object.entries(current).filter(([field]) => !noteFields.includes(field)));
      return Object.keys(rest).length ? rest : null;
    });
  };
  const autosave = useHomeAutosave({
    home,
    applyLocal,
    writeShared,
    writePersonal: (snapshot) => saveHomePersonalState(createClient(), snapshot, userId, searchId),
    onBusyChange: (busy) => setBusy(serverHome.id, busy),
  });
  const editor = useMemo(() => ({ saveShared: autosave.saveShared, registerDraft: autosave.registerDraft, failed: autosave.failed, settle: autosave.settle }), [autosave.saveShared, autosave.registerDraft, autosave.failed, autosave.settle]);

  // Match Reveal (docs/match-reveal.md). The baseline is this buyer's
  // completeness on the persisted home as read from the server — on open and on
  // every fresh read — so opening a home, another buyer's edits or background
  // data never trigger it. Only this buyer's own save, once persisted, that
  // takes it from locked to unlocked may claim the one-time reveal; the claim
  // (once per buyer and home, server-side) must succeed before it shows.
  const revealBaseline = useRef(null);
  const prioritiesRef = useRef(priorities);
  prioritiesRef.current = priorities;
  useEffect(() => { revealBaseline.current = matchCompleteness(computeMatch(serverHome, prioritiesRef.current)); }, [serverHome]);
  const considerReveal = useCallback((persisted) => {
    const after = matchCompleteness(computeMatch(persisted, prioritiesRef.current));
    const crossed = crossedRevealThreshold(revealBaseline.current, after);
    revealBaseline.current = after;
    if (!crossed) return;
    // One token per crossing: a retry after a lost response is the same claim.
    claimMatchReveal(createClient(), persisted.id, { token: crypto.randomUUID() }).then((claimed) => { if (claimed) setRevealOpen(true); });
  }, []);
  // 'saved' = every queued write has succeeded and nothing is pending, so the
  // local home is exactly what was persisted. savedVersion makes this run once
  // per completed save, even if 'saving' and 'saved' render together.
  useEffect(() => { if (autosave.status === 'saved') considerReveal(homeRef.current); }, [autosave.status, autosave.savedVersion, considerReveal]);
  // A fresh server read is what this buyer has now seen, unless their own
  // edits are still unsaved (then they keep the text they started from).
  // Runs on a new server read only (never on re-render: that would put an
  // older read back over text this buyer has since saved).
  const hasUnsavedRef = useRef(autosave.hasUnsaved);
  hasUnsavedRef.current = autosave.hasUnsaved;
  const seenServerHome = useRef(serverHome);
  useEffect(() => {
    if (seenServerHome.current === serverHome) return;
    seenServerHome.current = serverHome;
    if (!hasUnsavedRef.current()) notesSeen.current = pickNotes(serverHome);
  }, [serverHome]);
  const keepMyNotes = () => {
    Object.assign(notesSeen.current, notesConflict);
    setNotesConflict(null);
    setCloseBlocked(false);
    autosave.retry();
  };
  const takeTheirNotes = () => {
    Object.assign(notesSeen.current, notesConflict);
    const theirs = notesConflict;
    setNotesConflict(null);
    setCloseBlocked(false);
    autosave.saveShared(theirs);
    autosave.retry();
    setNotesEditorKey((key) => key + 1);
  };

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
          <SaveState status={autosave.status} onRetry={autosave.retry} conflict={!!notesConflict} />
          <button type="button" className="flh-overlay-close" onClick={() => close()} disabled={closing}>{closing ? 'Saving…' : 'Close'} <X size={15} aria-hidden="true" /></button>
        </div>
      </header>

      {notesConflict && <NotesConflict conflict={notesConflict} onKeepMine={keepMyNotes} onUseTheirs={takeTheirNotes} />}
      {closeBlocked && !notesConflict && <div className="flh-overlay-blocked" role="alert">
        <p><strong>Some changes couldn’t be saved.</strong> They’re still on screen. Check your connection and try again.</p>
        <div>
          <button type="button" className="hh-btn" onClick={() => { setCloseBlocked(false); autosave.retry(); }}>Retry</button>
          <button type="button" className="hh-btn hh-btn-ghost" onClick={() => { setCloseBlocked(false); close({ force: true }); }}>Close without saving them</button>
        </div>
      </div>}

      <div className="flh-overlay-scroll" ref={scrollRef}>
        {view === 'research' ? <>
          <HomeFacts home={home} priorities={priorities} vocabulary={vocabulary} editor={editor} userId={userId} isCollaborative={isCollaborative} onEditAll={usesFullEditor ? () => setFullEditor(true) : null} />

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
            onSaveNotes={(draft) => applyAndConfirm({ ...homeRef.current, ...draft })} notesEditorKey={notesEditorKey}
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
        onSave={async (next) => { const saved = await saveHomePersonalAndShared(createClient(), next, userId, searchId); updateHome(home.id, saved); setFullEditor(false); considerReveal(saved); return saved; }}
        onClose={() => setFullEditor(false)} onWantToTour={() => autosave.savePersonal({ status: 'Want to Tour' })} onArchiveRequest={(target) => { setFullEditor(false); setArchiveTarget(target); }} />}
      {revealOpen && match?.pct != null && <MatchReveal match={match} completeness={matchCompleteness(match)}
        onClose={() => setRevealOpen(false)}
        onOpenBreakdown={() => { setRevealOpen(false); requestAnimationFrame(() => { matchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); matchRef.current?.focus({ preventScroll: true }); }); }} />}
    </div>
  </div>;
}
