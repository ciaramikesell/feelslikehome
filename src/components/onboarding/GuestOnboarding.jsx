'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Onboarding from './Onboarding';
import { DRAFT_KEY, freshDraft, loadDraft, removeDraft, storeDraft } from '@/lib/guest/draft';
import { validateGuestPriorities } from '@/lib/guest/validation';

export default function GuestOnboarding() {
  const router = useRouter();
  const [initial, setInitial] = useState(null);
  const [error, setError] = useState(false);
  const draftRef = useRef(null);

  const openDraft = () => {
    try {
      const saved = loadDraft();
      const draft = saved && validateGuestPriorities(saved.priorities, { incomplete: true }) ? saved : freshDraft();
      storeDraft(draft);
      draftRef.current = draft;
      setInitial(draft);
      setError(false);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    openDraft();
    const sync = event => {
      if (event.key === DRAFT_KEY && draftRef.current && loadDraft()?.id !== draftRef.current.id) {
        setInitial(null);
        setError(true);
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const write = patch => {
    const existing = loadDraft();
    if (existing?.id !== draftRef.current.id || existing.submission) throw new Error('Draft no longer editable');
    const next = { ...existing, ...patch };
    storeDraft(next);
    draftRef.current = next;
  };

  if (error) return <main className="flh-account"><p role="alert">This draft is unavailable. Check that browser storage is enabled, then try again.</p><button onClick={openDraft}>Try again</button></main>;
  if (!initial) return <main className="flh-account" aria-busy="true" />;
  if (initial.submission) {
    return <main className="flh-account"><p>Your draft is ready to save.</p><a href="/guest/continue">Continue saving</a></main>;
  }

  return <>
    <Onboarding key={initial.id} initialPriorities={initial.priorities}
      initialProgress={{ version: 4, state: initial.progress }}
      services={{
        savePriorities: (_search, _user, priorities) => write({ priorities }),
        saveProgress: (_user, progress) => {
          try { return write({ progress: progress.state }); }
          catch { return false; }
        },
      }}
      onGuestFinish={(priorities, progress) => {
        write({ priorities, progress });
        router.push('/guest/signup');
      }}
    />
    <footer className="flh-account">
      <p>Until you save, your answers stay in this browser for up to seven days.</p>
      <button type="button" className="flh-text-action" onClick={() => {
        if (window.confirm('Discard your answers and start over?')) {
          removeDraft(initial.id);
          openDraft();
        }
      }}>Discard draft</button>
    </footer>
  </>;
}
