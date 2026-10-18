'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createAutosaveQueue } from './autosaveQueue.js';

// Autosave for one home in the overlay (see autosaveQueue.js for the write
// rules). Every change is applied locally at once through applyLocal, then
// queued. Text fields debounce on their own and register a commit callback
// (registerDraft) while they hold typed-but-unsaved text, so Close can commit
// it before waiting for the queue (settle()).
export function useHomeAutosave({ home, applyLocal, writeShared, writePersonal, onBusyChange }) {
  const latest = useRef(home);
  latest.current = home;
  const drafts = useRef(new Map());
  const [status, setStatus] = useState({ state: 'idle', failed: [] });
  const handlers = useRef({ writeShared, writePersonal, onBusyChange });
  handlers.current = { writeShared, writePersonal, onBusyChange };
  const queueRef = useRef(null);
  if (!queueRef.current) {
    queueRef.current = createAutosaveQueue({
      getLatest: () => latest.current,
      writeShared: (patch) => handlers.current.writeShared(patch),
      writePersonal: (snapshot) => handlers.current.writePersonal(snapshot),
      onChange: (next) => {
        setStatus(next);
        handlers.current.onBusyChange?.(next.pending || next.failed.length > 0);
      },
    });
  }
  const queue = queueRef.current;

  const saveShared = useCallback((patch) => {
    latest.current = { ...latest.current, ...patch };
    applyLocal(patch);
    queue.markShared(Object.keys(patch));
  }, [applyLocal, queue]);

  const savePersonal = useCallback((patch) => {
    latest.current = { ...latest.current, ...patch };
    applyLocal(patch);
    queue.markPersonal();
  }, [applyLocal, queue]);

  const registerDraft = useCallback((id, commit) => {
    if (commit) drafts.current.set(id, commit); else drafts.current.delete(id);
  }, []);

  const settle = useCallback(async () => {
    [...drafts.current.values()].forEach((commit) => commit());
    return queue.settle();
  }, [queue]);

  const hasUnsaved = useCallback(() => drafts.current.size > 0 || queue.hasUnsaved(), [queue]);

  // Leaving the page (reload, tab close) with unsaved edits asks first.
  useEffect(() => {
    const warn = (event) => { if (hasUnsaved()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsaved]);

  return { saveShared, savePersonal, retry: queue.retry, settle, registerDraft, hasUnsaved, status: status.state, failed: status.failed, savedCount: queue.savedCount };
}
