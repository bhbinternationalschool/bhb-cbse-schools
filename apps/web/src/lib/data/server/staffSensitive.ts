/**
 * POST /api/data/sis.staff/sensitive — the only door to a staff record's
 * protected fields (data-layer 2.2b; director, 20 Oct 2026).
 *
 *   body: { ops: [{ id, base, fields: { bankAccountNo: "…", panNo: "…", … } }] }
 *
 * Who: decided from the SESSION (staffSensitiveAuthority) — the owner, or
 * payroll · edit, or accounts · edit; the mirror-sync secret never. The
 * authority and the actor recorded in sis_staff_sensitive_changes come from
 * the session; the body names only records and field values.
 * What: only protected keys (bank, UPI, Aadhaar, PAN, pay; the login
 * username — owner only; a password may only be CLEARED, by the owner). The
 * stored profile is read and the given fields laid on it, so nothing else in
 * the record can change through here. Base: the row's `updated_at`, as for
 * every kernel write (stale → 409, nothing written). A removed member is
 * restored first.
 *
 * The rules are `buildSensitiveOps` (pure, self-tested); the route file only
 * wires auth, the read and the write.
 */
import {
  STAFF_LOGIN_PROFILE_KEYS,
  STAFF_SENSITIVE_PROFILE_KEYS,
  STAFF_SIGNIN_LINK_KEYS,
  mobileKey,
  protectedChangeRefusal,
  protectedChanges,
  refusedProtectedKeys,
  type StaffAuthority,
} from "@/lib/staffProtectedFields";
import type { Revision, WriteOp } from "../types";

type Row = Record<string, unknown>;

export type SensitiveRequestOp = { id: string; base: string | null; fields: Record<string, unknown> };

export type SensitiveBuild =
  | { ok: true; ops: WriteOp<Row>[] }
  | { ok: false; status: 400 | 403 | 404 | 409; message: string };

const ALLOWED = new Set<string>([...STAFF_SENSITIVE_PROFILE_KEYS, ...STAFF_LOGIN_PROFILE_KEYS, ...STAFF_SIGNIN_LINK_KEYS]);
const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/** The body's ops, shape-checked. */
export function parseSensitiveOps(raw: unknown): SensitiveRequestOp[] | string {
  if (!isObj(raw) || !Array.isArray(raw.ops)) return "Body must be { ops: [{ id, base, fields }] }";
  if (raw.ops.length === 0 || raw.ops.length > 50) return "Send 1–50 records";
  const out: SensitiveRequestOp[] = [];
  const seen = new Set<string>();
  for (const o of raw.ops) {
    if (!isObj(o) || typeof o.id !== "string" || !o.id) return "Every op needs a string id";
    if (seen.has(o.id)) return `${o.id} appears twice`;
    seen.add(o.id);
    if (o.base != null && typeof o.base !== "string") return `${o.id}: base must be the record's revision`;
    if (!isObj(o.fields) || Object.keys(o.fields).length === 0) return `${o.id}: fields must name at least one field`;
    const bad = Object.keys(o.fields).filter((k) => !ALLOWED.has(k));
    if (bad.length) return `${o.id}: ${bad.join(", ")} cannot be written here — only bank, UPI, Aadhaar, PAN, pay and the sign-in details`;
    out.push({ id: o.id, base: (o.base as string | null) ?? null, fields: o.fields as Record<string, unknown> });
  }
  return out;
}

export function buildSensitiveOps(
  ops: readonly SensitiveRequestOp[],
  stored: ReadonlyMap<string, Row>,
  authority: StaffAuthority,
  /** E-mails held by members other than `staffId`, and every sign-in mobile in use (last 10 digits). */
  inUse: (staffId: string) => { emails: ReadonlySet<string>; mobiles: ReadonlySet<string> } = () => ({
    emails: new Set(),
    mobiles: new Set(),
  }),
): SensitiveBuild {
  const out: WriteOp<Row>[] = [];
  for (const op of ops) {
    // Even the owner gives a sign-in detail to one person only (review C).
    if ("email" in op.fields || "mobile" in op.fields) {
      const used = inUse(op.id);
      const em = String(op.fields.email ?? "").trim().toLowerCase();
      if ("email" in op.fields && em && used.emails.has(em)) {
        return { ok: false, status: 409, message: `${op.id}: that e-mail is already another member's — a sign-in detail must be one person's` };
      }
      const mob = mobileKey(op.fields.mobile);
      const own = mobileKey(stored.get(op.id)?.mobile);
      if ("mobile" in op.fields && mob && mob !== own && used.mobiles.has(mob)) {
        return {
          ok: false,
          status: 409,
          message: `${op.id}: that mobile is already the sign-in number of another member, a family or a login — a sign-in detail must be one person's`,
        };
      }
    }
    const row = stored.get(op.id);
    if (!row) return { ok: false, status: 404, message: `${op.id}: no such staff record` };
    if (row.deleted_at) return { ok: false, status: 409, message: `${String(row.full_name || op.id)} is removed — restore the record first` };
    if (op.base == null) {
      return { ok: false, status: 409, message: `${op.id}: say which version you changed (base) — nothing was written` };
    }
    const storedProfile = isObj(row.profile) ? (row.profile as Row) : {};
    const storedView = { ...storedProfile, email: row.email ?? storedProfile.email, mobile: row.mobile ?? storedProfile.mobile };
    const change = protectedChanges(storedView, op.fields, { empCode: String(row.emp_code ?? "") });
    const refused = refusedProtectedKeys(change, op.fields, authority);
    const why = protectedChangeRefusal(String(row.full_name || op.id), refused);
    if (why) return { ok: false, status: 403, message: why };
    out.push({
      op: "upsert",
      id: op.id,
      base: op.base as Revision,
      row: {
        profile: { ...storedProfile, ...op.fields },
        // A sign-in link lives in its own column too (what sign-in reads).
        ...("email" in op.fields ? { email: String(op.fields.email ?? "").trim() } : {}),
        ...("mobile" in op.fields ? { mobile: String(op.fields.mobile ?? "").trim() } : {}),
      },
    });
  }
  return { ok: true, ops: out };
}
