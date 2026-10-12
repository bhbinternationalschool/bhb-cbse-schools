/**
 * Who may change whose permissions (Masters → Roles & permissions).
 *
 * Holding Settings · edit lets someone save the rbac desk, which carries
 * every person's roles and personal grants. Without a rule on top, an admin
 * could give themselves payroll, or take the fee counter away from the
 * principal. So (12 Oct 2026):
 *   - nobody changes their OWN assignments, personal grants or phone-app
 *     overrides — and nobody edits a role they hold;
 *   - the owner, principal and admin roles, the people holding them, and the
 *     protected super admins are changed only by a super admin or an owner.
 * The server applies this to every rbac desk save (desk-slice/rbac POST);
 * the screens only explain it.
 *
 * Pure: no I/O (rbacEditGuard is exercised by rbacEditorModel.selftest).
 */
import type { MastersState } from "@/lib/masters";
import {
  resolveSessionRoles,
  type RbacState,
  type SessionLike,
} from "@/lib/rbac";
import { isProtectedSuperAdminEmail } from "@/lib/superAdmin";

export const PROTECTED_ROLE_CODES = ["owner", "principal", "admin"] as const;

type Row = { id?: unknown; staffId?: unknown; roleId?: unknown } & Record<string, unknown>;

function stable(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as object).sort()) {
        const y = (x as Record<string, unknown>)[k];
        if (y !== undefined) o[k] = norm(y);
      }
      return o;
    }
    return x;
  };
  return JSON.stringify(norm(v ?? null));
}

function byId(v: unknown): Map<string, Row> {
  const m = new Map<string, Row>();
  if (!Array.isArray(v)) return m;
  for (const r of v) {
    if (r && typeof r === "object" && typeof (r as Row).id === "string") m.set((r as Row).id as string, r as Row);
  }
  return m;
}

/** Rows of one id'd slice that this save adds, changes or names as deleted. */
function changedRows(
  stored: unknown,
  incoming: unknown,
  inIncoming: boolean,
  named: readonly string[],
): Row[] {
  const before = byId(stored);
  const out: Row[] = [];
  if (inIncoming) {
    for (const [id, row] of byId(incoming)) {
      const prev = before.get(id);
      if (!prev || stable(prev) !== stable(row)) {
        out.push(row);
        if (prev) out.push(prev);
      }
    }
  }
  for (const id of named) {
    const prev = before.get(id);
    if (prev) out.push(prev);
  }
  return out;
}

export type RbacEditor = {
  session: SessionLike;
  /** The editor's own staff id, as resolved on the roster. */
  staffId: string;
};

/** Super admin, or anyone holding the owner role. */
export function isRbacSuperEditor(editor: RbacEditor, stored: RbacState, masters: MastersState | null): boolean {
  if (isProtectedSuperAdminEmail(editor.session.email)) return true;
  return resolveSessionRoles(stored, editor.session, masters).some((r) => r.code === "owner");
}

/** Does this person hold owner/principal/admin, or are they a protected super admin? */
export function isProtectedTarget(
  staffId: string,
  stored: RbacState,
  incoming: Partial<RbacState>,
  masters: MastersState | null,
): boolean {
  const staff = masters?.staff?.find((s) => s.id === staffId);
  if (staff && isProtectedSuperAdminEmail(staff.email)) return true;
  const protectedRoleIds = new Set(
    [...stored.roles, ...((incoming.roles as RbacState["roles"] | undefined) ?? [])]
      .filter((r) => (PROTECTED_ROLE_CODES as readonly string[]).includes(r.code))
      .map((r) => r.id),
  );
  const assigned = [...stored.assignments, ...((incoming.assignments as RbacState["assignments"] | undefined) ?? [])];
  if (assigned.some((a) => a.staffId === staffId && protectedRoleIds.has(a.roleId))) return true;
  if (staff) {
    const session: SessionLike = {
      roleCode: "",
      staffId: staff.id,
      fullName: staff.fullName,
      email: staff.email || "",
      persona: "staff",
    };
    return resolveSessionRoles(stored, session, masters).some((r) =>
      (PROTECTED_ROLE_CODES as readonly string[]).includes(r.code),
    );
  }
  return false;
}

/**
 * The refusal for this rbac desk save, or null when the editor may make it.
 *
 * @param stored   the saved rbac desk (normalised)
 * @param incoming the pushed desk (keys absent = not sent)
 * @param deletes  ids the save names as deleted, per slice
 */
export function rbacChangeRefusal(
  editor: RbacEditor,
  stored: RbacState,
  incoming: Partial<RbacState>,
  masters: MastersState | null,
  deletes: Record<string, readonly string[]> = {},
): string | null {
  const superEditor = isRbacSuperEditor(editor, stored, masters);
  const name = (staffId: string) => masters?.staff?.find((s) => s.id === staffId)?.fullName || staffId;

  // People whose assignments, personal grants or phone-app overrides change.
  const people = new Set<string>();
  for (const key of ["assignments", "userGrants"] as const) {
    for (const r of changedRows(stored[key], incoming[key], key in incoming, deletes[key] ?? [])) {
      if (typeof r.staffId === "string") people.add(r.staffId);
    }
  }
  if ("mobile" in incoming && incoming.mobile) {
    const before = new Map(stored.mobile.staffRules.map((r) => [r.staffId, stable(r)]));
    const after = new Map((incoming.mobile.staffRules ?? []).map((r) => [r.staffId, stable(r)]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(id) !== after.get(id)) people.add(id);
    }
  }

  // Roles whose definition (grants, functions, active, phone-app screens) changes.
  const roleCodes = new Set<string>();
  if ("roles" in incoming) {
    for (const r of changedRows(stored.roles, incoming.roles, true, deletes.roles ?? [])) {
      if (typeof r.code === "string") roleCodes.add(r.code);
    }
  } else if (deletes.roles?.length) {
    for (const r of changedRows(stored.roles, [], false, deletes.roles)) {
      if (typeof r.code === "string") roleCodes.add(r.code);
    }
  }
  if ("mobile" in incoming && incoming.mobile) {
    const before = stored.mobile.roleFeatures;
    const after = incoming.mobile.roleFeatures ?? {};
    for (const code of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (stable(before[code] ?? null) !== stable(after[code] ?? null)) roleCodes.add(code);
    }
  }

  if (superEditor) return null;

  if (editor.staffId && people.has(editor.staffId)) {
    return "You cannot change your own permissions — ask the principal or the director.";
  }
  for (const id of people) {
    if (isProtectedTarget(id, stored, incoming, masters)) {
      return `${name(id)} holds the owner, principal or admin role — only the director (owner) can change their permissions.`;
    }
  }
  const held = new Set(resolveSessionRoles(stored, editor.session, masters).map((r) => r.code));
  for (const code of roleCodes) {
    if ((PROTECTED_ROLE_CODES as readonly string[]).includes(code)) {
      return `Only the director (owner) can change the ${code} role.`;
    }
    if (held.has(code)) {
      return `You hold the ${code} role, so you cannot change it — ask the principal or the director.`;
    }
  }
  return null;
}
