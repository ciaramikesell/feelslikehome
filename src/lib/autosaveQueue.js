// The write queue behind the home overlay's autosave (useHomeAutosave). Plain
// JS with no React, so tests can drive it against real Postgres.
//
//   - shared facts: markShared(fields) — written as a partial update of exactly
//     those fields, so a co-buyer's edit of another fact is never overwritten;
//   - this buyer's own answers: markPersonal() — their home_member_state row.
//
// Writes run one at a time, in order. A write always sends the newest value of
// its fields (read from getLatest() when it runs, not when it was queued), so
// rapid changes coalesce and an older value can never land after a newer one.
// Responses are never copied back over local state. A failed write keeps its
// fields marked failed until retry(); nothing the buyer entered is dropped.
export function createAutosaveQueue({ getLatest, writeShared, writePersonal, onChange = () => {}, log = console }) {
  const dirtyShared = new Set();
  const failedShared = new Set();
  let dirtyPersonal = false;
  let failedPersonal = false;
  let queue = Promise.resolve();
  let scheduled = false;
  let running = 0;
  let saves = 0;

  const snapshot = () => {
    const pending = running > 0 || scheduled || dirtyShared.size > 0 || dirtyPersonal;
    const failed = [...failedShared, ...(failedPersonal ? ['personal'] : [])];
    return { state: pending ? 'saving' : failed.length ? 'error' : saves ? 'saved' : 'idle', failed, pending };
  };
  const publish = () => onChange(snapshot());

  const run = async () => {
    scheduled = false;
    const fields = [...dirtyShared];
    const personal = dirtyPersonal;
    dirtyShared.clear();
    dirtyPersonal = false;
    if (!fields.length && !personal) { publish(); return; }
    running += 1;
    publish();
    const latest = getLatest();
    let ok = true;
    try {
      if (fields.length) {
        try {
          await writeShared(Object.fromEntries(fields.map((field) => [field, latest[field] ?? null])));
          fields.forEach((field) => failedShared.delete(field));
        } catch (error) {
          ok = false;
          log.warn?.('Autosave of shared facts failed', error?.code || error?.message);
          // A newer edit of the same field is already queued and will retry it.
          fields.forEach((field) => { if (!dirtyShared.has(field)) failedShared.add(field); });
        }
      }
      if (personal) {
        try {
          await writePersonal(latest);
          failedPersonal = false;
        } catch (error) {
          ok = false;
          log.warn?.('Autosave of personal answers failed', error?.code || error?.message);
          if (!dirtyPersonal) failedPersonal = true;
        }
      }
      if (ok) saves += 1;
    } finally {
      running -= 1;
      publish();
    }
  };

  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      queue = queue.then(run, run);
    }
    publish();
  };

  return {
    markShared(fields) {
      fields.forEach((field) => { dirtyShared.add(field); failedShared.delete(field); });
      schedule();
    },
    markPersonal() {
      dirtyPersonal = true;
      failedPersonal = false;
      schedule();
    },
    retry() {
      failedShared.forEach((field) => dirtyShared.add(field));
      failedShared.clear();
      if (failedPersonal) { dirtyPersonal = true; failedPersonal = false; }
      schedule();
    },
    // Waits for every queued write, including ones queued while waiting.
    // Resolves true when everything is saved, false when something failed.
    async settle() {
      for (let guard = 0; guard < 50; guard += 1) {
        const current = queue;
        await current;
        if (current === queue && !scheduled && running === 0) break;
      }
      return failedShared.size === 0 && !failedPersonal;
    },
    status: snapshot,
    hasUnsaved: () => running > 0 || scheduled || dirtyShared.size > 0 || dirtyPersonal || failedShared.size > 0 || failedPersonal,
    savedCount: () => saves,
  };
}
