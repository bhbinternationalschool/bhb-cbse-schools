import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSchoolCommsHydratedServer } from "@/lib/schoolCommsPersistence";
import { loadSchoolComms } from "@/lib/schoolComms";

export const runtime = "nodejs";

/**
 * GET /api/v1/comms/feed — published notices (audience-filtered by persona,
 * pinned first) and news, newest first. One call feeds the app's Notices
 * screen for both parents and staff.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);

    await ensureSchoolMirrorHydrated();
    await ensureSchoolCommsHydratedServer();

    const persona = ctx.session.persona === "parent" ? "parents" : "staff";
    const state = loadSchoolComms();

    const notices = state.notices
      .filter(
        (n) =>
          n.status === "published" &&
          (n.audience === "all" || n.audience === persona),
      )
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          b.publishedAt.localeCompare(a.publishedAt),
      )
      .slice(0, 50)
      .map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        pinned: n.pinned,
        publishedAt: n.publishedAt,
      }));

    const news = state.news
      .filter((n) => n.status === "published")
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 50)
      .map((n) => ({
        id: n.id,
        title: n.title,
        summary: n.summary,
        body: n.body,
        coverUrl: n.coverUrl || null,
        publishedAt: n.publishedAt,
      }));

    return apiOk({ notices, news });
  } catch (e) {
    return apiErr(e);
  }
}
