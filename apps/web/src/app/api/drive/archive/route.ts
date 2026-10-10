import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { listArchive } from "@/lib/driveArchive.server";
import type { ArchiveKind } from "@/lib/driveArchive";

export const runtime = "nodejs";

/**
 * GET /api/drive/archive?kind=media|receipt&limit= — what the ERP has put
 * in the school's Drive, newest first, with a link to open each file, and
 * the archived/failed count per kind. Staff with settings.view.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "settings", "view");
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const rawKind = url.searchParams.get("kind");
  const kind = rawKind === "media" || rawKind === "receipt" ? (rawKind as ArchiveKind) : undefined;
  const limit = Number(url.searchParams.get("limit") || "") || undefined;
  const result = await listArchive({ kind, limit });
  if (!result) {
    return NextResponse.json({ ok: false, error: "Archive index unavailable" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, ...result });
}
