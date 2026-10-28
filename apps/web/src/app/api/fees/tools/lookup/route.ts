import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { classLabelOf, searchStudents } from "@/lib/api/v1/staffFees";
import {
  householdContact,
  loadFeeToolsContext,
  openDuesOf,
  toolsErrorResponse,
} from "@/lib/feeTools.server";
import type { SisStudent } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * GET /api/fees/tools/lookup — students and their open dues for
 * Fees → Bulk & PDC.
 *   ?q=            name / admission no / mobile search (current session)
 *   ?studentIds=   comma list → each child with open dues (&future=1 adds
 *                  months not yet due)
 *   ?householdId=  every active child of one family, with dues (&future=1)
 *   ?ground=       children holding a live approved concession on that
 *                  ground (e.g. staff_ward) — a ready-made bulk group
 *
 * Read-only. Dues are priced on the server exactly as the counter prices
 * them; a failed read answers an error, never an empty list.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(req.url);
    const ay = auth.ctx.session.academicYearCode;
    const future = url.searchParams.get("future") === "1";
    const ctx = await loadFeeToolsContext();

    const brief = (s: SisStudent) => ({
      id: s.id,
      name: s.fullName,
      admissionNo: s.admissionNo,
      classLabel: classLabelOf(auth.ctx, s),
      householdId: s.householdId || "",
      guardianName: s.householdId ? householdContact(ctx.sis, s.householdId).guardianName : "",
      siblingIds: s.householdId
        ? ctx.sis.students
            .filter((x) => x.householdId === s.householdId && x.id !== s.id && x.status === "active" && x.academicYearCode === ay)
            .map((x) => x.id)
        : [],
    });
    const withDues = (s: SisStudent) => ({
      ...brief(s),
      dues: s.status === "active" ? openDuesOf(s, ctx, future) : [],
    });

    const q = (url.searchParams.get("q") || "").trim();
    if (q) {
      return Response.json({ ok: true, students: searchStudents(ctx.sis, ay, q).map(brief) });
    }

    const idsRaw = (url.searchParams.get("studentIds") || "").trim();
    if (idsRaw) {
      const ids = [...new Set(idsRaw.split(",").map((x) => x.trim()).filter(Boolean))].slice(0, 200);
      const rows = ids
        .map((id) => ctx.sis.students.find((s) => s.id === id))
        .filter((s): s is SisStudent => !!s)
        .map(withDues);
      return Response.json({ ok: true, students: rows });
    }

    const householdId = (url.searchParams.get("householdId") || "").trim();
    if (householdId) {
      const kids = ctx.sis.students.filter(
        (s) => s.householdId === householdId && s.status === "active" && s.academicYearCode === ay,
      );
      return Response.json({
        ok: true,
        guardianName: householdContact(ctx.sis, householdId).guardianName,
        students: kids.map(withDues),
      });
    }

    const ground = (url.searchParams.get("ground") || "").trim();
    if (ground) {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const ids = new Set(
        (ctx.masters.concessionGrants ?? [])
          .filter(
            (g) =>
              g.ground === ground &&
              g.status === "approved" &&
              (!g.effectiveTo || g.effectiveTo >= today),
          )
          .map((g) => g.studentId),
      );
      const rows = ctx.sis.students
        .filter((s) => ids.has(s.id) && s.status === "active" && s.academicYearCode === ay)
        .map(brief);
      return Response.json({ ok: true, students: rows });
    }

    return Response.json({ ok: false, error: "Pass q, studentIds, householdId or ground" }, { status: 400 });
  } catch (e) {
    return toolsErrorResponse(e);
  }
}
