/**
 * POST — Propel's question papers into the ERP (director, 12 Oct 2026). The
 * robot sends Propel's assessment list (FA 1–4, SA 1–2 per class, division
 * and subject, with the chapters each covers). The ERP keeps it
 * (module_local_state "propel_tests") and answers which chapters Propel's
 * tests name that the ERP's loaded book for that class and subject lacks —
 * a new or changed chapter to check, since the AI tutor and lesson plans
 * follow the ERP's list. For Nursery–UKG, whose books Propel lists in full
 * (its unit list), the whole book is compared both ways. No student data:
 * Propel has none. Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  normalizePropelTests,
  propelChapterGaps,
  propelFullBookCheck,
  propelPrePrimaryBooks,
} from "@/lib/propelRobot";
import {
  propelClassGrade,
  propelSubjectKey,
  readErpBookChapters,
  readPropelBooks,
  writePropelBooks,
  writePropelTests,
} from "@/lib/propelRobot.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: { assessments?: unknown; units?: unknown; subjects?: unknown };
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
  const erpChapters = (className: string, subject: string) => {
    const grade = propelClassGrade(className);
    const key = propelSubjectKey(subject);
    return grade === null || !key ? null : (books.get(`${grade}|${key}`) ?? null);
  };
  const gaps = propelChapterGaps(tests, erpChapters);
  const subjects = (Array.isArray(body.subjects) ? body.subjects : [])
    .filter((x): x is { id: number; name: string } => !!x && typeof (x as { id?: unknown }).id === "number")
    .map((x) => ({ id: x.id, name: String(x.name || "") }));
  const propelBooks = propelPrePrimaryBooks(body.units, subjects);
  let bookChecks: ReturnType<typeof propelFullBookCheck> = [];
  if (propelBooks.length) {
    const previous = await readPropelBooks();
    if (previous === null) {
      return NextResponse.json({ ok: false, error: "Could not read the last book check — try again." }, { status: 503 });
    }
    bookChecks = propelFullBookCheck(propelBooks, erpChapters, previous === "none" ? null : previous);
    const kept = await writePropelBooks(propelBooks, by);
    if (!kept.ok) return NextResponse.json({ ok: false, error: kept.error }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    kept: tests.length,
    ready: tests.filter((t) => t.chapters.length > 0).length,
    gaps,
    bookChecks,
    updatedAt: saved.updatedAt,
  });
}
