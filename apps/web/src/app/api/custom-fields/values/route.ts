import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import { isCustomFieldEntity, type CustomFieldEntity, type ValueChange } from "@/lib/customFields";
import { MAX_VALUE_CHANGES, readCustomFieldValues, writeCustomFieldValues } from "@/lib/customFields.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Custom field VALUES — stored apart from the student/staff record, one row
 * per (record, field), written by compare-and-set (lib/customFields.server).
 *
 * GET  ?entity=student&ids=a,b,c   (or &all=1 for exports)
 *      — students · view / staff · view
 * POST { entity, changes: [{ entityId, fieldId, value, base }] }
 *      — students · edit / staff · edit: whoever may edit the record.
 *      Returns { stamps, conflicts, rejected }.
 */

const MODULE: Record<CustomFieldEntity, "students" | "staff"> = { student: "students", staff: "staff" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  if (!isCustomFieldEntity(entity)) return NextResponse.json({ ok: false, error: "entity must be student or staff" }, { status: 400 });
  const auth = await requireStaffPermission(req, MODULE[entity], "view");
  if (!auth.ok) return auth.response;
  const all = url.searchParams.get("all") === "1";
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!all && !ids.length) return NextResponse.json({ ok: false, error: "Name the records (ids) or ask for all" }, { status: 400 });
  // Refused, not trimmed: a silently shortened list would read as "no value" for the rest.
  if (ids.length > 500) return NextResponse.json({ ok: false, error: "At most 500 records per read" }, { status: 400 });
  const values = await readCustomFieldValues(entity, all ? "all" : ids);
  if (!values) return NextResponse.json({ ok: false, error: "Could not read the saved details" }, { status: 503 });
  return NextResponse.json({ ok: true, values }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const entity = body.entity;
  if (!isCustomFieldEntity(entity)) return NextResponse.json({ ok: false, error: "entity must be student or staff" }, { status: 400 });
  const auth = await requireStaffPermission(req, MODULE[entity], "edit");
  if (!auth.ok) return auth.response;
  if (!Array.isArray(body.changes)) return NextResponse.json({ ok: false, error: "changes must be a list" }, { status: 400 });
  if (body.changes.length > MAX_VALUE_CHANGES) {
    return NextResponse.json({ ok: false, error: `At most ${MAX_VALUE_CHANGES} values per save` }, { status: 400 });
  }
  const changes: ValueChange[] = (body.changes as Record<string, unknown>[]).map((c) => ({
    entityId: String(c?.entityId ?? ""),
    fieldId: String(c?.fieldId ?? ""),
    value: String(c?.value ?? ""),
    base: String(c?.base ?? ""),
  }));
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "Office";
  const r = await writeCustomFieldValues(entity, changes, by);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  const written = Object.keys(r.stamps);
  if (written.length) {
    const records = new Set(written.map((k) => k.split("|")[0]));
    await writeAudit({
      session: auth.ctx.session,
      module: MODULE[entity],
      action: "update",
      entityType: `${entity}_custom_fields`,
      entityId: records.size === 1 ? [...records][0] : "MANY",
      summary: `More details: ${written.length} value(s) saved on ${records.size} ${entity} record(s)${r.conflicts.length ? `, ${r.conflicts.length} changed elsewhere` : ""}`,
      after: { values: written.length, records: records.size, source: String(body.source ?? "form") },
    }).catch(() => null);
  }
  return NextResponse.json({ ok: true, stamps: r.stamps, conflicts: r.conflicts, rejected: r.rejected });
}
