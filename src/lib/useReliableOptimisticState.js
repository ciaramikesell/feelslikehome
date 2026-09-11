'use client';

import { useCallback, useRef, useState } from 'react';

const SAVE_ERROR = "Couldn't save that change. Try again.";

// Serializing full-state writes preserves click order at the database. The UI may
// continue moving ahead optimistically; only the newest failed intent is allowed
// to roll it back, so an older response can never erase a later choice.
export function useReliableOptimisticState(initialState, persist) {
  const [state, setState] = useState(initialState);
  const [saveError, setSaveError] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const confirmed = useRef(initialState);
  const latest = useRef(initialState);
  const queue = useRef(Promise.resolve());
  const version = useRef(0);
  const failed = useRef(null);

  const submit = useCallback((next) => {
    const requestVersion = ++version.current;
    latest.current = next;
    setState(next);
    setSaveError('');
    setPendingCount((count) => count + 1);

    const run = async () => {
      try {
        await persist(next);
        confirmed.current = next;
        if (requestVersion === version.current) failed.current = null;
      } catch (error) {
        failed.current = { next, requestVersion };
        if (requestVersion === version.current) {
          latest.current = confirmed.current;
          setState(confirmed.current);
          setSaveError(SAVE_ERROR);
        }
        throw error;
      }
    };
    const result = queue.current.then(run, run).finally(() => setPendingCount((count) => count - 1));
    queue.current = result.catch(() => {});
    // UI event handlers intentionally do not need their own catch; the hook has
    // already rolled back and exposed the failure through its accessible status.
    return result.catch(() => {});
  }, [persist]);

  const patch = useCallback((updater) => {
    const draft = structuredClone(latest.current);
    return submit(updater(draft));
  }, [submit]);

  const retry = useCallback(() => {
    if (!failed.current) return Promise.resolve();
    return submit(failed.current.next);
  }, [submit]);

  const flush = useCallback(() => queue.current, []);

  return { state, patch, submit, saveError, retry, flush, isSaving: pendingCount > 0 };
}
