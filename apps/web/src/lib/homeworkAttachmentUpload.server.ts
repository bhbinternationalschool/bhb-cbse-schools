/**
 * A teacher's homework file from the staff app ("Scan page" / "Upload file")
 * into the same private storage the web composer uses — see
 * lib/homeworkAttachments.ts for the contract.
 *
 * Guards, in order, all before a byte is stored:
 *   1. the staff app's "Post homework" feature is on for this person
 *      (assertMobileFeature — which also refuses a parent session);
 *   2. they hold homework.edit (assertPermission);
 *   3. they teach this section, or are school-wide (assertSectionScope).
 *
 * Storage is passed in so the self-test can drive the real guards without a
 * bucket; the route uses `schoolFilesStore`.
 */

import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { assertPermission } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { assertSectionScope } from "@/lib/api/v1/staffScope";
import { describeLimit, privateMediaUrl } from "@/lib/media";
import {
  HOMEWORK_ATTACHMENT_MAX_BYTES,
  homeworkAttachmentExt,
  homeworkAttachmentPath,
  type HomeworkAttachmentKind,
} from "@/lib/homeworkAttachments";

export type HomeworkAttachmentStore = {
  put(path: string, data: Buffer, contentType: string): Promise<{ ok: true } | { ok: false; error: string }>;
};

export type UploadedHomeworkAttachment = {
  id: string;
  label: string;
  url: string;
  kind: HomeworkAttachmentKind;
  bytes: number;
};

/** The private bucket, with a Drive copy beside it (Drive failing never fails the upload). */
export const schoolFilesStore: HomeworkAttachmentStore = {
  async put(path, data, contentType) {
    const { getServerTenantContext } = await import("@/lib/serverTenant");
    const tenant = await getServerTenantContext();
    if (!tenant) return { ok: false, error: "Storage unavailable" };
    const up = await tenant.sb.storage
      .from("school-files")
      .upload(path, data, { contentType, upsert: false, cacheControl: "31536000" });
    if (up.error) return { ok: false, error: up.error.message };
    try {
      const { archiveToDrive } = await import("@/lib/driveArchive.server");
      const { mediaArchiveFileName, mediaArchiveFolder } = await import("@/lib/driveArchive");
      const drive = await archiveToDrive({
        kind: "media",
        ref: `school-files/${path}`,
        folderPath: mediaArchiveFolder("school-files", new Date()),
        fileName: mediaArchiveFileName(path),
        mimeType: contentType,
        data,
      });
      if (!drive.ok) console.warn("[homework attachment] drive archive failed:", drive.error);
    } catch (e) {
      console.warn("[homework attachment] drive archive failed:", (e as Error)?.message);
    }
    return { ok: true };
  },
};

export async function uploadHomeworkAttachment(
  ctx: ApiAuthContext,
  form: FormData | null,
  store: HomeworkAttachmentStore,
): Promise<UploadedHomeworkAttachment> {
  assertMobileFeature(ctx, "homework_post");
  assertPermission(ctx, "homework", "edit");

  const classId = String(form?.get("classId") ?? "").trim();
  const sectionId = String(form?.get("sectionId") ?? "").trim();
  if (!classId || !sectionId) {
    throw new ApiError("bad_request", "classId and sectionId required", 400);
  }
  await assertSectionScope(ctx, classId, sectionId);

  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new ApiError("bad_request", "Choose a photo or PDF", 400);
  }
  const ext = homeworkAttachmentExt(file.type, file.name);
  if (!ext) {
    throw new ApiError("bad_request", "Attach a photo (JPG, PNG, WebP) or a PDF", 400);
  }
  if (file.size > HOMEWORK_ATTACHMENT_MAX_BYTES) {
    throw new ApiError(
      "bad_request",
      `That file is ${describeLimit(file.size)} — the limit is ${describeLimit(HOMEWORK_ATTACHMENT_MAX_BYTES)}`,
      413,
    );
  }

  const contentType = ext === "pdf" ? "application/pdf" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const path = homeworkAttachmentPath(classId, sectionId, ext);
  const data = Buffer.from(await file.arrayBuffer());
  const put = await store.put(path, data, contentType);
  if (!put.ok) {
    throw new ApiError("server_error", `The file was not saved — ${put.error}`, 500);
  }

  const label = String(form?.get("label") ?? "").trim().slice(0, 80) || file.name || "Attachment";
  const name = path.split("/").pop() as string;
  return {
    id: `att_${name.replace(/\.[^.]+$/, "")}`,
    label,
    url: privateMediaUrl(path),
    kind: ext === "pdf" ? "pdf" : "image",
    bytes: data.length,
  };
}

/**
 * May this reader open a file on this post? A parent: only with a child of
 * the household in the post's class and section. Staff: homework.view and
 * the section in their scope (school-wide roles pass). Anyone else: no.
 */
export async function assertHomeworkAttachmentReader(
  ctx: ApiAuthContext,
  post: { classId: string; sectionId: string; academicYearCode?: string },
  students: { householdId: string; classId: string; sectionId: string; academicYearCode?: string }[],
): Promise<void> {
  if (ctx.session.persona === "parent") {
    const { requireParentHousehold } = await import("@/lib/api/v1/household");
    const householdId = requireParentHousehold(ctx);
    const mine = students.some(
      (s) =>
        s.householdId === householdId &&
        s.classId === post.classId &&
        s.sectionId === post.sectionId &&
        (!post.academicYearCode || !s.academicYearCode || s.academicYearCode === post.academicYearCode),
    );
    if (!mine) throw new ApiError("forbidden", "Not your child's class", 403);
    return;
  }
  if (ctx.session.persona !== "staff") {
    throw new ApiError("forbidden", "Sign in to open this file", 403);
  }
  assertPermission(ctx, "homework", "view");
  await assertSectionScope(ctx, post.classId, post.sectionId);
}
