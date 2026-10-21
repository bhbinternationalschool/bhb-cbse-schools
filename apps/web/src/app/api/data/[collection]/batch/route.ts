/**
 * POST /api/data/masters/batch — one Masters action that changes several
 * elements across the `_rev` lists (data-layer 2.2c review): removing a class
 * with its subject links, a subject with its components' links, adding a class
 * with its sections. ALL OR NONE, in one desk_slice_rows_write batch — a cascade
 * refused part-way must not leave links pointing at a removed class or subject.
 *
 * Body: { ops: [{ collection: "masters.<list>", op, id, base, row? }] }
 * The same rules as POST /api/data/<masters list>, per collection: the
 * collection's edit (masters), or the FUNCTION that owns the list op by op (a
 * teacher's own-class class subjects — sliceFunctionGate); no list emptied.
 * Removals: at most MAX_BATCH_REMOVALS in one action (a whole-list wipe is far
 * larger). Any other collection here is a 404.
 */
import { NextResponse } from "next/server";
import { invalidateServerMastersCache } from "@/lib/api/v1/auth";
import { requireStaffApi, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { collectionDef, collectionKind } from "@/lib/data/registry";
import { sliceElementCount, writeMastersBatch, type Row } from "@/lib/data/server/repo";
import { sliceFunctionGate } from "@/lib/data/server/sliceFunctionGate";
import type { WriteOp } from "@/lib/data/types";
import { clearDeskProbeCache } from "@/lib/deskProbeCache.server";
import { withBuildCheck } from "@/lib/staleBuild.server";

export const runtime = "nodejs";

/** One action may remove at most this many elements (production's largest cascade: a class with 14 links). */
const MAX_BATCH_REMOVALS = 100;

type RouteCtx = { params: Promise<{ collection: string }> };

const fail = (status: number, kind: string, message: string) =>
  NextResponse.json({ ok: false, kind, message, conflicts: [] }, { status });

export const POST = withBuildCheck(async (req: Request, ctx: RouteCtx) => {
  const { collection } = await ctx.params;
  if (collection !== "masters") return fail(404, "not_found", "Unknown collection");

  let auth = await requireStaffPermission(req, "masters", "edit");
  let mode: "module" | "function" = "module";
  if (!auth.ok) {
    if (auth.response.status !== 403) return auth.response;
    const viaFunction = await requireStaffApi(req);
    if (!viaFunction.ok || viaFunction.viaMirrorSecret) return auth.response;
    auth = viaFunction;
    mode = "function";
  }

  let body: { ops?: unknown };
  try {
    body = (await req.json()) as { ops?: unknown };
  } catch {
    return fail(400, "invalid", "Invalid JSON");
  }
  if (!Array.isArray(body.ops) || body.ops.length === 0) return fail(400, "invalid", "Body must be { ops: [...] } with at least one op");
  const raw = body.ops as { collection?: unknown; op?: unknown; id?: unknown; base?: unknown; row?: unknown }[];
  if (raw.length > 500) return fail(400, "invalid", `Too many ops (${raw.length}); the limit is 500`);
  const items: { collection: string; op: WriteOp<Row> }[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !o.id || (o.op !== "upsert" && o.op !== "delete") || typeof o.collection !== "string") {
      return fail(400, "invalid", "Every op is { collection, op: upsert|delete, id, base, row? }");
    }
    const def = collectionDef(o.collection);
    if (!def || def.module !== "masters" || collectionKind(def) !== "slice" || def.slice?.base !== "rev" || def.slice.table !== "masters_desk_slices") {
      return fail(400, "invalid", `${o.collection} is not a Masters list`);
    }
    if (o.op === "upsert" && (!o.row || typeof o.row !== "object" || Array.isArray(o.row))) return fail(400, "invalid", `upsert ${o.id} has no row object`);
    items.push({
      collection: o.collection,
      op: (o.op === "delete"
        ? { op: "delete", id: o.id, base: o.base ?? null }
        : { op: "upsert", id: o.id, base: o.base ?? null, row: o.row }) as WriteOp<Row>,
    });
  }
  const removals = items.filter((i) => i.op.op === "delete").length;
  // A function holder (a teacher's own-class class subjects) removes one
  // element per save, as on the single-list route; the cascade allowance is
  // for Masters editors.
  if (mode === "function" && removals > 1) {
    return fail(400, "invalid", `One removal per save (this one removes ${removals}) — nothing was saved.`);
  }
  if (removals > MAX_BATCH_REMOVALS) {
    return fail(400, "invalid", `This action removes ${removals} items at once (the limit is ${MAX_BATCH_REMOVALS}) — nothing was saved.`);
  }

  // Per collection: who may write it, and no list left empty.
  const byCollection = new Map<string, WriteOp<Row>[]>();
  for (const i of items) byCollection.set(i.collection, [...(byCollection.get(i.collection) ?? []), i.op]);
  for (const [cid, ops] of byCollection) {
    const def = collectionDef(cid)!;
    const dels = ops.filter((o) => o.op === "delete").length;
    const adds = ops.filter((o) => o.op === "upsert").length;
    if (dels > 0) {
      let size: number;
      try {
        size = await sliceElementCount(def.slice!);
      } catch (e) {
        return fail(503, "unavailable", `Could not read ${def.slice!.key} to check this removal — nothing was saved (${e instanceof Error ? e.message : String(e)}).`);
      }
      if (dels >= size && adds === 0) return fail(400, "invalid", `This would leave ${def.slice!.key} empty — nothing was saved.`);
    }
    const gate = await sliceFunctionGate(req, def, ops, mode, auth.ctx);
    if (!gate.ok) return fail(gate.status, gate.kind, gate.message);
  }

  const result = await writeMastersBatch(items);
  if (!result.ok) return NextResponse.json(result, { status: result.kind === "conflict" ? 409 : result.kind === "invalid" ? 400 : result.kind === "auth" ? 403 : 503 });
  if (result.results.some((r) => r.status === "applied" || r.status === "deleted")) {
    clearDeskProbeCache("masters-desk-rows");
    invalidateServerMastersCache();
  }
  return NextResponse.json(result);
});
