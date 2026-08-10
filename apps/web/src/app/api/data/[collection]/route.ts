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
 *   POST /api/data/<collection>   body: { ops: WriteOp[] }
 *
 * The body is ALWAYS a list of stated per-record changes. This endpoint
 * never accepts a whole-module state object — inferring intent by diffing
 * one is what silently deleted rows and never deleted others.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { collectionDef } from "@/lib/data/registry";
import { list, write, type Row } from "@/lib/data/server/repo";
import type { Cursor, FailCode, WriteOp } from "@/lib/data/types";

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

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");

  const result = await list(collection, {
    academicYearCode: url.searchParams.get("ay") ?? undefined,
    limit: rawLimit ? Number(rawLimit) : undefined,
    cursor: (url.searchParams.get("cursor") as Cursor | null) ?? null,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: statusFor(result.code) });
  }
  return NextResponse.json(result);
}

export async function POST(req: Request, ctx: RouteCtx) {
  const { collection } = await ctx.params;
  const def = collectionDef(collection);
  if (!def) {
    return NextResponse.json(
      { ok: false, kind: "not_found", error: "Unknown collection", conflicts: [] },
      { status: 404 },
    );
  }

  const auth = await requireStaffPermission(req, def.rbac.edit, "edit");
  if (!auth.ok) return auth.response;

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

  const ops = body.ops as WriteOp<Row>[];
  // A batch big enough to time out is a batch that will be retried forever.
  if (ops.length > def.list.maxLimit) {
    return NextResponse.json(
      {
        ok: false,
        kind: "invalid",
        message: `Too many ops (${ops.length}); the limit is ${def.list.maxLimit}`,
        conflicts: [],
      },
      { status: 400 },
    );
  }

  const result = await write(collection, ops);
  if (!result.ok) {
    return NextResponse.json(result, { status: statusFor(result.kind) });
  }
  return NextResponse.json(result);
}
