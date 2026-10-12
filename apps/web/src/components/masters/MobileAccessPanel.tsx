"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
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
  hasPermission,
  removeUserGrant,
  resolveSessionRoles,
  setUserGrant,
  type RbacState,
} from "@/lib/rbac";
import { describePersonalRow } from "@/lib/rbacEditorModel";
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
  commit: commitRaw,
  actorName,
  editable = true,
}: {
  state: RbacState;
  masters: MastersState | null;
  commit: (next: RbacState, msg?: string) => void;
  /** Who is making the change — stamped on personal grants and the audit. */
  actorName?: string;
  /** False when the saved permissions could not be read — look, don't touch. */
  editable?: boolean;
}) {
  const commit = (next: RbacState, msg?: string) => {
    if (editable) commitRaw(next, msg);
  };
  const access = state.mobile ?? defaultMobileAccess();
  // Parent is listed so the office finds it where the old ERP had it; its
  // screens are the parent app's own and are not switched per role here.
  const roles = useMemo(() => state.roles.filter((r) => r.isActive), [state.roles]);
  const [roleCode, setRoleCode] = useState(
    () => roles.find((r) => r.code === "teacher")?.code || roles[0]?.code || "",
  );
  const [staffId, setStaffId] = useState("");

  const role = roles.find((r) => r.code === roleCode) || null;
  const isParentRole = roleCode === "parent";
  const saved = useMemo(() => new Set(access.roleFeatures[roleCode] ?? []), [access, roleCode]);
  // Ticks are staged and saved together, like the old ERP's Save button.
  const [roleDraft, setRoleDraft] = useState<Set<MobileFeatureId> | null>(null);
  const enabled = roleDraft ?? saved;
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(() => new Set());

  /** What this role's permission matrix allows — the ceiling for the grid. */
  const rolePerms = useMemo(() => {
    if (!role) return new Map<string, Set<string>>();
    return effectivePermissions([role]) as unknown as Map<string, Set<string>>;
  }, [role]);

  function roleAllows(f: MobileFeature): boolean {
    return !!rolePerms.get(f.module)?.has(f.action);
  }

  function pickRole(code: string) {
    if (roleDraft && !window.confirm("Discard the unsaved phone-app changes for this role?")) return;
    setRoleDraft(null);
    setRoleCode(code);
  }

  function setRoleFeatures(ids: MobileFeatureId[], on: boolean) {
    if (!editable || isParentRole) return;
    const next = new Set(enabled);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setRoleDraft(next);
  }

  function saveRoleFeatures() {
    if (!roleDraft || !role) return;
    const added = [...roleDraft].filter((f) => !saved.has(f));
    const removed = [...saved].filter((f) => !roleDraft.has(f));
    const name = (f: MobileFeatureId) => MOBILE_FEATURES.find((x) => x.id === f)?.label || f;
    commit(
      appendRbacAudit(
        { ...state, mobile: setRoleMobileFeatures(access, roleCode, [...roleDraft]) },
        actorName || "",
        "mobile.role",
        `${role.code}: ${added.length ? `+ ${added.map(name).join(", ")}` : ""}${added.length && removed.length ? " · " : ""}${removed.length ? `− ${removed.map(name).join(", ")}` : ""}`,
      ),
      `Phone app saved for ${role.name}`,
    );
    setRoleDraft(null);
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
    return {
      roleCodes: held.map((r) => r.code),
      ...resolveMobileFeatures({
        roleCodes: held.map((r) => r.code),
        staffId: staffMember.id,
        access,
        // The same check the app uses: roles, plus whatever the office gave
        // or took from this one person (personal deny > allow > roles).
        can: (m, a) => hasPermission(session, masters, m, a, state),
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
        `${staffMember.fullName}: ${describePersonalRow(g)}`,
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
  const q = query.trim().toLowerCase();
  const shownGroups = groups
    .map(([group, features]) => [
      group,
      q && !group.toLowerCase().includes(q)
        ? features.filter((f) => f.label.toLowerCase().includes(q) || f.note.toLowerCase().includes(q) || f.id.includes(q))
        : features,
    ] as const)
    .filter(([, features]) => features.length > 0);
  const modulesOn = groups.filter(([, fs]) => fs.some((f) => enabled.has(f.id))).length;

  return (
    <div className="space-y-4">
      <MastersWorkCard
        title="Phone app by role"
        hint="Which screens each role gets in the staff app. A screen also needs the module permission behind it — one that is missing is shown here, not hidden. Tick, then Save."
      >
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--muted)]">
            Role
            <select
              className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              value={roleCode}
              onChange={(e) => pickRole(e.target.value)}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[var(--muted)]" aria-hidden />
            <input
              type="search"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2 pl-8 pr-3 text-sm"
              placeholder="Search screens…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search phone-app screens"
            />
          </label>
          <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm" onClick={() => setClosed(new Set())}>
            Expand all
          </button>
          <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm" onClick={() => setClosed(new Set(groups.map(([g]) => g)))}>
            Collapse all
          </button>
          {roleDraft ? (
            <>
              <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm" onClick={() => setRoleDraft(null)}>
                Discard
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
                onClick={saveRoleFeatures}
              >
                Save
              </button>
            </>
          ) : null}
        </div>
        <p className="mb-3 flex flex-wrap gap-x-4 text-xs text-[var(--muted)]">
          <span>Total modules <strong className="text-[var(--foreground)]">{groups.length}</strong></span>
          <span>Enabled modules <strong className="text-[var(--foreground)]">{modulesOn}</strong></span>
          <span>Total features <strong className="text-[var(--foreground)]">{MOBILE_FEATURES.length}</strong></span>
          <span>Enabled features <strong className="text-[var(--foreground)]">{enabled.size}</strong></span>
        </p>

        {isParentRole ? (
          <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--muted)]">
            The parent app shows each family its own children&apos;s screens (fees, attendance, homework, notices,
            transport …). They are not switched on or off per role here; the screens below are the staff app&apos;s.
          </p>
        ) : null}

        <div className="space-y-3">
          {shownGroups.map(([group, features]) => {
            const open = q ? true : !closed.has(group);
            const on = features.filter((f) => enabled.has(f.id)).length;
            return (
              <div key={group} className="rounded-lg border border-[var(--border)]">
                <div className="flex flex-wrap items-center gap-2 bg-[var(--surface-sunken)] px-3 py-2">
                  <button
                    type="button"
                    className="flex-1 text-left text-xs font-semibold uppercase tracking-wide text-[var(--brand-deep)]"
                    onClick={() =>
                      setClosed((prev) => {
                        const next = new Set(prev);
                        if (next.has(group)) next.delete(group);
                        else next.add(group);
                        return next;
                      })
                    }
                    aria-expanded={open}
                  >
                    {open ? "▾" : "▸"} {group}
                    <span className="ml-2 font-normal normal-case text-[var(--muted)]">
                      {on}/{features.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[var(--primary)] disabled:opacity-50"
                    disabled={!editable || isParentRole}
                    onClick={() => setRoleFeatures(features.map((f) => f.id), true)}
                  >
                    Select all
                  </button>
                  <span className="text-[var(--muted)]">|</span>
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[var(--primary)] disabled:opacity-50"
                    disabled={!editable || isParentRole}
                    onClick={() => setRoleFeatures(features.map((f) => f.id), false)}
                  >
                    Clear all
                  </button>
                </div>
                {open ? (
                  <div className="grid gap-2 p-2 sm:grid-cols-2">
                    {features.map((f) => {
                      const isOn = enabled.has(f.id);
                      const allowed = roleAllows(f);
                      return (
                        <label
                          key={f.id}
                          className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2"
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={isOn}
                            disabled={!editable || isParentRole}
                            onChange={(e) => setRoleFeatures([f.id], e.target.checked)}
                          />
                          <span className="text-xs">
                            <span className="font-medium">{f.label}</span>
                            <span className="ml-1 font-mono text-[10px] text-[var(--muted)]">{f.id}</span>
                            <span className="block text-[var(--muted)]">{f.note}</span>
                            {isOn && !allowed ? (
                              <span className="mt-1 block text-[var(--danger)]">
                                Needs {f.module} · {f.action} in the role&apos;s permissions — switched on here but the
                                app will still refuse it.
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
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
                      <span className="font-medium">{describePersonalRow(g)}</span>
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
