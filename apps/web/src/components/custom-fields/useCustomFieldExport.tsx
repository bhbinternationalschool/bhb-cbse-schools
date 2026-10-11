"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  activeDefsFor,
  customExportCells,
  customExportColumns,
  labelKey,
  resolveEntityValues,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldValueRow,
} from "@/lib/customFields";
import { fetchCustomFieldDefs, fetchCustomFieldValues } from "@/lib/customFieldsClient";

/**
 * Optional "more details" columns on a register export (Students → Register,
 * Staff → Roster). Off by default; ticking the box reads every saved value
 * once. If that read fails the box unticks and says so — the export never
 * goes out with blank columns standing in for values it could not read.
 */

type Status = "idle" | "loading" | "ready" | "error";

export function useCustomFieldExport(entity: CustomFieldEntity) {
  const [defs, setDefs] = useState<CustomFieldDef[]>([]);
  const [include, setInclude] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [rows, setRows] = useState<CustomFieldValueRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    // Only to decide whether to offer the box at all; a failure just hides it.
    fetchCustomFieldDefs(entity)
      .then((all) => {
        if (!cancelled) setDefs(activeDefsFor(all, entity));
      })
      .catch(() => {
        if (!cancelled) setDefs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entity]);

  const toggle = useCallback(
    async (on: boolean) => {
      setError("");
      if (!on) {
        setInclude(false);
        return;
      }
      setInclude(true);
      setStatus("loading");
      try {
        const [all, values] = await Promise.all([fetchCustomFieldDefs(entity), fetchCustomFieldValues(entity, "all")]);
        setDefs(activeDefsFor(all, entity));
        setRows(values);
        setStatus("ready");
      } catch (e) {
        setInclude(false);
        setStatus("error");
        setError(e instanceof Error ? e.message : "Could not read the saved details");
      }
    },
    [entity],
  );

  const byEntity = useMemo(() => {
    const m = new Map<string, CustomFieldValueRow[]>();
    for (const r of rows) {
      const list = m.get(r.entityId);
      if (list) list.push(r);
      else m.set(r.entityId, [r]);
    }
    return m;
  }, [rows]);

  const active = include && status === "ready";

  /** Columns to append (none unless ticked and loaded). */
  const columns = useMemo(() => (active ? customExportColumns(defs) : []), [active, defs]);

  /** Cells for one record; `ids` = the record id first, then its other rows. */
  const cells = useCallback(
    (ids: string[]): Record<string, string> => {
      if (!active) return {};
      const own = ids.flatMap((id) => byEntity.get(id) ?? []);
      return customExportCells(defs, resolveEntityValues(own, ids));
    },
    [active, byEntity, defs],
  );

  return { defs, include, status, error, toggle, columns, cells, active };
}

/**
 * Students: every row of the same child (same admission number AND name)
 * across sessions, keyed by row id — so last year's answer exports on this
 * year's row (same rule as studentAliasIds, built once for the roster).
 */
export function studentAliasIndex(students: { id: string; admissionNo?: string; fullName?: string }[]): (id: string) => string[] {
  const groups = new Map<string, string[]>();
  const keyOf = new Map<string, string>();
  for (const s of students) {
    const adm = (s.admissionNo ?? "").replace(/\s+/g, " ").trim().toUpperCase();
    const name = labelKey(s.fullName ?? "");
    if (!adm || !name) continue;
    const k = `${adm}|${name}`;
    keyOf.set(s.id, k);
    const g = groups.get(k);
    if (g) g.push(s.id);
    else groups.set(k, [s.id]);
  }
  return (id: string) => {
    const k = keyOf.get(id);
    const g = k ? groups.get(k) ?? [] : [];
    return [id, ...g.filter((x) => x !== id)];
  };
}

export function CustomExportToggle({
  state,
  className = "",
}: {
  state: ReturnType<typeof useCustomFieldExport>;
  className?: string;
}) {
  if (!state.defs.length && state.status !== "error") return null;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--muted)] ${className}`}>
      <label className="inline-flex items-center gap-1.5" title="Add the school's custom fields (Masters → Custom fields) as extra export columns">
        <input
          type="checkbox"
          checked={state.include}
          disabled={state.status === "loading"}
          onChange={(e) => void state.toggle(e.target.checked)}
        />
        + More details ({state.defs.length})
      </label>
      {state.status === "loading" ? <span>loading…</span> : null}
      {state.status === "error" ? (
        <span role="alert" className="text-[var(--danger)]">
          could not load ({state.error}) — not added
        </span>
      ) : null}
    </span>
  );
}
