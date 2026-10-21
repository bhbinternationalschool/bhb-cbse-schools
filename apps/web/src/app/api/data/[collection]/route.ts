/**
 * The generic data endpoint.
 *
 * One pair of handlers for every collection, replacing the pattern behind
 * the 33 routes under /api/school-data. Those routes were near-identical and
 * each re-implemented auth, scoping and error handling — which is how the
 * same bug shipped 33 times in slightly different forms. Notably, several
 * return HTTP 200 {ok:true, skipped:true} when their dual-write flag is off,
 * so a client records success while the database is untouched. There is no
 * equivalent here: a write either happens or the status code says it did not.
 *
 * Contract:
 *   GET  /api/data/<collection>?ay=2026-27&limit=100&cursor=…
 *   GET  /api/data/<collection>?ids=a,b      current revisions (rows only)
 *   POST /api/data/<collection>   body: { ops: WriteOp[] }
 *
 * Since data-layer 1.5: a null base on a record that exists is refused (409,
 * reason "unversioned"); a batch is all-or-none; every applied op moves the
 * desk's sync_meta (erp_versions); a slice collection takes one op per
 * request; deleting a student or a family needs `students` approve; a
 * teacher's GET of sis.* returns only the rows in their reach.
 *
 * The body is ALWAYS a list of stated per-record changes. This endpoint
 * never accepts a whole-module state object — inferring intent by diffing
 * one is what silently deleted rows and never deleted others.
 */

import { NextResponse } from "next/server";
import { invalidateServerMastersCache, invalidateServerRbacCache } from "@/lib/api/v1/auth";
import { readStaffScopeForDesk } from "@/lib/api/v1/staffScope";
import { requireStaffApi, requireStaffPermission, type RouteAuthSuccess } from "@/lib/apiRouteAuth.server";
import { batchNeedsApproval } from "@/lib/data/approvalGate";
import { collectionDef, collectionKind, type CollectionDef } from "@/lib/data/registry";
import {
  householdIdsForSections,
  list,
  readRowsByIds,
  revisionsOf,
  sliceElementCount,
  staffSignInLinks,
  write,
  writeSlice,
  writeSliceBatch,
  type Row,
  type RowScope,
} from "@/lib/data/server/repo";
import { sliceFunctionGate } from "@/lib/data/server/sliceFunctionGate";
import { prepareStaffOps, staffListRows } from "@/lib/data/server/staffKernel";
import { staffActorOf } from "@/lib/staffProtectedFields";
import type { Cursor, FailCode, WriteOp, WriteResult } from "@/lib/data/types";
import { clearDeskProbeCache } from "@/lib/deskProbeCache.server";
import { hasPermission } from "@/lib/rbac";
import { withBuildCheck } from "@/lib/staleBuild.server";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ collection: string }> };

/** One mapping from failure kind to status code, so routes cannot disagree. */
function statusFor(code: FailCode | "conflict"): number {
  switch (code) {
    case "not_found":
      return 404;
    case "invalid":
      return 400;
    case "auth":
      return 403;
    case "conflict":
      return 409;
    case "network":
    case "unavailable":
      return 503;
  }
}

export async function GET(req: Request, ctx: RouteCtx) {
  const { collection } = await ctx.params;
  const def = collectionDef(collection);
  // Unknown ids are rejected before the value reaches anything that could
  // interpolate it — it arrives from a URL and is never trusted.
  if (!def) {
    return NextResponse.json(
      { ok: false, code: "not_found", error: "Unknown collection" },
      { status: 404 },
    );
  }

  const auth = await requireStaffPermission(req, def.rbac.view, "view");
  if (!auth.ok) return auth.response;

  // A teacher reads only what is in reach (data-layer 1.5). Until this, any
  // students.view holder could page the whole roster here.
  const reach = await teacherReach(def, auth);
  if (!reach.ok) return reach.response;

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");

  // `?ids=a,b` — the current revisions of named records, soft-deleted ones
  // included (to revive one, or put away a sheet held from elsewhere). Not
  // for a scoped (teacher) read: it would name rows outside the reach.
  const rawIds = url.searchParams.get("ids");
  if (rawIds !== null) {
    if (reach.scope) {
      return NextResponse.json(
        { ok: false, code: "auth", error: "Revisions by id are not available to a scoped session" },
        { status: 403 },
      );
    }
    const result = await revisionsOf(collection, rawIds.split(","));
    if (!result.ok) return NextResponse.json(result, { status: statusFor(result.code) });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  }

  // `?removed=1` — a soft-delete collection's REMOVED records (to restore
  // one; data-layer 2.2b). Only for a holder of the collection's `edit`.
  const removed = url.searchParams.get("removed") === "1";
  if (removed) {
    const editor =
      auth.viaMirrorSecret || hasPermission(auth.ctx.session, auth.ctx.masters, def.rbac.edit, "edit", auth.ctx.rbac);
    if (!editor || reach.scope) {
      return NextResponse.json(
        { ok: false, code: "auth", error: "Removed records are listed only for those who may restore them" },
        { status: 403 },
      );
    }
  }

  const result = await list(collection, {
    academicYearCode: url.searchParams.get("ay") ?? undefined,
    limit: rawLimit ? Number(rawLimit) : undefined,
    cursor: (url.searchParams.get("cursor") as Cursor | null) ?? null,
    scope: reach.scope,
    removed,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: statusFor(result.code) });
  }
  if (def.staffRecords) {
    // A directory for anyone without staff · edit (their own row in full);
    // never a password, whoever asks (the staff-roster GET's rule).
    const canEdit =
      auth.viaMirrorSecret || hasPermission(auth.ctx.session, auth.ctx.masters, def.rbac.edit, "edit", auth.ctx.rbac);
    const selfStaffId = auth.viaMirrorSecret ? "" : auth.ctx.session.staffId || "";
    return NextResponse.json(
      { ...result, rows: staffListRows(result.rows, { canEdit, selfStaffId }) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * The reach of this session over a collection with a `teacherScope`
 * (registry). No restriction for the mirror secret, a holder of `edit` on
 * the collection's module (as sis-roster: they get the whole roster anyway),
 * or a school-wide session. Otherwise the teacher's sections from
 * staffSectionScope (1.7) — or 403 for a collection that cannot be scoped.
 * An unknown scope is a 503 (R6), never the whole school.
 */
async function teacherReach(
  def: CollectionDef,
  auth: RouteAuthSuccess,
): Promise<{ ok: true; scope?: RowScope } | { ok: false; response: NextResponse }> {
  if (!def.teacherScope || auth.viaMirrorSecret) return { ok: true };
  const { session, masters, rbac } = auth.ctx;
  if (hasPermission(session, masters, def.rbac.edit, "edit", rbac)) return { ok: true };
  const read = await readStaffScopeForDesk(auth.ctx);
  if (!read.ok) return read;
  const scope = read.scope;
  if (!scope) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, code: "auth", error: "Staff session required" }, { status: 403 }),
    };
  }
  if (scope.unrestricted) return { ok: true };
  if (def.teacherScope === "deny") {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, code: "auth", error: `${def.id} covers the whole school; it is not available to a class login` },
        { status: 403 },
      ),
    };
  }
  const sections = Array.from(scope.sections).map((k) => {
    const at = k.indexOf("|");
    return { classId: k.slice(0, at), sectionId: k.slice(at + 1) };
  });
  if (def.teacherScope === "section") return { ok: true, scope: { kind: "sections", sections } };
  try {
    return { ok: true, scope: { kind: "households", ids: await householdIdsForSections(sections) } };
  } catch (e) {
    console.error("[data] household reach could not be read", e instanceof Error ? e.message : e);
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, code: "unavailable", error: "Could not work out your families — please try again.", scopeUnknown: true },
        { status: 503 },
      ),
    };
  }
}

/** Drop the server caches a changed collection feeds (registry `invalidates`). */
function invalidateAfterWrite(def: CollectionDef, result: WriteResult<Row>): void {
  if (!result.ok) return;
  if (!result.results.some((r) => r.status === "applied" || r.status === "deleted")) return;
  for (const key of def.invalidates?.probeCaches ?? []) clearDeskProbeCache(key);
  for (const ref of def.invalidates?.reference ?? []) {
    if (ref === "masters") invalidateServerMastersCache();
    if (ref === "rbac") invalidateServerRbacCache();
  }
}

/**
 * A write from a page on an older build is recorded (one log line and
 * `X-Bhb-Build-Stale: 1`) and otherwise handled exactly as any other —
 * never refused here; see lib/staleBuild.server.ts.
 */
export const POST = withBuildCheck(postOps);

async function postOps(req: Request, ctx: RouteCtx) {
  const { collection } = await ctx.params;
  const def = collectionDef(collection);
  if (!def) {
    return NextResponse.json(
      { ok: false, kind: "not_found", error: "Unknown collection", conflicts: [] },
      { status: 404 },
    );
  }

  // The collection's `edit` — or, for a Masters list owned by a FUNCTION
  // (Masters → Roles → functions: a teacher's own-class class subjects),
  // that function, checked op by op below (data-layer 2.2b).
  let auth = await requireStaffPermission(req, def.rbac.edit, "edit");
  let functionOnly = false;
  if (!auth.ok) {
    if (auth.response.status !== 403 || collectionKind(def) !== "slice") return auth.response;
    const viaFunction = await requireStaffApi(req);
    if (!viaFunction.ok || viaFunction.viaMirrorSecret) return auth.response;
    auth = viaFunction;
    functionOnly = true;
  }

  let body: { ops?: unknown };
  try {
    body = (await req.json()) as { ops?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, kind: "invalid", message: "Invalid JSON", conflicts: [] },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.ops)) {
    return NextResponse.json(
      {
        ok: false,
        kind: "invalid",
        // Named explicitly: a client porting from the old endpoints will
        // send { state: … }, and it should be told exactly why that is gone.
        message:
          "Body must be { ops: [...] }. Whole-module state is not accepted — " +
          "state each change as an op.",
        conflicts: [],
      },
      { status: 400 },
    );
  }

  let ops = body.ops as WriteOp<Row>[];
  if (ops.some((o) => !o || typeof o !== "object" || typeof (o as { id?: unknown }).id !== "string" || !(o as { id: string }).id)) {
    return NextResponse.json(
      { ok: false, kind: "invalid", message: "Every op is an object with a string id", conflicts: [] },
      { status: 400 },
    );
  }
  // A batch big enough to time out is a batch that will be retried forever.
  // 500 for every collection (the batch RPC's own ceiling), less where the
  // registry says so.
  if (ops.length > Math.min(def.list.maxLimit, 500)) {
    return NextResponse.json(
      {
        ok: false,
        kind: "invalid",
        message: `Too many ops (${ops.length}); the limit is ${Math.min(def.list.maxLimit, 500)}`,
        conflicts: [],
      },
      { status: 400 },
    );
  }

  // A decision, not data entry. Checked HERE and not only in the desk,
  // because the desk's Publish button is a suggestion — the API is one fetch
  // away from anyone holding an editor's session.
  if (
    batchNeedsApproval(
      def.approval,
      ops as unknown as { op?: string; row?: Record<string, unknown> }[],
    )
  ) {
    const approver = await requireStaffPermission(
      req,
      def.approval!.module,
      def.approval!.action ?? "approve",
    );
    if (!approver.ok) {
      return NextResponse.json(
        {
          ok: false,
          // "auth" is the vocabulary's word for 401/403 — the client already
          // knows it. Inventing a kind would land in whatever default branch
          // each caller happens to have.
          kind: "auth",
          message: def.approval!.message,
          conflicts: [],
        },
        { status: 403 },
      );
    }
  }

  // A Masters list element: who may write it, op by op — the whole module
  // (unless the office turned that function off for this person), or the
  // function that owns the list, within its actions and, for a class-scoped
  // one, the person's own classes (data-layer 2.2b).
  if (collectionKind(def) === "slice") {
    // The commit rules, on the server too (the browser's useMastersMutation
    // says the same): removing is one element per save, and no save leaves a
    // list empty — every whole-list wipe looked like a save that did.
    const deletes = ops.filter((o) => o.op === "delete").length;
    if (deletes > 1) {
      return NextResponse.json(
        { ok: false, kind: "invalid", message: `One removal per save (this one removes ${deletes}) — nothing was saved.`, conflicts: [] },
        { status: 400 },
      );
    }
    if (deletes === 1 && !ops.some((o) => o.op === "upsert")) {
      let size: number;
      try {
        size = await sliceElementCount(def.slice!);
      } catch (e) {
        return NextResponse.json(
          { ok: false, kind: "unavailable", message: `Could not read the list to check this removal — nothing was saved (${e instanceof Error ? e.message : String(e)}).`, conflicts: [] },
          { status: 503 },
        );
      }
      if (size <= 1) {
        return NextResponse.json(
          { ok: false, kind: "invalid", message: `This would leave ${def.slice!.key} empty — nothing was saved.`, conflicts: [] },
          { status: 400 },
        );
      }
    }
    const gate = await sliceFunctionGate(req, def, ops, functionOnly ? "function" : "module", auth.ctx);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, kind: gate.kind, message: gate.message, conflicts: [] }, { status: gate.status });
    }
  } else if (functionOnly) {
    return NextResponse.json({ ok: false, kind: "auth", message: "Forbidden", conflicts: [] }, { status: 403 });
  }

  // Staff records: protected fields, `by` from the session (data-layer 2.2b).
  if (def.staffRecords) {
    const by = auth.viaMirrorSecret ? "mirror-sync" : staffActorOf(auth.ctx.session);
    const prepared = await prepareStaffOps(ops, by, (ids) => readRowsByIds(def.table, ids), () => staffSignInLinks());
    if (!prepared.ok) {
      const kind = prepared.status === 403 ? "auth" : prepared.status === 400 ? "invalid" : "unavailable";
      return NextResponse.json({ ok: false, kind, message: prepared.message, conflicts: [] }, { status: prepared.status });
    }
    ops = prepared.ops;
  } else {
    // `by` is the server's to say, on every collection: a delete is stamped
    // with the session (desk_write_guarded records it where the table has
    // deleted_by), never with what the body claims.
    const by = auth.viaMirrorSecret ? "mirror-sync" : staffActorOf(auth.ctx.session) || auth.ctx.session.fullName || "";
    ops = ops.map((o) => {
      const { by: _ignored, ...rest } = o as WriteOp<Row> & { by?: unknown };
      void _ignored;
      return (o.op === "delete" ? { ...rest, by } : rest) as WriteOp<Row>;
    });
  }

  // Rows go through desk_write_guarded; slice elements and object slices
  // through their RPCs (registry `kind`) — one op per request, except a
  // `_rev` list, whose several ops go as ONE all-or-none batch.
  const result =
    collectionKind(def) === "rows"
      ? await write(collection, ops)
      : collectionKind(def) === "slice" && def.slice?.base === "rev" && ops.length > 1
        ? await writeSliceBatch(collection, ops)
        : await writeSlice(collection, ops);
  invalidateAfterWrite(def, result);
  if (!result.ok) {
    return NextResponse.json(result, { status: statusFor(result.kind) });
  }
  return NextResponse.json(result);
}
