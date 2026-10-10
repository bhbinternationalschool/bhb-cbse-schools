import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import { requireStaffApi, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  fetchStaffRemoteServer,
  pushStaffRemoteServer,
  wipeRemoteStaffRosterServer,
} from "@/lib/staffPersistence";
import type { MastersState } from "@/lib/masters";
import type { StaffRecord } from "@/lib/foundationMasters";
import { hasPermission } from "@/lib/rbac";
import { redactStaffRoster } from "@/lib/staffRosterRedact";

export const runtime = "nodejs";

/** GET — pull staff/departments/designations from normalized tables */
export async function GET(req: Request) {
  // Any member of staff: the directory + their own record (redacted below).
  // Everyone needs their own record — punch card, leave, payslips, the
  // teacher home — and staff.view is no longer given to teachers.
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;

  // staff.view is held by teachers, accounts, transport and the auditor.
  // They get a directory and their own record — never colleagues' Aadhaar,
  // PAN, bank, salary or anyone's password (lib/staffRosterRedact.ts).
  const canEditStaff =
    auth.viaMirrorSecret ||
    hasPermission(auth.ctx.session, auth.ctx.masters, "staff", "edit", auth.ctx.rbac);
  const selfStaffId = auth.viaMirrorSecret ? "" : auth.ctx.session.staffId || "";
  if (!auth.viaMirrorSecret) {
    try {
      const bundle = await fetchStaffRemoteServer();
      if (!bundle) throw new Error("Staff roster fetch failed — tenant/db unavailable");
      return NextResponse.json(
        {
          ok: true,
          ...bundle,
          staff: redactStaffRoster(bundle.staff as StaffRecord[], { canEditStaff, selfStaffId }),
          redacted: !canEditStaff,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Staff roster fetch failed" },
        { status: 503 },
      );
    }
  }

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

  // Browsers never receive loginPassword any more (staffRosterRedact), so a
  // blank one in a save means "not sent", not "clear it": keep the stored.
  const incoming = (body.state.staff ?? []) as StaffRecord[];
  if (incoming.some((s) => !s.loginPassword)) {
    const stored = await fetchStaffRemoteServer();
    if (!stored) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved roster to check this change — nothing was written, try again" },
        { status: 503 },
      );
    }
    const pw = new Map((stored.staff as StaffRecord[]).map((s) => [s.id, s.loginPassword || ""]));
    body.state = {
      ...body.state,
      staff: incoming.map((s) => (s.loginPassword ? s : { ...s, loginPassword: pw.get(s.id) || "" })),
    };
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
