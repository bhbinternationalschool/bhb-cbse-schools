import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  fetchStaffRemoteServer,
  pushStaffRemoteServer,
  wipeRemoteStaffRosterServer,
} from "@/lib/staffPersistence";
import type { MastersState } from "@/lib/masters";

export const runtime = "nodejs";

/** GET — pull staff/departments/designations from normalized tables */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "view");
  if (!auth.ok) return auth.response;

  try {
    const result = await cachedDeskJson({
      cacheKey: "staff-roster",
      tables: ["sis_staff", "sis_departments", "sis_designations"],
      ifNoneMatch: req.headers.get("if-none-match"),
      build: async () => {
        const bundle = await fetchStaffRemoteServer();
        if (!bundle) throw new Error("Staff roster fetch failed — tenant/db unavailable");
        return { ok: true, ...bundle };
      },
    });
    return deskJsonResponse(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Staff roster fetch failed" },
      { status: 503 },
    );
  }
}

/** POST — push a Masters state's staff/department/designation slices */
export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "edit");
  if (!auth.ok) return auth.response;

  let body: { state?: Partial<MastersState> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.state) {
    return NextResponse.json({ error: "Missing state" }, { status: 400 });
  }

  const result = await pushStaffRemoteServer(body.state as MastersState);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Push failed" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}

/** DELETE — wipe staff roster (used by tenant reset flows) */
export async function DELETE(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "delete");
  if (!auth.ok) return auth.response;

  const result = await wipeRemoteStaffRosterServer();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Wipe failed" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
