"use client";

import { useMemo, useState } from "react";
import {
  appendRbacAudit,
  cloneRole,
  newRbacId,
  type FeatureGrant,
  type PermissionGrant,
  type RbacRole,
  type RbacState,
} from "@/lib/rbac";
import {
  buildPermissionTree,
  effectiveDiff,
  leafLabel,
  roleLeafState,
  setRoleLeaves,
  type TreeLeaf,
} from "@/lib/rbacEditorModel";
import { ROLE_TEMPLATES, resolveRoleTemplate } from "@/lib/rbacRoleTemplates";
import { mobileFeature, type MobileFeatureId } from "@/lib/mobileFeatures";
import { MastersWorkCard } from "@/components/masters/MastersLayout";
import { RbacPermissionTree, TreeButton, type LeafView } from "@/components/masters/RbacPermissionTree";
import { RbacChangePreview } from "@/components/masters/RbacChangePreview";

type Grants = { permissions: PermissionGrant[]; featureGrants: FeatureGrant[] };

function grantsOf(r: RbacRole): Grants {
  return {
    permissions: r.permissions.map((p) => ({ module: p.module, actions: [...p.actions] })),
    featureGrants: (r.featureGrants ?? []).map((g) => ({ feature: g.feature, actions: [...g.actions] })),
  };
}

/** Union of two grant sets (template "Add to the role"). */
function unionGrants(a: Grants, b: Grants): Grants {
  const perms = new Map(a.permissions.map((p) => [p.module, new Set(p.actions)]));
  for (const p of b.permissions) {
    const s = perms.get(p.module) ?? new Set();
    p.actions.forEach((x) => s.add(x));
    perms.set(p.module, s);
  }
  const fns = new Map(a.featureGrants.map((g) => [g.feature, new Set(g.actions)]));
  for (const g of b.featureGrants) {
    const s = fns.get(g.feature) ?? new Set();
    g.actions.forEach((x) => s.add(x));
    fns.set(g.feature, s);
  }
  return {
    permissions: [...perms.entries()].map(([module, s]) => ({ module, actions: [...s] })),
    featureGrants: [...fns.entries()].map(([feature, s]) => ({ feature, actions: [...s] })),
  };
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
 * Masters → Roles & permissions → Role permissions: the same tree for a
 * ROLE — whole-module ticks and function ticks — with Duplicate role and
 * the default templates (applied only by the button, after a preview).
 */
export function RbacRoleTree({
  state,
  editable,
  actorName,
  commit,
}: {
  state: RbacState;
  editable: boolean;
  actorName: string;
  commit: (next: RbacState, msg?: string) => void;
}) {
  const tree = useMemo(() => buildPermissionTree(), []);
  const [roleId, setRoleId] = useState(
    () => state.roles.find((r) => r.code === "office")?.id || state.roles[0]?.id || "",
  );
  const [draft, setDraft] = useState<Grants | null>(null);
  const [dupName, setDupName] = useState("");
  const [dupCode, setDupCode] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templateTarget, setTemplateTarget] = useState<"this" | "new">("this");
  const [templateMode, setTemplateMode] = useState<"replace" | "add">("replace");
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const role = state.roles.find((r) => r.id === roleId) ?? null;
  const working: Grants | null = role ? draft ?? grantsOf(role) : null;

  const view = (leaf: TreeLeaf): LeafView => {
    if (!working) return { on: false, disabled: true };
    const st = roleLeafState(working, leaf);
    if (leaf.kind === "feature" && st.viaWholeModule) {
      return { on: true, source: "module", disabled: true, title: "Given by the whole-module tick above" };
    }
    return { on: st.on };
  };

  function pickRole(id: string) {
    if (draft && !window.confirm("Discard the unsaved changes to this role?")) return;
    setDraft(null);
    setRoleId(id);
    setNotice(null);
  }

  function diffLabels(before: Grants, after: Grants) {
    const d = effectiveDiff(tree, (l) => roleLeafState(before, l).on, (l) => roleLeafState(after, l).on);
    return { gained: d.gained.map((l) => leafLabel(tree, l)), lost: d.lost.map((l) => leafLabel(tree, l)) };
  }

  function writeRole(next: Grants, action: string, detail: string, extra?: (s: RbacState) => RbacState) {
    if (!role) return;
    let s: RbacState = {
      ...state,
      roles: state.roles.map((r) =>
        r.id === role.id ? { ...r, permissions: next.permissions, featureGrants: next.featureGrants } : r,
      ),
    };
    if (extra) s = extra(s);
    commit(appendRbacAudit(s, actorName, action, detail), `Saved ${role.name}`);
    setDraft(null);
  }

  function reviewSave() {
    if (!role || !draft) return;
    const d = diffLabels(grantsOf(role), draft);
    setPreview({
      title: `Save the ${role.name} role`,
      ...d,
      notes: (
        <p className="text-[var(--muted)]">
          Everyone holding {role.name} gets this — check the Assignments tab for who that is.
        </p>
      ),
      confirmLabel: "Save role",
      apply: () =>
        writeRole(draft, "role.permissions", `${role.code}: +${d.gained.length} / −${d.lost.length}; ${[...d.gained.map((x) => `+${x}`), ...d.lost.map((x) => `−${x}`)].slice(0, 12).join("; ")}`),
    });
  }

  function duplicate() {
    if (!role || !editable) return;
    if (draft) {
      setNotice("Save or discard the changes first.");
      return;
    }
    const r = cloneRole(state, role.id, dupCode || dupName, dupName, actorName);
    if (!r.ok) {
      setNotice(r.reason);
      return;
    }
    commit(r.state, `Duplicated ${role.name} as ${r.role.name}`);
    setRoleId(r.role.id);
    setDupName("");
    setDupCode("");
  }

  function reviewTemplate() {
    const t = ROLE_TEMPLATES.find((x) => x.id === templateId);
    if (!t || !editable) return;
    if (draft) {
      setNotice("Save or discard the changes first.");
      return;
    }
    const resolved = resolveRoleTemplate(t);
    const tGrants: Grants = { permissions: resolved.permissions, featureGrants: resolved.featureGrants };
    const mobileNote = (code: string, next: MobileFeatureId[]) => {
      const cur = new Set(state.mobile.roleFeatures[code] ?? []);
      const add = next.filter((f) => !cur.has(f));
      const drop = templateMode === "replace" ? [...cur].filter((f) => !next.includes(f)) : [];
      const name = (f: MobileFeatureId) => mobileFeature(f)?.label || f;
      return (
        <p className="text-[var(--muted)]">
          Phone app: {add.length ? `+ ${add.map(name).join(", ")}` : "nothing added"}
          {drop.length ? ` · − ${drop.map(name).join(", ")}` : ""}
        </p>
      );
    };
    const unmatched = resolved.unmatched.length ? (
      <p className="text-[var(--warning)]">
        Not in the catalogue yet, so not given: {resolved.unmatched.join("; ")}.
      </p>
    ) : null;

    if (templateTarget === "new") {
      const code = t.code;
      if (state.roles.some((r) => r.code === code)) {
        setNotice(`A role with code “${code}” already exists — apply the template to it instead.`);
        return;
      }
      const empty: Grants = { permissions: [], featureGrants: [] };
      const d = diffLabels(empty, tGrants);
      setPreview({
        title: `Create the ${t.name} role from the template`,
        ...d,
        notes: (
          <>
            <p>{t.summary}</p>
            <p className="text-[var(--muted)]">New role code: {code}. Nobody holds it until you assign it.</p>
            {mobileNote(code, resolved.mobile)}
            {unmatched}
          </>
        ),
        confirmLabel: "Create role",
        apply: () => {
          const newRole: RbacRole = {
            id: newRbacId("role"),
            code,
            name: t.name,
            isBuiltIn: false,
            isActive: true,
            makerChecker: false,
            permissions: tGrants.permissions,
            featureGrants: tGrants.featureGrants,
            note: `From the ${t.name} template`,
          };
          const s: RbacState = {
            ...state,
            roles: [...state.roles, newRole],
            mobile: { ...state.mobile, roleFeatures: { ...state.mobile.roleFeatures, [code]: resolved.mobile } },
          };
          commit(appendRbacAudit(s, actorName, "role.template", `${t.name} → new role ${code}`), `Created ${t.name}`);
          setRoleId(newRole.id);
        },
      });
      return;
    }

    if (!role) return;
    const before = grantsOf(role);
    const after = templateMode === "replace" ? tGrants : unionGrants(before, tGrants);
    const d = diffLabels(before, after);
    const nextMobile =
      templateMode === "replace"
        ? resolved.mobile
        : [...new Set([...(state.mobile.roleFeatures[role.code] ?? []), ...resolved.mobile])];
    setPreview({
      title: `${templateMode === "replace" ? "Replace" : "Add to"} ${role.name} with the ${t.name} template`,
      ...d,
      notes: (
        <>
          <p>{t.summary}</p>
          {mobileNote(role.code, nextMobile)}
          {unmatched}
        </>
      ),
      confirmLabel: "Apply template",
      apply: () =>
        writeRole(after, "role.template", `${t.name} ${templateMode === "replace" ? "replaced" : "added to"} ${role.code}: +${d.gained.length} / −${d.lost.length}`, (s) => ({
          ...s,
          mobile: { ...s.mobile, roleFeatures: { ...s.mobile.roleFeatures, [role.code]: nextMobile } },
        })),
    });
  }

  const selectedTemplate = ROLE_TEMPLATES.find((x) => x.id === templateId);

  return (
    <div className="space-y-4">
      <MastersWorkCard
        title="Role permissions"
        hint="Pick a role; tick whole modules or single functions. A whole-module tick covers every function in it. Review & save shows exactly what changes for everyone holding the role."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Role</span>
            <select
              className="min-w-[14rem] rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              value={roleId}
              onChange={(e) => pickRole(e.target.value)}
            >
              {state.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code}){!r.isActive ? " — inactive" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Duplicate as</span>
            <input
              className="w-44 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              placeholder="New role name"
              value={dupName}
              onChange={(e) => setDupName(e.target.value)}
              disabled={!editable}
            />
          </label>
          <input
            className="w-36 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
            placeholder="code (optional)"
            value={dupCode}
            onChange={(e) => setDupCode(e.target.value)}
            disabled={!editable}
            aria-label="New role code"
          />
          <TreeButton onClick={duplicate} disabled={!editable || !dupName.trim()}>
            Duplicate role
          </TreeButton>
        </div>
        {role ? (
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            {role.note || (role.isBuiltIn ? "Built-in role" : "Custom role")}
            {role.makerChecker ? " · maker-checker on" : ""}
          </p>
        ) : null}
      </MastersWorkCard>

      <MastersWorkCard
        title="Apply a template"
        hint="Starting points for common jobs. Nothing changes until you review the difference and confirm."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Template</span>
            <select
              className="min-w-[14rem] rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={!editable}
            >
              <option value="">Choose…</option>
              {ROLE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Apply to</span>
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              value={templateTarget}
              onChange={(e) => setTemplateTarget(e.target.value as "this" | "new")}
              disabled={!editable}
            >
              <option value="this">{role ? `The ${role.name} role` : "This role"}</option>
              <option value="new">A new role</option>
            </select>
          </label>
          {templateTarget === "this" ? (
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">How</span>
              <select
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                value={templateMode}
                onChange={(e) => setTemplateMode(e.target.value as "replace" | "add")}
                disabled={!editable}
              >
                <option value="replace">Replace what the role has</option>
                <option value="add">Only add to it</option>
              </select>
            </label>
          ) : null}
          <TreeButton onClick={reviewTemplate} disabled={!editable || !templateId}>
            Preview template
          </TreeButton>
        </div>
        {selectedTemplate ? (
          <p className="mt-2 text-[12px] text-[var(--muted)]">{selectedTemplate.summary}</p>
        ) : null}
      </MastersWorkCard>

      {notice ? <p className="text-sm font-medium text-[var(--danger)]">{notice}</p> : null}

      {role && working ? (
        <MastersWorkCard title={`What the ${role.name} role can do`}>
          <RbacPermissionTree
            tree={tree}
            view={view}
            onSet={(leaves, on) => {
              if (!editable) return;
              setDraft(setRoleLeaves(working, leaves, on));
            }}
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
