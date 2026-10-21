/**
 * The masters-desk bridge (data-layer 2.2c; goes with the old whole-book save
 * in 2.2e/2.2f).
 *
 * The fee setup and the lib/ writers still save through saveMasters, which
 * sends the sections that differ from what this tab last LOADED from
 * /api/school-data/masters-desk, each at the stamp it loaded (or, with no
 * loaded desk, the whole book at the desk revision). An element write moves
 * the stamp of its slice and the desk revision. Without a fresh load the
 * next old save would carry the old stamp and be refused — "changed on
 * another device" for a fee edit made right after adding a subject in the
 * same tab.
 *
 * So after every element write (confirmed or refused) the tab's masters desk
 * is re-read: the "hydrated" mark is dropped and ensureMastersHydrated reads
 * the desk again (server wins — DB-read mode — no merge, no push), which
 * records the new stamps and revision as the old save's base. The same
 * pattern as the staff bridge (staffBridge.ts).
 */

export type MastersDeskBridgeDeps = {
  reset: () => void;
  hydrate: () => Promise<boolean>;
};

async function pageCopyDeps(): Promise<MastersDeskBridgeDeps | null> {
  if (typeof window === "undefined") return null;
  const [{ resetDeskHydrated }, { ensureMastersHydrated }] = await Promise.all([
    import("@/lib/deskHydrateGuard"),
    import("@/lib/mastersPersistence"),
  ]);
  return { reset: () => resetDeskHydrated("masters"), hydrate: () => ensureMastersHydrated() };
}

let inFlight: Promise<boolean> | null = null;
let queued: Promise<boolean> | null = null;

async function rereadOnce(deps: MastersDeskBridgeDeps | null | undefined): Promise<boolean> {
  try {
    const d = deps === undefined ? await pageCopyDeps() : deps;
    if (!d) return false;
    d.reset();
    await d.hydrate();
    return true;
  } catch (e) {
    console.warn("[masters-desk-bridge] the desk could not be re-read after a write", e);
    return false;
  }
}

/**
 * Re-read the masters desk into this tab (its stamps become the old save's
 * base). Never throws. Writes that land while a re-read runs share ONE
 * follow-up re-read (it must start after them), never one each.
 */
export function bridgeMastersDeskAfterWrite(deps?: MastersDeskBridgeDeps | null): Promise<boolean> {
  if (inFlight) {
    if (!queued) {
      const after = inFlight;
      queued = after.then(() => {
        queued = null;
        return bridgeMastersDeskAfterWrite(deps);
      });
    }
    return queued;
  }
  const run = rereadOnce(deps);
  inFlight = run;
  void run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return run;
}

/** Resolves once no re-read is running or queued — an old save waits for it, so it is based on the new stamps. */
export async function mastersDeskBridgeSettled(): Promise<void> {
  while (inFlight || queued) await (queued ?? inFlight);
}
