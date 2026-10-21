/**
 * What each reference view answers (data-layer 1.4) — the `data` of
 * `GET /api/data/views/<name>`. Types only: the server handlers
 * (lib/data/server/views.ts) build them, the hooks (lib/data/client/hooks.tsx)
 * read them.
 */
import type { MastersState } from "@/lib/masters";
import type { Department, Designation, StaffRecord } from "@/lib/foundationMasters";
import type { RbacState } from "@/lib/rbac";
import type { ModuleRegistryState } from "@/lib/moduleRegistry";

/** Masters without the staff side (staff, departments, designations: the staff-list view). */
export type MastersBook = Omit<MastersState, "staff" | "departments" | "designations">;

export type MastersView = {
  /**
   * "teaching": only the teaching keys are filled (lib/mastersTeachingSubset);
   * every other list is EMPTY BECAUSE WITHHELD, not because the school has none.
   */
  scope: "full" | "teaching";
  masters: MastersBook;
  /**
   * Data-layer 2.2b: the stamp (`updated_at`) of each OBJECT slice this answer
   * carries (schoolProfile, schoolTiming, midYearFeePolicy, statutoryConfig)
   * — the base of its next write. List elements carry their own `_rev`.
   * Absent from servers before 2.2b, and when the stamps were not read.
   */
  stamps?: Partial<Record<(typeof MASTERS_OBJECT_SLICE_KEYS)[number], string>>;
};

/** Masters' object slices (lib/mastersNormalized.server MASTERS_OBJECT_SLICES), as the views name them. */
export const MASTERS_OBJECT_SLICE_KEYS = ["midYearFeePolicy", "schoolProfile", "schoolTiming", "statutoryConfig"] as const;

export type StaffListEntry = {
  id: string;
  empCode: string;
  fullName: string;
  stream: StaffRecord["stream"];
  status: StaffRecord["status"];
  departmentId: string | null;
  departmentName: string;
  designationId: string | null;
  designationName: string;
  classTeacherLinks: StaffRecord["classTeacherLinks"];
  subjectTeachingLinks: StaffRecord["subjectTeachingLinks"];
  dutyLinks: { id: string; role: StaffRecord["dutyLinks"][number]["role"]; label: string; academicYearCode: string }[];
  vehicleLinks: StaffRecord["vehicleLinks"];
};

export type StaffListView = {
  staff: StaffListEntry[];
  departments: Pick<Department, "id" | "code" | "name" | "isActive">[];
  designations: Pick<Designation, "id" | "code" | "name" | "departmentId" | "isActive">[];
};

export type RbacView = {
  rbac: RbacState;
  /** true: only your own assignments and grants are in `rbac`, and no audit. */
  ownOnly: boolean;
  /** false: the school has no saved role set — these are the built-in roles. */
  known: boolean;
};

export type ModuleRegistryView = ModuleRegistryState;
