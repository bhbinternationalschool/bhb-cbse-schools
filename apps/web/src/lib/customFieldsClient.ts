"use client";

import type { CustomFieldDef, CustomFieldEntity, CustomFieldValueRow, ValueChange } from "@/lib/customFields";

/**
 * Browser half of custom fields: plain calls to /api/custom-fields/*.
 * Nothing is cached in browser storage. A failed read throws — the caller
 * shows "could not load", never an empty list (unknown is not empty).
 */

async function json<T>(res: Response): Promise<T> {
  const j = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || !j.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}

export async function fetchCustomFieldDefs(entity?: CustomFieldEntity, withCounts = false): Promise<CustomFieldDef[]> {
  const q = new URLSearchParams();
  if (entity) q.set("entity", entity);
  if (withCounts) q.set("counts", "1");
  const j = await json<{ defs: CustomFieldDef[] }>(await fetch(`/api/custom-fields/defs?${q}`, { cache: "no-store" }));
  return j.defs;
}

export async function postCustomFieldDef(
  body: Record<string, unknown> & { action: "create" | "update" | "delete" },
): Promise<CustomFieldDef | null> {
  const j = await json<{ def?: CustomFieldDef }>(
    await fetch("/api/custom-fields/defs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return j.def ?? null;
}

export async function fetchCustomFieldValues(entity: CustomFieldEntity, ids: string[] | "all"): Promise<CustomFieldValueRow[]> {
  if (ids !== "all" && !ids.length) return [];
  const q = new URLSearchParams({ entity });
  if (ids === "all") q.set("all", "1");
  else q.set("ids", ids.join(","));
  const j = await json<{ values: CustomFieldValueRow[] }>(await fetch(`/api/custom-fields/values?${q}`, { cache: "no-store" }));
  return j.values;
}

export type SaveValuesResult = {
  stamps: Record<string, string>;
  conflicts: { entityId: string; fieldId: string }[];
  rejected: { entityId: string; fieldId: string; error: string }[];
};

export async function saveCustomFieldValues(
  entity: CustomFieldEntity,
  changes: ValueChange[],
  source: "form" | "import" = "form",
): Promise<SaveValuesResult> {
  const out: SaveValuesResult = { stamps: {}, conflicts: [], rejected: [] };
  // The server takes 5,000 per call; an import is cut to stay well under.
  for (let i = 0; i < changes.length; i += 1000) {
    const j = await json<SaveValuesResult>(
      await fetch("/api/custom-fields/values", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, changes: changes.slice(i, i + 1000), source }),
      }),
    );
    Object.assign(out.stamps, j.stamps);
    out.conflicts.push(...j.conflicts);
    out.rejected.push(...j.rejected);
  }
  return out;
}
