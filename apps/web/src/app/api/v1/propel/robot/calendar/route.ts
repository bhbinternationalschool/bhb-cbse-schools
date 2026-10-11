/**
 * POST — the Office Robot's Propel calendar plan (director, 12 Oct 2026).
 *
 * The robot sends what Propel's calendar already holds (holidays, events)
 * and Propel's subject list; the ERP answers with the exact Propel payloads
 * to create — published student holidays, and the exam date sheet as
 * "Offline assessment" events — plus everything it will not send and why.
 * Nothing is written here or on Propel: a person presses Send in the panel.
 * Compliance · edit, like the rest of the robot.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import { fetchExamSetupFromDb } from "@/lib/examsNormalized.server";
import {
  buildPropelExamPlan,
  buildPropelHolidayPlan,
  type PropelCalendarRow,
  type PropelSubject,
} from "@/lib/propelRobot";

export const runtime = "nodejs";

/** Today in IST — the school's day, whatever the server's clock zone is. */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

const rows = (v: unknown): PropelCalendarRow[] => (Array.isArray(v) ? (v as PropelCalendarRow[]).slice(0, 2000) : []);

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: { holidays?: unknown; events?: unknown; subjects?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const masters = auth.ctx.masters;
  if (!(masters.classes ?? []).length) {
    return NextResponse.json({ ok: false, error: "Could not read the ERP classes — try again." }, { status: 503 });
  }
  const exams = await fetchExamSetupFromDb();
  if (!exams.ok) {
    return NextResponse.json({ ok: false, error: "Could not read the exam date sheet — try again." }, { status: 503 });
  }
  const ay = staffWorkingYear(auth.ctx);
  const ayEnd = (masters.academicYears ?? []).find((y) => y.code === ay)?.endsOn || "";
  const today = istToday();
  const propelSubjects = (Array.isArray(body.subjects) ? body.subjects : [])
    .filter((s): s is PropelSubject => !!s && typeof (s as PropelSubject).id === "number" && Array.isArray((s as PropelSubject).classes))
    .map((s) => ({ id: s.id, name: String(s.name || ""), classes: s.classes.filter((c) => typeof c === "number") }));

  const holidays = buildPropelHolidayPlan({
    holidays: masters.holidays ?? [],
    classes: masters.classes ?? [],
    academicYearCode: ay,
    ayEnd,
    today,
    existing: rows(body.holidays),
  });
  const exam = buildPropelExamPlan({
    terms: exams.bundle.terms,
    subjects: exams.bundle.subjects,
    dateSheet: exams.bundle.dateSheet,
    classes: masters.classes ?? [],
    academicYearCode: ay,
    today,
    propelSubjects,
    existing: rows(body.events),
  });
  return NextResponse.json({ ok: true, academicYearCode: ay, today, holidays, exams: exam });
}
