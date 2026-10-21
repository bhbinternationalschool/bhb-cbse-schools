import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import type { CommsAudience } from "@/lib/schoolComms";
import { publishNewsServer, publishNoticeServer } from "@/lib/schoolNoticePublish.server";

export const runtime = "nodejs";

/** Audiences the apps show. "students" notices reach no app, so the phone does not offer them. */
const AUDIENCES: CommsAudience[] = ["all", "parents", "staff"];

const MAX_TITLE = 200;
const MAX_BODY = 5000;

/**
 * POST /api/v1/staff/notices — publish a notice or a news item from the
 * staff app's Notices & news screen (request mr_mv9y435vx6e5).
 *
 * body: { kind: "notice" | "news", title, body, audience? ("all" | "parents"
 *         | "staff", notices only), pinned? (notices), summary? (news) }
 *
 * The same server path the ERP's other server publishers use
 * (lib/schoolNoticePublish.server — the comms desk, loaded and saved whole;
 * a notice rings the audience's phones once, as one published on the web).
 *
 * Who may: whoever may create it on the web — Notices · create for a notice,
 * News · create for news (lib/schoolComms canCreateComms) — on top of the
 * app's Notices switch. The app shows the button only to them (features
 * "notices_create" / "news_create" from /api/v1/staff/features), and this
 * refuses everyone else whatever the app shows.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "notices");
    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") throw new ApiError("bad_request", "JSON body required", 400);

    const kind = raw.kind === "news" ? "news" : raw.kind === "notice" ? "notice" : null;
    if (!kind) throw new ApiError("bad_request", "kind must be notice or news", 400);
    assertPermission(ctx, kind === "news" ? "news" : "notices", "create");

    const title = String(raw.title ?? "").trim();
    const body = String(raw.body ?? "").trim();
    if (!title) throw new ApiError("bad_request", "Write a title", 400);
    if (!body) throw new ApiError("bad_request", "Write the message", 400);
    if (title.length > MAX_TITLE) throw new ApiError("bad_request", `Title is too long (${MAX_TITLE} characters at most)`, 400);
    if (body.length > MAX_BODY) throw new ApiError("bad_request", `Message is too long (${MAX_BODY} characters at most)`, 400);

    const academicYearCode = staffWorkingYear(ctx);
    const createdBy = ctx.session.fullName || "Staff app";

    if (kind === "notice") {
      const audience = (raw.audience ?? "all") as CommsAudience;
      if (!AUDIENCES.includes(audience)) throw new ApiError("bad_request", "Choose who it is for", 400);
      const res = await publishNoticeServer({
        title,
        body,
        audience,
        pinned: raw.pinned === true,
        academicYearCode,
        createdBy,
      });
      if (!res.ok) throw new ApiError("server_error", res.error, 503);
      await writeAudit({
        session: ctx.session,
        module: "notices",
        action: "create",
        entityType: "notice",
        entityId: res.notice.id,
        summary: `Published notice from the staff app: ${title}`.slice(0, 200),
        ...requestMeta(request),
      });
      return apiOk({ kind, id: res.notice.id, publishedAt: res.notice.publishedAt });
    }

    const res = await publishNewsServer({
      title,
      summary: String(raw.summary ?? "").slice(0, 300),
      body,
      academicYearCode,
      createdBy,
    });
    if (!res.ok) throw new ApiError("server_error", res.error, 503);
    await writeAudit({
      session: ctx.session,
      module: "news",
      action: "create",
      entityType: "news",
      entityId: res.item.id,
      summary: `Published news from the staff app: ${title}`.slice(0, 200),
      ...requestMeta(request),
    });
    return apiOk({ kind, id: res.item.id, publishedAt: res.item.publishedAt });
  } catch (e) {
    return apiErr(e);
  }
}
