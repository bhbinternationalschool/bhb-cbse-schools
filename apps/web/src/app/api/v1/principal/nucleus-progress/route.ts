import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { latestNucleusSnapshot, saveNucleusPaste } from "@/lib/nucleusProgress.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/v1/principal/nucleus-progress — the most recent reading of Nucleus. */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "home", "view");
    const url = new URL(request.url);
    const ay = url.searchParams.get("academicYearCode") || ctx.session.academicYearCode;
    const snapshot = await latestNucleusSnapshot(ay);
    const res = apiOk({ snapshot });
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res;
  } catch (e) {
    return apiErr(e);
  }
}

/**
 * POST /api/v1/principal/nucleus-progress — store a table pasted out of Nucleus.
 *
 * All rows or none: a paste with an unreadable line is refused and the lines
 * are named, so a half-import cannot masquerade as this week's picture.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "home", "view");
    const body = (await request.json().catch(() => ({}))) as {
      text?: string;
      capturedOn?: string;
      note?: string;
      academicYearCode?: string;
    };
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) {
      return apiOk({ ok: false, error: "Paste the Teacher Timeliness table first." });
    }
    const today = new Date().toISOString().slice(0, 10);
    const capturedOn = /^\d{4}-\d{2}-\d{2}$/.test(body.capturedOn ?? "")
      ? body.capturedOn!
      : today;
    const result = await saveNucleusPaste({
      text,
      academicYearCode: body.academicYearCode || ctx.session.academicYearCode,
      capturedOn,
      capturedBy: ctx.session.fullName || ctx.session.roleCode || "",
      note: typeof body.note === "string" ? body.note : "",
    });
    return apiOk(result);
  } catch (e) {
    return apiErr(e);
  }
}
