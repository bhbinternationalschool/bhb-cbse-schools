"use client";

import { useMemo, useState } from "react";
import type { MastersState } from "@/lib/masters";
import {
  MOBILE_FEATURES,
  defaultMobileAccess,
  resolveMobileFeatures,
  setRoleMobileFeatures,
  setStaffMobileRule,
  type MobileFeature,
  type MobileFeatureId,
} from "@/lib/mobileFeatures";
import {
  appendRbacAudit,
  effectivePermissions,
  removeUserGrant,
  resolveSessionRoles,
  setUserGrant,
  type RbacState,
} from "@/lib/rbac";
import { MastersWorkCard } from "@/components/masters/MastersLayout";

/**
 * Masters → Roles → Mobile app.
 *
 * Two questions the office actually asks: "what does a teacher get on their
 * phone?" and "why can this one person not see the fee counter?". The first
 * is the role grid, the second the per-person overrides underneath it.
 *
 * Nothing here can widen access: a feature stays dark unless the role's
 * permission matrix already carries the module and action it needs, and the
 * grid says so in place rather than silently doing nothing.
 */
export function MobileAccessPanel({
  state,
  masters,
  commit,
  actorName,
}: {
  state: RbacState;
  masters: MastersState | null;
  commit: (next: RbacState, msg?: string) => void;
  /** Who is making the change — stamped on personal grants and the audit. */
  actorName?: string;
}) {
  const access = state.mobile ?? defaultMobileAccess();
  const roles = useMemo(
    () => state.roles.filter((r) => r.isActive && r.code !== "parent"),
    [state.roles],
  );
  const [roleCode, setRoleCode] = useState(
    () => roles.find((r) => r.code === "teacher")?.code || roles[0]?.code || "",
  );
  const [staffId, setStaffId] = useState("");

  const role = roles.find((r) => r.code === roleCode) || null;
  const enabled = new Set(access.roleFeatures[roleCode] ?? []);

  /** What this role's permission matrix allows — the ceiling for the grid. */
  const rolePerms = useMemo(() => {
    if (!role) return new Map<string, Set<string>>();
    return effectivePermissions([role]) as unknown as Map<string, Set<string>>;
  }, [role]);

  function roleAllows(f: MobileFeature): boolean {
    return !!rolePerms.get(f.module)?.has(f.action);
  }

  function toggleRoleFeature(id: MobileFeatureId, on: boolean) {
    const next = on
      ? [...enabled, id]
      : [...enabled].filter((x) => x !== id);
    commit(
      {
        ...state,
        mobile: setRoleMobileFeatures(access, roleCode, next as MobileFeatureId[]),
      },
      on ? "Feature switched on for this role" : "Feature switched off for this role",
    );
  }

  const activeStaff = useMemo(
    () => (masters?.staff ?? []).filter((s) => s.status === "active"),
    [masters],
  );
  const rule = access.staffRules.find((r) => r.staffId === staffId) || null;
  const staffMember = activeStaff.find((s) => s.id === staffId) || null;

  /** What that person ends up with, both gates applied — the honest answer. */
  const staffResolved = useMemo(() => {
    if (!staffMember || !masters) return null;
    const session = {
      roleCode: "",
      fullName: staffMember.fullName,
      email: staffMember.email || "",
      persona: "staff" as const,
      staffId: staffMember.id,
    };
    const held = resolveSessionRoles(state, session, masters);
    const perms = effectivePermissions(held) as unknown as Map<string, Set<string>>;
    // Whatever the office handed this one person counts too — that is the
    // whole point of a personal grant, and the preview has to say so.
    const personal = (state.userGrants ?? []).filter(
      (g) =>
        g.staffId === staffMember.id &&
        (!g.expiresOn || g.expiresOn >= new Date().toISOString().slice(0, 10)),
    );
    return {
      roleCodes: held.map((r) => r.code),
      ...resolveMobileFeatures({
        roleCodes: held.map((r) => r.code),
        staffId: staffMember.id,
        access,
        can: (m, a) =>
          !!perms.get(m)?.has(a) ||
          personal.some((g) => g.module === m && g.actions.includes(a)),
      }),
    };
  }, [staffMember, masters, state, access]);

  /** This person's live personal grants, newest first. */
  const personalGrants = useMemo(() => {
    if (!staffId) return [];
    return (state.userGrants ?? [])
      .filter((g) => g.staffId === staffId)
      .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
  }, [state.userGrants, staffId]);

  /**
   * Give one person the module permission a feature needs, without moving the
   * role. This is how a single teacher ends up on the fee counter while the
   * rest of the staff room does not.
   */
  function grantForFeature(f: MobileFeature) {
    if (!staffId || !staffMember) return;
    const existing = personalGrants.find((g) => g.module === f.module);
    const actions = [...new Set([...(existing?.actions ?? []), f.action])];
    const withGrant = setUserGrant(state, {
      staffId,
      module: f.module,
      actions,
      note: `For the ${f.label} feature in the staff app`,
      grantedBy: actorName || "",
    });
    commit(
      appendRbacAudit(
        withGrant,
        actorName || "",
        "user.grant",
        `${staffMember.fullName}: ${f.module} · ${actions.join(", ")} (${f.label})`,
      ),
      `${staffMember.fullName} can now ${f.action} ${f.module}`,
    );
  }

  function dropGrant(id: string) {
    const g = personalGrants.find((x) => x.id === id);
    if (!g || !staffMember) return;
    commit(
      appendRbacAudit(
        removeUserGrant(state, id),
        actorName || "",
        "user.grant.remove",
        `${staffMember.fullName}: ${g.module} · ${g.actions.join(", ")}`,
      ),
      "Personal permission removed",
    );
  }

  function setPersonal(id: MobileFeatureId, mode: "role" | "allow" | "deny") {
    if (!staffId) return;
    const base = rule ?? { staffId, allow: [], deny: [], note: "" };
    const allow = base.allow.filter((x) => x !== id);
    const deny = base.deny.filter((x) => x !== id);
    if (mode === "allow") allow.push(id);
    if (mode === "deny") deny.push(id);
    commit(
      { ...state, mobile: setStaffMobileRule(access, { ...base, allow, deny }) },
      "Saved for this person",
    );
  }

  const groups = useMemo(() => {
    const out = new Map<string, MobileFeature[]>();
    for (const f of MOBILE_FEATURES) {
      const list = out.get(f.group) ?? [];
      list.push(f);
      out.set(f.group, list);
    }
    return [...out.entries()];
  }, []);

  return (
    <div className="space-y-4">
      <MastersWorkCard
        title="Mobile app by role"
        hint="What each role sees in the staff app. A feature also needs the module permission above — one that is missing is shown here, not hidden."
      >
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--muted)]">
            Role
            <select
              className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              value={roleCode}
              onChange={(e) => setRoleCode(e.target.value)}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-[var(--muted)]">
            {enabled.size} of {MOBILE_FEATURES.length} features on
          </p>
        </div>

        <div className="space-y-4">
          {groups.map(([group, features]) => (
            <div key={group}>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {group}
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {features.map((f) => {
                  const on = enabled.has(f.id);
                  const allowed = roleAllows(f);
                  return (
                    <label
                      key={f.id}
                      className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={on}
                        onChange={(e) => toggleRoleFeature(f.id, e.target.checked)}
                      />
                      <span className="text-xs">
                        <span className="font-medium">{f.label}</span>
                        <span className="block text-[var(--muted)]">{f.note}</span>
                        {on && !allowed ? (
                          <span className="mt-1 block text-[var(--danger,#b42318)]">
                            Needs {f.module} · {f.action} in the permission matrix —
                            switched on here but the app will still refuse it.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </MastersWorkCard>

      <MastersWorkCard
        title="One person"
        hint="Give a feature to somebody their role does not cover, or take it away without touching the role."
      >
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--muted)]">
            Staff member
            <select
              className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
            >
              <option value="">Select…</option>
              {activeStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                  {s.empCode ? ` · ${s.empCode}` : ""}
                </option>
              ))}
            </select>
          </label>
          {staffResolved ? (
            <p className="text-xs text-[var(--muted)]">
              Roles: {staffResolved.roleCodes.join(", ") || "none"} ·{" "}
              {staffResolved.features.length} features on the phone
              {staffResolved.blockedByRbac.length
                ? ` · ${staffResolved.blockedByRbac.length} blocked by permissions`
                : ""}
            </p>
          ) : null}
        </div>

        {staffId ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {MOBILE_FEATURES.map((f) => {
              const mode = rule?.deny.includes(f.id)
                ? "deny"
                : rule?.allow.includes(f.id)
                  ? "allow"
                  : "role";
              const effective = staffResolved?.features.includes(f.id);
              const blocked = staffResolved?.blockedByRbac.includes(f.id);
              return (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2"
                >
                  <span className="text-xs">
                    <span className="font-medium">{f.label}</span>
                    <span className="block text-[var(--muted)]">
                      {blocked
                        ? `Blocked — role lacks ${f.module} · ${f.action}`
                        : effective
                          ? "On for this person"
                          : "Off"}
                    </span>
                  </span>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <select
                      className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
                      value={mode}
                      onChange={(e) =>
                        setPersonal(f.id, e.target.value as "role" | "allow" | "deny")
                      }
                    >
                      <option value="role">Follow role</option>
                      <option value="allow">Always on</option>
                      <option value="deny">Always off</option>
                    </select>
                    {blocked ? (
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--muted-bg,rgba(0,0,0,0.04))]"
                        onClick={() => grantForFeature(f)}
                      >
                        Grant {f.module} · {f.action}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">
            Pick somebody to see what their phone shows today.
          </p>
        )}

        {staffId && personalGrants.length > 0 ? (
          <div className="mt-4 rounded-lg border border-[var(--border)] p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Permissions given to this person alone
            </h4>
            <ul className="space-y-1">
              {personalGrants.map((g) => {
                const expired =
                  !!g.expiresOn &&
                  g.expiresOn < new Date().toISOString().slice(0, 10);
                return (
                  <li
                    key={g.id}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span>
                      <span className="font-medium">
                        {g.module} · {g.actions.join(", ")}
                      </span>
                      <span className="block text-[var(--muted)]">
                        {g.note || "No note"}
                        {g.grantedBy ? ` · by ${g.grantedBy}` : ""}
                        {g.expiresOn
                          ? expired
                            ? ` · expired ${g.expiresOn}`
                            : ` · until ${g.expiresOn}`
                          : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px]"
                      onClick={() => dropGrant(g.id)}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </MastersWorkCard>
    </div>
  );
}
