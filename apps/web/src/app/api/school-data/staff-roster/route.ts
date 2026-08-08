import { NextResponse } from "next/server";
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

  const bundle = await fetchStaffRemoteServer();
  if (!bundle) {
    return NextResponse.json(
      { ok: false, error: "Staff roster fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, ...bundle });
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
