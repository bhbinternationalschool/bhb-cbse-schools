/**
 * /api/admissions/village-aliases — the spelling review queue.
 *
 * GET    ?academicYearCode=…   the queue, the decisions taken, and coverage
 * POST   { alias, status, villageId?, leadCount?, note? }   record a decision
 * DELETE ?id=…                 undo one
 *
 * Reads need `admissions:view`; writing a spelling changes what every
 * penetration figure on the dashboard reports, so it needs `admissions:edit`.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  VillageAliasError,
  deleteAlias,
  loadAliasWorkspace,
  saveAlias,
  searchVillages,
  type SaveAliasInput,
} from "@/lib/villageAliases.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function handle(e: unknown, verb: string) {
  if (e instanceof VillageAliasError) {
    console.warn(`[village-aliases] ${verb} ${e.status}: ${e.message}`);
    return fail(e.message, e.status);
  }
  const message = e instanceof Error ? e.message : "Unexpected error";
  console.error(`[village-aliases] ${verb} unhandled: ${message}`);
  return fail("Something went wrong. Try again.", 500);
}

export async function GET(request: Request) {
  const auth = await requireStaffPermission(request, "admissions", "view");
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  try {
    // Free-text lookup for the review screen's "search all villages" box.
    const search = (params.get("villageSearch") || "").trim();
    if (search) {
      return NextResponse.json(
        { ok: true, results: await searchVillages(search) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const year = (params.get("academicYearCode") || "").trim();
    return NextResponse.json(await loadAliasWorkspace(year), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return handle(e, "GET");
  }
}

export async function POST(request: Request) {
  const auth = await requireStaffPermission(request, "admissions", "edit");
  if (!auth.ok) return auth.response;

  const session = auth.ctx.session;
  const actor = String(session.fullName || session.roleCode || "staff");

  let body: SaveAliasInput;
  try {
    body = (await request.json()) as SaveAliasInput;
  } catch {
    return fail("Invalid JSON body", 400);
  }

  try {
    return NextResponse.json({ ok: true, alias: await saveAlias(body, actor) });
  } catch (e) {
    return handle(e, "POST");
  }
}

export async function DELETE(request: Request) {
  const auth = await requireStaffPermission(request, "admissions", "edit");
  if (!auth.ok) return auth.response;

  const session = auth.ctx.session;
  const actor = String(session.fullName || session.roleCode || "staff");
  const id = new URL(request.url).searchParams.get("id") || "";

  try {
    await deleteAlias(id, actor);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handle(e, "DELETE");
  }
}
