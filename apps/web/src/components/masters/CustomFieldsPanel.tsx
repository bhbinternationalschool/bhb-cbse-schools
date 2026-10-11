"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import { ErpPanel, ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { RowActionMenu, type RowAction } from "@/components/ui/erp-grid";
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  validateDefInput,
  type CustomFieldDef,
  type CustomFieldDefInput,
  type CustomFieldEntity,
  type CustomFieldType,
} from "@/lib/customFields";
import { fetchCustomFieldDefs, postCustomFieldDef } from "@/lib/customFieldsClient";
import { isBuiltInStudentImportHeader } from "@/lib/studentImport";

/**
 * Masters → Custom fields (old SStudy ERP: Configuration → Custom Field).
 * The office adds its own fields to student and staff records; they appear
 * under "More details" on the edit pages, as optional export columns, and
 * as optional columns in the student import (matched by name).
 *
 * Stored on the server (custom_field_defs). A field that holds values can
 * be switched off — hidden, values kept — but not deleted.
 */

type Draft = {
  id: string | null;
  baseUpdatedAt: string;
  labelEn: string;
  labelHi: string;
  fieldType: CustomFieldType;
  optionsText: string;
  requiredOnNew: boolean;
  active: boolean;
  sortOrder: number;
  valueCount: number;
};

const emptyDraft = (): Draft => ({
  id: null,
  baseUpdatedAt: "",
  labelEn: "",
  labelHi: "",
  fieldType: "text",
  optionsText: "",
  requiredOnNew: false,
  active: true,
  sortOrder: 0,
  valueCount: 0,
});

const typeLabel = (t: CustomFieldType) => CUSTOM_FIELD_TYPES.find((x) => x.id === t)?.label ?? t;

export function CustomFieldsPanel({ canEdit }: { canEdit: boolean }) {
  const [entity, setEntity] = useState<CustomFieldEntity>("student");
  const [defs, setDefs] = useState<CustomFieldDef[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      setDefs(await fetchCustomFieldDefs(undefined, true));
    } catch (e) {
      setDefs(null);
      setLoadError(e instanceof Error ? e.message : "Could not load the custom fields");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () =>
      (defs ?? [])
        .filter((d) => d.entityType === entity)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.labelEn.localeCompare(b.labelEn)),
    [defs, entity],
  );

  const flash = (ok: boolean, text: string) => setMsg({ ok, text });

  function inputOf(d: Draft): CustomFieldDefInput {
    return {
      entityType: entity,
      labelEn: d.labelEn,
      labelHi: d.labelHi,
      fieldType: d.fieldType,
      options: d.optionsText.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean),
      requiredOnNew: d.requiredOnNew,
      active: d.active,
      sortOrder: d.id ? d.sortOrder : undefined,
    };
  }

  async function saveDraft() {
    if (!draft) return;
    const input = inputOf(draft);
    const current = draft.id ? rows.find((r) => r.id === draft.id) ?? null : null;
    const v = validateDefInput(
      input,
      rows,
      current,
      entity === "student" ? isBuiltInStudentImportHeader : undefined,
    );
    if (!v.ok) {
      flash(false, v.error);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (draft.id) {
        await postCustomFieldDef({ action: "update", id: draft.id, baseUpdatedAt: draft.baseUpdatedAt, ...input });
        flash(true, `Saved "${v.def.labelEn}"`);
      } else {
        await postCustomFieldDef({ action: "create", ...input });
        flash(true, `Added "${v.def.labelEn}" — it now shows under More details`);
      }
      setDraft(null);
      await load();
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "Could not save");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function patchDef(d: CustomFieldDef, change: Partial<CustomFieldDefInput>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await postCustomFieldDef({
        action: "update",
        id: d.id,
        baseUpdatedAt: d.updatedAt,
        entityType: d.entityType,
        labelEn: d.labelEn,
        labelHi: d.labelHi,
        fieldType: d.fieldType,
        options: d.options,
        requiredOnNew: d.requiredOnNew,
        active: d.active,
        sortOrder: d.sortOrder,
        ...change,
      });
      if (okText) flash(true, okText);
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function move(d: CustomFieldDef, dir: -1 | 1) {
    const i = rows.findIndex((r) => r.id === d.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const order = [...rows];
    [order[i], order[j]] = [order[j]!, order[i]!];
    // Renumber 10, 20, 30… and write only the fields whose number moved.
    for (const [k, r] of order.entries()) {
      const want = (k + 1) * 10;
      if (r.sortOrder !== want) await patchDef(r, { sortOrder: want }, "");
    }
    await load();
  }

  async function remove(d: CustomFieldDef) {
    if (!window.confirm(`Delete "${d.labelEn}"? No record holds a value for it.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await postCustomFieldDef({ action: "delete", id: d.id, baseUpdatedAt: d.updatedAt, labelEn: d.labelEn });
      flash(true, `Deleted "${d.labelEn}"`);
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusy(false);
      await load();
    }
  }

  const edit = (d: CustomFieldDef) =>
    setDraft({
      id: d.id,
      baseUpdatedAt: d.updatedAt,
      labelEn: d.labelEn,
      labelHi: d.labelHi,
      fieldType: d.fieldType,
      optionsText: d.options.join("\n"),
      requiredOnNew: d.requiredOnNew,
      active: d.active,
      sortOrder: d.sortOrder,
      valueCount: d.valueCount,
    });

  const actions: RowAction<CustomFieldDef>[] = [
    { id: "edit", label: "Edit", onSelect: edit, hidden: () => !canEdit },
    { id: "up", label: "Move up", onSelect: (d) => void move(d, -1), hidden: () => !canEdit, disabled: (d) => busy || rows[0]?.id === d.id },
    { id: "down", label: "Move down", onSelect: (d) => void move(d, 1), hidden: () => !canEdit, disabled: (d) => busy || rows[rows.length - 1]?.id === d.id },
    {
      id: "toggle",
      label: "Switch off (hide, keep values)",
      onSelect: (d) => void patchDef(d, { active: false }, `"${d.labelEn}" switched off — values are kept`).then(load),
      hidden: (d) => !canEdit || !d.active,
    },
    {
      id: "on",
      label: "Switch on",
      onSelect: (d) => void patchDef(d, { active: true }, `"${d.labelEn}" switched on`).then(load),
      hidden: (d) => !canEdit || d.active,
    },
    {
      id: "delete",
      label: "Delete (unused only)",
      tone: "danger",
      separatorAbove: true,
      onSelect: (d) => void remove(d),
      hidden: () => !canEdit,
      disabled: (d) => busy || d.valueCount !== 0,
    },
  ];

  return (
    <div className="space-y-4">
      <ErpPanel
        title="Custom fields"
        description="Add the school's own fields to student and staff records — no code change. Active fields show on the edit page under More details, can be added to the register export, and can be filled from the student import by a column with the same name."
      >
        <div className="flex flex-wrap items-center gap-2">
          {CUSTOM_FIELD_ENTITIES.map((e) => (
            <button
              key={e.id}
              type="button"
              className={entity === e.id ? btn : btnOutline}
              aria-pressed={entity === e.id}
              onClick={() => {
                setEntity(e.id);
                setDraft(null);
                setMsg(null);
              }}
            >
              {e.label}
            </button>
          ))}
          {canEdit ? (
            <button type="button" className={`${btnOutline} ml-auto`} onClick={() => setDraft(emptyDraft())} disabled={busy || defs === null}>
              + Add field
            </button>
          ) : null}
        </div>
        {msg ? <p className={`mt-2 text-xs ${msg.ok ? "text-[var(--tone-teal)]" : "text-[var(--danger)]"}`}>{msg.text}</p> : null}
      </ErpPanel>

      {draft ? (
        <ErpPanel title={draft.id ? `Edit "${draft.labelEn}"` : `New ${entity === "student" ? "student" : "staff"} field`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-[var(--muted)]">Name (English) *</span>
              <input className={field} value={draft.labelEn} maxLength={60} onChange={(e) => setDraft({ ...draft, labelEn: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--muted)]">Name (Hindi, optional)</span>
              <input className={field} value={draft.labelHi} maxLength={60} onChange={(e) => setDraft({ ...draft, labelHi: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--muted)]">Type</span>
              <select
                className={field}
                value={draft.fieldType}
                disabled={Boolean(draft.id) && draft.valueCount !== 0}
                onChange={(e) => setDraft({ ...draft, fieldType: e.target.value as CustomFieldType })}
              >
                {CUSTOM_FIELD_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} — {t.hint}
                  </option>
                ))}
              </select>
              {draft.id && draft.valueCount !== 0 ? (
                <span className="mt-1 block text-[11px] text-[var(--muted)]">
                  {draft.valueCount > 0 ? `${draft.valueCount} record(s) hold a value, so the type is fixed.` : "Type is fixed while we cannot count the saved values."}
                </span>
              ) : null}
            </label>
            {draft.fieldType === "choice" ? (
              <label className="text-sm sm:row-span-2">
                <span className="mb-1 block text-[var(--muted)]">Choices — one per line</span>
                <textarea
                  className={`${field} min-h-[6rem]`}
                  value={draft.optionsText}
                  onChange={(e) => setDraft({ ...draft, optionsText: e.target.value })}
                  placeholder={"Red\nBlue\nGreen\nYellow"}
                />
                {draft.id ? (
                  <span className="mt-1 block text-[11px] text-[var(--muted)]">
                    Removing a choice does not change records that already hold it; they show it as &ldquo;no longer a choice&rdquo;.
                  </span>
                ) : null}
              </label>
            ) : null}
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.requiredOnNew} onChange={(e) => setDraft({ ...draft, requiredOnNew: e.target.checked })} />
                Required when adding a new {entity === "student" ? "student" : "staff member"}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                Active (shown on the edit page)
              </label>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" className={btn} disabled={busy} onClick={() => void saveDraft()}>
              {busy ? "Saving…" : draft.id ? "Save field" : "Add field"}
            </button>
            <button type="button" className={btnOutline} disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </ErpPanel>
      ) : null}

      {loadError ? (
        <div role="alert" className="rounded-lg border border-[var(--border)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          Could not load the custom fields ({loadError}).{" "}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : defs === null ? (
        <p className="text-sm text-[var(--muted)]">Loading custom fields…</p>
      ) : (
        <ErpTableShell exportAs={`custom_fields_${entity}`} exportTitle={`Custom fields — ${entity === "student" ? "students" : "staff"}`}>
          <div className="overflow-x-auto">
            <ErpTable minWidth="min-w-[720px]">
              <ErpTableHead>
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Choices</th>
                  <th className="px-3 py-2">Required on new</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Records filled</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </ErpTableHead>
              <ErpTableBody zebra>
                {rows.map((d, i) => (
                  <tr key={d.id} className={d.active ? "" : "opacity-60"}>
                    <td className="px-3 py-2 text-[var(--muted)]">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-[var(--ink)]">
                      {d.labelEn}
                      {d.labelHi ? <span className="ml-1 text-xs font-normal text-[var(--muted)]">· {d.labelHi}</span> : null}
                    </td>
                    <td className="px-3 py-2">{typeLabel(d.fieldType)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--muted)]">{d.options.join(", ") || "—"}</td>
                    <td className="px-3 py-2">{d.requiredOnNew ? "Yes" : "No"}</td>
                    <td className="px-3 py-2">{d.active ? "Active" : "Switched off"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.valueCount < 0 ? "?" : d.valueCount}</td>
                    <td className="px-3 py-2 text-right">
                      <RowActionMenu row={d} label={`Actions for ${d.labelEn}`} actions={actions} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                      No {entity === "student" ? "student" : "staff"} fields yet.{canEdit ? " Click + Add field — e.g. House, Locker no, Hostel (Yes/No)." : ""}
                    </td>
                  </tr>
                ) : null}
              </ErpTableBody>
            </ErpTable>
          </div>
        </ErpTableShell>
      )}
    </div>
  );
}
