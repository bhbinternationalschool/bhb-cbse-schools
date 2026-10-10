import { writeAudit } from "@/lib/audit.server";
import { deskBundleToMastersState, fetchMastersDeskFromDb, pushMastersDeskToDb } from "@/lib/mastersNormalized.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  applySubjectRequest,
  subjectRequestError,
  type NewSubjectRequestInput,
  type SubjectRequest,
  type SubjectRequestStatus,
} from "@/lib/subjectRequests";
import type { SubjectsSlice } from "@/lib/subjectMasters";

/**
 * Storage and decisions for teachers' subject requests (lib/subjectRequests,
 * table subject_change_requests). Approval changes Masters through the same
 * versioned save the Masters screen uses — read, change one class's links,
 * write against the revision read — and only then marks the request.
 */

type Row = Record<string, unknown>;

function fromRow(r: Row): SubjectRequest {
  return {
    id: String(r.id),
    staffId: String(r.staff_id ?? ""),
    staffName: String(r.staff_name ?? ""),
    classId: String(r.class_id ?? ""),
    className: String(r.class_name ?? ""),
    action: r.action as SubjectRequest["action"],
    subjectId: String(r.subject_id ?? ""),
    subjectName: String(r.subject_name ?? ""),
    reason: String(r.reason ?? ""),
    status: r.status as SubjectRequestStatus,
    decidedBy: String(r.decided_by ?? ""),
    decidedAt: r.decided_at ? String(r.decided_at) : "",
    decisionNote: String(r.decision_note ?? ""),
    createdAt: String(r.created_at ?? ""),
  };
}

export async function listSubjectRequests(filter: { status?: SubjectRequestStatus; staffId?: string; limit?: number } = {}): Promise<SubjectRequest[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  let q = ctx.sb.from("subject_change_requests").select("*").eq("tenant_id", ctx.tenantId);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.staffId) q = q.eq("staff_id", filter.staffId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(filter.limit ?? 200);
  if (error) return null;
  return (data ?? []).map(fromRow);
}

export function subjectsSliceOf(m: { subjects?: SubjectsSlice["subjects"]; classSubjects?: SubjectsSlice["classSubjects"]; classes?: SubjectsSlice["classes"] }): SubjectsSlice {
  return { subjects: m.subjects ?? [], classSubjects: m.classSubjects ?? [], classes: m.classes ?? [] };
}

export async function fileSubjectRequest(
  slice: SubjectsSlice,
  input: NewSubjectRequestInput,
  who: { staffId: string; staffName: string; allowedClassIds: Set<string> | "all" },
): Promise<{ ok: true; request: SubjectRequest } | { ok: false; error: string; status: number }> {
  const pending = await listSubjectRequests({ status: "pending", limit: 500 });
  if (!pending) return { ok: false, error: "Could not read the requests just now — please try again.", status: 503 };
  const err = subjectRequestError(slice, input, { allowedClassIds: who.allowedClassIds, pending });
  if (err) return { ok: false, error: err, status: 400 };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database unavailable", status: 503 };
  const cls = slice.classes.find((c) => c.id === input.classId)!;
  const sub = slice.subjects.find((s) => s.id === input.subjectId);
  const { data, error } = await ctx.sb
    .from("subject_change_requests")
    .insert({
      tenant_id: ctx.tenantId,
      staff_id: who.staffId,
      staff_name: who.staffName,
      class_id: cls.id,
      class_name: cls.name,
      action: input.action,
      subject_id: input.action === "new" ? "" : String(input.subjectId ?? ""),
      subject_name: input.action === "new" ? String(input.subjectName ?? "").replace(/\s+/g, " ").trim().slice(0, 80) : sub?.nameEn ?? "",
      reason: String(input.reason ?? "").trim().slice(0, 300),
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: "Could not save the request — please try again.", status: 500 };
  return { ok: true, request: fromRow(data as Row) };
}

/** Mark a pending request decided. False when someone else decided it first. */
async function markDecided(id: string, status: SubjectRequestStatus, by: string, note: string): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  const { data, error } = await ctx.sb
    .from("subject_change_requests")
    .update({ status, decided_by: by, decided_at: new Date().toISOString(), decision_note: note.slice(0, 300) })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  return !error && (data ?? []).length === 1;
}

export async function withdrawSubjectRequest(id: string, staffId: string): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  const { data, error } = await ctx.sb
    .from("subject_change_requests")
    .update({ status: "withdrawn", decided_by: "teacher", decided_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .eq("staff_id", staffId)
    .eq("status", "pending")
    .select("id");
  return !error && (data ?? []).length === 1;
}

export type DecideResult = { ok: true; summary: string } | { ok: false; error: string; status: number };

export async function decideSubjectRequest(
  id: string,
  decision: "approve" | "reject",
  by: string,
  opts: { note?: string; newCode?: string } = {},
): Promise<DecideResult> {
  const pending = await listSubjectRequests({ status: "pending", limit: 500 });
  if (!pending) return { ok: false, error: "Could not read the requests just now — please try again.", status: 503 };
  const req = pending.find((r) => r.id === id);
  if (!req) return { ok: false, error: "This request was already decided or withdrawn.", status: 409 };

  if (decision === "reject") {
    if (!(await markDecided(id, "rejected", by, opts.note ?? ""))) return { ok: false, error: "This request was already decided.", status: 409 };
    return { ok: true, summary: `Declined: ${req.subjectName} for ${req.className}` };
  }

  // Masters may move between the read and the write (another office save):
  // the revision lock refuses the write, and a fresh read is tried once more.
  let summary = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const { bundle, meta, readFailed } = await fetchMastersDeskFromDb();
    if (readFailed || !meta) return { ok: false, error: "Could not read Masters — nothing was changed. Please try again.", status: 503 };
    const state = deskBundleToMastersState(bundle);
    const applied = applySubjectRequest(subjectsSliceOf(state), req, { newCode: opts.newCode });
    if (!applied.ok) return { ok: false, error: applied.error, status: 400 };
    const pushed = await pushMastersDeskToDb(
      { ...state, subjects: applied.subjects, classSubjects: applied.classSubjects },
      { baseUpdatedAt: meta.updatedAt ?? meta.lastUpdatedAt ?? null },
    );
    if (pushed.ok) {
      summary = applied.summary;
      break;
    }
    if (!pushed.conflict) return { ok: false, error: pushed.error || "Masters could not be saved — nothing was changed.", status: 500 };
  }
  if (!summary) return { ok: false, error: "Masters kept changing while this was being saved — please try again.", status: 409 };

  // Masters is changed; the request row follows. If someone decided it in
  // between, Masters already has the change and that is what they saw too.
  await markDecided(id, "approved", by, opts.note ?? "");
  await writeAudit({
    module: "masters",
    action: "edit",
    entityType: "class_subjects",
    entityId: req.classId,
    summary: `${summary} — requested by ${req.staffName}${req.reason ? ` ("${req.reason.slice(0, 120)}")` : ""}, approved by ${by}`,
    before: {},
    after: { requestId: req.id },
  }).catch(() => null);
  return { ok: true, summary };
}
