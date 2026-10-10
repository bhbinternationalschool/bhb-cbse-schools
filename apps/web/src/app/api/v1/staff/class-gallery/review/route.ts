/**
 * The principal's review of class-gallery items the AI check held.
 *
 * GET  /api/v1/staff/class-gallery/review — held items (and those still being checked), newest first.
 * POST /api/v1/staff/class-gallery/review { id, action: "approve" | "remove" }
 *
 * Leadership only (lib/classGallery.server postableSections().unrestricted).
 * Approve shows it to the class's parents and copies it to Drive; remove
 * deletes the file and keeps the row as "removed", so a stale copy cannot
 * bring it back.
 */
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth, type ApiAuthContext } from "@/lib/api/v1/auth";
import { postableSections } from "@/lib/classGallery.server";
import { decideClassItem, listItemsForReview } from "@/lib/classGalleryReview.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Approving a video copies it to Drive.
export const maxDuration = 300;

async function reviewer(request: Request): Promise<ApiAuthContext> {
  const ctx = await resolveApiAuth(request);
  if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Staff session required", 403);
  if (!(await postableSections(ctx)).unrestricted) {
    throw new ApiError("forbidden", "Only the principal and the office decide on held items.", 403);
  }
  return ctx;
}

export async function GET(request: Request) {
  try {
    await reviewer(request);
    return apiOk({ items: await listItemsForReview() });
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    await reviewer(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").slice(0, 60);
    const action = body.action === "approve" ? "approve" : body.action === "remove" ? "remove" : "";
    if (!id || !action) throw new ApiError("bad_request", "id and action (approve or remove) required", 400);
    const status = await decideClassItem(id, action).catch((e: unknown) => {
      throw new ApiError("bad_request", e instanceof Error ? e.message : "Could not save — try again", 400);
    });
    return apiOk({ id, status });
  } catch (e) {
    return apiErr(e);
  }
}
