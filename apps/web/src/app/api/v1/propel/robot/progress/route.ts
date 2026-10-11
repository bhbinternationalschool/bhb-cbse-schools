/**
 * POST — Propel's Teacher Timeliness into the ERP (director, 12 Oct 2026).
 * The robot sends Propel's per-teacher course progress and its staff list
 * (for the mobiles that match Propel accounts to ERP staff). The ERP keeps
 * the latest rows and one snapshot a day for the trend
 * (module_local_state "propel_teacher_progress"); Staff → Appraisal shows
 * it. Writes nothing on Propel. Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { normalizePropelProgress, type PropelTeacher } from "@/lib/propelRobot";
import { writePropelProgress } from "@/lib/propelRobot.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: { rows?: unknown; teachers?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const rows = normalizePropelProgress(
    body.rows,
    Array.isArray(body.teachers) ? (body.teachers as PropelTeacher[]).slice(0, 500) : [],
    auth.ctx.masters.staff ?? [],
  );
  if (!rows.length) return NextResponse.json({ ok: false, error: "Propel sent no progress rows — nothing kept." }, { status: 400 });
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "office";
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const saved = await writePropelProgress(rows, by, today);
  if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });
  return NextResponse.json({
    ok: true,
    kept: rows.length,
    behind: rows.filter((r) => r.gap < 0).length,
    matched: rows.filter((r) => r.staffId).length,
  });
}
