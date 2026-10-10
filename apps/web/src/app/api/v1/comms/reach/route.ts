/**
 * GET — who the school can reach without the personal class WhatsApp groups,
 * class by class (lib/commsReach): families with the parent app, families
 * reachable only on the school's WhatsApp number, and families neither can
 * reach (with their numbers, for the office to call). Reads only.
 * Notifications · view.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { buildReachReport } from "@/lib/commsReach";
import { loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { householdOf, loadSisForStaff, studentsInSession } from "@/lib/sis";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { readWaNumberVerdicts } from "@/lib/waNumberVerdicts.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "notifications", "view");
  if (!auth.ok) return auth.response;
  const ctx = await getServerTenantContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Tenant unavailable" }, { status: 503 });

  // The parent app on a phone (FCM) or as the installed web app (Web Push).
  const [fcm, web] = await Promise.all([
    fetchAllPages<{ subject_id: string }>((from, to) =>
      ctx.sb.from("push_device_tokens").select("subject_id").eq("tenant_id", ctx.tenantId).eq("subject_type", "parent").order("id", { ascending: true }).range(from, to),
    ),
    fetchAllPages<{ subject_id: string }>((from, to) =>
      ctx.sb.from("push_subscriptions").select("subject_id").eq("tenant_id", ctx.tenantId).eq("subject_type", "parent").order("id", { ascending: true }).range(from, to),
    ),
  ]);
  if (fcm.error || web.error) {
    // Unknown is not "nobody has the app".
    return NextResponse.json({ ok: false, error: "Could not read who has the parent app — try again." }, { status: 503 });
  }
  const verdicts = await readWaNumberVerdicts();
  if (!verdicts.ok) return NextResponse.json({ ok: false, error: "Could not read the WhatsApp number checks — try again." }, { status: 503 });

  await ensureSchoolMirrorHydrated();
  const sis = loadSisForStaff();
  const masters = loadMasters();
  const notOn = new Set<string>();
  const on = new Set<string>();
  for (const [m, v] of Object.entries(verdicts.verdicts)) (v.onWhatsApp ? on : notOn).add(m);
  // This session's children only. The "parents" send audience reads every
  // active row of every year (stale per-year duplicates) and reaches ~26
  // families more — so the card sends to exactly these ids instead.
  const students = studentsInSession(sis, auth.ctx.session.academicYearCode).filter((s) => s.status === "active");
  const report = buildReachReport({
    students,
    householdOf: (id) => householdOf(sis, id),
    appHouseholds: new Set([...fcm.rows, ...web.rows].map((r) => String(r.subject_id))),
    notOnWhatsApp: notOn,
    onWhatsApp: on,
    classLabel: (s) => {
      const cls = masters.classes.find((c) => c.id === s.classId);
      const sec = masters.sections.find((x) => x.id === s.sectionId);
      return {
        key: `${s.classId}:${s.sectionId}`,
        label: [cls?.name, sec?.name].filter(Boolean).join(" ") || "Class not set",
        order: masters.classes.findIndex((c) => c.id === s.classId),
      };
    },
  });
  return NextResponse.json({ ok: true, ...report, studentIds: students.map((s) => s.id) });
}
