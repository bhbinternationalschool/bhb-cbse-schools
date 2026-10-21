/**
 * The staff-record fields plain staff editing may not change, and who may
 * (data-layer 2.2b; director, 20 Oct 2026).
 *
 *  - SENSITIVE (bank, UPI, Aadhaar, PAN, pay): only the owner or someone
 *    given the function `staff.sensitive_edit` ("Bank, ID & pay details" —
 *    the built-in Accounts role, i.e. the accountant; director, 21 Oct 2026).
 *    NOT staff · edit, payroll · edit or accounts · edit as such: the Office
 *    and Admin roles hold those for their daily work and must not reach
 *    these fields. The database enforces the same
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
 *  - SIGN-IN LINKS (`email`, `mobile`, and `loginUsername` above): sign-in
 *    resolves a person by them (/api/auth/session by email or username, the
 *    staff OTP and provisioning by mobile). On an existing record any change
 *    — filling a blank one too — is the owner's; a new record may carry ones
 *    no other member holds (never a protected owner e-mail). Review of #702.
 *
 * Pure: no I/O. Self-tested in staffProtectedFields.selftest.ts.
 */
import { isProtectedSuperAdminEmail } from "@/lib/superAdmin";
import { featureGrantHeld, hasPermission, resolveSessionRoles, type RbacState, type SessionLike } from "@/lib/rbac";
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

/** The function that opens the sensitive fields (lib/rbacFeatureCatalog/people.ts). */
export const STAFF_SENSITIVE_FEATURE = "staff.sensitive_edit";

/** Columns / keys a sign-in resolves a person by. */
export const STAFF_SIGNIN_LINK_KEYS = ["email", "mobile"] as const;

type Profile = Record<string, unknown>;

/** A value for comparison: blank = null = "" = absent; a number and the
 * string that spells it alike (25000 = "25000" — but "007" ≠ 7: an account
 * number's leading zeros are part of it); objects with their keys sorted. */
function canon(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      const c = canon(o[k]);
      if (c !== null) out[k] = c;
    }
    return Object.keys(out).length ? out : null;
  }
  return v;
}

function norm(v: unknown): string | null {
  const c = canon(v);
  return c === null ? null : JSON.stringify(c);
}

export function profileValueChanged(before: unknown, after: unknown): boolean {
  return norm(before) !== norm(after);
}

const isBlank = (v: unknown) => norm(v) === null;

/** The login username the staff form fills in from an employee code. */
export function defaultLoginUsername(empCode: string): string {
  return String(empCode || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

/** A mobile as sign-in matches it: the last 10 digits. */
export function mobileKey(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "").slice(-10);
}

/** Sign-in links other members already hold (and e-mails nobody may take). */
export type TakenLinks = {
  emails: ReadonlySet<string>;
  mobiles: ReadonlySet<string>;
};

export function takenLinksOf(
  others: readonly Record<string, unknown>[],
): TakenLinks {
  const emails = new Set<string>();
  const mobiles = new Set<string>();
  for (const o of others) {
    const e = String(o.email ?? "").trim().toLowerCase();
    if (e) emails.add(e);
    const m = mobileKey(o.mobile);
    if (m.length === 10 && !/^0+$/.test(m)) mobiles.add(m);
  }
  return { emails, mobiles };
}

export type ProtectedChange = { sensitive: string[]; login: string[] };

/**
 * Which protected keys `incoming` changes against `stored` (null = a new
 * record). A key ABSENT from `incoming` is not a change (callers lay the
 * stored value on first — see withStoredProtectedKeys); a key present and
 * blank where the stored one is set IS one (a blanking).
 *
 * `login` collects the sign-in keys: loginUsername, loginPassword, email,
 * mobile. Allowed without the owner (so not listed): the form's default
 * username (from the employee code) where none was set; on a NEW record an
 * e-mail / mobile no other member holds (`taken`).
 */
export function protectedChanges(
  stored: Profile | null,
  incoming: Profile,
  opts: { empCode?: string; taken?: TakenLinks } = {},
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
    // Blank → the form's own default (it derives one on every save) is not a change of who signs in.
    const isDefault = next === defaultLoginUsername(opts.empCode ?? "");
    if (!(isBlank(stored?.loginUsername) && (next === "" || isDefault))) login.push("loginUsername");
  }
  // E-mail and mobile: on an EXISTING record any change — filling a blank one
  // too — is the owner's (filling the principal's blank mobile with your own
  // phone would sign you in as the principal). A NEW record may carry ones no
  // other member holds (and no owner e-mail).
  if ("email" in incoming && profileValueChanged(stored?.email, incoming.email)) {
    const next = String(incoming.email ?? "").trim().toLowerCase();
    const freeOnCreate = stored === null && !opts.taken?.emails.has(next) && !isProtectedSuperAdminEmail(next);
    if (!freeOnCreate) login.push("email");
  }
  if ("mobile" in incoming && mobileKey(stored?.mobile) !== mobileKey(incoming.mobile)) {
    const next = mobileKey(incoming.mobile);
    const freeOnCreate = stored === null && !opts.taken?.mobiles.has(next);
    if (!freeOnCreate) login.push("mobile");
  }
  return { sensitive, login };
}

/**
 * `incoming` with every protected key it does not carry taken from
 * `stored` — absent = keep stored (a save that left them out must not blank
 * them: the old route's normalisation turns an absent key into "").
 */
export function withStoredProtectedKeys(stored: Profile | null, incoming: Profile): Profile {
  const out: Profile = { ...incoming };
  if (!stored) return out;
  for (const k of [...STAFF_SENSITIVE_PROFILE_KEYS, ...STAFF_LOGIN_PROFILE_KEYS, ...STAFF_SIGNIN_LINK_KEYS]) {
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
      `${name}: ${c.login.join(", ")} not saved — a sign-in detail (login, e-mail or mobile) of a member is set or ` +
      "changed only by the owner; only the owner changes a sign-in link."
    );
  }
  if (c.sensitive.length) {
    return (
      `${name}: ${c.sensitive.join(", ")} not saved — ${SENSITIVE_WORDS} can be changed only by the owner ` +
      "or with the bank & pay details function."
    );
  }
  return null;
}

/**
 * May this session change sensitive staff fields, and on what authority?
 * Decided from the SESSION and the server's own roles copy only — never from
 * anything the request body says. The mirror-sync secret is never an
 * authority (the caller refuses it before asking). `rbacKnown` false = the
 * school's roles could not be read: only a protected owner e-mail counts.
 *
 *  owner    — a protected super-admin email, or a role whose code is "owner"
 *  accounts / payroll — holds the FUNCTION staff.sensitive_edit (a role's
 *             function grant or a personal allow — never the whole staff,
 *             payroll or accounts module as such); recorded as "payroll"
 *             when the person also holds payroll · edit, else "accounts".
 */
export function staffSensitiveAuthority(
  session: SessionLike,
  masters: MastersState | null,
  rbac: RbacState,
  opts: { rbacKnown?: boolean } = {},
): StaffAuthority | null {
  if (session.persona && session.persona !== "staff") return null;
  if (isProtectedSuperAdminEmail(session.email)) return "owner";
  if (opts.rbacKnown === false) return null;
  if (resolveSessionRoles(rbac, session, masters).some((r) => r.code === "owner")) return "owner";
  if (!featureGrantHeld(session, masters, STAFF_SENSITIVE_FEATURE, "edit", rbac)) return null;
  return hasPermission(session, masters, "payroll", "edit", rbac) ? "payroll" : "accounts";
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
 * change: sensitive keys need any authority; sign-in links need the owner;
 * a password is never set — the owner may only clear one. `authority` null
 * = plain staff editing (refuses every one).
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

/** The employee code as the old save keys it (normalizeStaffRecord upper-cases, the push trims). */
export function rosterEmpKey(v: unknown): string {
  return String(v ?? "").toUpperCase().trim();
}

/**
 * The stored row the OLD save will write an incoming row onto — computed the
 * way upsertStaffBundle does it: by (normalised) employee code first, else by
 * id. `mismatch` = the row's id is one member and its employee code another's
 * (the save would write the other member) — always refused.
 */
export function rosterTargetOf<T extends RosterRecord>(
  stored: readonly T[],
  row: RosterRecord,
): { target: T | null; mismatch: boolean } {
  const emp = rosterEmpKey(row.empCode);
  const byEmp = emp ? stored.find((s) => rosterEmpKey(s.empCode) === emp) ?? null : null;
  const byId = stored.find((s) => s.id === row.id) ?? null;
  return { target: byEmp ?? byId, mismatch: !!(byEmp && byId && byEmp.id !== byId.id) };
}

/**
 * The old save's rows as they will be judged AND written: each row's absent
 * protected / sign-in keys taken from the stored row the write lands on
 * (rosterTargetOf) — the push normalises an absent key to "", which would
 * otherwise blank a bank account. A blank password is "not sent" (browsers
 * never receive one): the stored one is kept.
 */
export function prepareRosterRows<T extends RosterRecord>(stored: readonly RosterRecord[], incoming: readonly T[]): T[] {
  return incoming.map((row) => {
    const { target } = rosterTargetOf(stored, row);
    const raw: Profile = { ...row };
    if (isBlank(raw.loginPassword)) delete raw.loginPassword;
    return withStoredProtectedKeys(target, raw) as T;
  });
}

/**
 * The OLD staff-roster save (POST /api/school-data/staff-roster — the Staff
 * screen until 2.2d moves it to the kernel). Its rows go straight to
 * sis_staff, past desk_write_guarded, so the rule is applied here, to the
 * rows it WILL write (stamped: the rows it names; unstamped: only new rows —
 * stored ones are never replaced), each judged against the stored row the
 * write lands on (rosterTargetOf). Callers lay the stored protected keys on
 * absent ones first (withStoredProtectedKeys). Returns every refused row
 * (id as sent) with the first refusal's words.
 */
export function rosterSaveRefusal(
  stored: readonly RosterRecord[],
  incoming: readonly RosterRecord[],
  namedIds: ReadonlySet<string> | null,
  authority: StaffAuthority | null,
): { refusedIds: string[]; message: string } | null {
  const refusedIds: string[] = [];
  let message = "";
  for (const row of incoming) {
    if (!row || typeof row.id !== "string") continue;
    const { target, mismatch } = rosterTargetOf(stored, row);
    if (namedIds ? !namedIds.has(row.id) : target !== null) continue; // not written by this save
    const name = String(row.fullName || row.empCode || row.id);
    let why: string | null = null;
    if (mismatch) {
      why = `${name}: employee code ${rosterEmpKey(row.empCode)} belongs to another member — not saved; only the owner changes a sign-in link.`;
    } else {
      const taken = takenLinksOf(stored.filter((s) => s.id !== target?.id));
      const change = protectedChanges(target, row, { empCode: rosterEmpKey(row.empCode), taken });
      why = protectedChangeRefusal(name, refusedProtectedKeys(change, row, authority));
    }
    if (why) {
      refusedIds.push(row.id);
      if (!message) message = why;
    }
  }
  return refusedIds.length ? { refusedIds, message } : null;
}
