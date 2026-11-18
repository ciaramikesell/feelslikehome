'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AuthForm from '@/components/auth/AuthForm';
import { GUEST_CONTINUE, loadDraft, removeDraft, storeDraft, transferPayload } from '@/lib/guest/draft';
import { postGuestTransfer } from '@/lib/guest/client';

const signInHref = '/auth/sign-in?redirect=' + encodeURIComponent(GUEST_CONTINUE);

export function GuestSignup() {
  const [draft, setDraft] = useState(undefined);
  useEffect(() => setDraft(loadDraft()), []);
  if (draft === undefined) return <main className="flh-account" aria-busy="true" />;

  return <main className="flh-account">
    <h1 className="hh-serif">Save your personalized search</h1>
    {draft ? <>
      <p>Create your account to keep your priorities and start comparing homes.</p>
      <AuthForm guestDraftId={draft.id} initialMode="sign-up" redirectTo={GUEST_CONTINUE} />
      <Link href="/guest">Back to your answers</Link>
    </> : <Link href="/guest">Start personalizing</Link>}
  </main>;
}

export function GuestContinue({ email, interrupted, hasBindingCookie }) {
  const [draft, setDraft] = useState(undefined);
  const [result, setResult] = useState(null);
  const running = useRef(false);
  useEffect(() => setDraft(loadDraft()), []);

  async function save() {
    if (running.current) return;
    running.current = true;
    setResult('saving');
    try {
      const current = loadDraft();
      if (!current || current.id !== draft.id) {
        setResult('unavailable');
        return;
      }
      const submission = current.submission || transferPayload(current);
      storeDraft({ ...current, submission });
      const answer = await postGuestTransfer(submission);
      if (answer === 'saved' || answer === 'already_saved') {
        removeDraft(draft.id);
        // A lost save response must leave the proof available for replay.
        postGuestTransfer({ action: 'clear', draftId: draft.id }).catch(() => {});
      }
      setResult(answer);
    } catch {
      setResult('retry');
    } finally {
      running.current = false;
    }
  }

  if (draft === undefined) return <main className="flh-account" aria-busy="true" />;
  const saved = result === 'saved' || result === 'already_saved';
  const canSave = draft && email && hasBindingCookie && !saved;
  return <main className="flh-account">
    <h1 className="hh-serif">{saved ? 'Your personalized search is saved' : 'Save your personalized search'}</h1>
    {saved ? <>
      <p>Review your preferences in My Search, then open My Homes to add your first listing.</p>
      <Link className="hh-btn" href="/homes">Go to My Homes to add a listing</Link>{' '}
      <Link href="/search">Review My Search</Link>
    </> : <>
      {(interrupted || !draft || !hasBindingCookie) && <p>Open Feels Like Home in the same browser or app where you started. Then sign in with the email you verified. Your answers stay in that browser until you save, discard, or the draft expires.</p>}
      {email && <p>Signed in as <strong>{email}</strong>.</p>}
      {canSave && <button className="hh-btn" disabled={result === 'saving'} onClick={save}>
        {result === 'saving' ? 'Saving…' : 'Save your personalized search'}
      </button>}
      {result && result !== 'saving' && <p role="alert">
        {result === 'retry' ? 'Could not save yet. Try again. Your draft is still here.' :
          result === 'invalid_draft' ? 'These answers could not be saved. Your draft is still here.' :
          'This draft could not be applied to this account. Your draft is still here.'}
      </p>}
      {!email && <Link href={signInHref}>Sign in to continue</Link>}
      {email && <p><Link href="/">Continue to Feels Like Home</Link></p>}
      {draft && result && result !== 'saving' && <button type="button" className="flh-text-action" onClick={() => {
        if (window.confirm('Discard your guest draft?')) {
          removeDraft(draft.id);
          postGuestTransfer({ action: 'clear', draftId: draft.id }).catch(() => {});
          setDraft(null);
          setResult(null);
        }
      }}>Discard guest draft</button>}
    </>}
  </main>;
}
