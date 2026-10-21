/**
 * Who receives an event — decided on the server from the school's saved
 * roles, grants and relationships, never from anything a browser or phone
 * sends (director, 15 Oct 2026: "to every user based on roles"). Pure: the
 * caller passes the server's Masters (with the staff roster) and RBAC copy.
 *
 * Rules, combined as a union, minus `exclude` (the person who did it):
 *
 *   { staff: ids }            named members of staff — a relationship the
 *                             event already knows (the applicant, a class
 *                             teacher, a named leave approver)
 *   { households: ids }       named families
 *   { permission: m, action } every active member of staff whose roles or
 *                             personal grants hold <module>.<action>, as
 *                             their own login would be checked
 *                             (staffRoleCodeFor + hasPermission)
 *   { feature: id, action }   …or the one function (lib/rbacFeatures), or
 *                             its whole module
 *     schoolWide: true        …and only those whose roles reach the whole
 *                             school (owner / principal / admin / office —
 *                             the rule lib/api/v1/staffScope uses). A
 *                             teacher holds student_leave.approve for her
 *                             own class; she is reached by the class
 *                             relationship ({staff}), not by the grant.
 *   { staffLeaveApprovers }   canManageStaffLeave — who decides staff leave
 *   { owners }                the protected super-admins only (the director's
 *                             logins): what only the owner may approve, e.g.
 *                             a payout held for approval
 *
 * The protected super-admins (the director's logins) hold every grant; one
 * whose email is not on the roster is addressed by that email — the key the
 * push device of such a login registers under (lib/pushSubject.ts).
 *
 * An inactive member of staff, a family id that is blank, and a person
 * whose personal grant DENIES the module never receive. There is no "all"
 * rule: nothing here can address the whole school.
 */
import type { StaffRecord } from "@/lib/foundationMasters";
import type { MastersState } from "@/lib/masters";
import {
  hasFeaturePermission,
  hasPermission,
  resolveSessionRoles,
  type RbacAction,
  type RbacModule,
  type RbacState,
  type SessionLike,
} from "@/lib/rbac";
import { canManageStaffLeave } from "@/lib/staffResolve";
import { staffRoleCodeFor } from "@/lib/staffSessionRole";
import { recipientKey, type Recipient } from "./kinds";

export type AudienceRule =
  | { staff: readonly string[] }
  | { households: readonly string[] }
  | { permission: RbacModule; action: RbacAction; schoolWide?: boolean }
  | { feature: string; action: RbacAction; schoolWide?: boolean }
  | { staffLeaveApprovers: true }
  | { owners: true };

export type AudienceContext = {
  masters: MastersState;
  rbac: RbacState;
  /** protectedSuperAdminEmails() — lower-case. */
  superAdminEmails: readonly string[];
};

/** The session a member of staff's own login would carry (role code as minted at sign-in). */
export function staffSessionLike(s: StaffRecord, ctx: AudienceContext): SessionLike & { persona: "staff" } {
  const roleCode = staffRoleCodeFor({ email: s.email, fullName: s.fullName, staffId: s.id }, ctx.masters, "teacher", ctx.rbac);
  return { persona: "staff", roleCode, staffId: s.id, email: s.email || undefined, fullName: s.fullName };
}

const SCHOOL_WIDE_ROLES = new Set(["owner", "principal", "admin", "office"]);

function schoolWide(s: SessionLike, ctx: AudienceContext): boolean {
  return resolveSessionRoles(ctx.rbac, s, ctx.masters).some((r) => SCHOOL_WIDE_ROLES.has(r.code));
}

function activeStaff(ctx: AudienceContext): StaffRecord[] {
  return (ctx.masters.staff ?? []).filter((s) => s.status === "active" && !!s.id);
}

/** Super-admin logins with no roster row, addressed by email. */
function offRosterOwners(ctx: AudienceContext): Recipient[] {
  const onRoster = new Set(
    (ctx.masters.staff ?? []).map((s) => (s.email || "").trim().toLowerCase()).filter(Boolean),
  );
  return ctx.superAdminEmails
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && !onRoster.has(e))
    .map((e) => ({ type: "staff" as const, id: e }));
}

function holders(ctx: AudienceContext, holds: (session: SessionLike) => boolean): Recipient[] {
  const out: Recipient[] = [];
  for (const s of activeStaff(ctx)) {
    if (holds(staffSessionLike(s, ctx))) out.push({ type: "staff", id: s.id });
  }
  return [...out, ...offRosterOwners(ctx)];
}

export function resolveAudience(
  rules: readonly AudienceRule[],
  ctx: AudienceContext,
  exclude: readonly Recipient[] = [],
): Recipient[] {
  const active = new Set(activeStaff(ctx).map((s) => s.id));
  const owners = new Set(offRosterOwners(ctx).map((r) => r.id));
  const byKey = new Map<string, Recipient>();
  const add = (r: Recipient) => {
    const id = r.id.trim();
    if (!id) return;
    byKey.set(recipientKey({ type: r.type, id }), { type: r.type, id });
  };

  for (const rule of rules) {
    if ("staff" in rule) {
      // A named person still has to be someone who works here today.
      for (const id of rule.staff) if (active.has(id) || owners.has(id.toLowerCase())) add({ type: "staff", id });
    } else if ("households" in rule) {
      for (const id of rule.households) add({ type: "parent", id });
    } else if ("permission" in rule) {
      const wide = rule.schoolWide === true;
      for (const r of holders(
        ctx,
        (s) => hasPermission(s, ctx.masters, rule.permission, rule.action, ctx.rbac) && (!wide || schoolWide(s, ctx)),
      ))
        add(r);
    } else if ("feature" in rule) {
      const wide = rule.schoolWide === true;
      for (const r of holders(
        ctx,
        (s) => hasFeaturePermission(s, ctx.masters, rule.feature, rule.action, ctx.rbac) && (!wide || schoolWide(s, ctx)),
      ))
        add(r);
    } else if ("owners" in rule) {
      const supers = new Set(ctx.superAdminEmails.map((e) => e.trim().toLowerCase()));
      for (const st of activeStaff(ctx)) if (supers.has((st.email || "").trim().toLowerCase())) add({ type: "staff", id: st.id });
      for (const r of offRosterOwners(ctx)) add(r);
    } else if ("staffLeaveApprovers" in rule) {
      for (const r of holders(ctx, (s) => canManageStaffLeave(s, ctx.masters, ctx.rbac))) add(r);
    }
  }

  for (const x of exclude) byKey.delete(recipientKey({ type: x.type, id: x.id.trim() }));
  return [...byKey.values()].sort((a, b) => recipientKey(a).localeCompare(recipientKey(b)));
}
