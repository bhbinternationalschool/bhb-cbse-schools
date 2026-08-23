/**
 * /api/admissions/lead-intelligence
 *
 * POST { action: "rescore" }                       re-score every lead
 * POST { action: "resolveTravel", blocks: [...] }  geocode + route one block
 *
 * Both are write actions that cost something — one rewrites 919 score rows,
 * the other spends Google quota — so both sit behind `admissions:edit` and
 * neither runs on a page load.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { LeadScoreError, rescoreLeads } from "@/lib/leadScore.server";
import { VillageTravelError, resolveBlockTravel } from "@/lib/villageTravel.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body =
  | { action: "rescore"; academicYearCode?: string }
  | { action: "resolveTravel"; blocks?: string[]; villageIds?: string[]; limit?: number; refresh?: boolean };

function fail(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  const auth = await requireStaffPermission(request, "admissions", "edit");
  if (!auth.ok) return auth.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return fail("Invalid JSON body", 400);
  }

  try {
    if (body.action === "rescore") {
      return NextResponse.json(await rescoreLeads(body.academicYearCode ?? ""));
    }

    if (body.action === "resolveTravel") {
      const result = await resolveBlockTravel({
        blocks: body.blocks ?? [],
        villageIds: body.villageIds,
        limit: body.limit,
        refresh: body.refresh === true,
      });
      // Travel times feed the distance component of every lead score, so a
      // resolve that did not re-score would leave the two disagreeing until
      // somebody happened to press the other button.
      const rescored = await rescoreLeads("");
      return NextResponse.json({ ...result, rescored: rescored.scored });
    }

    return fail("Unknown action", 400);
  } catch (e) {
    if (e instanceof LeadScoreError || e instanceof VillageTravelError) {
      console.warn(`[lead-intelligence] ${e.status}: ${e.message}`);
      return fail(e.message, e.status);
    }
    const message = e instanceof Error ? e.message : "Unexpected error";
    console.error("[lead-intelligence] unhandled:", message);
    return fail("Something went wrong. Try again.", 500);
  }
}
