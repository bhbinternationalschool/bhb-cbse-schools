/**
 * One save at a time per desk (12 Oct 2026).
 *
 * Stamped and versioned saves (rowStampClient, sliceRevClient, Masters
 * section stamps, domain-blob / module-state CAS) send, for each changed
 * row, the version this browser changed it from — and learn the new version
 * only when the save's reply comes back. A second save that left before the
 * first one's reply still carried the old version, so the server refused it
 * as "changed elsewhere first", the desk reloaded and the second change was
 * lost: removing EL and then marking it unpaid, or ticking two permission
 * cells, showed "N changes … were NOT saved" with nobody else editing.
 *
 * `serialSave(key, task)` starts `task` only after every earlier task for the
 * same key has finished (resolved or failed), so each save reads the
 * versions the previous one left. Tasks must read their state and versions
 * when they run, not when they are queued. Page memory only.
 */

const chains = new Map<string, Promise<unknown>>();

export function serialSave<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return next;
}

/** True while a save for `key` is running or queued (for tests and status). */
export function saveInFlight(key: string): boolean {
  return chains.has(key);
}
