/**
 * The role code a staff session carries: the person's explicit Masters →
 * Roles assignment when they have one, else decided from the roster.
 *
 * One function for every place that mints or re-checks a staff session —
 * password login, WhatsApp-OTP login, and every v1 API request — so the
 * three can never disagree. Before 2026-09-29 each login route had its own
 * copy, and a signed cookie kept whatever it was minted with for ever: a
 * cookie from before the 2026-08-14 fix still said "principal" for a
 * teacher, and nothing ever looked again.
 */

import { assignedRoleScopes, inferRoleCodes, type RbacRole, type RbacState } from "@/lib/rbac";
import type { MastersState } from "@/lib/masters";
import { superAdminRoleCode } from "@/lib/superAdmin";

const PRIORITY = [
  "principal",
  "admin",
  "driver",
  "accounts",
  "office",
  "transport",
  "gate",
  "teacher",
  "support",
] as const;

/**
 * Highest privilege first, for choosing which of several ASSIGNED roles is
 * the session's role code (Nihal: office + accounts → accounts). Only the
 * label is chosen here — every assigned role still counts in permission
 * checks (resolveSessionRoleScopes reads all of them).
 */
const ASSIGNED_PRIORITY = [
  "owner",
  "principal",
  "admin",
  "accounts",
  "office",
  "auditor",
  "transport",
  "teacher",
  "gate",
  "driver",
  "support",
  "parent",
] as const;

function grantCount(role: RbacRole): number {
  return role.permissions.reduce((n, g) => n + g.actions.length, 0);
}

/**
 * The person's explicitly assigned role codes, highest privilege first.
 * Built-in codes rank by ASSIGNED_PRIORITY; a custom role (cloned or new)
 * ranks after them by how many grants it holds. Empty = no assignment.
 */
function hasScope(scope: unknown): boolean {
  if (!scope || typeof scope !== "object") return false;
  return Object.values(scope as Record<string, unknown>).some((v) =>
    Array.isArray(v) ? v.length > 0 : v != null && v !== "",
  );
}

export function assignedRoleCodesFor(
  staffId: string | null | undefined,
  rbac: RbacState,
  opts: { unscopedOnly?: boolean } = {},
): string[] {
  const rank = (r: RbacRole) => {
    const i = (ASSIGNED_PRIORITY as readonly string[]).indexOf(r.code);
    return i >= 0 ? i : ASSIGNED_PRIORITY.length;
  };
  const roles = assignedRoleScopes(rbac, staffId)
    .filter((x) => !opts.unscopedOnly || !hasScope(x.scope))
    .map((x) => x.role);
  roles.sort((a, b) => rank(a) - rank(b) || grantCount(b) - grantCount(a));
  return [...new Set(roles.map((r) => r.code).filter(Boolean))];
}

/**
 * `rbac` is the school's roles + assignments as read on the server. Pass
 * null when that read failed: the role then comes from the roster alone,
 * the same as before assignments were consulted (never "no role").
 */
export function staffRoleCodeFor(
  person: { email?: string | null; fullName: string; staffId?: string },
  masters: MastersState,
  fallback = "teacher",
  rbac: RbacState | null = null,
): string {
  const owner = superAdminRoleCode(person.email);
  if (owner) return owner;
  if (rbac && person.staffId) {
    // The label comes from UNSCOPED assignments only. Some checks still read
    // the label alone (attendance unlock, social credentials, admissions
    // manager), so "office for Class V" must not make a session "office"
    // school-wide; scoped grants still apply through the permission checks.
    const assigned = assignedRoleCodesFor(person.staffId, rbac, { unscopedOnly: true });
    if (assigned.length > 0) return assigned[0]!;
  }
  const codes = inferRoleCodes(
    {
      // Blank on purpose: the stale code must not feed its own regex.
      roleCode: "",
      email: person.email || undefined,
      fullName: person.fullName,
      persona: "staff",
      staffId: person.staffId,
    },
    masters,
  );
  return PRIORITY.find((c) => codes.includes(c)) ?? fallback;
}
