/**
 * What of the staff roster a caller may read.
 *
 * Until 2026-09-29 GET /api/school-data/staff-roster sent every staff
 * member's WHOLE record to anyone holding `staff.view` — the built-in
 * teacher, accounts, transport and auditor roles — including Aadhaar, PAN,
 * bank account, salary, PF/ESIC and, for four staff, a login password in
 * plain text. Thirteen teachers' browsers had cached it by the time it was
 * found.
 *
 * Now: holders of `staff.edit` (office, leadership) get the records as
 * before, minus the password; everyone else gets a directory — who
 * someone is, what they teach, how to reach them at school — plus their
 * own full record (still without a password). Pure; self-tested in
 * staffRosterRedact.selftest.ts.
 */
import { normalizeStaffRecord, type StaffRecord } from "@/lib/foundationMasters";

/** Safe for any member of staff to see about a colleague. */
export const STAFF_DIRECTORY_KEYS = [
  "id",
  "empCode",
  "fullName",
  "stream",
  "category",
  "jobType",
  "departmentId",
  "designationId",
  "campusId",
  "status",
  "gender",
  "mobile",
  "email",
  "photoUrl",
  "joiningDate",
  "subjectsTaught",
  "classTeacherLinks",
  "subjectTeachingLinks",
  "dutyLinks",
  "vehicleLinks",
] as const satisfies readonly (keyof StaffRecord)[];

/** Never leaves the server, whoever asks. */
export const STAFF_NEVER_SENT_KEYS = ["loginPassword"] as const;

function withoutSecrets(s: StaffRecord): StaffRecord {
  const copy = { ...s } as Record<string, unknown>;
  for (const k of STAFF_NEVER_SENT_KEYS) copy[k] = "";
  return copy as StaffRecord;
}

export function redactStaffRoster(
  staff: StaffRecord[],
  opts: { canEditStaff: boolean; selfStaffId: string },
): StaffRecord[] {
  return staff.map((s) => {
    if (opts.canEditStaff || (opts.selfStaffId && s.id === opts.selfStaffId)) {
      return withoutSecrets(s);
    }
    const dir: Record<string, unknown> = {};
    for (const k of STAFF_DIRECTORY_KEYS) dir[k] = (s as Record<string, unknown>)[k];
    return normalizeStaffRecord(dir as Partial<StaffRecord> & { id: string; fullName: string; empCode: string });
  });
}
