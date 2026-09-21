import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  JOB_CV_EXTRACT_PROMPT,
  JOB_CV_EXTRACT_SYSTEM,
  jobCvExtractIsUsable,
  parseJobCvExtract,
  type JobCvExtract,
} from "@/lib/jobCvExtractAi";
import type { JobApplication, JobApplicationOcrStatus } from "@/lib/jobApplications";
import {
  alertLeadershipOfJobApplication,
  archiveJobCv,
  createJobApplication,
  recentApplicationFor,
  updateJobApplicationDetails,
} from "@/lib/jobApplications.server";
import { trackServerWork } from "@/lib/serverWork";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|jpg|png|webp)|application\/pdf)$/;

function extensionFor(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/**
 * A CV that arrived on WhatsApp, after the sender chose JOB.
 *
 * Same destination as the careers page, so the office works one pile.
 * Deliberately quieter than the page about failure: a person on WhatsApp
 * cannot be shown a validation error usefully, so anything unreadable is
 * still filed with the file attached and flagged for a human, rather than
 * refused. The one thing that IS refused is a repeat within the day —
 * WhatsApp makes it very easy to send the same document four times.
 *
 * The applicant's name here is the WhatsApp profile name. It is not a
 * claim about who they are; the CV and the number are. That is why the
 * OCR's name is preferred when it found one.
 */
export async function captureWhatsAppJobCv(input: {
  mediaId: string;
  mobile10: string;
  applicantName: string;
}): Promise<{ ok: boolean; reason?: string; application?: JobApplication }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, reason: "no_tenant" };

  const recent = await recentApplicationFor(input.mobile10);
  if (recent?.cvPath) {
    // Already have a CV from this number today. Say thank you, store
    // nothing: four copies of the same CV help nobody.
    return { ok: true, reason: "duplicate", application: recent };
  }
  // A job seeker who typed their details first and sends the CV after is
  // one application, not two: the CV joins the record they already have.

  const { fetchWaMediaAsDataUrl } = await import("@/lib/waInboundMedia.server");
  const media = await fetchWaMediaAsDataUrl(input.mediaId);
  if (!media.ok) return { ok: false, reason: media.error };

  const m = media.dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) return { ok: false, reason: "bad_media" };
  const mimeType = m[1]!.toLowerCase();
  const base64 = m[2]!;
  if (!ALLOWED.test(mimeType)) return { ok: false, reason: "unsupported_type" };
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_BYTES) return { ok: false, reason: "too_large" };

  // Store first, read second — as on the careers page, a CV the office can
  // open beats a perfect read of a file nobody kept.
  const path = `careers/${new Date().getUTCFullYear()}/wa_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${extensionFor(mimeType)}`;
  const { error: uploadErr } = await ctx.sb.storage
    .from("school-files")
    .upload(path, Buffer.from(base64, "base64"), {
      contentType: mimeType,
      upsert: false,
    });
  if (uploadErr) {
    console.warn("[careers/wa] upload failed", uploadErr.message);
    return { ok: false, reason: "upload_failed" };
  }

  let fields: JobCvExtract | null = null;
  let ocrStatus: JobApplicationOcrStatus = "failed";
  try {
    const { geminiConfigured, generateGeminiVisionJson } = await import(
      "@/lib/erpAiGemini.server"
    );
    if (geminiConfigured()) {
      const r = await generateGeminiVisionJson({
        system: JOB_CV_EXTRACT_SYSTEM,
        prompt: JOB_CV_EXTRACT_PROMPT,
        base64,
        mimeType,
        maxTokens: 900,
      });
      if (r.ok) fields = parseJobCvExtract(r.text);
    }
  } catch (e) {
    console.warn("[careers/wa] ocr failed", e);
  }
  if (fields) ocrStatus = jobCvExtractIsUsable(fields) ? "ok" : "unreadable";

  const bytesBuf = Buffer.from(base64, "base64");
  if (recent) {
    const upd = await updateJobApplicationDetails(recent.id, {
      applicantName: fields?.fullName || "",
      email: fields?.email ?? "",
      cvPath: path,
      cvMime: mimeType,
      subjectWords: fields?.subjects ?? [],
      classWords: fields?.classes ?? [],
      qualification: fields?.qualification ?? "",
      experienceYears: fields?.experienceYears ?? "",
      currentEmployer: fields?.currentEmployer ?? "",
      ocrStatus,
      ocrNotes: (fields?.notes ?? "").slice(0, 300),
    });
    if (!upd.ok) return { ok: false, reason: "save_failed" };
    void trackServerWork(archiveJobCv(upd.application, bytesBuf).then(() => {}));
    return { ok: true, application: upd.application };
  }

  const created = await createJobApplication({
    source: "whatsapp",
    // The CV's name beats the WhatsApp profile name, which is whatever
    // the sender set it to and is often a nickname or a shop name.
    applicantName: fields?.fullName || input.applicantName || "",
    // The number they messaged from is the number that works.
    mobile: input.mobile10,
    email: fields?.email ?? "",
    cvPath: path,
    cvMime: mimeType,
    subjectWords: fields?.subjects ?? [],
    classWords: fields?.classes ?? [],
    qualification: fields?.qualification ?? "",
    experienceYears: fields?.experienceYears ?? "",
    currentEmployer: fields?.currentEmployer ?? "",
    ocrStatus,
    ocrNotes: (fields?.notes ?? "").slice(0, 300),
  });
  if (!created.ok) {
    console.warn("[careers/wa] save failed", created.error);
    return { ok: false, reason: "save_failed" };
  }

  void trackServerWork(alertLeadershipOfJobApplication(created.application).catch(() => {}));
  // Into the school's Drive as well, one folder per job seeker. Never
  // blocks the application: a failed copy is a drive_archive row to retry.
  void trackServerWork(archiveJobCv(created.application, bytesBuf).then(() => {}));
  return { ok: true, application: created.application };
}

/**
 * A job seeker typed their details without a CV ("Maths, 6-8, B.Ed").
 * Saved as an application straight away so the school can find them,
 * joined to any application from the same number today, and the CV can
 * follow later.
 */
export async function captureWhatsAppJobDetails(input: {
  mobile10: string;
  applicantName: string;
  details: { subjectWords: string[]; classWords: string[]; qualification: string; experienceYears: string };
  applicationId?: string;
}): Promise<{ ok: boolean; application?: JobApplication; created?: boolean }> {
  const existing = input.applicationId
    ? { id: input.applicationId }
    : await recentApplicationFor(input.mobile10);
  if (existing) {
    const upd = await updateJobApplicationDetails(existing.id, {
      subjectWords: input.details.subjectWords,
      classWords: input.details.classWords,
      qualification: input.details.qualification,
      experienceYears: input.details.experienceYears,
    });
    return upd.ok ? { ok: true, application: upd.application, created: false } : { ok: false };
  }
  const created = await createJobApplication({
    source: "whatsapp",
    applicantName: input.applicantName || "",
    mobile: input.mobile10,
    subjectWords: input.details.subjectWords,
    classWords: input.details.classWords,
    qualification: input.details.qualification,
    experienceYears: input.details.experienceYears,
    // Nothing was read: there is no CV yet.
    ocrStatus: "pending",
    ocrNotes: "Details typed on WhatsApp; no CV yet.",
  });
  if (!created.ok) return { ok: false };
  void trackServerWork(alertLeadershipOfJobApplication(created.application).catch(() => {}));
  return { ok: true, application: created.application, created: true };
}
