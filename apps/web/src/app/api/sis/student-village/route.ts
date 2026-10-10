/**
 * /api/sis/student-village — village and boarding point for a student.
 *
 * GET  ?directory=1              every village with block, centroid and travel
 * GET  ?studentId=…              that student's village link and pinned point
 * POST { studentId, villageId }  record the household's village (a human choice)
 * POST { studentId, lat, lng, pointName? }  pin the boarding point
 *
 * Village choice is a household fact and lands on the household, so siblings
 * inherit it. The boarding pin is per student, because an older child may be
 * put on the main road while the younger is collected nearer home.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type Body = {
  studentId?: string;
  /** null clears the village link. */
  villageId?: string | null;
  lat?: number;
  lng?: number;
  pointName?: string;
  note?: string;
  stopId?: string;
};

export async function GET(request: Request) {
  const auth = await requireStaffPermission(request, "transport", "view");
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const ctx = await getServerTenantContext();
  if (!ctx) return fail("Database is not reachable.", 503);

  try {
    if (params.get("directory")) {
      // Paginated. PostgREST applies its server-side max-rows cap to a
      // set-returning RPC just as it does to a table read, so a single call
      // returned 1,000 of 1,292 villages — the dropdown would have been
      // missing a whole block with no sign anything was wrong.
      const raw: Record<string, unknown>[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await ctx.sb
          .rpc("village_directory", { p_tenant_id: ctx.tenantId })
          .range(from, from + PAGE - 1);
        if (error) return fail(`Could not read villages: ${error.message}`, 502);
        const page = (data as Record<string, unknown>[] | null) ?? [];
        raw.push(...page);
        if (page.length < PAGE) break;
      }
      const villages = raw.map((v) => ({
        villageId: String(v.village_id),
        villageName: String(v.village_name ?? ""),
        blockName: String(v.block_name ?? ""),
        settlementType: v.settlement_type === "town" ? "town" : "village",
        latitude: typeof v.latitude === "number" ? v.latitude : null,
        longitude: typeof v.longitude === "number" ? v.longitude : null,
        distanceKm: v.distance_km === null ? null : Number(v.distance_km),
        durationMinutes: v.duration_minutes === null ? null : Number(v.duration_minutes),
        students: Number(v.students) || 0,
      }));
      return NextResponse.json({ ok: true, villages });
    }

    const studentId = (params.get("studentId") || "").trim();
    if (!studentId) return fail("studentId or directory=1 required", 400);

    const { data: student, error: sErr } = await ctx.sb
      .from("sis_students")
      .select("id, household_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", studentId)
      .maybeSingle();
    if (sErr) return fail(`Could not read the student: ${sErr.message}`, 502);
    if (!student) return fail("Student not found", 404);

    const householdId = (student as { household_id: string | null }).household_id ?? "";

    const [linkRes, pinRes] = await Promise.all([
      householdId
        ? ctx.sb
            .from("sis_household_village")
            .select("village_id, village_name, block_name, match_source, match_confidence")
            .eq("tenant_id", ctx.tenantId)
            .eq("household_id", householdId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      ctx.sb
        .from("sis_student_transport_point")
        .select("village_id, latitude, longitude, point_name, note, set_by, set_at")
        .eq("tenant_id", ctx.tenantId)
        .eq("student_id", studentId)
        .maybeSingle(),
    ]);

    const link = linkRes.data as Record<string, unknown> | null;
    const pin = pinRes.data as Record<string, unknown> | null;

    return NextResponse.json({
      ok: true,
      householdId,
      village: link
        ? {
            villageId: link.village_id ? String(link.village_id) : null,
            villageName: String(link.village_name ?? ""),
            blockName: String(link.block_name ?? ""),
            // "address_scan" means nobody has confirmed this — the UI says so
            // rather than presenting a guess as the family's own answer.
            source: String(link.match_source ?? ""),
            confidence: String(link.match_confidence ?? ""),
          }
        : null,
      point: pin
        ? {
            latitude: Number(pin.latitude),
            longitude: Number(pin.longitude),
            pointName: String(pin.point_name ?? ""),
            note: String(pin.note ?? ""),
            setBy: String(pin.set_by ?? ""),
            setAt: String(pin.set_at ?? ""),
          }
        : null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    console.error("[student-village] GET failed:", message);
    return fail("Could not load the village details.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireStaffPermission(request, "transport", "edit");
  if (!auth.ok) return auth.response;

  const session = auth.ctx.session;
  const actor = String(session.fullName || session.roleCode || "staff");

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return fail("Invalid JSON body", 400);
  }

  const studentId = (body.studentId || "").trim();
  if (!studentId) return fail("studentId is required", 400);

  const ctx = await getServerTenantContext();
  if (!ctx) return fail("Database is not reachable.", 503);

  try {
    const { data: student, error: sErr } = await ctx.sb
      .from("sis_students")
      .select("id, household_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", studentId)
      .maybeSingle();
    if (sErr) return fail(`Could not read the student: ${sErr.message}`, 502);
    if (!student) return fail("Student not found", 404);
    const householdId = (student as { household_id: string | null }).household_id ?? "";

    /* ── village choice (household-wide) ───────────────────── */
    if (body.villageId !== undefined) {
      if (!householdId) {
        return fail(
          "This student has no household on file, so a village cannot be recorded against them.",
          409,
        );
      }
      const { error } = await ctx.sb.rpc("set_household_village", {
        p_tenant_id: ctx.tenantId,
        p_household_id: householdId,
        p_village_id: body.villageId,
        p_actor: actor,
      });
      if (error) return fail(`Could not save the village: ${error.message}`, 502);
      console.info(
        `[student-village] village set student=${studentId} village=${body.villageId ?? "cleared"} by=${actor}`,
      );
    }

    /* ── boarding pin (per student) ────────────────────────── */
    if (body.lat !== undefined && body.lng !== undefined) {
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      // A pin outside north India is a dropped map, not a boarding point.
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < 20 ||
        lat > 31 ||
        lng < 77 ||
        lng > 89
      ) {
        return fail("That pin is outside the district — drop it near the village.", 400);
      }
      const { error } = await ctx.sb.from("sis_student_transport_point").upsert(
        {
          student_id: studentId,
          tenant_id: ctx.tenantId,
          village_id: body.villageId ?? null,
          latitude: lat,
          longitude: lng,
          point_name: (body.pointName || "").slice(0, 120),
          note: (body.note || "").slice(0, 500),
          stop_id: (body.stopId || "").slice(0, 60),
          set_by: actor,
          set_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id" },
      );
      if (error) return fail(`Could not save the boarding point: ${error.message}`, 502);
      console.info(`[student-village] pin saved student=${studentId} by=${actor}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    console.error("[student-village] POST failed:", message);
    return fail("Could not save. Try again.", 500);
  }
}
