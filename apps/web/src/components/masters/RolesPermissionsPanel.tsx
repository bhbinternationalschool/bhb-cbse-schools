"use client";

import { useEffect, useMemo, useState } from "react";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  appendRbacAudit,
  canConfigureRbac,
  cloneRole,
  defaultBuiltInRoles,
  loadRbac,
  newRbacId,
  principalAccessSummary,
  roleHasAction,
  saveRbac,
  setRolePermission,
  staffAccessOverview,
  RBAC_ACTIONS,
  RBAC_MODULES,
  type RbacAction,
  type RbacModule,
  type RbacRole,
  type RbacState,
  type UserRoleAssignment,
} from "@/lib/rbac";
import { useDemoSession } from "@/components/shell/SessionContext";
import { isSuperAdminSession } from "@/lib/superAdmin";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersTablesRow,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";

type RbacTab = "matrix" | "roles" | "assignments" | "summary" | "audit";

function emptyScope() {
  return {
    campusIds: [] as string[],
    classIds: [] as string[],
    departmentIds: [] as string[],
  };
}

export function RolesPermissionsPanel() {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [state, setState] = useState<RbacState | null>(null);
  const [tab, setTab] = useState<RbacTab>("matrix");
  const [notice, setNotice] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string>("");
  const [cloneCode, setCloneCode] = useState("");
  const [cloneName, setCloneName] = useState("");

  const [assignStaffId, setAssignStaffId] = useState("");
  const [assignRoleId, setAssignRoleId] = useState("");
  const [assignExpires, setAssignExpires] = useState("");
  const [assignNote, setAssignNote] = useState("");

  useEffect(() => {
    const m = loadMasters();
    const r = loadRbac();
    setMasters(m);
    setState(r);
    setRoleId(
      r.roles.find((x) => x.code === "principal")?.id || r.roles[0]?.id || "",
    );
    setAssignRoleId(
      r.roles.find((x) => x.code === "teacher")?.id || r.roles[0]?.id || "",
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const { ensureRbacHydrated } = await import("@/lib/rbacPersistence");
      await ensureRbacHydrated();
      const r = loadRbac();
      setState(r);
    })();
  }, []);

  const allowed = useMemo(() => {
    if (!masters || !state) return false;
    return canConfigureRbac(session, masters, state);
  }, [masters, session, state]);

  const selected = useMemo(
    () => state?.roles.find((r) => r.id === roleId) ?? null,
    [state, roleId],
  );

  const summary = useMemo(
    () => (state ? principalAccessSummary(state) : []),
    [state],
  );

  const staffRows = useMemo(
    () => (state && masters ? staffAccessOverview(state, masters) : []),
    [state, masters],
  );

  function commit(next: RbacState, msg?: string) {
    setState(next);
    saveRbac(next);
    if (msg) {
      setNotice(msg);
      window.setTimeout(() => setNotice(null), 2800);
    }
  }

  function toggle(module: RbacModule, action: RbacAction, enabled: boolean) {
    if (!state || !selected) return;
    commit(
      setRolePermission(
        state,
        selected.id,
        module,
        action,
        enabled,
        session.fullName,
      ),
    );
  }

  function runClone() {
    if (!state || !selected) return;
    const r = cloneRole(
      state,
      selected.id,
      cloneCode,
      cloneName,
      session.fullName,
    );
    if (!r.ok) {
      setNotice(r.reason);
      return;
    }
    commit(r.state, `Cloned role ${r.role.name}`);
    setRoleId(r.role.id);
    setCloneCode("");
    setCloneName("");
  }

  function resetBuiltIns() {
    if (!state) return;
    if (
      !window.confirm(
        "Reset built-in roles to defaults? Custom roles and assignments are kept.",
      )
    ) {
      return;
    }
    const builtins = defaultBuiltInRoles();
    const custom = state.roles.filter((r) => !r.isBuiltIn);
    const merged = [
      ...builtins.map((b) => {
        const prev = state.roles.find((r) => r.code === b.code && r.isBuiltIn);
        return prev ? { ...b, id: prev.id } : b;
      }),
      ...custom,
    ];
    commit(
      appendRbacAudit(
        { ...state, roles: merged },
        session.fullName,
        "reset_builtins",
        "Restored built-in permission templates",
      ),
      "Built-in roles reset",
    );
  }

  function addAssignment() {
    if (!state || !assignStaffId || !assignRoleId) {
      setNotice("Pick staff and role");
      return;
    }
    const row: UserRoleAssignment = {
      id: newRbacId("ura"),
      staffId: assignStaffId,
      roleId: assignRoleId,
      isPrimary: !state.assignments.some((a) => a.staffId === assignStaffId),
      scope: emptyScope(),
      expiresOn: assignExpires.slice(0, 10),
      note: assignNote.trim(),
    };
    const staffName =
      masters?.staff?.find((s) => s.id === assignStaffId)?.fullName ||
      assignStaffId;
    const roleName =
      state.roles.find((r) => r.id === assignRoleId)?.name || assignRoleId;
    commit(
      appendRbacAudit(
        { ...state, assignments: [...state.assignments, row] },
        session.fullName,
        "assign_role",
        `${staffName} → ${roleName}${row.expiresOn ? ` (until ${row.expiresOn})` : ""}`,
      ),
      "Role assigned",
    );
    setAssignNote("");
    setAssignExpires("");
  }

  function removeAssignment(id: string) {
    if (!state) return;
    const a = state.assignments.find((x) => x.id === id);
    commit(
      appendRbacAudit(
        {
          ...state,
          assignments: state.assignments.filter((x) => x.id !== id),
        },
        session.fullName,
        "unassign_role",
        a ? `${a.staffId} / ${a.roleId}` : id,
      ),
      "Assignment removed",
    );
  }

  function setRoleActive(role: RbacRole, isActive: boolean) {
    if (!state) return;
    if (role.isBuiltIn && !isActive && role.code === "principal") {
      setNotice("Cannot deactivate Principal built-in");
      return;
    }
    commit(
      appendRbacAudit(
        {
          ...state,
          roles: state.roles.map((r) =>
            r.id === role.id ? { ...r, isActive } : r,
          ),
        },
        session.fullName,
        isActive ? "activate_role" : "deactivate_role",
        role.code,
      ),
    );
  }

  if (!state || !masters) {
    return <p className="text-sm text-[var(--muted)]">Loading roles…</p>;
  }

  if (!allowed) {
    return (
      <p className="rounded-xl border border-[rgba(180,35,24,0.25)] bg-[rgba(180,35,24,0.06)] px-4 py-3 text-sm text-[var(--brand-deep)]">
        Roles &amp; permissions are Super Admin / Principal / Admin only.
      </p>
    );
  }

  const activeStaff = (masters.staff ?? []).filter((s) => s.status === "active");

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-4 py-3 text-sm text-[var(--muted)]">
        {isSuperAdminSession(session) ? (
          <>
            <strong>Super admin</strong> — assign roles to staff (Principal,
            Admin, Teacher, Accounts, etc.) under Assignments, or edit the
            permission matrix per role.
          </>
        ) : (
          <>
            Module × action matrix with optional expiry on staff assignments.
            Accounts never see payroll by default. Multi-role staff get a
            permission union.
          </>
        )}
      </p>
      {notice ? (
        <p className="text-sm font-medium text-[var(--brand-deep)]">{notice}</p>
      ) : null}

      <ModuleTabs
        aria-label="Roles and permissions"
        value={tab}
        onChange={(id) => setTab(id as RbacTab)}
        items={[
          { id: "matrix", label: "Permission matrix", tone: "navy" },
          { id: "roles", label: "Roles", tone: "teal" },
          { id: "assignments", label: "Assignments", tone: "violet" },
          { id: "summary", label: "Access summary", tone: "amber" },
          { id: "audit", label: "Audit", tone: "slate" },
        ]}
      />

      {tab === "matrix" ? (
        <MastersWorkCard
          title="Permission matrix"
          hint="Select a role, then toggle module × action cells."
        >
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Role
              </span>
              <select
                className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
              >
                {state.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                    {!r.isActive ? " — inactive" : ""}
                  </option>
                ))}
              </select>
            </label>
            {selected ? (
              <p className="text-[11px] text-[var(--muted)]">
                {selected.note || (selected.isBuiltIn ? "Built-in" : "Custom")}
                {selected.makerChecker ? " · Maker-checker on" : ""}
              </p>
            ) : null}
          </div>
          {selected ? (
            <div className="overflow-x-auto rounded-lg border border-[rgba(32,48,80,0.1)]">
              <table className="min-w-full text-left text-[11px]">
                <thead className="bg-[rgba(32,48,80,0.04)] text-[var(--muted)]">
                  <tr>
                    <th className="px-2 py-2 font-semibold">Module</th>
                    {RBAC_ACTIONS.map((a) => (
                      <th
                        key={a.id}
                        className="px-1 py-2 text-center font-semibold"
                        title={a.label}
                      >
                        {a.label.slice(0, 3)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RBAC_MODULES.map((m) => (
                    <tr
                      key={m.id}
                      className="border-t border-[rgba(32,48,80,0.06)]"
                    >
                      <td className="px-2 py-1.5 font-medium text-[var(--brand-deep)]">
                        {m.label}
                      </td>
                      {RBAC_ACTIONS.map((a) => {
                        const on = roleHasAction(selected, m.id, a.id);
                        return (
                          <td key={a.id} className="px-1 py-1 text-center">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(e) =>
                                toggle(m.id, a.id, e.target.checked)
                              }
                              aria-label={`${m.label} ${a.label}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </MastersWorkCard>
      ) : null}

      {tab === "roles" ? (
        <div className="space-y-4">
          <MastersWorkCard
            title="Clone role"
            hint="Create a custom role from a template."
          >
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
              >
                {state.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input
                className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-2 text-sm"
                placeholder="new_code"
                value={cloneCode}
                onChange={(e) => setCloneCode(e.target.value)}
              />
              <input
                className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-2 text-sm"
                placeholder="Display name"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
              />
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-sm font-semibold text-white"
                onClick={runClone}
              >
                Clone
              </button>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-2 text-sm"
                onClick={resetBuiltIns}
              >
                Reset built-ins
              </button>
            </div>
          </MastersWorkCard>
          <MastersTableCard title="Roles">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[11px] text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Active</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {state.roles.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-[rgba(32,48,80,0.06)]"
                  >
                    <td className="px-3 py-2 font-mono text-[12px]">{r.code}</td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-[11px] text-[var(--muted)]">
                      {r.isBuiltIn ? "Built-in" : "Custom"}
                      {r.makerChecker ? " · MC" : ""}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={r.isActive}
                        onChange={(e) => setRoleActive(r, e.target.checked)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                        onClick={() => {
                          setRoleId(r.id);
                          setTab("matrix");
                        }}
                      >
                        Matrix →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </MastersTableCard>
        </div>
      ) : null}

      {tab === "assignments" ? (
        <div className="space-y-4">
          <MastersWorkCard
            title="Assign role"
            hint="Multi-role staff union permissions. Optional expiry for substitutes."
          >
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
                value={assignStaffId}
                onChange={(e) => setAssignStaffId(e.target.value)}
              >
                <option value="">Staff…</option>
                {activeStaff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.empCode} — {s.fullName}
                  </option>
                ))}
              </select>
              <select
                className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
                value={assignRoleId}
                onChange={(e) => setAssignRoleId(e.target.value)}
              >
                {state.roles
                  .filter((r) => r.isActive)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
              <input
                type="date"
                className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-2 text-sm"
                value={assignExpires}
                onChange={(e) => setAssignExpires(e.target.value)}
                title="Expires on"
              />
              <input
                className="min-w-[10rem] flex-1 rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-2 text-sm"
                placeholder="Note (e.g. substitute XI-A)"
                value={assignNote}
                onChange={(e) => setAssignNote(e.target.value)}
              />
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-sm font-semibold text-white"
                onClick={addAssignment}
              >
                Assign
              </button>
            </div>
          </MastersWorkCard>
          <MastersTableCard title="Assignments">
            {state.assignments.length === 0 ? (
              <MastersEmptyRow label="No explicit assignments — roles inferred from designation / login." />
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead className="text-[11px] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2">Staff</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Expires</th>
                    <th className="px-3 py-2">Note</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {state.assignments.map((a) => {
                    const staff = masters.staff?.find((s) => s.id === a.staffId);
                    const role = state.roles.find((r) => r.id === a.roleId);
                    return (
                      <tr
                        key={a.id}
                        className="border-t border-[rgba(32,48,80,0.06)]"
                      >
                        <td className="px-3 py-2">
                          {staff?.fullName || a.staffId}
                          <span className="ml-1 text-[11px] text-[var(--muted)]">
                            {staff?.empCode}
                          </span>
                        </td>
                        <td className="px-3 py-2">{role?.name || a.roleId}</td>
                        <td className="px-3 py-2 text-[12px]">
                          {a.expiresOn || "—"}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-[var(--muted)]">
                          {a.note || "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="text-xs font-medium text-[var(--danger)]"
                            onClick={() => removeAssignment(a.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </MastersTableCard>
        </div>
      ) : null}

      {tab === "summary" ? (
        <MastersTablesRow>
          <MastersTableCard title="Principal access summary">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[11px] text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">Capability</th>
                  <th className="px-3 py-2">Roles with access</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr
                    key={row.capability}
                    className="border-t border-[rgba(32,48,80,0.06)]"
                  >
                    <td className="px-3 py-2">{row.capability}</td>
                    <td className="px-3 py-2 text-[12px] text-[var(--muted)]">
                      {row.roleNames.length
                        ? row.roleNames.join(", ")
                        : "None"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </MastersTableCard>
          <MastersTableCard title="Staff with explicit roles">
            {staffRows.length === 0 ? (
              <MastersEmptyRow label="No assignment overrides yet." />
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead className="text-[11px] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2">Staff</th>
                    <th className="px-3 py-2">Roles</th>
                  </tr>
                </thead>
                <tbody>
                  {staffRows.map((r) => (
                    <tr
                      key={r.staffId}
                      className="border-t border-[rgba(32,48,80,0.06)]"
                    >
                      <td className="px-3 py-2">
                        {r.staffName}
                        {r.expiresSoon ? (
                          <span className="ml-2 text-[10px] font-semibold text-[#b42318]">
                            expires soon
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-[var(--muted)]">
                        {r.roles.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </MastersTableCard>
        </MastersTablesRow>
      ) : null}

      {tab === "audit" ? (
        <MastersTableCard title="Permission change audit">
          {state.audit.length === 0 ? (
            <MastersEmptyRow label="No RBAC changes logged yet." />
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="text-[11px] text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Who</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {state.audit.map((e) => (
                  <tr
                    key={e.id}
                    className="border-t border-[rgba(32,48,80,0.06)]"
                  >
                    <td className="px-3 py-2 text-[11px] text-[var(--muted)]">
                      {e.at.slice(0, 19).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2">{e.by}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">
                      {e.action}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-[var(--muted)]">
                      {e.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MastersTableCard>
      ) : null}
    </div>
  );
}
