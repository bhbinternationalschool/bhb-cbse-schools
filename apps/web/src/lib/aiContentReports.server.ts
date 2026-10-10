/**
 * ai_content_reports — what a parent said was wrong with an AI reply.
 *
 * Unlike ai_generations, which stores only hashes, this table holds the
 * text of the exchange. That is deliberate and narrow: a report exists to
 * be read by a human, and a hash cannot be read. See the migration comment.
 *
 * Filing a report must not fail quietly. Everywhere else in this codebase a
 * failed telemetry insert is logged and swallowed; here the caller is told,
 * because a parent who taps "Report" and is told "sent" when nothing was
 * stored is worse than one who is asked to try again.
 */

import { randomUUID } from "crypto";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { ParsedAiReport } from "@/lib/aiContentReports";

export type AiContentReportRow = {
  id: string;
  generationId: string;
  route: string;
  householdId: string;
  studentId: string;
  reportedBy: string;
  category: string;
  reason: string;
  question: string;
  reply: string;
  status: "open" | "reviewed" | "dismissed";
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string;
  reviewNote: string;
};

export function newAiReportId(): string {
  return `air_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/**
 * The category is stored inside `reason` rather than in its own column, so
 * the table stays the shape the migration declares and a future category
 * needs no migration. `reportSummary` is the reader.
 */
function packReason(r: ParsedAiReport): string {
  return r.reason ? `[${r.category}] ${r.reason}` : `[${r.category}]`;
}

export function unpackReason(stored: string): {
  category: string;
  reason: string;
} {
  // [\s\S] rather than the dotAll flag: a parent's note may run to several
  // lines, and the tsconfig target predates that flag.
  const m = /^\[([a-z]+)\]\s?([\s\S]*)$/i.exec(stored || "");
  return m
    ? { category: m[1].toLowerCase(), reason: m[2].trim() }
    : { category: "other", reason: (stored || "").trim() };
}

export async function recordAiContentReport(input: {
  report: ParsedAiReport;
  householdId: string;
  reportedBy: string;
  route?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    console.error("[ai_content_reports] NOT RECORDED — no tenant context");
    return { ok: false, error: "Could not file the report right now" };
  }
  const id = newAiReportId();
  const { error } = await ctx.sb.from("ai_content_reports").insert({
    id,
    tenant_id: ctx.tenantId,
    generation_id: input.report.generationId,
    route: input.route || "tutor",
    household_id: input.householdId,
    student_id: input.report.studentId,
    reported_by: input.reportedBy.slice(0, 120),
    reason: packReason(input.report),
    question: input.report.question,
    reply: input.report.reply,
    status: "open",
  });
  if (error) {
    console.error("[ai_content_reports] insert failed:", error.message);
    return { ok: false, error: "Could not file the report right now" };
  }
  return { ok: true, id };
}

type DbRow = Record<string, unknown>;

function toRow(r: DbRow): AiContentReportRow {
  const { category, reason } = unpackReason(String(r.reason ?? ""));
  return {
    id: String(r.id ?? ""),
    generationId: String(r.generation_id ?? ""),
    route: String(r.route ?? "tutor"),
    householdId: String(r.household_id ?? ""),
    studentId: String(r.student_id ?? ""),
    reportedBy: String(r.reported_by ?? ""),
    category,
    reason,
    question: String(r.question ?? ""),
    reply: String(r.reply ?? ""),
    status: (String(r.status ?? "open") as AiContentReportRow["status"]),
    createdAt: String(r.created_at ?? ""),
    reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    reviewedBy: String(r.reviewed_by ?? ""),
    reviewNote: String(r.review_note ?? ""),
  };
}

/**
 * The school's queue. Open first because that is the work; `limit` is
 * capped well under PostgREST's 1000-row ceiling so this can never be the
 * reader that silently truncates.
 */
export async function listAiContentReports(opts?: {
  status?: "open" | "all";
  limit?: number;
}): Promise<AiContentReportRow[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const limit = Math.min(Math.max(1, opts?.limit ?? 200), 500);
  let q = ctx.sb
    .from("ai_content_reports")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if ((opts?.status ?? "open") === "open") q = q.eq("status", "open");
  const { data, error } = await q;
  if (error) {
    console.error("[ai_content_reports] list failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => toRow(r as DbRow));
}

export async function setAiContentReportStatus(input: {
  id: string;
  status: "reviewed" | "dismissed";
  reviewedBy: string;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { error } = await ctx.sb
    .from("ai_content_reports")
    .update({
      status: input.status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: input.reviewedBy.slice(0, 120),
      review_note: (input.note || "").slice(0, 500),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.id);
  if (error) {
    console.error("[ai_content_reports] update failed:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
