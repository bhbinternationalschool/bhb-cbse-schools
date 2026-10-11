/**
 * POST — Smart Teach's publisher assets into the ERP's index (director, 12
 * Oct 2026). The Office Robot reads each book's Assets tab (asset type and
 * title per chapter) in the teacher's signed-in Smart Teach and sends the
 * list; the ERP keeps it (module_local_state "pinnacle_assets") so lesson
 * plans, Teaching today, homework and exam papers can name the right
 * animation, mind map or worksheet for a chapter and link to the book. Only
 * titles and types — no files. Books not in this scan keep their earlier
 * entries. Compliance · edit, like the rest of the robot.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { normalizePinnacleAssets } from "@/lib/pinnacleAssets";
import { writePinnacleAssets } from "@/lib/pinnacleAssets.server";

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
  const books = normalizePinnacleAssets(body.books);
  if (!books.length) {
    return NextResponse.json({ ok: false, error: "No assets came from Smart Teach — nothing was kept." }, { status: 400 });
  }
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "office";
  const saved = await writePinnacleAssets(books, by);
  if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });
  return NextResponse.json({
    ok: true,
    books: books.length,
    chapters: books.reduce((n, b) => n + b.chapters.length, 0),
    assets: books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.assets.length, 0), 0),
    indexedBooks: saved.total,
  });
}
