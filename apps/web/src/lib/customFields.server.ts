import { reservedCustomLabel } from "@/lib/customFieldsReserved";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";
import {
  normalizeCustomValue,
  validateDefInput,
  type CustomFieldDef,
  type CustomFieldDefInput,
  type CustomFieldEntity,
  type CustomFieldValueRow,
  type ValueChange,
} from "@/lib/customFields";

/**
 * Storage for custom fields (lib/customFields; tables custom_field_defs and
 * custom_field_values, migration 20261011190000).
 *
 * Values are written one (record, field) row at a time, by compare-and-set
 * on the row's own updated_at: "" inserts only (never over a row that
 * exists), a stamp updates only while the row still holds it. Nothing here
 * reads or writes sis_students / sis_staff, so a custom-field save cannot
 * touch a built-in field. Every read reports failure as null — never as
 * "no fields" or "no values".
 */

type Row = Record<string, unknown>;

function defFromRow(r: Row, valueCount: number): CustomFieldDef {
  return {
    id: String(r.id),
    entityType: r.entity_type as CustomFieldEntity,
    labelEn: String(r.label_en ?? ""),
    labelHi: String(r.label_hi ?? ""),
    fieldType: r.field_type as CustomFieldDef["fieldType"],
    options: Array.isArray(r.options) ? (r.options as unknown[]).map(String) : [],
    requiredOnNew: r.required_on_new === true,
    active: r.active !== false,
    sortOrder: Number(r.sort_order ?? 0) || 0,
    updatedAt: String(r.updated_at ?? ""),
    valueCount,
  };
}

/** Records holding a non-blank value, per field. -1 when the count failed. */
async function countValues(defIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ctx = await getServerTenantContext();
  for (const id of defIds) {
    if (!ctx) {
      out.set(id, -1);
      continue;
    }
    const { count, error } = await ctx.sb
      .from("custom_field_values")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("field_id", id)
      .neq("value", "");
    out.set(id, error || count == null ? -1 : count);
  }
  return out;
}

export async function listCustomFieldDefs(
  entity?: CustomFieldEntity,
  opts: { withCounts?: boolean } = {},
): Promise<CustomFieldDef[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  let q = ctx.sb.from("custom_field_defs").select("*").eq("tenant_id", ctx.tenantId);
  if (entity) q = q.eq("entity_type", entity);
  // A school defines tens of fields, not thousands; the cap is a fence.
  const { data, error } = await q.order("sort_order", { ascending: true }).order("label_en", { ascending: true }).limit(500);
  if (error) {
    console.error("[custom-fields] defs read failed:", error.message);
    return null;
  }
  const rows = (data ?? []) as Row[];
  const counts = opts.withCounts ? await countValues(rows.map((r) => String(r.id))) : new Map<string, number>();
  return rows.map((r) => defFromRow(r, opts.withCounts ? (counts.get(String(r.id)) ?? -1) : -1));
}

async function anyValueRows(fieldId: string): Promise<number> {
  const ctx = await getServerTenantContext();
  if (!ctx) return -1;
  const { count, error } = await ctx.sb
    .from("custom_field_values")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("field_id", fieldId);
  return error || count == null ? -1 : count;
}

type DefResult = { ok: true; def: CustomFieldDef } | { ok: false; error: string; status: number };

export async function createCustomFieldDef(input: CustomFieldDefInput, by: string): Promise<DefResult> {
  const all = await listCustomFieldDefs(input.entityType);
  if (!all) return { ok: false, error: "Could not read the existing fields — try again.", status: 503 };
  const v = validateDefInput(input, all, null, reservedCustomLabel(input.entityType));
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database unavailable", status: 503 };
  const sortOrder = input.sortOrder == null ? (all.reduce((m, d) => Math.max(m, d.sortOrder), 0) + 10) : v.def.sortOrder;
  const { data, error } = await ctx.sb
    .from("custom_field_defs")
    .insert({
      tenant_id: ctx.tenantId,
      entity_type: v.def.entityType,
      label_en: v.def.labelEn,
      label_hi: v.def.labelHi,
      field_type: v.def.fieldType,
      options: v.def.options,
      required_on_new: v.def.requiredOnNew,
      active: v.def.active,
      sort_order: sortOrder,
      created_by: by,
      updated_by: by,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "A field with that name already exists", status: 409 };
    return { ok: false, error: error.message, status: 500 };
  }
  return { ok: true, def: defFromRow(data as Row, 0) };
}

/** Edit a field at the version the screen loaded (`baseUpdatedAt`). */
export async function updateCustomFieldDef(
  id: string,
  input: CustomFieldDefInput,
  baseUpdatedAt: string,
  by: string,
): Promise<DefResult> {
  if (!id || !baseUpdatedAt) return { ok: false, error: "Which field, at which version?", status: 400 };
  const all = await listCustomFieldDefs(input.entityType);
  if (!all) return { ok: false, error: "Could not read the existing fields — try again.", status: 503 };
  const current = all.find((d) => d.id === id);
  if (!current) return { ok: false, error: "That field is no longer there — reload.", status: 404 };
  const typeChanging = current.fieldType !== input.fieldType;
  const v = validateDefInput(
    input,
    all,
    { ...current, valueCount: typeChanging ? await anyValueRows(id) : 0 },
    reservedCustomLabel(input.entityType),
  );
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database unavailable", status: 503 };
  const was = Date.parse(baseUpdatedAt);
  const { data, error } = await ctx.sb
    .from("custom_field_defs")
    .update({
      label_en: v.def.labelEn,
      label_hi: v.def.labelHi,
      field_type: v.def.fieldType,
      options: v.def.options,
      required_on_new: v.def.requiredOnNew,
      active: v.def.active,
      sort_order: v.def.sortOrder,
      updated_by: by,
      updated_at: new Date(Math.max(Date.now(), (Number.isFinite(was) ? was : 0) + 1)).toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .eq("updated_at", baseUpdatedAt)
    .select("*");
  if (error) {
    if (error.code === "23505") return { ok: false, error: "A field with that name already exists", status: 409 };
    return { ok: false, error: error.message, status: 500 };
  }
  if (!data?.length) return { ok: false, error: "Someone changed this field since you opened it — reload and try again.", status: 409 };
  return { ok: true, def: defFromRow(data[0] as Row, current.valueCount) };
}

/**
 * Hard delete — only a field no record has ever saved a value for (the
 * foreign key refuses it otherwise). A field in use is deactivated instead.
 */
export async function deleteCustomFieldDef(id: string, baseUpdatedAt: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const n = await anyValueRows(id);
  if (n < 0) return { ok: false, error: "Could not check whether records hold a value — nothing deleted.", status: 503 };
  if (n > 0) return { ok: false, error: `${n} record(s) hold a value for this field. Switch it off instead — values are kept.`, status: 409 };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database unavailable", status: 503 };
  const { data, error } = await ctx.sb
    .from("custom_field_defs")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .eq("updated_at", baseUpdatedAt)
    .select("id");
  if (error) {
    if (error.code === "23503") return { ok: false, error: "Records now hold a value for this field. Switch it off instead.", status: 409 };
    return { ok: false, error: error.message, status: 500 };
  }
  if (!data?.length) return { ok: false, error: "Someone changed this field since you opened it — reload.", status: 409 };
  return { ok: true };
}

function valueFromRow(r: Row): CustomFieldValueRow {
  return {
    entityId: String(r.entity_id),
    fieldId: String(r.field_id),
    value: String(r.value ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

/** Values of these records (or of every record of the type). Paged. */
export async function readCustomFieldValues(
  entity: CustomFieldEntity,
  ids: string[] | "all",
): Promise<CustomFieldValueRow[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const cols = "id, entity_id, field_id, value, updated_at";
  const res =
    ids === "all"
      ? await fetchAllPages<Row>((from, to) =>
          ctx.sb
            .from("custom_field_values")
            .select(cols)
            .eq("tenant_id", ctx.tenantId)
            .eq("entity_type", entity)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : await fetchByIds<Row>(ids, (chunk, from, to) =>
          ctx.sb
            .from("custom_field_values")
            .select(cols)
            .eq("tenant_id", ctx.tenantId)
            .eq("entity_type", entity)
            .in("entity_id", chunk)
            .order("id", { ascending: true })
            .range(from, to),
        );
  if (res.error) {
    console.error("[custom-fields] values read failed:", res.error);
    return null;
  }
  if ("truncated" in res && res.truncated) return null;
  return res.rows.map(valueFromRow);
}

export type ValueWriteResult =
  | {
      ok: true;
      /** New stamp per `${entityId}|${fieldId}` written. */
      stamps: Record<string, string>;
      /** Changed elsewhere since loaded — the stored value stands. */
      conflicts: { entityId: string; fieldId: string }[];
      /** Refused before writing (bad value, unknown or switched-off field). */
      rejected: { entityId: string; fieldId: string; error: string }[];
    }
  | { ok: false; error: string; status: number };

export const MAX_VALUE_CHANGES = 5000;

/**
 * Write value changes by compare-and-set. Each value is re-checked against
 * its field here — the browser's check is a courtesy, this one is the rule.
 */
export async function writeCustomFieldValues(entity: CustomFieldEntity, changes: ValueChange[], by: string): Promise<ValueWriteResult> {
  if (changes.length > MAX_VALUE_CHANGES) return { ok: false, error: `At most ${MAX_VALUE_CHANGES} values per save`, status: 400 };
  const defs = await listCustomFieldDefs(entity);
  if (!defs) return { ok: false, error: "Could not read the field list — nothing saved.", status: 503 };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database unavailable", status: 503 };
  const byId = new Map(defs.map((d) => [d.id, d]));
  const stamps: Record<string, string> = {};
  const conflicts: { entityId: string; fieldId: string }[] = [];
  const rejected: { entityId: string; fieldId: string; error: string }[] = [];
  const seen = new Set<string>();
  const inserts: { key: string; entityId: string; fieldId: string; value: string }[] = [];

  for (const c of changes) {
    const entityId = String(c.entityId ?? "").trim();
    const fieldId = String(c.fieldId ?? "");
    const key = `${entityId}|${fieldId}`;
    const def = byId.get(fieldId);
    if (!entityId || entityId.length > 120) {
      rejected.push({ entityId, fieldId, error: "No record named" });
      continue;
    }
    if (!def) {
      rejected.push({ entityId, fieldId, error: "That field is no longer there" });
      continue;
    }
    if (!def.active) {
      rejected.push({ entityId, fieldId, error: `"${def.labelEn}" is switched off` });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ entityId, fieldId, error: `"${def.labelEn}" sent twice for one record` });
      continue;
    }
    seen.add(key);
    const n = normalizeCustomValue(def, String(c.value ?? ""));
    if (!n.ok) {
      rejected.push({ entityId, fieldId, error: n.error });
      continue;
    }
    const base = String(c.base ?? "");
    if (!base) {
      inserts.push({ key, entityId, fieldId, value: n.value });
      continue;
    }
    // The new stamp must differ from the old one, or a second stale copy
    // holding the same stamp would still match.
    const was = Date.parse(base);
    const { data, error } = await ctx.sb
      .from("custom_field_values")
      .update({
        value: n.value,
        updated_by: by,
        updated_at: new Date(Math.max(Date.now(), (Number.isFinite(was) ? was : 0) + 1)).toISOString(),
      })
      .eq("tenant_id", ctx.tenantId)
      .eq("entity_type", entity)
      .eq("entity_id", entityId)
      .eq("field_id", fieldId)
      .eq("updated_at", base)
      .select("updated_at");
    if (error) return { ok: false, error: error.message, status: 500 };
    if (data?.length) stamps[key] = String(data[0]!.updated_at);
    else conflicts.push({ entityId, fieldId });
  }

  // New rows go in batches (an import can bring hundreds). Insert-only: a
  // row that already exists is left alone and reported as a conflict.
  for (let i = 0; i < inserts.length; i += 200) {
    const part = inserts.slice(i, i + 200);
    const { data, error } = await ctx.sb
      .from("custom_field_values")
      .upsert(
        part.map((p) => ({ tenant_id: ctx.tenantId, entity_type: entity, entity_id: p.entityId, field_id: p.fieldId, value: p.value, updated_by: by })),
        { onConflict: "tenant_id,entity_type,entity_id,field_id", ignoreDuplicates: true },
      )
      .select("entity_id, field_id, updated_at");
    if (error) return { ok: false, error: error.message, status: 500 };
    const got = new Map(((data ?? []) as Row[]).map((d) => [`${d.entity_id}|${d.field_id}`, String(d.updated_at)]));
    for (const p of part) {
      if (got.has(p.key)) stamps[p.key] = got.get(p.key)!;
      else conflicts.push({ entityId: p.entityId, fieldId: p.fieldId }); // saved elsewhere first
    }
  }
  return { ok: true, stamps, conflicts, rejected };
}
