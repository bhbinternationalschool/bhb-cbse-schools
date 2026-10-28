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
 *    the sensitive route). The profile is one jsonb column: an upsert's
 *    profile keys are laid on the STORED profile — a key left out is kept,
 *    never wiped — so leaving the protected keys out is no blanking either.
 *  - staffListRows: what a list answer carries — the whole row (never the
 *    password) for a staff · edit holder and for the person's own row; a
 *    directory for everyone else (the staff-roster GET's rule since 29 Sep).
 */
import { STAFF_DIRECTORY_KEYS } from "@/lib/staffRosterRedact";
import {
  STAFF_NEVER_SENT_PROFILE_KEYS,
  protectedChangeRefusal,
  isBlankMobile,
  mobileFillCheck,
  protectedChanges,
  redactStaffRowProfile,
  takenLinksOf,
  withStoredProtectedKeys,
} from "@/lib/staffProtectedFields";
import type { WriteOp } from "../types";

type Row = Record<string, unknown>;

export type StaffOpsVerdict =
  | { ok: true; ops: WriteOp<Row>[]; /** Records whose missing mobile this write fills (logged by the route). */ mobileFills: string[] }
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
  /** The sign-in links (e-mail, mobile) of every live member, for the "not another member's" rule. */
  readLinks: () => Promise<readonly Row[]> = async () => [],
  /** The director's mobile rule (21 Oct): who may get a missing mobile filled by a non-owner. */
  mobileRule: { inUse: () => Promise<ReadonlySet<string>>; isPowerful: (stored: Row) => boolean } = {
    inUse: async () => new Set(),
    isPowerful: () => true,
  },
): Promise<StaffOpsVerdict> {
  const mobileFills: string[] = [];
  let inUse: ReadonlySet<string> | null = null;
  if (!by.trim()) return { ok: false, status: 403, message: "A signed-in member of staff is required to change staff records." };
  const touches = (r: Row) => "profile" in r || "email" in r || "mobile" in r;
  const needsStored = ops.filter((o) => o.op === "upsert" && isObj((o as { row?: unknown }).row) && touches((o as { row: Row }).row));
  let links: readonly Row[] | null = null;
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
    if (touches(row)) {
      if ("profile" in row && !isObj(row.profile)) return { ok: false, status: 400, message: `${op.id}: profile must be an object` };
      const before = stored.get(op.id) ?? null;
      // Sensitive keys are judged here only when the write would otherwise
      // LAND (its base is the stored revision, or a new id with no base): a
      // stale copy's old bank value is a conflict (409 — the database checks
      // the base first and then the same keys itself). The LOGIN keys have no
      // database check, so they are judged on every write.
      const lands = before ? sameInstant(op.base, before.updated_at) : op.base == null;
      const storedProfile = before && isObj(before.profile) ? (before.profile as Row) : before ? {} : null;
      // `profile` is ONE jsonb column, and the kernel patches columns: sent as
      // it is, a profile carrying only the changed keys would REPLACE the whole
      // record (addresses, documents, class links …). So the stored profile is
      // the base and the sent keys are laid on it — a key is cleared by sending
      // it as "" or null, never by leaving it out. (Protected keys left out are
      // therefore kept too; withStoredProtectedKeys says so explicitly.)
      const profile = withStoredProtectedKeys(storedProfile, { ...(storedProfile ?? {}), ...((row.profile as Row | undefined) ?? {}) });
      const empCode = String(row.emp_code ?? (profile as Row).empCode ?? before?.emp_code ?? "");
      // The sign-in links live in their own columns (what sign-in reads) and in
      // the profile: judged as one — the column when the write names it.
      const storedView: Row | null = before
        ? { ...(storedProfile ?? {}), email: before.email ?? storedProfile?.email, mobile: before.mobile ?? storedProfile?.mobile }
        : null;
      const view: Row = {
        ...profile,
        ...("email" in row ? { email: row.email } : {}),
        ...("mobile" in row ? { mobile: row.mobile } : {}),
      };
      if (!("email" in row) && !("email" in ((row.profile as Row | undefined) ?? {}))) delete view.email;
      if (!("mobile" in row) && !("mobile" in ((row.profile as Row | undefined) ?? {}))) delete view.mobile;
      if (links === null && ("email" in view || "mobile" in view)) {
        try {
          links = await readLinks();
        } catch (e) {
          return { ok: false, status: 503, message: `Could not read the staff sign-in details to check this change — nothing was written (${e instanceof Error ? e.message : String(e)}).` };
        }
      }
      const taken = takenLinksOf((links ?? []).filter((l) => String(l.id) !== op.id));
      const name = String(row.full_name ?? (profile as Row).fullName ?? before?.full_name ?? op.id);
      // A missing mobile may be recorded by the office, under safeguards.
      let fillKind: "none" | "fill" = "none";
      if (storedView && "mobile" in view && isBlankMobile(storedView.mobile)) {
        if (inUse === null) {
          try {
            inUse = await mobileRule.inUse();
          } catch (e) {
            return { ok: false, status: 503, message: `Could not check the mobile — nothing was written (${e instanceof Error ? e.message : String(e)}).` };
          }
        }
        const fill = mobileFillCheck(storedView, view, { inUse, powerful: mobileRule.isPowerful(before!), name });
        if (fill.kind === "refuse") return { ok: false, status: 403, message: fill.message };
        fillKind = fill.kind;
      }
      const change = protectedChanges(storedView, view, { empCode, taken, mobileFillAllowed: fillKind === "fill" });
      const why = protectedChangeRefusal(name, lands ? change : { sensitive: [], login: change.login });
      if (why) return { ok: false, status: 403, message: why };
      if (fillKind === "fill") mobileFills.push(op.id);
      if ("profile" in row) row.profile = profile;
    }
    out.push({ op: "upsert", id: op.id, base: op.base, row });
  }
  return { ok: true, ops: out, mobileFills };
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
