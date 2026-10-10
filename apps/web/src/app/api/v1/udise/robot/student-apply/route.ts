/**
 * POST — apply the portal values the office ticked to ERP children.
 *
 * Body: { items: [{ erpId, revisionAt, fields: ["dob", "bloodGroup", …] }
 *                | { erpId, revisionAt, penFromSearch: "<PEN>" }] }
 *
 * The comparison is run again here and only what it proposes NOW is written —
 * a value the portal no longer holds, or a "check"-only item (mobiles,
 * admission no.), cannot be sent. A PEN from the PEN finder is accepted only
 * if the finder found it at THIS school. Each child is written on its own
 * row, refused if someone saved it in between; one audit line per child.
 * Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import { loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { householdOf, isRealPortalId, loadSisForStaff, studentsInSession } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import { applyPortalValues, readPenCandidates, readPortalStudents } from "@/lib/udisePortalStudents.server";
import { diffStudent, matchCopies, proposedValue, type SyncField } from "@/lib/udisePortalStudentSync";

export const runtime = "nodejs";

type Item = { erpId?: string; revisionAt?: string; fields?: unknown; penFromSearch?: string };

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as { items?: Item[] };
  const items = Array.isArray(body.items) ? body.items.slice(0, 250) : [];
  if (!items.length) return NextResponse.json({ ok: false, error: "Nothing ticked" }, { status: 400 });

  const ay = auth.ctx.session.academicYearCode;
  const [copyYear, pens] = await Promise.all([readPortalStudents(ay), readPenCandidates()]);
  if (!copyYear || !pens) return NextResponse.json({ ok: false, error: "Could not read the robot's copy — nothing written." }, { status: 503 });
  await ensureSchoolMirrorHydrated();
  const sis = loadSisForStaff();
  const active = studentsInSession(sis, ay).filter((s) => s.status === "active");
  const hhOf = (s: (typeof active)[number]) => (s.householdId ? householdOf(sis, s.householdId) : undefined);
  const { matched } = matchCopies(Object.values(copyYear.byPen), active, (s) => {
    const h = hhOf(s);
    return h ? [h.whatsappMobile, h.mobile, h.altMobile] : [];
  });
  const ourCode = String(loadMasters().schoolProfile?.udiseCode || TENANT.udiseCode || "").replace(/\D/g, "");

  const results: { erpId: string; ok: boolean; written?: string[]; error?: string; conflict?: boolean }[] = [];
  for (const it of items) {
    const erpId = String(it.erpId || "");
    const st = active.find((s) => s.id === erpId);
    if (!st) {
      results.push({ erpId, ok: false, error: "Not an active child this session" });
      continue;
    }
    const changes: { field: SyncField; value: string | boolean }[] = [];
    if (it.penFromSearch) {
      const pen = String(it.penFromSearch).replace(/\D/g, "");
      const hit = (pens[erpId]?.hits || []).find((h) => h.pen === pen);
      if (isRealPortalId(st.pen)) {
        results.push({ erpId, ok: false, error: `Already has PEN ${st.pen}` });
        continue;
      }
      if (!hit || !ourCode || hit.udiseCode.replace(/\D/g, "") !== ourCode) {
        results.push({ erpId, ok: false, error: ourCode ? "That PEN was not found at this school by the PEN finder" : "Set the school's UDISE code in Masters first" });
        continue;
      }
      changes.push({ field: "pen", value: pen });
    } else {
      const m = matched.get(erpId);
      if (!m) {
        results.push({ erpId, ok: false, error: "No portal copy for this child — fetch from the portal first" });
        continue;
      }
      const diffs = diffStudent(m.copy, st, hhOf(st));
      const wanted = Array.isArray(it.fields) ? (it.fields as string[]) : [];
      for (const f of wanted) {
        const d = proposedValue(diffs, f as SyncField);
        if (d && d.value !== undefined) changes.push({ field: d.field, value: d.value });
      }
      if (!changes.length) {
        results.push({ erpId, ok: false, error: "Nothing to write — the portal and the ERP already agree on those, or they are check-only" });
        continue;
      }
    }
    const w = await applyPortalValues(erpId, it.revisionAt || st.revisionAt, changes);
    if (!w.ok) {
      results.push({ erpId, ok: false, error: w.error, conflict: w.conflict });
      continue;
    }
    results.push({ erpId, ok: true, written: changes.map((c) => c.field) });
    await writeAudit({
      session: auth.ctx.session,
      module: "students",
      action: "edit",
      entityType: "student",
      entityId: erpId,
      summary: `UDISE+ → ERP (${it.penFromSearch ? "PEN finder" : "portal copy"}) for ${st.fullName}: ${changes.map((c) => c.field).join(", ")}`,
      after: Object.fromEntries(changes.map((c) => [c.field, c.value])),
    });
  }
  return NextResponse.json({ ok: true, applied: results.filter((r) => r.ok).length, results });
}
