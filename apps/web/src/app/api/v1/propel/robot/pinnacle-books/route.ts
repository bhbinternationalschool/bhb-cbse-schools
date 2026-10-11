/**
 * POST — Pinnacle Smart Teach's books against the ERP's (director, 12 Oct
 * 2026). The Office Robot reads each book's table of contents in the
 * Smart Teach Book Library (Click Code Connect, Know and Grow, New Longman
 * Vistas, Tip-Tap-Toe) and sends the chapter lists; the ERP compares each
 * with its loaded book for that class and subject, both ways, and with the
 * last check so a changed book shows. Only the comparison is kept
 * (module_local_state "pinnacle_books"); the ERP's books are never edited
 * from here. Compliance · edit, like the Propel panel.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { propelFullBookCheck } from "@/lib/propelRobot";
import { normalizePinnacleBooks } from "@/lib/pinnacleBooks";
import {
  PINNACLE_BOOKS_KEY,
  propelClassGrade,
  propelSubjectKey,
  readErpBookChapters,
  readPropelBooks,
  writePropelBooks,
} from "@/lib/propelRobot.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: { books?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const books = normalizePinnacleBooks(body.books);
  if (!books.length) {
    return NextResponse.json(
      { ok: false, error: "No book contents came from Smart Teach — open the Book Library and try again." },
      { status: 400 },
    );
  }
  const erp = await readErpBookChapters();
  if (!erp) return NextResponse.json({ ok: false, error: "Could not read the ERP's books — try again." }, { status: 503 });
  const previous = await readPropelBooks(PINNACLE_BOOKS_KEY);
  if (previous === null) {
    return NextResponse.json({ ok: false, error: "Could not read the last book check — try again." }, { status: 503 });
  }
  const erpChapters = (className: string, subject: string) => {
    const grade = propelClassGrade(className);
    const key = propelSubjectKey(subject);
    return grade === null || !key ? null : (erp.get(`${grade}|${key}`) ?? null);
  };
  const checks = propelFullBookCheck(books, erpChapters, previous === "none" ? null : previous).map((c, i) => ({
    ...c,
    title: books[i].title,
  }));
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "office";
  const kept = await writePropelBooks(books, by, PINNACLE_BOOKS_KEY);
  if (!kept.ok) return NextResponse.json({ ok: false, error: kept.error }, { status: 500 });
  return NextResponse.json({ ok: true, checked: books.length, checks });
}
