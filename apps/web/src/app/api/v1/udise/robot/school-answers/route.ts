/**
 * GET  — the office's confirmed UDISE+ school answers (lib/udiseSchoolAnswers).
 * PUT  — { answers: { <key>: boolean } } — confirm them; the signed-in staff
 *        member is recorded as the one who confirmed. Compliance · edit for
 *        both: these answers are typed into a government portal.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { normalizeUdiseSchoolAnswers } from "@/lib/udiseSchoolAnswers";
import { readUdiseSchoolAnswers, writeUdiseSchoolAnswers } from "@/lib/udiseSchoolAnswers.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const got = await readUdiseSchoolAnswers();
  if (!got) return NextResponse.json({ ok: false, error: "Could not read the school answers. Try again." }, { status: 503 });
  return NextResponse.json({ ok: true, ...got.answers, updatedAt: got.updatedAt });
}

export async function PUT(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: { answers?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "";
  if (!by) return NextResponse.json({ ok: false, error: "Your login has no name to record." }, { status: 400 });
  const answers = normalizeUdiseSchoolAnswers({ answers: body.answers, confirmedBy: by, confirmedAt: new Date().toISOString() });
  const saved = await writeUdiseSchoolAnswers(answers);
  if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });
  return NextResponse.json({ ok: true, ...answers, updatedAt: saved.updatedAt });
}
