/**
 * The access copy (data-layer 2.3a): what every client permission check
 * decides with — the roles (useRbac) and the staff roster (useStaffList) —
 * built from the two reference views instead of the tab's page copies.
 *
 * Pure, so the rules are self-tested (accessCopy.selftest.ts):
 *
 *   accessStatusOf  "ready" only when BOTH views have answered; a view that
 *                   failed without ever answering is "failed" (the screen
 *                   says it could not check and offers Try again) — never
 *                   "ready with an empty roster", never a "no" (R6).
 *   accessMastersOf the empty Masters shell plus the roster, departments and
 *                   designations from the staff list. Permission checks read
 *                   only those keys (lib/rbac resolveStaffForRbac,
 *                   inferRoleCodes; lib/staffResolve). The Masters book —
 *                   classes, sections, fee lists — is NOT here: a screen that
 *                   needs it reads useMasters() (useScreenMasters,
 *                   useStableAccessCopy).
 *   accessRbacOf    the view's rbac through normalizeRbacState, exactly as the
 *                   page copy was read (loadRbac): built-in roles are always
 *                   present, newly added modules merged onto them.
 *
 * A staff-list entry carries no phone, Aadhaar, salary, e-mail or password
 * (lib/data/server/views.ts staffListEntry): the records built here have
 * those fields empty. Nothing that decides access reads them; the signed-in
 * person is matched by `session.staffId` first, then by name.
 */
import { emptyMastersShell, type MastersState } from "@/lib/masters";
import { normalizeStaffRecord, type StaffRecord } from "@/lib/foundationMasters";
import { normalizeRbacState, type RbacState } from "@/lib/rbac";
import type { AccessDataStatus } from "@/lib/accessDataStatus";
import type { RbacView, StaffListEntry, StaffListView } from "../viewTypes";

/** One view query as far as the access copy cares. */
export type ViewQueryState = {
  /** The last answer (kept through a failed background refetch). */
  hasData: boolean;
  /** The read failed (after its retries). */
  isError: boolean;
};

/**
 * Whether permission checks may decide yet.
 *   remote false (no database configured: this browser is the truth) → ready;
 *   not mounted (server render) → loading;
 *   both views answered → ready (a later failed refetch keeps the answer);
 *   either failed with no answer → failed;
 *   otherwise → loading.
 */
export function accessStatusOf(input: {
  remote: boolean;
  mounted: boolean;
  rbac: ViewQueryState;
  staff: ViewQueryState;
}): AccessDataStatus {
  if (!input.mounted) return "loading";
  if (!input.remote) return "ready";
  if (input.rbac.hasData && input.staff.hasData) return "ready";
  if ((input.rbac.isError && !input.rbac.hasData) || (input.staff.isError && !input.staff.hasData)) return "failed";
  return "loading";
}

/** A directory entry as the StaffRecord the permission helpers take. */
export function staffRecordOfEntry(e: StaffListEntry): StaffRecord {
  return normalizeStaffRecord({
    id: e.id,
    empCode: e.empCode,
    fullName: e.fullName,
    stream: e.stream,
    status: e.status,
    departmentId: e.departmentId,
    designationId: e.designationId,
    classTeacherLinks: e.classTeacherLinks,
    subjectTeachingLinks: e.subjectTeachingLinks,
    vehicleLinks: e.vehicleLinks,
    dutyLinks: (e.dutyLinks ?? []).map((l) => ({ ...l, notes: "" })),
  });
}

/** The empty Masters shell with the staff side from the staff list. */
export function accessMastersOf(view: StaffListView): MastersState {
  return {
    ...emptyMastersShell(),
    staff: (view.staff ?? []).map(staffRecordOfEntry),
    departments: (view.departments ?? []).map((d) => ({ ...d })),
    designations: (view.designations ?? []).map((d) => ({ ...d, departmentId: d.departmentId ?? null })),
  };
}

/** The rbac view's state, normalised as the page copy was. */
export function accessRbacOf(view: RbacView): RbacState {
  return normalizeRbacState(view.rbac);
}
