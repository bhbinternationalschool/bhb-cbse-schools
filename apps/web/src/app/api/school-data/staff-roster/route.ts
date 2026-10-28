import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import { requireStaffApi, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { fetchStaffRemoteServer, softRemoveStaffRosterServer } from "@/lib/staffPersistence";
import { invalidateServerMastersCache } from "@/lib/api/v1/auth";
import { clearDeskProbeCache } from "@/lib/deskProbeCache.server";
import { staffActorOf, staffSensitiveAuthority } from "@/lib/staffProtectedFields";
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
    hasPermission(auth.ctx.session, auth.ctx.masters, "staff", "edit", auth.ctx.rbac) ||
    // The owner and the bank & pay details function read whole records (2.2b).
    staffSensitiveAuthority(auth.ctx.session, auth.ctx.masters, auth.ctx.rbac, { rbacKnown: auth.ctx.rbacKnown !== false }) !== null;
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

/**
 * POST — gone (data-layer 2.2d). The staff screens write rows through the
 * kernel: POST /api/data/sis.staff, sis.departments, sis.designations (and
 * /api/data/sis.staff/sensitive for bank, ID, pay and login details). This
 * whole-roster save is refused for every body, nothing written; an old tab
 * that still sends it is told to reload.
 */
export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  console.warn(
    `[staff-roster] refused a whole-roster POST (410) from ${auth.viaMirrorSecret ? "mirror" : auth.ctx.session.staffId || auth.ctx.session.email || "?"}`,
  );
  return NextResponse.json(
    {
      ok: false,
      code: "gone",
      error:
        "This page is out of date: staff records are now saved one by one. Reload the page and make the change again — nothing was saved.",
    },
    { status: 410 },
  );
}

/**
 * DELETE — remove the whole staff roster. Since data-layer 2.2b a SOFT
 * remove (deleted_at + deleted_by = this session): hidden everywhere,
 * restorable; departments and designations stay. It hard-deleted every
 * sis_staff, sis_designations and sis_departments row before.
 */
export async function DELETE(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "delete");
  if (!auth.ok) return auth.response;

  const by = auth.viaMirrorSecret ? "mirror-sync" : staffActorOf(auth.ctx.session) || auth.ctx.session.fullName;
  const result = await softRemoveStaffRosterServer(by);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Remove failed" },
      { status: 502 },
    );
  }
  clearDeskProbeCache("staff-roster");
  invalidateServerMastersCache();
  return NextResponse.json({ ok: true, removed: result.removed ?? 0, soft: true });
}
