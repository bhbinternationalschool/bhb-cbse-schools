import { NextResponse } from "next/server";
import { requireAnyStaffPermission, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import { isCustomFieldEntity, isCustomFieldType, type CustomFieldDefInput } from "@/lib/customFields";
import {
  createCustomFieldDef,
  deleteCustomFieldDef,
  listCustomFieldDefs,
  updateCustomFieldDef,
} from "@/lib/customFields.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Custom field definitions (Masters → Custom fields; lib/customFields).
 * GET  ?entity=student|staff&counts=1 — anyone who can see Masters,
 *      Students or Staff (the edit pages and exports need the list).
 * POST { action: "create" | "update" | "delete", ... } — masters · edit.
 */

export async function GET(req: Request) {
  const auth = await requireAnyStaffPermission(req, [
    { module: "masters", action: "view" },
    { module: "students", action: "view" },
    { module: "staff", action: "view" },
  ]);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  if (entity && !isCustomFieldEntity(entity)) {
    return NextResponse.json({ ok: false, error: "entity must be student or staff" }, { status: 400 });
  }
  const defs = await listCustomFieldDefs(isCustomFieldEntity(entity) ? entity : undefined, { withCounts: url.searchParams.get("counts") === "1" });
  if (!defs) return NextResponse.json({ ok: false, error: "Could not read the custom fields" }, { status: 503 });
  return NextResponse.json({ ok: true, defs }, { headers: { "Cache-Control": "no-store" } });
}

function inputFrom(b: Record<string, unknown>): CustomFieldDefInput | null {
  if (!isCustomFieldEntity(b.entityType) || !isCustomFieldType(b.fieldType)) return null;
  return {
    entityType: b.entityType,
    labelEn: String(b.labelEn ?? ""),
    labelHi: String(b.labelHi ?? ""),
    fieldType: b.fieldType,
    options: Array.isArray(b.options) ? b.options.map(String) : [],
    requiredOnNew: b.requiredOnNew === true,
    active: b.active !== false,
    sortOrder: b.sortOrder == null ? undefined : Number(b.sortOrder),
  };
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "masters", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "Office";
  const action = String(body.action ?? "");

  if (action === "delete") {
    const id = String(body.id ?? "");
    const r = await deleteCustomFieldDef(id, String(body.baseUpdatedAt ?? ""));
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    await writeAudit({
      session: auth.ctx.session,
      module: "masters",
      action: "delete",
      entityType: "custom_field",
      entityId: id,
      summary: `Deleted unused custom field ${String(body.labelEn ?? id)}`,
    }).catch(() => null);
    return NextResponse.json({ ok: true });
  }

  const input = inputFrom(body);
  if (!input) return NextResponse.json({ ok: false, error: "Choose who the field is for and its type" }, { status: 400 });

  if (action === "create") {
    const r = await createCustomFieldDef(input, by);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    await writeAudit({
      session: auth.ctx.session,
      module: "masters",
      action: "create",
      entityType: "custom_field",
      entityId: r.def.id,
      summary: `Added ${r.def.entityType} custom field "${r.def.labelEn}" (${r.def.fieldType})`,
      after: r.def,
    }).catch(() => null);
    return NextResponse.json({ ok: true, def: r.def });
  }

  if (action === "update") {
    const id = String(body.id ?? "");
    const r = await updateCustomFieldDef(id, input, String(body.baseUpdatedAt ?? ""), by);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    await writeAudit({
      session: auth.ctx.session,
      module: "masters",
      action: "edit",
      entityType: "custom_field",
      entityId: id,
      summary: `Changed ${r.def.entityType} custom field "${r.def.labelEn}"${r.def.active ? "" : " (switched off)"}`,
      after: r.def,
    }).catch(() => null);
    return NextResponse.json({ ok: true, def: r.def });
  }

  return NextResponse.json({ ok: false, error: "action must be create, update or delete" }, { status: 400 });
}
