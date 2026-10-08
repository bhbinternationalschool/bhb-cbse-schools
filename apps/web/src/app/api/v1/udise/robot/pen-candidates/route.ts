/**
 * POST — the robot's PEN finder results: { results: [{ erpId, searched,
 * error?, hits: [{ pen, name, dob, father, mother, schoolName, udiseCode,
 * classDesc, yearDesc, statusDesc }] }] }. Stored for the office to review
 * (GET student-diff → penSearch). A PEN is put on a child only by the
 * office's Apply, and only when it was found at this school. Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { mergePenCandidates, type PenHit, type PenSearchResult } from "@/lib/udisePortalStudents.server";

export const runtime = "nodejs";

const str = (v: unknown, n = 120) => (v === null || v === undefined ? "" : String(v)).trim().slice(0, n);

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as { results?: unknown };
  const rows = Array.isArray(body.results) ? (body.results as Record<string, unknown>[]).slice(0, 300) : [];
  const now = new Date().toISOString();
  const results: PenSearchResult[] = rows
    .filter((r) => r && typeof r === "object" && str(r.erpId))
    .map((r) => ({
      erpId: str(r.erpId, 60),
      checkedAt: now,
      searched: r.searched === true,
      error: r.searched === true ? undefined : str(r.error, 200) || "could not search",
      hits: (Array.isArray(r.hits) ? (r.hits as Record<string, unknown>[]) : []).slice(0, 10).map(
        (h): PenHit => ({
          pen: str(h.pen, 20).replace(/\D/g, ""),
          name: str(h.name),
          dob: str(h.dob, 12),
          father: str(h.father),
          mother: str(h.mother),
          schoolName: str(h.schoolName),
          udiseCode: str(h.udiseCode, 14),
          classDesc: str(h.classDesc, 20),
          yearDesc: str(h.yearDesc, 12),
          statusDesc: str(h.statusDesc, 30),
        }),
      ),
    }));
  if (!results.length) return NextResponse.json({ ok: false, error: "No results in the request" }, { status: 400 });
  const w = await mergePenCandidates(results);
  if (!w.ok) return NextResponse.json({ ok: false, error: w.error }, { status: 503 });
  return NextResponse.json({ ok: true, saved: results.length });
}
