/**
 * POST — Propel's question papers into the ERP (director, 12 Oct 2026). The
 * robot sends Propel's assessment list (FA 1–4, SA 1–2 per class, division
 * and subject, with the chapters each covers). The ERP keeps it
 * (module_local_state "propel_tests") and answers which chapters Propel's
 * tests name that the ERP's loaded book for that class and subject lacks —
 * a new or changed chapter to check, since the AI tutor and lesson plans
 * follow the ERP's list. No student data: Propel has none. Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { normalizePropelTests, propelChapterGaps } from "@/lib/propelRobot";
import {
  propelClassGrade,
  propelSubjectKey,
  readErpBookChapters,
  writePropelTests,
} from "@/lib/propelRobot.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: { assessments?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const tests = normalizePropelTests(body.assessments);
  if (!tests.length) return NextResponse.json({ ok: false, error: "Propel's test list was empty — nothing kept." }, { status: 400 });
  const books = await readErpBookChapters();
  if (!books) return NextResponse.json({ ok: false, error: "Could not read the ERP's books — try again." }, { status: 503 });
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "office";
  const saved = await writePropelTests(tests, by);
  if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });
  const gaps = propelChapterGaps(tests, (className, subject) => {
    const grade = propelClassGrade(className);
    const key = propelSubjectKey(subject);
    return grade === null || !key ? null : (books.get(`${grade}|${key}`) ?? null);
  });
  return NextResponse.json({
    ok: true,
    kept: tests.length,
    ready: tests.filter((t) => t.chapters.length > 0).length,
    gaps,
    updatedAt: saved.updatedAt,
  });
}
