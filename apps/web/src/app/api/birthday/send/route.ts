import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { birthdayCardUrl, birthdaysOn, istNow, runBirthdayGreetings } from "@/lib/birthday.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Staff: GET ?date= → who has a birthday (with a signed card link each);
 * POST { date, studentIds?, dryRun?, force?, includeSocial? } → send now.
 */
async function staff(edit: boolean) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return null;
  if (!hasPermission(session, loadMasters(), "students", edit ? "edit" : "view")) return null;
  return session;
}

export async function GET(req: Request) {
  if (!(await staff(false))) return NextResponse.json({ error: "Students access required" }, { status: 403 });
  const url = new URL(req.url);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") || "") ? String(url.searchParams.get("date")) : istNow().date;
  const design = url.searchParams.get("design") || "confetti";
  const format = url.searchParams.get("format") || "square";
  const list = await birthdaysOn(date);
  return NextResponse.json({
    ok: true,
    date,
    students: list.map((b) => ({ ...b, cardUrl: birthdayCardUrl({ studentId: b.studentId, date, design, format }) })),
  });
}

export async function POST(req: Request) {
  if (!(await staff(true))) return NextResponse.json({ error: "Students edit access required" }, { status: 403 });
  let body: { date?: string; studentIds?: string[]; dryRun?: boolean; force?: boolean; includeSocial?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? String(body.date) : istNow().date;
  const r = await runBirthdayGreetings({
    date,
    dryRun: body.dryRun === true,
    force: body.force === true,
    includeSocial: body.includeSocial === true,
    studentIds: Array.isArray(body.studentIds) ? body.studentIds.map(String).slice(0, 200) : undefined,
  });
  return NextResponse.json({ ok: true, ...r });
}
