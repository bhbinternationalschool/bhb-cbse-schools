/**
 * POST /api/sis/separate-sibling { studentId, clearParentDetails }
 *
 * Takes a child out of a family they were wrongly linked to — a new family
 * of their own, their receipts with them. See lib/sisSeparate.server.ts.
 */
import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { separateStudentFromFamily } from "@/lib/sisSeparate.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireStaffPermission(request, "students", "edit");
  if (!auth.ok) return auth.response;
  let body: { studentId?: unknown; clearParentDetails?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  if (!studentId) return NextResponse.json({ ok: false, error: "studentId is required" }, { status: 400 });
  const result = await separateStudentFromFamily({
    studentId,
    clearParentDetails: body.clearParentDetails === true,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
