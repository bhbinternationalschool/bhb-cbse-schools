/**
 * POST multipart { file, classId, sectionId, label? } — one homework file
 * from the staff app's compose form ("Scan page" / "Upload file"). Stored in
 * the private `school-files` bucket under the section's homework folder and
 * returned as an attachment ref for POST /api/v1/homework/post. Uploads, or
 * says it did not — never a base64 fallback. Guards: lib/homeworkAttachmentUpload.server.ts.
 */

import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { schoolFilesStore, uploadHomeworkAttachment } from "@/lib/homeworkAttachmentUpload.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    // Refuse before reading a body of up to 20 MB; the helper checks this
    // again with homework.edit and the section scope.
    assertMobileFeature(ctx, "homework_post");
    const form = await request.formData().catch(() => null);
    const attachment = await uploadHomeworkAttachment(ctx, form, schoolFilesStore);
    return apiOk({ attachment });
  } catch (e) {
    return apiErr(e);
  }
}
