import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { birthdayCardUrl, birthdaysOn, istNow, runBirthdayGreetings, runStaffBirthdayGreetings, staffBirthdaysOn } from "@/lib/birthday.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Staff desk: GET ?date= → who has a birthday, students and staff alike, with
 * a signed card link each; POST { date, studentIds?, staffIds?, dryRun?,
 * force?, includeSocial? } → send now. A POST naming staffIds wishes those
 * colleagues even when automatic staff greetings are off: the office asked
 * for it by hand, which is not the same as a job doing it unattended.
 */
async function staff(edit: boolean) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return null;
  if (!hasPermission(session, loadMasters(), "students", edit ? "edit" : "view")) return null;
  return session;
}

/**
 * Colleagues' birthdays and personal mobiles belong to the Staff module, not
 * to Students. Everyone who can open this screen sees the children; only
 * someone with Staff access sees the staff half of it.
 */
async function staffModuleAccess(edit: boolean): Promise<boolean> {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return false;
  return hasPermission(session, loadMasters(), "staff", edit ? "edit" : "view");
}

export async function GET(req: Request) {
  if (!(await staff(false))) return NextResponse.json({ error: "Students access required" }, { status: 403 });
  const url = new URL(req.url);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") || "") ? String(url.searchParams.get("date")) : istNow().date;
  const design = url.searchParams.get("design") || "confetti";
  const format = url.searchParams.get("format") || "square";
  const list = await birthdaysOn(date);
  const staffAccess = await staffModuleAccess(false);
  const staffList = staffAccess ? await staffBirthdaysOn(date) : [];
  return NextResponse.json({
    ok: true,
    date,
    students: list.map((b) => ({ ...b, cardUrl: birthdayCardUrl({ studentId: b.studentId, date, design, format }) })),
    staffAccess,
    staff: staffList.map((b) => ({ ...b, cardUrl: birthdayCardUrl({ studentId: "", staffId: b.staffId, date, design, format }) })),
  });
}

export async function POST(req: Request) {
  if (!(await staff(true))) return NextResponse.json({ error: "Students edit access required" }, { status: 403 });
  let body: { date?: string; studentIds?: string[]; staffIds?: string[]; dryRun?: boolean; force?: boolean; includeSocial?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? String(body.date) : istNow().date;
  const staffIds = Array.isArray(body.staffIds) ? body.staffIds.map(String).slice(0, 200) : undefined;
  if (staffIds && !(await staffModuleAccess(true))) {
    return NextResponse.json({ error: "Staff edit access required to wish staff" }, { status: 403 });
  }
  // A request naming only staff must not run the family send as well, or
  // "wish this one teacher" would greet every family with a birthday today.
  if (staffIds && !Array.isArray(body.studentIds)) {
    const rs = await runStaffBirthdayGreetings({ date, dryRun: body.dryRun === true, force: body.force === true, staffIds });
    return NextResponse.json({ ok: true, ...rs, staff: rs });
  }
  const r = await runBirthdayGreetings({
    date,
    dryRun: body.dryRun === true,
    force: body.force === true,
    includeSocial: body.includeSocial === true,
    studentIds: Array.isArray(body.studentIds) ? body.studentIds.map(String).slice(0, 200) : undefined,
  });
  // Not `staff` — that name is the session guard at the top of this file.
  const staffResult = staffIds ? await runStaffBirthdayGreetings({ date, dryRun: body.dryRun === true, force: body.force === true, staffIds }) : null;
  return NextResponse.json({ ok: true, ...r, staff: staffResult });
}
