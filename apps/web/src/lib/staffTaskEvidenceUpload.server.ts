/**
 * Staff task evidence upload (30 Oct 2026): one photo or PDF proving work on
 * a staff task, stored in the private `school-files` bucket under the task's
 * own folder and returned as a StaffTaskAttachment ref. The assignee names
 * the ref in a progress or submit PATCH; it is served back through
 * /api/file/<path>, which checks staff access on every request — the ref
 * itself carries no permission, and the stored path never expires (unlike a
 * signed URL). Uploads, or says it did not — never a base64 fallback.
 *
 * Same pattern as lib/homeworkAttachmentUpload.server.ts, kept separate:
 * homework uploads are section-scoped and homework-gated; task evidence is
 * task-scoped and open to any member of staff the task's own rule allows.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import type { RouteAuthResult } from "@/lib/apiRouteAuth.server";
import type { StaffTaskAttachment, StaffTaskRow } from "@/lib/staffTasksShared";

export const STAFF_TASK_EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;

export type StaffTaskEvidenceStore = {
  put(
    path: string,
    data: Buffer,
    contentType: string,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
};

/** The real store: the private school-files bucket, then a Drive archive copy. */
export const staffTaskEvidenceStore: StaffTaskEvidenceStore = {
  async put(path, data, contentType) {
    const { getServerTenantContext } = await import("@/lib/serverTenant");
    const tenant = await getServerTenantContext();
    if (!tenant) return { ok: false, error: "Storage unavailable" };
    // The private school-files bucket only. No Drive archive copy here
    // (unlike homework attachments): task evidence is internal review
    // material, and a default second copy would widen where it lives
    // without the school asking for that.
    const up = await tenant.sb.storage
      .from("school-files")
      .upload(path, data, { contentType, upsert: false, cacheControl: "31536000" });
    if (up.error) return { ok: false, error: up.error.message };
    return { ok: true };
  },
};

/** Photo or PDF only, by content type or file extension. */
function evidenceExt(mime: string, name: string): "jpg" | "png" | "webp" | "pdf" | null {
  const m = (mime || "").toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "application/pdf") return "pdf";
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "png") return "png";
  if (ext === "webp") return "webp";
  if (ext === "pdf") return "pdf";
  return null;
}

export type EvidenceUploadResult =
  | { ok: true; attachment: StaffTaskAttachment }
  | { ok: false; status: number; error: string };

/**
 * Validate and store the `file` field of a multipart form for `taskId`.
 * The route owns the access check; this helper owns the file rules.
 */
export async function uploadStaffTaskEvidence(
  form: FormData | null,
  taskId: string,
  store: StaffTaskEvidenceStore,
): Promise<EvidenceUploadResult> {
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, status: 400, error: "Choose a photo or PDF" };
  }
  const ext = evidenceExt(file.type, file.name);
  if (!ext) {
    return { ok: false, status: 400, error: "Attach a photo (JPG, PNG, WebP) or a PDF" };
  }
  if (file.size > STAFF_TASK_EVIDENCE_MAX_BYTES) {
    const mb = Math.round(STAFF_TASK_EVIDENCE_MAX_BYTES / (1024 * 1024));
    return { ok: false, status: 413, error: `That file is too large — the limit is ${mb} MB` };
  }
  const contentType = ext === "pdf" ? "application/pdf" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const path = `staff-tasks/${taskId}/${randomUUID()}.${ext}`;
  const data = Buffer.from(await file.arrayBuffer());
  const put = await store.put(path, data, contentType);
  if (!put.ok) {
    return { ok: false, status: 500, error: `The file was not saved — ${put.error}` };
  }
  const name = (file.name || "evidence").slice(0, 200);
  return { ok: true, attachment: { kind: ext === "pdf" ? "file" : "photo", name, path } };
}

export type StaffTaskEvidencePostDeps = {
  requireStaff: (req: Request) => Promise<RouteAuthResult>;
  readTasks: () => Promise<StaffTaskRow[] | null>;
  /** Board holders under the 30 Oct rule (Staff · approve / staff.tasks grant). */
  canManage: (ctx: ApiAuthContext) => boolean;
  canReview: (ctx: ApiAuthContext) => boolean;
  selfStaffId: (ctx: ApiAuthContext) => string | null;
  store: StaffTaskEvidenceStore;
};

/**
 * POST /api/staff/tasks/evidence, testable: every decision the route makes,
 * with dependencies injected so the self-test drives it without a database
 * or storage. The upload is stored only after the access rule passes, and
 * lands on the task only when the caller's progress / submit PATCH lands —
 * evidence never appears on a task whose state change was refused.
 */
export async function staffTaskEvidencePost(
  req: Request,
  deps: StaffTaskEvidencePostDeps,
): Promise<Response> {
  const auth = await deps.requireStaff(req);
  if (!auth.ok) return auth.response;

  const form = await req.formData().catch(() => null);
  const taskId = String(form?.get("taskId") ?? "").trim();
  if (!taskId) {
    return NextResponse.json({ ok: false, error: "taskId is required" }, { status: 400 });
  }
  const tasks = await deps.readTasks();
  if (!tasks) {
    return NextResponse.json({ ok: false, error: "Tasks could not be read" }, { status: 503 });
  }
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    return NextResponse.json({ ok: false, error: "That task was not found" }, { status: 404 });
  }
  const ctx = auth.ctx;
  const selfId = auth.viaMirrorSecret ? null : deps.selfStaffId(ctx);
  const allowed =
    auth.viaMirrorSecret ||
    deps.canManage(ctx) ||
    deps.canReview(ctx) ||
    (!!selfId && task.assigneeStaffId === selfId);
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "This task is not yours" }, { status: 403 });
  }
  if (task.status === "done" || task.status === "cancelled") {
    return NextResponse.json({ ok: false, error: "That task is already closed" }, { status: 409 });
  }

  const up = await uploadStaffTaskEvidence(form, taskId, deps.store);
  if (!up.ok) {
    return NextResponse.json({ ok: false, error: up.error }, { status: up.status });
  }
  return NextResponse.json({ ok: true, attachment: up.attachment });
}
