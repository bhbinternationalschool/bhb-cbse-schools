"use client";

import { useMemo, useState } from "react";
import type { MastersState } from "@/lib/masters";
import type { StaffRecord } from "@/lib/foundationMasters";
import {
  appendRbacAudit,
  removeUserGrant,
  resolveSessionRoles,
  type RbacRole,
  type RbacState,
  type SessionLike,
} from "@/lib/rbac";
import {
  buildPermissionTree,
  copyStaffPermissions,
  describePersonalRow,
  effectiveDiff,
  leafLabel,
  livePersonalRows,
  personalRowChanges,
  staffLeafState,
  setStaffLeaves,
  type TreeLeaf,
} from "@/lib/rbacEditorModel";
import { newRbacId } from "@/lib/rbac";
import { MastersTableCard, MastersWorkCard } from "@/components/masters/MastersLayout";
import { RbacPermissionTree, TreeButton, type LeafView } from "@/components/masters/RbacPermissionTree";
import { RbacChangePreview } from "@/components/masters/RbacChangePreview";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";

function staffSession(s: StaffRecord): SessionLike {
  return { roleCode: "", staffId: s.id, fullName: s.fullName, email: s.email || "", persona: "staff" };
}

type Preview = {
  title: string;
  gained: string[];
  lost: string[];
  notes: React.ReactNode;
  confirmLabel: string;
  apply: () => void;
};

/**
 * Masters → Roles & permissions → Assign to user — the old ERP's main
 * screen. Pick a person; see what they can do, where each tick comes from
 * (their roles, a grant to them alone, or a deny for them alone), change
 * it, review the difference, save. Changes are personal rows on top of the
 * roles: the role itself is edited under Role permissions.
 */
export function RbacAssignToUser({
  state,
  masters,
  editable,
  actorName,
  commit,
}: {
  state: RbacState;
  masters: MastersState;
  editable: boolean;
  actorName: string;
  commit: (next: RbacState, msg?: string) => void;
}) {
  const tree = useMemo(() => buildPermissionTree(), []);
  const staff = useMemo(
    () =>
      (masters.staff ?? [])
        .filter((s) => s.status === "active")
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [masters.staff],
  );
  const [staffId, setStaffId] = useState("");
  const [draft, setDraft] = useState<RbacState | null>(null);
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [copyFrom, setCopyFrom] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  const person = staff.find((s) => s.id === staffId) ?? null;
  const working = draft ?? state;
  const today = new Date().toISOString().slice(0, 10);

  function rolesIn(s: RbacState, who: StaffRecord): RbacRole[] {
    return resolveSessionRoles(s, staffSession(who), masters);
  }
  function evaluator(s: RbacState, who: StaffRecord) {
    const roles = rolesIn(s, who);
    const personal = livePersonalRows(s.userGrants ?? [], who.id, today);
    return (leaf: TreeLeaf) => staffLeafState(roles, personal, leaf);
  }

  const roles = person ? rolesIn(working, person) : [];
  const explicit = person
    ? working.assignments.filter((a) => a.staffId === person.id && (!a.expiresOn || a.expiresOn >= today))
    : [];
  const evalLeaf = person ? evaluator(working, person) : null;

  const view = (leaf: TreeLeaf): LeafView => {
    if (!evalLeaf) return { on: false, disabled: true };
    const st = evalLeaf(leaf);
    if (st.personalDeny) {
      return {
        on: false,
        source: "deny",
        title: `Taken away from this person${st.denyIsModuleWide ? " for the whole module" : ""}${
          st.roleSources.length ? ` (their ${st.roleSources.join(", ")} role would allow it)` : ""
        }`,
      };
    }
    if (st.roleSources.length) {
      return {
        on: true,
        source: "role",
        title: `From ${st.roleSources.join(", ")} role${st.roleSources.length > 1 ? "s" : ""}${
          st.viaWholeModule && leaf.kind === "feature" ? " (whole module)" : ""
        } — untick to take it away from this person only`,
      };
    }
    if (st.personalAllow) return { on: true, source: "personal", title: "Given to this person alone" };
    return { on: false };
  };

  function setLeaves(leaves: TreeLeaf[], on: boolean) {
    if (!editable || !person) return;
    const r = setStaffLeaves(working, roles, person.id, leaves, on, {
      grantedBy: actorName,
      ...(reason.trim() ? { note: reason.trim() } : {}),
      ...(expires ? { expiresOn: expires } : {}),
    });
    setDraft(r.state);
    setNotice(
      r.blocked
        ? `${r.blocked} tick${r.blocked === 1 ? "" : "s"} not changed — denied for the whole module; clear the module's own tick first.`
        : null,
    );
  }

  function pickStaff(id: string) {
    if (draft && !window.confirm("Discard the unsaved changes for this person?")) return;
    setDraft(null);
    setStaffId(id);
    setCopyFrom("");
    setNotice(null);
  }

  function reviewSave() {
    if (!draft || !person) return;
    const diff = effectiveDiff(tree, (l) => evaluator(state, person)(l).on, (l) => evaluator(draft, person)(l).on);
    const rows = personalRowChanges(state, draft, person.id);
    const lines = [
      ...rows.added.map((g) => `New: ${describePersonalRow(g)}`),
      ...rows.changed.map((g) => `Changed: ${describePersonalRow(g)}`),
      ...rows.removed.map((g) => `Removed: ${describePersonalRow(g)}`),
    ];
    setPreview({
      title: `Save permissions for ${person.fullName}`,
      gained: diff.gained.map((l) => leafLabel(tree, l)),
      lost: diff.lost.map((l) => leafLabel(tree, l)),
      notes: lines.length ? (
        <>
          <p className="font-semibold">Personal rows</p>
          <ul className="list-disc pl-5 text-[var(--muted)]">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      ) : null,
      confirmLabel: "Save permissions",
      apply: () => {
        const detail = `${person.fullName}: +${diff.gained.length} / −${diff.lost.length}; ${lines.slice(0, 12).join("; ")}${lines.length > 12 ? "; …" : ""}`;
        commit(appendRbacAudit(draft, actorName, "user.permissions", detail), `Saved permissions for ${person.fullName}`);
        setDraft(null);
      },
    });
  }

  function reviewCopy() {
    if (!person || !copyFrom) return;
    const src = staff.find((s) => s.id === copyFrom);
    if (!src) return;
    if (draft && !window.confirm("Copying replaces the unsaved changes for this person. Continue?")) return;
    const srcExplicit = state.assignments.some(
      (a) => a.staffId === src.id && (!a.expiresOn || a.expiresOn >= today),
    );
    const srcRoles = rolesIn(state, src);
    const r = copyStaffPermissions(state, {
      fromStaffId: src.id,
      toStaffId: person.id,
      sourceRoleIds: srcRoles.map((x) => x.id),
      fromLabel: `${src.fullName} (${src.empCode})`,
      toLabel: `${person.fullName} (${person.empCode})`,
      by: actorName,
      newId: newRbacId,
    });
    if (!r.ok) {
      setNotice(r.reason);
      return;
    }
    const diff = effectiveDiff(tree, (l) => evaluator(state, person)(l).on, (l) => evaluator(r.state, person)(l).on);
    const before = rolesIn(state, person).map((x) => x.name);
    const after = r.roleIds.map((id) => state.roles.find((x) => x.id === id)?.name || id);
    setPreview({
      title: `Copy ${src.fullName}'s permissions to ${person.fullName}`,
      gained: diff.gained.map((l) => leafLabel(tree, l)),
      lost: diff.lost.map((l) => leafLabel(tree, l)),
      notes: (
        <>
          <p>
            Roles: <strong>{before.join(", ") || "none"}</strong> → <strong>{after.join(", ") || "none"}</strong>
          </p>
          {!srcExplicit ? (
            <p className="text-[var(--muted)]">
              {src.fullName} has no role assigned by name — their roles come from the designation. {person.fullName} gets
              them as assigned roles.
            </p>
          ) : null}
          <p className="text-[var(--muted)]">
            Personal rows: {r.rowsCopied} copied, {r.rowsReplaced} of {person.fullName}&apos;s replaced
            {r.mobileRuleCopied ? " · phone-app overrides copied" : ""}.
          </p>
        </>
      ),
      confirmLabel: "Copy and save",
      apply: () => {
        commit(r.state, `Copied ${src.fullName}'s permissions to ${person.fullName}`);
        setDraft(null);
        setCopyFrom("");
      },
    });
  }

  const personalRows = person
    ? (working.userGrants ?? [])
        .filter((g) => g.staffId === person.id)
        .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt))
    : [];

  function dropRow(id: string) {
    if (!editable) return;
    setDraft(removeUserGrant(working, id));
  }
  function setRowExpiry(id: string) {
    if (!editable) return;
    const row = working.userGrants.find((g) => g.id === id);
    if (!row) return;
    const v = window.prompt("Expires on (YYYY-MM-DD) — leave empty for no expiry", row.expiresOn || "");
    if (v === null) return;
    const clean = v.trim();
    if (clean && !/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      setNotice("Use a date like 2026-12-31.");
      return;
    }
    setDraft({
      ...working,
      userGrants: working.userGrants.map((g) => (g.id === id ? { ...g, expiresOn: clean } : g)),
    });
  }

  if (staff.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3 text-sm text-[var(--muted)]">
        The staff list has not loaded in this browser yet, so nobody can be picked. Reload the page; if it stays
        empty, the staff roster could not be read.
      </p>
    );
  }

  const designation = person ? masters.designations.find((d) => d.id === person.designationId)?.name : "";
  const department = person ? masters.departments.find((d) => d.id === person.departmentId)?.name : "";

  return (
    <div className="space-y-4">
      <MastersWorkCard
        title="Assign to user"
        hint="Pick a staff member. Ticks with a lock come from their roles; green ones were given to them alone; red ones were taken away from them alone. Change ticks, then Review & save."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Staff member</span>
            <select
              className="min-w-[16rem] rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              value={staffId}
              onChange={(e) => pickStaff(e.target.value)}
            >
              <option value="">Select staff…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} — {s.empCode}
                </option>
              ))}
            </select>
          </label>
          {person ? (
            <>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Copy permissions from</span>
                <select
                  className="min-w-[14rem] rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                  value={copyFrom}
                  onChange={(e) => setCopyFrom(e.target.value)}
                  disabled={!editable}
                >
                  <option value="">Another staff member…</option>
                  {staff
                    .filter((s) => s.id !== person.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} — {s.empCode}
                      </option>
                    ))}
                </select>
              </label>
              <TreeButton onClick={reviewCopy} disabled={!editable || !copyFrom}>
                Preview copy
              </TreeButton>
            </>
          ) : null}
        </div>

        {person ? (
          <div className="mt-4 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Name" value={`${person.fullName} (${person.empCode})`} />
            <Fact label="Designation" value={designation || "—"} />
            <Fact label="Department" value={department || "—"} />
            <div>
              <p className="text-[11px] text-[var(--muted)]">Roles</p>
              <p className="font-medium">
                {roles.length ? roles.map((r) => r.name).join(", ") : "None"}
              </p>
              <p className="text-[11px] text-[var(--muted)]">
                {explicit.length
                  ? "Assigned by name (Assignments tab)"
                  : "From the designation — assign a role by name to change it"}
              </p>
            </div>
          </div>
        ) : null}
      </MastersWorkCard>

      {person ? (
        <MastersWorkCard
          title={`What ${person.fullName} can do`}
          hint="Unticking a role tick takes it away from this person only (a personal deny). Ticking something their roles do not give is a personal grant. A function denied here also closes its tabs and its own API routes; to take a whole screen away, untick the module's “Whole module” row."
        >
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="min-w-[14rem] flex-1 text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Reason (saved on new ticks)</span>
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                placeholder="e.g. Runs the fee counter on Saturdays"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={!editable}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Expires on (optional)</span>
              <input
                type="date"
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                disabled={!editable}
              />
            </label>
          </div>
          {notice ? <p className="mb-2 text-sm font-medium text-[var(--danger)]">{notice}</p> : null}
          <RbacPermissionTree
            tree={tree}
            view={view}
            onSet={setLeaves}
            readOnly={!editable}
            toolbarExtra={
              draft ? (
                <>
                  <TreeButton onClick={() => setDraft(null)}>Discard</TreeButton>
                  <TreeButton onClick={reviewSave} primary>
                    Review &amp; save
                  </TreeButton>
                </>
              ) : null
            }
          />
        </MastersWorkCard>
      ) : null}

      {person ? (
        <MastersTableCard title={`Given to or taken from ${person.fullName} alone`}>
          {personalRows.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">
              Nothing — {person.fullName} has exactly what their roles give.
            </div>
          ) : (
            <ErpTable>
              <ErpTableHead>
                <tr>
                  <th className="px-3 py-2">Permission</th>
                  <th className="px-3 py-2">Why</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2" />
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {personalRows.map((g) => {
                  const lapsed = !!g.expiresOn && g.expiresOn < today;
                  return (
                    <tr key={g.id}>
                      <td className={`px-3 py-2 text-[12px] ${g.effect === "deny" ? "text-[var(--danger)]" : ""}`}>
                        {describePersonalRow(g)}
                        {lapsed ? (
                          <span className="ml-2 text-[10px] font-semibold text-[var(--muted)]">expired</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-[var(--muted)]">{g.note || "—"}</td>
                      <td className="px-3 py-2 text-[12px] text-[var(--muted)]">{g.grantedBy || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <RowActionMenu
                          row={g}
                          label="Personal permission actions"
                          actions={[
                            { id: "expiry", label: "Change expiry…", onSelect: (x) => setRowExpiry(x.id) },
                            {
                              id: "remove",
                              label: "Remove (back to what the roles give)",
                              tone: "danger",
                              separatorAbove: true,
                              onSelect: (x) => dropRow(x.id),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </ErpTableBody>
            </ErpTable>
          )}
        </MastersTableCard>
      ) : null}

      {preview ? (
        <RbacChangePreview
          title={preview.title}
          gained={preview.gained}
          lost={preview.lost}
          notes={preview.notes}
          confirmLabel={preview.confirmLabel}
          onCancel={() => setPreview(null)}
          onConfirm={() => {
            preview.apply();
            setPreview(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
