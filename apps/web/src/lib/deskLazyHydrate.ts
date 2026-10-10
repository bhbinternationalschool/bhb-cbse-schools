/**
 * Load a heavy desk the first time a page actually reads it (10 Oct 2026,
 * storage plan Phase 3).
 *
 * Admissions, fees, payments and attendance are the largest downloads in
 * the ERP. They used to load on every page — the idle sweep fetched them
 * whether or not anything on screen used them, so a teacher opening
 * Homework on a phone pulled the whole fee book and every lead. Now they
 * load on the routes that use them (deskHydrationSchedule ROUTE_IDS) and,
 * as a safety net, the first time any screen reads one: that read starts
 * the load, and `bhb-desk-hydrated` tells listening screens to re-read once
 * it lands. A page that never reads a heavy desk never downloads it.
 */

const started = new Set<string>();

export function hydrateOnFirstRead(id: string, run: () => Promise<unknown>): void {
  if (typeof window === "undefined" || started.has(id)) return;
  started.add(id);
  // After the current render: a load*() call must stay synchronous and cheap.
  setTimeout(() => {
    void run()
      .then(() => window.dispatchEvent(new CustomEvent("bhb-desk-hydrated", { detail: { id } })))
      .catch(() => {
        // A failed load may be retried by the next read.
        started.delete(id);
      });
  }, 0);
}

/** Tests only. */
export function resetLazyHydrateForTests(): void {
  started.clear();
}
