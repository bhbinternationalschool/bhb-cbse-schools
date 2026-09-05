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
 */
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
  if (!deskRead.ok) {
    console.warn("[staffHr] desk read failed", deskRead.error);
  } else if ((deskRead.bundle.leaveTypes as unknown[] | undefined)?.length) {
    state = normalizeStaffHrState({
      version: 1,
      ...(deskRead.bundle as Partial<StaffHrState>),
      staffRequests: state.staffRequests,
    });
  }
  writeStaffHrLocalRaw(state);
  return true;
}
