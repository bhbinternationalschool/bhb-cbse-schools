import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { generateLeadershipDigestJson, llmStatus } from "@/lib/aiLlm.server";
import { formatInr } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import type { PrincipalSnapshot } from "@/lib/principalSnapshot.server";

export const runtime = "nodejs";

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "leadership-digest",
    configured: status.tutorEngine !== "none",
    engine: status.tutorEngine,
    note: "POST { snapshot: PrincipalSnapshot }",
  });
}

function metricsSummary(snap: PrincipalSnapshot): string {
  return [
    `Fees collected today: ${formatInr(snap.fees.todayCollectionPaise)}`,
    `Fees collected month-to-date: ${formatInr(snap.fees.mtdCollectionPaise)}`,
    `Open dues: ${formatInr(snap.fees.openDuesPaise)} across ${snap.fees.defaulterHouseholds} students`,
    `Student attendance marked today: ${snap.attendance.studentMarkedPct}% (${snap.attendance.studentPresent} present, ${snap.attendance.studentAbsent} absent, ${snap.attendance.studentLeave} leave), ${snap.attendance.sectionsMarked} sections marked`,
    `Staff present today: ${snap.staff.presentToday} of ${snap.staff.activeCount} active (${snap.staff.absentToday} absent)`,
    `Admissions pipeline: ${snap.admissions.pipeline} open leads, ${snap.admissions.enrolled} enrolled this session, ${snap.admissions.followUpsDue} follow-ups due`,
    `Alerts: ${snap.alerts.attendanceRegistersPending} attendance registers not yet marked, ${snap.alerts.lowStockSkus} low-stock store SKUs, ${snap.alerts.vaultExpiring30d} compliance documents expiring within 30 days`,
  ].join("\n");
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  let body: { snapshot?: PrincipalSnapshot };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const snap = body.snapshot;
  if (!snap || !snap.fees || !snap.attendance || !snap.staff || !snap.admissions || !snap.alerts) {
    return NextResponse.json({ error: "snapshot required" }, { status: 400 });
  }

  const result = await generateLeadershipDigestJson({
    schoolName: TENANT.nameDisplay,
    metricsSummary: metricsSummary(snap),
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, engine: result.engine },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    engine: result.engine,
    generationId: result.generationId,
    headline: result.headline,
    highlights: result.highlights,
  });
}
