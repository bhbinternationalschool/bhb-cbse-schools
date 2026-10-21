/**
 * The staff rules of the generic data route (data-layer 2.2b) for the
 * `staffRecords` collection (sis.staff), kept out of the route so they can be
 * driven directly by a self-test (staffKernel.selftest.ts).
 *
 *  - prepareStaffOps: every op checked BEFORE it reaches desk_write_guarded.
 *    A delete is stamped with `by` from the SESSION (whatever the body said).
 *    An upsert may not write `deleted_by` (the server's), nor change a
 *    protected profile key (bank / UPI / Aadhaar / PAN / pay — the database
 *    refuses those too — or the login, which only the owner changes through
 *    the sensitive route). The profile is one jsonb column: the protected keys
 *    an upsert leaves out are laid on from the stored row, so leaving them out
 *    is never a blanking.
 *  - staffListRows: what a list answer carries — the whole row (never the
 *    password) for a staff · edit holder and for the person's own row; a
 *    directory for everyone else (the staff-roster GET's rule since 29 Sep).
 */
import { STAFF_DIRECTORY_KEYS } from "@/lib/staffRosterRedact";
import {
  STAFF_NEVER_SENT_PROFILE_KEYS,
  protectedChangeRefusal,
  protectedChanges,
  redactStaffRowProfile,
  withStoredProtectedKeys,
} from "@/lib/staffProtectedFields";
import type { WriteOp } from "../types";

type Row = Record<string, unknown>;

export type StaffOpsVerdict =
  | { ok: true; ops: WriteOp<Row>[] }
  | { ok: false; status: 400 | 403 | 503; message: string };

/** Same instant to the millisecond (a base and a stored updated_at may be spelled differently). */
function sameInstant(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  const x = Date.parse(String(a));
  const y = Date.parse(String(b));
  return Number.isFinite(x) && Number.isFinite(y) ? x === y : String(a) === String(b);
}

const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * @param ops     the request's ops (already shape-checked: objects with a string id)
 * @param by      who is writing — the session's staff id / email (route), never the body
 * @param readStored  the stored sis_staff rows for these ids (throws on a failed read)
 */
export async function prepareStaffOps(
  ops: readonly WriteOp<Row>[],
  by: string,
  readStored: (ids: string[]) => Promise<Map<string, Row>>,
): Promise<StaffOpsVerdict> {
  if (!by.trim()) return { ok: false, status: 403, message: "A signed-in member of staff is required to change staff records." };
  const needsStored = ops.filter((o) => o.op === "upsert" && isObj((o as { row?: unknown }).row) && "profile" in ((o as { row: Row }).row));
  let stored = new Map<string, Row>();
  if (needsStored.length) {
    try {
      stored = await readStored(needsStored.map((o) => o.id));
    } catch (e) {
      return {
        ok: false,
        status: 503,
        message: `Could not read the saved staff records to check this change — nothing was written (${e instanceof Error ? e.message : String(e)}).`,
      };
    }
  }
  const out: WriteOp<Row>[] = [];
  for (const op of ops) {
    if (op.op === "delete") {
      // The server says who removed it; a `by` in the body is ignored.
      out.push({ op: "delete", id: op.id, base: op.base, by: by.trim() } as WriteOp<Row>);
      continue;
    }
    const raw = (op as { row?: unknown }).row;
    if (!isObj(raw)) return { ok: false, status: 400, message: `upsert ${op.id} has no row object` };
    const row: Row = { ...raw };
    delete row.deleted_by;
    delete row.tenant_id;
    if ("profile" in row) {
      if (!isObj(row.profile)) return { ok: false, status: 400, message: `${op.id}: profile must be an object` };
      const before = stored.get(op.id) ?? null;
      // Sensitive keys are judged here only when the write would otherwise
      // LAND (its base is the stored revision, or a new id with no base): a
      // stale copy's old bank value is a conflict (409 — the database checks
      // the base first and then the same keys itself). The LOGIN keys have no
      // database check, so they are judged on every write.
      const lands = before ? sameInstant(op.base, before.updated_at) : op.base == null;
      const storedProfile = before && isObj(before.profile) ? (before.profile as Row) : before ? {} : null;
      const profile = withStoredProtectedKeys(storedProfile, row.profile as Row);
      const empCode = String(row.emp_code ?? (profile as Row).empCode ?? before?.emp_code ?? "");
      const change = protectedChanges(storedProfile, profile, { empCode });
      const why = protectedChangeRefusal(
        String(row.full_name ?? (profile as Row).fullName ?? before?.full_name ?? op.id),
        lands ? change : { sensitive: [], login: change.login },
      );
      if (why) return { ok: false, status: 403, message: why };
      row.profile = profile;
    }
    out.push({ op: "upsert", id: op.id, base: op.base, row });
  }
  return { ok: true, ops: out };
}

/** Top-level sis_staff columns a directory row keeps (the rest is the profile's business). */
const DIRECTORY_COLUMNS = [
  "id",
  "emp_code",
  "full_name",
  "stream",
  "category",
  "department_id",
  "designation_id",
  "campus_id",
  "status",
  "mobile",
  "email",
  "updated_at",
  "deleted_at",
] as const;

export function staffListRows(rows: readonly Row[], opts: { canEdit: boolean; selfStaffId: string }): Row[] {
  return rows.map((r) => {
    if (opts.canEdit || (opts.selfStaffId && String(r.id) === opts.selfStaffId)) {
      return redactStaffRowProfile(r, STAFF_NEVER_SENT_PROFILE_KEYS);
    }
    const dir: Row = {};
    for (const c of DIRECTORY_COLUMNS) if (c in r) dir[c] = r[c];
    const p = isObj(r.profile) ? (r.profile as Row) : {};
    const profile: Row = {};
    for (const k of STAFF_DIRECTORY_KEYS) if (k in p) profile[k] = p[k];
    dir.profile = profile;
    return dir;
  });
}
