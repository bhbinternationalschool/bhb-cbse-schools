/**
 * The staff screens' saves, as stated row writes (data-layer 2.2d). Pure.
 *
 * The staff screens (Staff → Roster, the profile form, Allocate teaching,
 * Doc verify, Masters → Staff setup) still build the next roster from the one
 * on screen: "mark inactive" is `{...shown, staff: shown.staff.map(…)}`. Until
 * 2.2d that whole book went to `saveMasters`, which (a) refused every save of a
 * user without Masters · edit before any request while the screen said
 * "updated", and (b) re-sent the roster on every Masters save. Since 2.2d the
 * difference between `shown` and `next` becomes stated writes of the kernel
 * collections sis.departments / sis.designations / sis.staff (2.2b), each laid
 * on the record AS STORED NOW (`stored`, read just before):
 *
 *  - a field the action changed is sent ONLY when the stored value is still
 *    the one the screen showed — otherwise the save is a conflict naming the
 *    field ("changed on another device"), nothing is sent, and the screen shows
 *    the stored value. Fields the action did not touch are never sent, so a
 *    change someone else made to another field of the same record is kept;
 *  - teacher / vehicle / duty links are merged link by link on the stored list
 *    (added links, removed link ids — as the Masters editor's links, 2.2c);
 *  - documents are merged document by document on the stored set;
 *  - bank, UPI, Aadhaar, PAN, pay and a login change go apart (`sensitive`), to
 *    the sensitive route, which only the owner or the "Bank, ID & pay details"
 *    function may use; the form's default username over a blank one is not a
 *    login change and stays in the row write;
 *  - a member who is no longer in `next` → a delete (a SOFT remove: the route
 *    records who, from the session); a new one → an upsert with no base;
 *  - departments and designations: their own rows, base = stored updated_at.
 *
 * The password is never sent (the server never sends it either).
 */
import {
  normalizeStaffRecord,
  type Department,
  type Designation,
  type StaffRecord,
} from "@/lib/foundationMasters";
import {
  STAFF_SENSITIVE_PROFILE_KEYS,
  defaultLoginUsername,
  profileValueChanged,
} from "@/lib/staffProtectedFields";
import { asRevision, type Revision, type WriteOp } from "../types";

type Row = Record<string, unknown>;

/** What a staff screen shows (a MastersState carries these three). */
export type StaffBook = {
  staff?: readonly StaffRecord[];
  departments?: readonly Department[];
  designations?: readonly Designation[];
};

/** The kernel rows as stored now (GET /api/data/sis.staff etc.). */
export type StoredStaffBook = {
  staff: readonly Row[];
  departments: readonly Row[];
  designations: readonly Row[];
};

export type StaffCollection = "sis.departments" | "sis.designations" | "sis.staff";

export type StaffWriteRequest = { collection: StaffCollection; ops: WriteOp<Row>[] };

export type SensitivePatch = {
  id: string;
  /** The stored revision when the row write does not touch this record; else filled from its answer. */
  base: Revision | null;
  fields: Row;
};

export type StaffBookPlan =
  | {
      ok: true;
      /** In order: departments, designations, staff (each one all-or-none request). */
      requests: StaffWriteRequest[];
      /** Protected fields, written after the rows (sensitive route). */
      sensitive: SensitivePatch[];
      /** Nothing changed at all. */
      empty: boolean;
    }
  | {
      ok: false;
      kind: "conflict" | "invalid";
      reason: string;
      /** For a conflict: which records and fields, to put the stored values on screen. */
      conflicts?: { id: string; fields: string[] }[];
    };

/** StaffRecord keys that also live in their own sis_staff column. */
export const STAFF_COLUMN_OF: Readonly<Record<string, string>> = {
  empCode: "emp_code",
  fullName: "full_name",
  stream: "stream",
  category: "category",
  departmentId: "department_id",
  designationId: "designation_id",
  campusId: "campus_id",
  mobile: "mobile",
  email: "email",
  status: "status",
};

/** Lists merged element by element (each element has an id). */
export const STAFF_LINK_LIST_KEYS = ["classTeacherLinks", "subjectTeachingLinks", "vehicleLinks", "dutyLinks"] as const;

const NEVER_SENT = new Set(["loginPassword", "id"]);
const SENSITIVE = new Set<string>(STAFF_SENSITIVE_PROFILE_KEYS);
/** A data: URL larger than this is not stored in the record (the old save blanked it silently). */
const DATA_URL_MAX = 8_000;

const FIELD_LABEL: Readonly<Record<string, string>> = {
  empCode: "Employee code",
  fullName: "Name",
  mobile: "Mobile",
  altMobile: "Alternate mobile",
  email: "E-mail",
  status: "Status",
  departmentId: "Department",
  designationId: "Designation",
  campusId: "Campus",
  fatherName: "Father's name",
  dateOfBirth: "Date of birth",
  joiningDate: "Joining date",
  addressCurrent: "Current address",
  addressPermanent: "Permanent address",
  photoUrl: "Photo",
  signatureUrl: "Signature",
  loginUsername: "Login username",
  loginEnabled: "Login enabled",
  remarks: "Remarks",
};

export function staffFieldLabel(key: string): string {
  if (key.startsWith("docs.")) return `Document (${key.slice(5)})`;
  return FIELD_LABEL[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const changed = (a: unknown, b: unknown) => profileValueChanged(a, b);

/** A stored sis_staff row as the screens hold a record (staffPersistence.rowToStaff's rule). */
export function storedStaffRecord(row: Row): StaffRecord {
  const profile = isObj(row.profile) ? (row.profile as Partial<StaffRecord>) : {};
  return normalizeStaffRecord({
    ...profile,
    id: String(row.id),
    empCode: (row.emp_code as string | null) ?? profile.empCode ?? "",
    fullName: (row.full_name as string | null) ?? profile.fullName ?? "",
    stream: ((row.stream as StaffRecord["stream"]) || profile.stream || "teaching") as StaffRecord["stream"],
    category: ((row.category as StaffRecord["category"]) || profile.category || "permanent") as StaffRecord["category"],
    departmentId: (row.department_id as string | null) ?? profile.departmentId ?? null,
    designationId: (row.designation_id as string | null) ?? profile.designationId ?? null,
    campusId: (row.campus_id as string | null) || profile.campusId || null,
    mobile: (row.mobile as string | null) ?? profile.mobile ?? "",
    email: (row.email as string | null) ?? profile.email ?? "",
    status: row.status === "inactive" ? "inactive" : "active",
  });
}

function columnValue(key: string, value: unknown): unknown {
  if (key === "campusId") return value ?? "";
  return value ?? null;
}

function tooBigDataUrl(v: unknown): boolean {
  return typeof v === "string" && v.startsWith("data:") && v.length > DATA_URL_MAX;
}

/** The link list changes between two lists: links added or changed, link ids taken off. */
function linkChange(before: unknown, after: unknown): { put: Row[]; remove: string[] } {
  const was = new Map((Array.isArray(before) ? before : []).filter(isObj).map((l) => [String(l.id), l]));
  const now = (Array.isArray(after) ? after : []).filter(isObj);
  const nowIds = new Set(now.map((l) => String(l.id)));
  const put = now.filter((l) => !was.has(String(l.id)) || changed(was.get(String(l.id)), l));
  const remove = [...was.keys()].filter((id) => !nowIds.has(id));
  return { put, remove };
}

function applyLinkChange(stored: unknown, c: { put: Row[]; remove: string[] }): Row[] {
  const list = (Array.isArray(stored) ? stored : []).filter(isObj);
  const drop = new Set([...c.remove, ...c.put.map((l) => String(l.id))]);
  return [...list.filter((l) => !drop.has(String(l.id))), ...c.put];
}

/** The fields a NEW record carries in its row write (everything but the protected keys and the password). */
function newStaffRow(rec: StaffRecord): { row: Row; sensitive: Row } {
  const profile: Row = {};
  const sensitive: Row = {};
  for (const [k, v] of Object.entries(rec)) {
    if (NEVER_SENT.has(k) && k !== "id") continue;
    if (SENSITIVE.has(k)) {
      if (changed(null, v)) sensitive[k] = v;
      continue;
    }
    if (k === "loginUsername") {
      const u = String(v ?? "").trim();
      if (u && u !== defaultLoginUsername(rec.empCode)) {
        sensitive[k] = u;
        continue;
      }
    }
    profile[k] = v;
  }
  delete profile.loginPassword;
  const row: Row = { profile };
  for (const [k, col] of Object.entries(STAFF_COLUMN_OF)) row[col] = columnValue(k, (rec as unknown as Row)[k]);
  return { row, sensitive };
}

function byId<T extends { id: string }>(list: readonly T[] | undefined): Map<string, T> {
  return new Map((list ?? []).map((x) => [x.id, x]));
}

function storedById(rows: readonly Row[]): Map<string, Row> {
  return new Map(rows.map((r) => [String(r.id), r]));
}

const rev = (r: Row | undefined): Revision | null => (r?.updated_at ? asRevision(String(r.updated_at)) : null);

/** Departments / designations: changed fields only, on the stored row. */
function setupOps(
  kind: "departments" | "designations",
  shown: readonly (Department | Designation)[] | undefined,
  next: readonly (Department | Designation)[] | undefined,
  stored: readonly Row[],
  conflicts: { id: string; fields: string[] }[],
): WriteOp<Row>[] {
  const a = byId(shown);
  const b = byId(next);
  const s = storedById(stored);
  const cols: Record<string, string> = { code: "code", name: "name", isActive: "is_active", departmentId: "department_id" };
  const toStored = (r: Row): Row => ({
    code: r.code ?? "",
    name: r.name ?? "",
    isActive: r.is_active !== false,
    ...(kind === "designations" ? { departmentId: r.department_id ?? null } : {}),
  });
  const ops: WriteOp<Row>[] = [];
  for (const [id, after] of b) {
    const before = a.get(id);
    const st = s.get(id);
    const afterRow = after as unknown as Row;
    if (!before) {
      if (st) {
        conflicts.push({ id, fields: ["(already exists)"] });
        continue;
      }
      const row: Row = {};
      for (const [k, col] of Object.entries(cols)) if (k in afterRow) row[col] = afterRow[k] ?? null;
      if (!("is_active" in row)) row.is_active = true;
      ops.push({ op: "upsert", id, base: null, row });
      continue;
    }
    const beforeRow = before as unknown as Row;
    const keys = Object.keys(cols).filter((k) => changed(beforeRow[k], afterRow[k]));
    if (!keys.length) continue;
    if (!st) {
      conflicts.push({ id, fields: ["(removed on another device)"] });
      continue;
    }
    const now = toStored(st);
    const moved = keys.filter((k) => changed(now[k], beforeRow[k]));
    if (moved.length) {
      conflicts.push({ id, fields: moved });
      continue;
    }
    const row: Row = {};
    for (const k of keys) row[cols[k]!] = afterRow[k] ?? null;
    ops.push({ op: "upsert", id, base: rev(st), row });
  }
  for (const [id] of a) {
    if (b.has(id)) continue;
    const st = s.get(id);
    if (st) ops.push({ op: "delete", id, base: rev(st) });
  }
  return ops;
}

export function planStaffBookCommit(input: { shown: StaffBook; next: StaffBook; stored: StoredStaffBook }): StaffBookPlan {
  const conflicts: { id: string; fields: string[] }[] = [];
  const depOps = setupOps("departments", input.shown.departments, input.next.departments, input.stored.departments, conflicts);
  const desOps = setupOps("designations", input.shown.designations, input.next.designations, input.stored.designations, conflicts);

  const shown = byId(input.shown.staff);
  const next = byId(input.next.staff);
  const stored = storedById(input.stored.staff);
  const staffOps: WriteOp<Row>[] = [];
  const sensitive: SensitivePatch[] = [];

  for (const [id, afterRaw] of next) {
    const after = normalizeStaffRecord(afterRaw);
    const beforeRaw = shown.get(id);
    const st = stored.get(id);
    if (!beforeRaw) {
      if (st) {
        conflicts.push({ id, fields: ["(a record with this id already exists)"] });
        continue;
      }
      if (tooBigDataUrl(after.photoUrl) || tooBigDataUrl(after.signatureUrl)) {
        return { ok: false, kind: "invalid", reason: `${after.fullName || after.empCode}: the photo or signature is stored inside the record and is too large — upload it again.` };
      }
      const { row, sensitive: prot } = newStaffRow(after);
      staffOps.push({ op: "upsert", id, base: null, row });
      if (Object.keys(prot).length) sensitive.push({ id, base: null, fields: prot });
      continue;
    }
    const before = normalizeStaffRecord(beforeRaw);
    const a = before as unknown as Row;
    const b = after as unknown as Row;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
      (k) => !NEVER_SENT.has(k) && changed(a[k], b[k]),
    );
    if (!keys.length) continue;
    if (!st) {
      conflicts.push({ id, fields: ["(no longer on the roster — removed on another device?)"] });
      continue;
    }
    const now = storedStaffRecord(st) as unknown as Row;
    const profile: Row = {};
    const row: Row = {};
    const prot: Row = {};
    const moved: string[] = [];
    for (const k of keys) {
      if ((STAFF_LINK_LIST_KEYS as readonly string[]).includes(k)) {
        profile[k] = applyLinkChange(now[k], linkChange(a[k], b[k]));
        continue;
      }
      if (k === "docs") {
        const da = isObj(a.docs) ? a.docs : {};
        const db = isObj(b.docs) ? b.docs : {};
        const dn = isObj(now.docs) ? now.docs : {};
        const docs: Row = { ...dn };
        for (const dk of new Set([...Object.keys(da), ...Object.keys(db)])) {
          if (!changed(da[dk], db[dk])) continue;
          if (changed(dn[dk], da[dk])) moved.push(`docs.${dk}`);
          else docs[dk] = db[dk];
        }
        profile.docs = docs;
        continue;
      }
      if (changed(now[k], a[k])) {
        moved.push(k);
        continue;
      }
      if ((k === "photoUrl" || k === "signatureUrl") && tooBigDataUrl(b[k])) {
        return { ok: false, kind: "invalid", reason: `${after.fullName}: the ${staffFieldLabel(k).toLowerCase()} is stored inside the record and is too large — upload it again.` };
      }
      if (SENSITIVE.has(k)) {
        prot[k] = b[k] ?? "";
        continue;
      }
      if (k === "loginUsername") {
        const u = String(b[k] ?? "").trim();
        const isDefault = !String(now[k] ?? "").trim() && (u === "" || u === defaultLoginUsername(String(b.empCode ?? "")));
        if (!isDefault) {
          prot[k] = u;
          continue;
        }
      }
      profile[k] = b[k] ?? null;
      if (STAFF_COLUMN_OF[k]) row[STAFF_COLUMN_OF[k]] = columnValue(k, b[k]);
    }
    if (moved.length) {
      conflicts.push({ id, fields: moved });
      continue;
    }
    if (Object.keys(profile).length) row.profile = profile;
    if (Object.keys(row).length) staffOps.push({ op: "upsert", id, base: rev(st), row });
    if (Object.keys(prot).length) sensitive.push({ id, base: Object.keys(row).length ? null : rev(st), fields: prot });
  }
  for (const [id] of shown) {
    if (next.has(id)) continue;
    const st = stored.get(id);
    // Already removed (or never stored): nothing to do.
    if (st) staffOps.push({ op: "delete", id, base: rev(st) });
  }

  if (conflicts.length) {
    const names = conflicts.map((c) => {
      const who =
        (next.get(c.id) ?? shown.get(c.id))?.fullName ||
        byId(input.next.departments).get(c.id)?.name ||
        byId(input.next.designations).get(c.id)?.name ||
        c.id;
      return `${who}: ${c.fields.map(staffFieldLabel).join(", ")}`;
    });
    return {
      ok: false,
      kind: "conflict",
      reason: `Not saved — someone changed this on another device a moment ago (${names.join("; ")}). The screen now shows their version; make your change again.`,
      conflicts,
    };
  }

  const requests: StaffWriteRequest[] = [];
  if (depOps.length) requests.push({ collection: "sis.departments", ops: depOps });
  if (desOps.length) requests.push({ collection: "sis.designations", ops: desOps });
  if (staffOps.length) requests.push({ collection: "sis.staff", ops: staffOps });
  return { ok: true, requests, sensitive, empty: requests.length === 0 && sensitive.length === 0 };
}
