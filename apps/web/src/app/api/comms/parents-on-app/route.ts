/**
 * Comms → Parents on app: parent app adoption by class and section — who
 * signed in, who opened it lately, notifications, app version, and the
 * families who never signed in with their phone numbers (lib/parentsOnApp).
 *
 * GET (notices · edit — office; every parent's mobile is in it)
 *   → { ok, summary, classes, families, asOf, presenceAvailable }
 *
 * Reads only. Sign-ins and push tokens are essential: if either cannot be
 * read the report refuses (unknown is not "nobody is on the app"). The
 * app-open stamps (parent_app_presence) are additive — if that table cannot
 * be read the report still loads and says so (presenceAvailable: false).
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { childrenOnRoll } from "@/lib/appPopups";
import { loadMasters } from "@/lib/masters";
import { buildParentsOnApp, type AppDevice, type AppLogin, type AppPresence, type RosterChild } from "@/lib/parentsOnApp";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { isHiddenReviewDemoHousehold, loadSisForStaff } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { fetchAllPages } from "@/lib/supabase/pageAll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "notices", "edit");
  if (!auth.ok) return auth.response;
  const ctx = await getServerTenantContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Database unavailable" }, { status: 503 });

  const [tokens, logins, presence] = await Promise.all([
    fetchAllPages<{ subject_id: string; app_version: string | null; created_at: string; last_seen_at: string }>((from, to) =>
      ctx.sb
        .from("push_device_tokens")
        .select("subject_id, app_version, created_at, last_seen_at")
        .eq("tenant_id", ctx.tenantId)
        .eq("subject_type", "parent")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPages<{ entity_id: string | null; created_at: string }>((from, to) =>
      ctx.sb
        .from("audit_events")
        .select("entity_id, created_at")
        .eq("tenant_id", ctx.tenantId)
        .eq("entity_type", "parent_session")
        .eq("action", "create")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPages<{ household_id: string; first_seen_at: string; last_seen_at: string; app_build: number | null }>((from, to) =>
      ctx.sb
        .from("parent_app_presence")
        .select("household_id, first_seen_at, last_seen_at, app_build")
        .eq("tenant_id", ctx.tenantId)
        .order("household_id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (tokens.error || tokens.truncated) return NextResponse.json({ ok: false, error: "Could not read app devices — try again." }, { status: 503 });
  if (logins.error || logins.truncated) return NextResponse.json({ ok: false, error: "Could not read app sign-ins — try again." }, { status: 503 });
  const presenceAvailable = !presence.error && !presence.truncated;
  if (presence.error) console.warn("[parents-on-app] presence read failed:", presence.error);

  const keep = (id: string) => !!id && !isHiddenReviewDemoHousehold(id);
  const devices: AppDevice[] = tokens.rows
    .map((r) => ({
      householdId: String(r.subject_id ?? ""),
      appVersion: String(r.app_version ?? ""),
      createdAt: String(r.created_at ?? ""),
      lastSeenAt: String(r.last_seen_at ?? ""),
    }))
    .filter((d) => keep(d.householdId));
  const appLogins: AppLogin[] = logins.rows
    .map((r) => ({ householdId: String(r.entity_id ?? ""), at: String(r.created_at ?? "") }))
    .filter((l) => keep(l.householdId));
  const appPresence: AppPresence[] = presenceAvailable
    ? presence.rows
        .map((r) => ({
          householdId: String(r.household_id ?? ""),
          firstSeenAt: String(r.first_seen_at ?? ""),
          lastSeenAt: String(r.last_seen_at ?? ""),
          appBuild: typeof r.app_build === "number" ? r.app_build : null,
        }))
        .filter((p) => keep(p.householdId))
    : [];

  await ensureSchoolMirrorHydrated();
  if (!(await ensureSisHydratedServer())) {
    return NextResponse.json({ ok: false, error: "Could not load the student register — try again." }, { status: 503 });
  }
  const masters = loadMasters();
  const sis = loadSisForStaff();
  const ay = auth.ctx.session.academicYearCode || "";
  const classes = new Map(masters.classes.map((c) => [c.id, c]));
  const sections = new Map(masters.sections.map((s) => [s.id, s.name]));

  // One row per child — this session's row (else the newest) — and only the
  // children on roll: a family whose children are all inactive drops out.
  const children: RosterChild[] = childrenOnRoll(
    sis.students.filter((s) => s.householdId),
    ay,
  ).map((s) => {
    const cls = classes.get(s.classId);
    return {
      householdId: s.householdId,
      studentId: s.id,
      name: s.fullName,
      classId: s.classId || "none",
      className: cls?.name ?? "",
      classSort: cls?.sortOrder ?? 999,
      sectionId: s.sectionId || "",
      section: sections.get(s.sectionId) ?? "",
      fatherMobile: s.fatherMobile,
      motherMobile: s.motherMobile,
    };
  });

  const built = buildParentsOnApp({
    devices,
    logins: appLogins,
    presence: appPresence,
    families: sis.households.map((h) => ({
      householdId: h.id,
      guardianName: h.guardianName,
      whatsappMobile: h.whatsappMobile,
      mobile: h.mobile,
      altMobile: h.altMobile,
    })),
    children,
  });
  return NextResponse.json(
    { ok: true, ...built, presenceAvailable, asOf: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
