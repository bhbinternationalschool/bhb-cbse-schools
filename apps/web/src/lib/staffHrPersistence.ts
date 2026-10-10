import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  emptyStaffHrState,
  loadStaffHr,
  normalizeStaffHrState,
  staffHrStateIsEmpty,
  writeStaffHrLocalRaw,
  type StaffHrState,
} from "@/lib/staffHr";

const desk = createDeskSlicePersistence<StaffHrState>({
  moduleId: "staff_hr",
  blobMetaKey: "bhb_staff_hr_v1_remote_meta",
  label: "staffHr",
  isEmpty: staffHrStateIsEmpty,
  loadLocal: loadStaffHr,
  writeLocalRaw: writeStaffHrLocalRaw,
  hasRemoteData: (b) =>
    (Array.isArray(b.leaveTypes) ? b.leaveTypes.length : 0) > 0,
});

export const staffHrRemoteEnabled = desk.remoteEnabled;
export const scheduleStaffHrSync = desk.scheduleSync;
export const ensureStaffHrHydrated = desk.ensureHydrated;
export const resetStaffHrPersistenceCache = desk.resetCache;
export const pushStaffHrRemoteServer = desk.pushRemoteServer;

/**
 * Server-side hydrate for the API routes: the desk slices win (they are what
 * the web desk saves), the jsonb blob fills in `staffRequests`, which is not
 * a desk slice. Re-read on every call — a mobile decision must see what the
 * office saved a minute ago.
 *
 * Returns false when the desk itself could not be read: the cache then holds
 * the blob alone, and a reader that needs to tell "no leave" from "could not
 * look" must not treat it as the desk.
 */
/**
 * Whether the server copy in the cache came from a successful desk read.
 * A copy that did not (the read failed, so the cache holds the legacy blob
 * or nothing) must never be saved back over the desk — saveStaffHrServer
 * checks this.
 */
let serverCopyFromDesk = false;
export function staffHrServerCopyIsFromDesk(): boolean {
  return serverCopyFromDesk;
}

export async function ensureStaffHrHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;
  const { fetchDeskSliceFromDb } = await import("@/lib/deskSliceNormalized.server");
  const { fetchServerBlob } = await import("@/lib/serverBlob");

  let state = emptyStaffHrState();
  try {
    const blob = await fetchServerBlob<StaffHrState>(
      "staff_hr_state" as import("@/lib/serverBlob").ServerBlobTable,
    );
    if (blob.state) state = normalizeStaffHrState(blob.state);
  } catch (e) {
    console.warn("[staffHr] blob read failed", (e as Error)?.message);
  }
  const deskRead = await fetchDeskSliceFromDb("staff_hr");
  // The desk is the truth once it has ever been written (it has sync meta),
  // even with no leave types in it. Only a desk never written falls back to
  // the blob — this used to take the blob whenever leaveTypes was empty.
  const deskWritten =
    deskRead.ok &&
    (deskRead.meta != null ||
      ((deskRead.bundle.leaveTypes as unknown[] | undefined)?.length ?? 0) > 0);
  if (!deskRead.ok) {
    console.warn("[staffHr] desk read failed", deskRead.error);
  } else if (deskWritten) {
    state = normalizeStaffHrState({
      version: 1,
      ...(deskRead.bundle as Partial<StaffHrState>),
      staffRequests: state.staffRequests,
    });
  }
  writeStaffHrLocalRaw(state);
  serverCopyFromDesk = deskRead.ok;
  return deskRead.ok;
}
