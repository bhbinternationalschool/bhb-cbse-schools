/**
 * The staff bridge (data-layer 2.2b; goes with the page copy in 2.3a/2.3b).
 *
 * Screens that write staff records through the kernel (sis.staff,
 * sis.departments, sis.designations — 2.2d) still sit next to readers of the
 * tab's page copy: the lib/ save checks (lib/rbacGuard) resolve the signed-in
 * person through its `masters.staff` + `designations`, and the old
 * staff-roster save takes its per-row stamps from that copy. After a kernel
 * write the copy must therefore follow the server, or (a) the screen's
 * permission answers lag the write, and (b) the next OLD save of a row this
 * write moved would carry the row's previous stamp and be refused as a
 * conflict.
 *
 * So after every confirmed staff write (and after a conflict — the server
 * holds something newer), the bridge drops the staff desk's "hydrated" mark
 * and re-reads the roster from the server: hydrateStaffOnce replaces the
 * copy's staff, departments and designations with the server's (server wins
 * — the DB-read mode is on everywhere) and records the new per-row stamps.
 * (The access copy itself is the staff-list view since data-layer 2.3a: the
 * kernel write invalidates it; no event is raised.) A soft-removed member is not in the server's roster, so they leave the copy;
 * a restored one comes back. No merge, no push.
 */

export type StaffBridgeDeps = {
  /** Forget that the staff desk was loaded (deskHydrateGuard). */
  reset: () => void;
  /** Re-read the roster into the page copy (staffPersistence.ensureStaffHydrated). */
  hydrate: () => Promise<boolean>;
};

async function pageCopyDeps(): Promise<StaffBridgeDeps | null> {
  if (typeof window === "undefined") return null;
  const [{ resetDeskHydrated }, { ensureStaffHydrated }] = await Promise.all([
    import("@/lib/deskHydrateGuard"),
    import("@/lib/staffPersistence"),
  ]);
  return { reset: () => resetDeskHydrated("staff"), hydrate: () => ensureStaffHydrated() };
}

/** Re-read the roster into this tab's page copy. Never throws; false = not re-read. */
export async function bridgeStaffAfterWrite(deps?: StaffBridgeDeps | null): Promise<boolean> {
  try {
    const d = deps === undefined ? await pageCopyDeps() : deps;
    if (!d) return false;
    d.reset();
    await d.hydrate();
    return true;
  } catch (e) {
    console.warn("[staff-bridge] the roster could not be re-read after a write", e);
    return false;
  }
}
