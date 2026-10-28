"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { btn } from "@/components/ui/erp-ui";
import {
  activeDefsFor,
  diffCustomValues,
  missingRequiredOnNew,
  normalizeCustomValue,
  resolveEntityValues,
  valueForInput,
  type CustomFieldDef,
  type CustomFieldEntity,
  type ResolvedValue,
} from "@/lib/customFields";
import { fetchCustomFieldDefs, fetchCustomFieldValues, saveCustomFieldValues } from "@/lib/customFieldsClient";

/**
 * "More details" on the student and staff edit pages: the school's own
 * fields from Masters → Custom fields (lib/customFields).
 *
 * Saved on their own, one value at a time with the stamp it was loaded at,
 * through /api/custom-fields/values — never as part of the student or staff
 * record, so this section cannot rewrite or blank a built-in field, and a
 * value changed on another screen since this page opened is reported, not
 * overwritten.
 */

export type CustomFieldsHandle = {
  /**
   * Problems that must stop the save: values that do not fit their type,
   * plus (for a NEW record) required-on-new fields left blank.
   */
  validate: (forCreate: boolean) => string[];
  /** True when something here was edited and not yet saved. */
  isDirty: () => boolean;
  /** Save the edits against this record id. Returns a line for the toast. */
  saveFor: (entityId: string) => Promise<{ ok: boolean; message: string }>;
};

type Props = {
  entity: CustomFieldEntity;
  mode: "create" | "edit";
  /** The record's id (staff know it before the first save; students do not). */
  entityId: string | null;
  /** Students: the same child's rows in other sessions, read for carried values. */
  aliasIds?: string[];
  readOnly?: boolean;
  /** Show the section's own Save button (edit mode). */
  showSaveButton?: boolean;
};

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; defs: CustomFieldDef[]; resolved: Map<string, ResolvedValue> };

export const CustomFieldsSection = forwardRef<CustomFieldsHandle, Props>(function CustomFieldsSection(
  { entity, mode, entityId, aliasIds, readOnly = false, showSaveButton = true },
  ref,
) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const aliasKey = (aliasIds ?? []).join(",");
  const readIds = useMemo(() => {
    if (mode !== "edit" || !entityId) return [];
    const rest = aliasKey ? aliasKey.split(",").filter((id) => id && id !== entityId) : [];
    return [entityId, ...rest];
  }, [mode, entityId, aliasKey]);
  const loadRef = useRef(load);
  loadRef.current = load;
  const editedRef = useRef(edited);
  editedRef.current = edited;

  const loadSeq = useRef(0);
  /**
   * `keepEdits` (the default): an input the user has already changed keeps
   * what they typed — e.g. the child's other-session rows arriving a moment
   * after the first load must not wipe it. After a save the page takes the
   * stored values as they now are.
   */
  const reload = useCallback(async (keepEdits = true) => {
    const seq = ++loadSeq.current;
    const before = loadRef.current;
    const typed = editedRef.current;
    setLoad({ state: "loading" });
    try {
      const [all, rows] = await Promise.all([
        fetchCustomFieldDefs(entity),
        readIds.length ? fetchCustomFieldValues(entity, readIds) : Promise.resolve([]),
      ]);
      // A later load (e.g. the child's other-session rows arriving) wins.
      if (seq !== loadSeq.current) return;
      const defs = activeDefsFor(all, entity);
      const resolved = resolveEntityValues(rows, readIds);
      const wasInput = (id: string) => {
        if (before.state !== "ready") return "";
        const d = before.defs.find((x) => x.id === id);
        return d ? valueForInput(d, before.resolved.get(id)?.value ?? "") : "";
      };
      setEdited(
        Object.fromEntries(
          defs.map((d) => {
            const fresh = valueForInput(d, resolved.get(d.id)?.value ?? "");
            const mine = typed[d.id];
            const dirty = keepEdits && mine !== undefined && mine !== wasInput(d.id);
            return [d.id, dirty ? mine : fresh];
          }),
        ),
      );
      setErrors({});
      setLoad({ state: "ready", defs, resolved });
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setLoad({ state: "error", message: e instanceof Error ? e.message : "Could not load more details" });
    }
  }, [entity, readIds]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Edits that differ from what was loaded, in the form's own terms. */
  const pendingDiff = useCallback(
    (forId: string) => {
      const l = loadRef.current;
      if (l.state !== "ready") return { ok: true as const, changes: [] };
      const loadedInputs = Object.fromEntries(l.defs.map((d) => [d.id, valueForInput(d, l.resolved.get(d.id)?.value ?? "")]));
      const touched: Record<string, string> = {};
      for (const d of l.defs) {
        const now = editedRef.current[d.id] ?? "";
        if (now !== loadedInputs[d.id]) touched[d.id] = now;
      }
      return diffCustomValues(forId, l.defs, l.resolved, touched);
    },
    [],
  );

  const checkAll = useCallback((): string[] => {
    const l = loadRef.current;
    if (l.state !== "ready") return [];
    const errs: Record<string, string> = {};
    for (const d of l.defs) {
      const n = normalizeCustomValue(d, editedRef.current[d.id] ?? "");
      if (!n.ok) errs[d.id] = n.error;
    }
    setErrors(errs);
    return Object.values(errs);
  }, []);

  const save = useCallback(
    async (forId: string): Promise<{ ok: boolean; message: string }> => {
      const l = loadRef.current;
      if (l.state === "error") return { ok: false, message: "More details could not load, so none were saved" };
      if (l.state !== "ready") return { ok: true, message: "" };
      const problems = checkAll();
      if (problems.length) return { ok: false, message: `More details not saved — ${problems.join("; ")}` };
      const diff = pendingDiff(forId);
      if (!diff.ok) return { ok: false, message: `More details not saved — ${diff.errors.join("; ")}` };
      if (!diff.changes.length) return { ok: true, message: "" };
      setBusy(true);
      try {
        const r = await saveCustomFieldValues(entity, diff.changes);
        const label = (id: string) => l.defs.find((d) => d.id === id)?.labelEn ?? "a field";
        const parts: string[] = [];
        const saved = Object.keys(r.stamps).length;
        if (saved) parts.push(`${saved} more detail${saved === 1 ? "" : "s"} saved`);
        if (r.conflicts.length) {
          parts.push(`${r.conflicts.map((c) => label(c.fieldId)).join(", ")} changed on another screen — reloaded, please check and re-enter`);
        }
        if (r.rejected.length) parts.push(r.rejected.map((x) => x.error).join("; "));
        const ok = !r.conflicts.length && !r.rejected.length;
        // Re-read so the next save starts from the stamps just written.
        if (mode === "edit" || r.conflicts.length) await reload(false);
        return { ok, message: parts.join(" · ") };
      } catch (e) {
        return { ok: false, message: `More details not saved — ${e instanceof Error ? e.message : "server error"}` };
      } finally {
        setBusy(false);
      }
    },
    [checkAll, entity, mode, pendingDiff, reload],
  );

  useImperativeHandle(
    ref,
    () => ({
      validate: (forCreate: boolean) => {
        const l = loadRef.current;
        if (l.state !== "ready") return [];
        const typeErrs = checkAll();
        if (!forCreate) return typeErrs;
        const missing = missingRequiredOnNew(l.defs, editedRef.current).map((d) => `${d.labelEn} is required`);
        if (missing.length) {
          setErrors((prev) => {
            const next = { ...prev };
            for (const d of missingRequiredOnNew(l.defs, editedRef.current)) next[d.id] = `${d.labelEn} is required`;
            return next;
          });
        }
        return [...missing, ...typeErrs];
      },
      isDirty: () => {
        const d = pendingDiff(entityId ?? "new");
        return !d.ok || d.changes.length > 0;
      },
      saveFor: save,
    }),
    [checkAll, entityId, pendingDiff, save],
  );

  if (load.state === "loading") {
    return <p className="text-sm text-[var(--muted)]">Loading more details…</p>;
  }
  if (load.state === "error") {
    return (
      <div role="alert" className="rounded-lg border border-[var(--border)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
        Could not load more details ({load.message}). Nothing here will be saved until they load.{" "}
        <button type="button" className="font-semibold underline" onClick={() => void reload()}>
          Try again
        </button>
      </div>
    );
  }
  if (!load.defs.length) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No extra fields yet. The office can add them in{" "}
        <Link href="/masters?tab=custom-fields" className="font-semibold text-[var(--brand-mid)]">
          Masters → Custom fields
        </Link>
        .
      </p>
    );
  }

  const { defs, resolved } = load;
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">
        The school&apos;s own fields (Masters → Custom fields). They are saved separately from the rest of the profile
        {mode === "create" ? " right after the record is created." : "."} Dates are typed DD/MM/YYYY.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {defs.map((d) => {
          const value = edited[d.id] ?? "";
          const carried = resolved.get(d.id);
          const fromOther = carried && entityId && carried.fromEntityId !== entityId && carried.value;
          const required = mode === "create" && d.requiredOnNew;
          const err = errors[d.id];
          const set = (v: string) => {
            setEdited((prev) => ({ ...prev, [d.id]: v }));
            if (err) setErrors((prev) => ({ ...prev, [d.id]: "" }));
            setMsg(null);
          };
          const inputId = `cf-${d.id}`;
          let control: React.ReactNode;
          if (d.fieldType === "choice") {
            const stale = value && !d.options.includes(value);
            control = (
              <select id={inputId} className="field" value={value} disabled={readOnly} onChange={(e) => set(e.target.value)}>
                <option value="">—</option>
                {stale ? <option value={value}>{value} (no longer a choice)</option> : null}
                {d.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            );
          } else if (d.fieldType === "yes_no") {
            control = (
              <select id={inputId} className="field" value={value} disabled={readOnly} onChange={(e) => set(e.target.value)}>
                <option value="">—</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            );
          } else {
            control = (
              <input
                id={inputId}
                className="field"
                value={value}
                readOnly={readOnly}
                inputMode={d.fieldType === "number" ? "decimal" : d.fieldType === "date" ? "numeric" : undefined}
                placeholder={d.fieldType === "date" ? "DD/MM/YYYY" : undefined}
                maxLength={d.fieldType === "text" ? 500 : 40}
                onChange={(e) => set(e.target.value)}
                onBlur={() => {
                  const n = normalizeCustomValue(d, value);
                  if (!n.ok) setErrors((prev) => ({ ...prev, [d.id]: n.error }));
                }}
                aria-invalid={err ? true : undefined}
              />
            );
          }
          return (
            <div key={d.id} className="text-sm">
              <label htmlFor={inputId} className="mb-1.5 block text-[var(--muted)]">
                {d.labelEn}
                {d.labelHi ? <span className="ml-1 text-[11px]">· {d.labelHi}</span> : null}
                {required ? (
                  <span className="ml-0.5 text-[var(--danger)]" aria-hidden="true">
                    *
                  </span>
                ) : null}
              </label>
              {control}
              {err ? <p className="mt-1 text-[11px] text-[var(--danger)]">{err}</p> : null}
              {!err && fromOther ? (
                <p className="mt-1 text-[11px] text-[var(--muted)]">Carried from this child&apos;s record in another session.</p>
              ) : null}
            </div>
          );
        })}
      </div>
      {msg ? <p className={`text-xs ${msg.ok ? "text-[var(--tone-teal)]" : "text-[var(--danger)]"}`}>{msg.text}</p> : null}
      {showSaveButton && mode === "edit" && entityId && !readOnly ? (
        <div>
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={() =>
              void save(entityId).then((r) => setMsg({ ok: r.ok, text: r.message || "No changes to save" }))
            }
          >
            {busy ? "Saving…" : "Save more details"}
          </button>
        </div>
      ) : null}
    </div>
  );
});
