/**
 * Comms → Parents on app: which families have the parent app, class by
 * class, and when each last opened it (lib/parentsOnApp).
 *
 * GET (notices · edit — office; every parent's mobile is in it) → { ok, summary, classes, asOf }
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { buildParentsOnApp, type AppDevice, type RosterChild } from "@/lib/parentsOnApp";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { isHiddenReviewDemoHousehold, loadSisForStaff } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "notices", "edit");
  if (!auth.ok) return auth.response;
  const ctx = await getServerTenantContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Database unavailable" }, { status: 503 });

  // Every phone, paged — a failed read is an error, never "nobody has the app".
  const devices: AppDevice[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.sb
      .from("push_device_tokens")
      .select("subject_id, app_version, created_at, last_seen_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("subject_type", "parent")
      .order("id")
      .range(from, from + 999);
    if (error) return NextResponse.json({ ok: false, error: "Could not read app devices" }, { status: 503 });
    for (const r of data ?? []) {
      const householdId = String(r.subject_id ?? "");
      if (!householdId || isHiddenReviewDemoHousehold(householdId)) continue;
      devices.push({
        householdId,
        appVersion: String(r.app_version ?? ""),
        createdAt: String(r.created_at ?? ""),
        lastSeenAt: String(r.last_seen_at ?? ""),
      });
    }
    if ((data ?? []).length < 1000) break;
  }

  await ensureSchoolMirrorHydrated();
  await ensureSisHydratedServer();
  const masters = loadMasters();
  const sis = loadSisForStaff();
  const ay = currentAcademicYearCode(masters);
  const classes = new Map(masters.classes.map((c) => [c.id, c]));
  const sections = new Map(masters.sections.map((s) => [s.id, s.name]));

  // One row per child: the session's row when there are per-year duplicates.
  const byChild = new Map<string, RosterChild & { ay: string }>();
  for (const s of sis.students) {
    if (s.status !== "active" || !s.householdId) continue;
    const key = `${s.householdId}|${s.admissionNo || s.id}`;
    const prev = byChild.get(key);
    if (prev && (prev.ay === ay || (s.academicYearCode !== ay && prev.ay >= s.academicYearCode))) continue;
    const cls = classes.get(s.classId);
    byChild.set(key, {
      householdId: s.householdId,
      key,
      name: s.fullName,
      classId: s.classId || "none",
      className: cls?.name ?? "",
      classSort: cls?.sortOrder ?? 999,
      section: sections.get(s.sectionId) ?? "",
      ay: s.academicYearCode,
    });
  }

  const built = buildParentsOnApp({
    devices,
    families: sis.households.map((h) => ({ householdId: h.id, guardianName: h.guardianName, mobile: h.mobile })),
    children: [...byChild.values()],
  });
  return NextResponse.json({ ok: true, ...built, asOf: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
