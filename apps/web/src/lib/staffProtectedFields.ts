/**
 * The staff-record fields plain staff editing may not change, and who may
 * (data-layer 2.2b; director, 20 Oct 2026).
 *
 *  - SENSITIVE (bank, UPI, Aadhaar, PAN, pay): only the owner or someone who
 *    holds the payroll or accounts function. The database enforces the same
 *    list (`_sis_staff_sensitive_keys()`, migration 20261021090000): the
 *    generic kernel path can never change them; `sis_staff_write_sensitive`
 *    can, and only POST /api/data/sis.staff/sensitive calls it, after
 *    `staffSensitiveAuthority` below said yes for THIS session.
 *  - LOGIN (`loginUsername`, `loginPassword`): `loginUsername` is an identity
 *    link — /api/auth/session signs a Supabase login in as the staff row whose
 *    email OR loginUsername matches it — so changing it hands someone's
 *    sign-in to a record. `loginPassword` is a demo-era plain-text password
 *    (real sign-in is Supabase Auth: OTP / first-login set-password); no
 *    browser ever receives it. Decision: neither is written by plain staff
 *    editing (the kernel's sis.staff or the old staff-roster save). A new
 *    record may carry the username the staff form derives from its employee
 *    code (or none); after that only the OWNER changes it, through the
 *    sensitive route. A password is never set by any app path — only cleared,
 *    by the owner.
 *
 * Pure: no I/O. Self-tested in staffProtectedFields.selftest.ts.
 */
import { isProtectedSuperAdminEmail } from "@/lib/superAdmin";
import { hasPermission, resolveSessionRoles, type RbacState, type SessionLike } from "@/lib/rbac";
import type { MastersState } from "@/lib/masters";

import {
  STAFF_ANSWER_REDACTED_PROFILE_KEYS,
  STAFF_LOGIN_PROFILE_KEYS,
  STAFF_NEVER_SENT_PROFILE_KEYS,
  STAFF_SENSITIVE_PROFILE_KEYS,
} from "@/lib/staffProtectedKeys";

export {
  STAFF_ANSWER_REDACTED_PROFILE_KEYS,
  STAFF_LOGIN_PROFILE_KEYS,
  STAFF_NEVER_SENT_PROFILE_KEYS,
  STAFF_SENSITIVE_PROFILE_KEYS,
};

export type StaffAuthority = "owner" | "payroll" | "accounts";

type Profile = Record<string, unknown>;

/** blank = null = "" = absent, exactly as `_sis_staff_sensitive_diff` decides. */
function norm(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  return JSON.stringify(v);
}

export function profileValueChanged(before: unknown, after: unknown): boolean {
  return norm(before) !== norm(after);
}

/** The login username the staff form fills in from an employee code. */
export function defaultLoginUsername(empCode: string): string {
  return String(empCode || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

export type ProtectedChange = { sensitive: string[]; login: string[] };

/**
 * Which protected keys `incoming` changes against `stored` (null = a new
 * record). A key ABSENT from `incoming` is not a change (callers lay the
 * stored value on first — see withStoredProtectedKeys); a key present and
 * blank where the stored one is set IS one (a blanking).
 */
export function protectedChanges(
  stored: Profile | null,
  incoming: Profile,
  opts: { empCode?: string } = {},
): ProtectedChange {
  const sensitive: string[] = [];
  const login: string[] = [];
  for (const k of STAFF_SENSITIVE_PROFILE_KEYS) {
    if (!(k in incoming)) continue;
    if (profileValueChanged(stored?.[k], incoming[k])) sensitive.push(k);
  }
  if ("loginPassword" in incoming && profileValueChanged(stored?.loginPassword, incoming.loginPassword)) {
    login.push("loginPassword");
  }
  if ("loginUsername" in incoming && profileValueChanged(stored?.loginUsername, incoming.loginUsername)) {
    const next = String(incoming.loginUsername ?? "").trim();
    // A NEW record may carry the form's own default (or none).
    const allowedOnCreate = stored === null && (next === "" || next === defaultLoginUsername(opts.empCode ?? ""));
    if (!allowedOnCreate) login.push("loginUsername");
  }
  return { sensitive, login };
}

/**
 * `incoming` with every protected key it does not carry taken from
 * `stored` — the profile is ONE jsonb column, so a staff save that left them
 * out would otherwise be a blanking (and refused by the database).
 */
export function withStoredProtectedKeys(stored: Profile | null, incoming: Profile): Profile {
  const out: Profile = { ...incoming };
  if (!stored) return out;
  for (const k of [...STAFF_SENSITIVE_PROFILE_KEYS, ...STAFF_LOGIN_PROFILE_KEYS]) {
    if (!(k in out) && k in stored) out[k] = stored[k];
  }
  return out;
}

const SENSITIVE_WORDS = "bank, UPI, Aadhaar, PAN and pay";

/** The refusal for a plain staff edit that touched a protected key. Ends in a
 * phrase isFeatureRefusalMessage knows, so the browser toasts it. */
export function protectedChangeRefusal(name: string, c: ProtectedChange): string | null {
  if (c.login.length) {
    return (
      `${name}: the login (${c.login.join(", ")}) is not changed by editing a staff record — ` +
      "staff sign in with the email on their record; only the owner changes a login username."
    );
  }
  if (c.sensitive.length) {
    return (
      `${name}: ${c.sensitive.join(", ")} not saved — ${SENSITIVE_WORDS} can be changed only by the owner ` +
      "or with the payroll or accounts function."
    );
  }
  return null;
}

/**
 * May this session change sensitive staff fields, and on what authority?
 * Decided from the SESSION and the server's own roles copy only — never from
 * anything the request body says. The mirror-sync secret is never an
 * authority (the caller refuses it before asking).
 *
 *  owner    — a protected super-admin email, or a role whose code is "owner"
 *  payroll  — payroll · edit (role or personal grant)
 *  accounts — accounts · edit
 */
export function staffSensitiveAuthority(
  session: SessionLike,
  masters: MastersState | null,
  rbac: RbacState,
): StaffAuthority | null {
  if (session.persona && session.persona !== "staff") return null;
  if (isProtectedSuperAdminEmail(session.email)) return "owner";
  if (resolveSessionRoles(rbac, session, masters).some((r) => r.code === "owner")) return "owner";
  if (hasPermission(session, masters, "payroll", "edit", rbac)) return "payroll";
  if (hasPermission(session, masters, "accounts", "edit", rbac)) return "accounts";
  return null;
}

/** Who the database records as the actor: the session's staff id, else its email. */
export function staffActorOf(session: { staffId?: string; email?: string; fullName?: string }): string {
  return (session.staffId || session.email || "").trim();
}

/** A copy of a sis_staff row (snake_case columns + `profile`) without `keys` in its profile. */
export function redactStaffRowProfile(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  if (!row || typeof row !== "object") return row;
  const out: Record<string, unknown> = { ...row };
  if (row.profile && typeof row.profile === "object" && !Array.isArray(row.profile)) {
    const p: Profile = { ...(row.profile as Profile) };
    for (const k of keys) delete p[k];
    out.profile = p;
  }
  // A camelCase StaffRecord carries them at the top level.
  for (const k of keys) delete out[k];
  return out;
}

/**
 * Of the protected keys a change touches, those THIS authority may not
 * change: sensitive keys need any of owner / payroll / accounts; the login
 * username needs the owner; a password is never set — the owner may only
 * clear one. `authority` null = plain staff editing (refuses every one).
 */
export function refusedProtectedKeys(
  c: ProtectedChange,
  incoming: Profile,
  authority: StaffAuthority | null,
): ProtectedChange {
  return {
    sensitive: authority ? [] : [...c.sensitive],
    login: c.login.filter((k) => {
      if (authority !== "owner") return true;
      if (k === "loginPassword") return norm(incoming.loginPassword) !== null;
      return false;
    }),
  };
}

type RosterRecord = { id: string; empCode?: string; fullName?: string } & Profile;

/**
 * The OLD staff-roster save (POST /api/school-data/staff-roster — the Staff
 * screen until 2.2d moves it to the kernel). Its rows go straight to
 * sis_staff, past desk_write_guarded, so the rule is applied here:
 * of the rows this save WILL write — stamped: the rows it names; unstamped:
 * only new rows (stored ones are never replaced) — none may change a
 * protected key beyond `authority`. Stored rows are matched by id, else by
 * employee code (the save remaps ids onto stored rows by code). Returns the
 * refusal for the first offending row, or null.
 */
export function rosterSaveRefusal(
  stored: readonly RosterRecord[],
  incoming: readonly RosterRecord[],
  namedIds: ReadonlySet<string> | null,
  authority: StaffAuthority | null,
): string | null {
  const byId = new Map(stored.map((s) => [s.id, s]));
  const byEmp = new Map(
    stored.filter((s) => String(s.empCode ?? "").trim()).map((s) => [String(s.empCode).trim(), s]),
  );
  for (const row of incoming) {
    if (!row || typeof row.id !== "string") continue;
    const emp = String(row.empCode ?? "").trim();
    const match = byId.get(row.id) ?? (emp ? byEmp.get(emp) : undefined) ?? null;
    if (namedIds ? !namedIds.has(row.id) : match !== null) continue; // not written by this save
    const change = protectedChanges(match, row, { empCode: emp });
    const refused = refusedProtectedKeys(change, row, authority);
    const why = protectedChangeRefusal(String(row.fullName || emp || row.id), refused);
    if (why) return why;
  }
  return null;
}
