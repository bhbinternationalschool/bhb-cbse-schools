/**
 * GET /api/v1/homework/attachment?postId=&attId= — one file on a published
 * homework post, for a parent with a child in that section or a member of
 * staff who teaches it. `/api/file` is staff-only, so this is how a parent
 * (web portal or app) opens a worksheet. Serves a storage file from the
 * section's homework folder, an older inline web attachment the same way,
 * or redirects to a pasted link. See lib/homeworkAttachments.ts.
 */

import { NextResponse } from "next/server";
import { apiErr, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureHomeworkHydratedServer } from "@/lib/homeworkPersistence";
import { loadHomework } from "@/lib/homework";
import { loadSis } from "@/lib/sis";
import { homeworkAttachmentSource } from "@/lib/homeworkAttachments";
import { assertHomeworkAttachmentReader } from "@/lib/homeworkAttachmentUpload.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const url = new URL(request.url);
    const postId = url.searchParams.get("postId")?.trim() || "";
    const attId = url.searchParams.get("attId")?.trim() || "";
    if (!postId || !attId) throw new ApiError("bad_request", "postId and attId required", 400);

    await ensureSchoolMirrorHydrated();
    await ensureHomeworkHydratedServer();
    const post = loadHomework().posts.find((p) => p.id === postId && p.status === "published");
    const att = post?.attachments.find((a) => a.id === attId);
    if (!post || !att) throw new ApiError("not_found", "File not found", 404);

    await assertHomeworkAttachmentReader(ctx, post, loadSis().students);

    const src = homeworkAttachmentSource(att.url);
    const headers = {
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    };
    if (src.kind === "link") return NextResponse.redirect(src.url, 302);
    if (src.kind === "inline") {
      return new NextResponse(Buffer.from(src.base64, "base64"), {
        status: 200,
        headers: { ...headers, "Content-Type": src.contentType },
      });
    }
    if (src.kind !== "storage") throw new ApiError("not_found", "File not found", 404);

    const tenant = await getServerTenantContext();
    if (!tenant) throw new ApiError("server_error", "Storage unavailable", 503);
    const { data, error } = await tenant.sb.storage.from("school-files").download(src.path);
    if (error || !data) throw new ApiError("not_found", "File not found", 404);
    return new NextResponse(await data.arrayBuffer(), {
      status: 200,
      headers: { ...headers, "Content-Type": src.contentType },
    });
  } catch (e) {
    return apiErr(e);
  }
}
