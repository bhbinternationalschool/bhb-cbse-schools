import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { chapterPositionOf } from "@/lib/chapterStandards";
import { publisherAssetsFor } from "@/lib/pinnacleAssets.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/v1/teaching/publisher-assets?className=Class%205&subject=Computer&codes=Ch%207,8
 *
 * Smart Teach's publisher assets (animations, mind maps, games, worksheets…)
 * for chapters of one class + subject, as the Office Robot last indexed them
 * (director, 12 Oct 2026). `codes` are chapter codes as the syllabus writes
 * them ("7", "Ch 7"); a code that names no chapter number is skipped rather
 * than guessed. Titles and a link to the book's Assets page only — the files
 * stay on Smart Teach, opened with the teacher's own login.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "teaching", "view");
    const url = new URL(request.url);
    const className = url.searchParams.get("className") || "";
    const subject = url.searchParams.get("subject") || "";
    const positions = [
      ...new Set(
        (url.searchParams.get("codes") || "")
          .split(",")
          .map((c) => chapterPositionOf(c))
          .filter((n): n is number => n !== null),
      ),
    ].slice(0, 80);
    const found = positions.length ? await publisherAssetsFor(className, subject, positions) : new Map();
    const res = apiOk({
      chapters: [...found.entries()].map(([position, a]) => ({ position, ...a })),
    });
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res;
  } catch (e) {
    return apiErr(e);
  }
}
