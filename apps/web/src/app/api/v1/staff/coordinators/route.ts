/**
 * Class co-ordinators (lib/attendanceCover).
 *
 * GET — { byStaff: { staffId: ["classId|sectionId", …] }, updatedAt }.
 *        Staff · view.
 * PUT — { staffId, sectionKeys, baseUpdatedAt } — that person's classes, all
 *        of them (an empty list removes them as co-ordinator). Refused when a
 *        class already has another co-ordinator, or when the list changed
 *        since `baseUpdatedAt` was read. Staff · edit, like Allocate teaching.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { setCoordinatorSections } from "@/lib/attendanceCover";
import { readClassCoordinators, writeClassCoordinators } from "@/lib/attendanceCover.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "view");
  if (!auth.ok) return auth.response;
  const got = await readClassCoordinators();
  if (!got) return NextResponse.json({ ok: false, error: "Could not read the co-ordinators. Try again." }, { status: 503 });
  return NextResponse.json({ ok: true, byStaff: got.state.byStaff, updatedAt: got.updatedAt, updatedBy: got.state.updatedBy });
}

export async function PUT(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "edit");
  if (!auth.ok) return auth.response;
  let body: { staffId?: unknown; sectionKeys?: unknown; baseUpdatedAt?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const staffId = typeof body.staffId === "string" ? body.staffId.trim() : "";
  const keys = Array.isArray(body.sectionKeys) ? body.sectionKeys.map(String) : [];
  const base = typeof body.baseUpdatedAt === "string" ? body.baseUpdatedAt : "";
  const masters = auth.ctx.masters;
  const person = masters.staff.find((s) => s.id === staffId);
  if (!person) return NextResponse.json({ ok: false, error: "That member of staff was not found." }, { status: 400 });
  const valid = new Set(masters.sections.map((s) => `${s.classId}|${s.id}`));
  const unknown = keys.filter((k) => !valid.has(k));
  if (unknown.length) return NextResponse.json({ ok: false, error: "Some of those classes no longer exist — reload and try again." }, { status: 400 });

  const got = await readClassCoordinators();
  if (!got) return NextResponse.json({ ok: false, error: "Could not read the co-ordinators — nothing was saved. Try again." }, { status: 503 });
  if (got.updatedAt !== base) {
    return NextResponse.json({ ok: false, error: "Someone else changed the co-ordinators meanwhile — reload and try again. Nothing was saved." }, { status: 409 });
  }
  const label = (k: string) => {
    const [c, s] = k.split("|");
    return [masters.classes.find((x) => x.id === c)?.name, masters.sections.find((x) => x.id === s)?.name].filter(Boolean).join(" ") || k;
  };
  const name = (id: string) => masters.staff.find((s) => s.id === id)?.fullName || "another member of staff";
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "staff";
  const next = setCoordinatorSections(got.state, staffId, keys, by, name, label);
  if (!next.ok) return NextResponse.json({ ok: false, error: next.error }, { status: 409 });
  const saved = await writeClassCoordinators(next.state, got.updatedAt);
  if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: saved.conflict ? 409 : 500 });
  return NextResponse.json({ ok: true, byStaff: next.state.byStaff, updatedAt: saved.updatedAt, updatedBy: by });
}
