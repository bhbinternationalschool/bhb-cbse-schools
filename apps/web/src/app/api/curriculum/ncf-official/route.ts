/**
 * Masters → Subjects: the NCERT / CBSE class-wise subject lists (from
 * DIKSHA), the changes waiting for the office, and the school's matches.
 *
 * GET  — masters:view. The lists, pending changes, matches, last sync time.
 * POST — masters:edit.
 *   { action: "sync" }                                  check DIKSHA now
 *   { action: "map", mappings: [{ subjectKey, schoolSubjectId | null }] }
 *   { action: "decide", id, status: "done" | "dismissed" }
 *
 * Creating school subjects and class links is NOT done here: the screen
 * writes those through the normal Masters save, like every other edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  decideNcfChange,
  loadNcfOfficialView,
  saveNcfMappings,
  syncNcfOfficial,
} from "@/lib/ncfOfficial.server";

export const runtime = "nodejs";
export const maxDuration = 120;

function failure(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  // Tables not created yet reads as a setup step, not a crash.
  const missing = /relation .* does not exist|schema cache|PGRST205|42P01/i.test(message);
  return NextResponse.json(
    { ok: false, error: missing ? "The NCF subject tables are not set up yet (migration 20260930170000)." : message },
    { status: missing ? 503 : 500 },
  );
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "masters", "view");
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, ...(await loadNcfOfficialView()) });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "masters", "edit");
  if (!auth.ok) return auth.response;
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "staff";
  let body: {
    action?: string;
    mappings?: { subjectKey?: string; schoolSubjectId?: string | null }[];
    id?: string;
    status?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  try {
    if (body.action === "sync") {
      const result = await syncNcfOfficial();
      return NextResponse.json({ ok: result.boards.every((b) => b.ok), result, ...(await loadNcfOfficialView()) });
    }
    if (body.action === "map") {
      const list = (Array.isArray(body.mappings) ? body.mappings : [])
        .filter((m) => typeof m?.subjectKey === "string" && m.subjectKey.trim())
        .slice(0, 200)
        .map((m) => ({ subjectKey: String(m.subjectKey), schoolSubjectId: m.schoolSubjectId ? String(m.schoolSubjectId) : null }));
      if (list.length === 0) return NextResponse.json({ ok: false, error: "No mappings" }, { status: 400 });
      await saveNcfMappings(list, by);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "decide") {
      const status = body.status === "done" || body.status === "dismissed" ? body.status : null;
      if (!body.id || !status) return NextResponse.json({ ok: false, error: "id and status required" }, { status: 400 });
      await decideNcfChange(String(body.id), status, by);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return failure(e);
  }
}
