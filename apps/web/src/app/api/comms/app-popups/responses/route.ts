/**
 * Comms → App pop-ups → Responses: which families answered a pop-up and what
 * they gave (lib/appPopupResponses).
 *
 * GET  ?id=<popupId> (notices · view AND students · view) → { rows }
 *      Aadhaar as last 4 digits + status only — the full number stays on the
 *      student record, behind the student screens' own access.
 * POST { studentId, who: "child" | "father" | "mother" } (students · edit)
 *      → mark that number verified on UDISE+ (a parent's on every child).
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { markAadhaarVerified, popupResponses, readAppPopups } from "@/lib/appPopups.server";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "notices", "view");
  if (!auth.ok) return auth.response;
  const students = await requireStaffPermission(req, "students", "view");
  if (!students.ok) return students.response;
  const id = new URL(req.url).searchParams.get("id") || "";
  const state = await readAppPopups();
  if (!state) return NextResponse.json({ ok: false, error: "Could not read app pop-ups" }, { status: 503 });
  const popup = state.popups.find((p) => p.id === id);
  if (!popup) return NextResponse.json({ ok: false, error: "Pop-up not found" }, { status: 404 });
  await ensureSchoolMirrorHydrated();
  const rows = await popupResponses(popup, currentAcademicYearCode(loadMasters()));
  if (!rows) return NextResponse.json({ ok: false, error: "Could not read the responses — try again" }, { status: 503 });
  return NextResponse.json({ ok: true, rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "students", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const studentId = String(body.studentId ?? "");
  const who = body.who === "child" || body.who === "father" || body.who === "mother" ? body.who : null;
  if (!studentId || !who) return NextResponse.json({ ok: false, error: "studentId and who required" }, { status: 400 });
  const r = await markAadhaarVerified(studentId, who, auth.ctx.session.fullName || "Office");
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
