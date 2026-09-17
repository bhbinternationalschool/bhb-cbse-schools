/**
 * Storing and reading Nucleus syllabus-progress snapshots.
 *
 * A snapshot is a reading of another system on a date. It is never merged into
 * an older one: each paste (or, later, each token fetch) is its own row set, so
 * two readings can be compared and a stale one can be shown as stale.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  parseNucleusTimeliness,
  summariseNucleus,
  type NucleusProgressRow,
  type NucleusSummary,
} from "@/lib/nucleusProgress";
import {
  parseNucleusAssessments,
  summariseAssessments,
  type AssessmentSummary,
  type NucleusAssessmentRow,
} from "@/lib/nucleusAssessments";

export type NucleusSnapshot = {
  id: string;
  capturedOn: string;
  source: "paste" | "token";
  academicYearCode: string;
  capturedBy: string;
  note: string;
  rows: NucleusProgressRow[];
  summary: NucleusSummary;
};

export type SaveResult =
  | { ok: true; snapshot: NucleusSnapshot }
  | { ok: false; error: string; lineErrors?: string[] };

/**
 * Read a pasted table and store it whole, or store nothing.
 *
 * A paste with ANY unreadable row is rejected outright: a snapshot missing
 * four of thirty-five class-subjects looks complete on screen and is not.
 */
export async function saveNucleusPaste(input: {
  text: string;
  academicYearCode: string;
  capturedOn: string;
  capturedBy: string;
  note?: string;
}): Promise<SaveResult> {
  const { rows, errors } = parseNucleusTimeliness(input.text);
  if (errors.length) {
    return {
      ok: false,
      error: `${errors.length} row${errors.length === 1 ? "" : "s"} could not be read — nothing was saved.`,
      lineErrors: errors,
    };
  }
  if (rows.length === 0) {
    return {
      ok: false,
      error: "No rows found. Copy the Teacher Timeliness table from Nucleus, including its numbers.",
    };
  }

  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No database connection." };

  const { data: snap, error: snapErr } = await ctx.sb
    .from("nucleus_progress_snapshots")
    .insert({
      tenant_id: ctx.tenantId,
      captured_on: input.capturedOn,
      kind: "timeliness",
      source: "paste",
      academic_year_code: input.academicYearCode,
      captured_by: input.capturedBy,
      row_count: rows.length,
      note: input.note ?? "",
    })
    .select("id")
    .single();
  if (snapErr || !snap?.id) {
    return { ok: false, error: snapErr?.message ?? "Could not start the snapshot." };
  }

  const { error: rowsErr } = await ctx.sb.from("nucleus_progress_rows").insert(
    rows.map((r) => ({
      tenant_id: ctx.tenantId,
      snapshot_id: snap.id as string,
      position: r.position,
      teacher_name: r.teacherName,
      class_label: r.classLabel,
      subject_label: r.subjectLabel,
      total_plans: r.totalPlans,
      required_plans: r.requiredPlans,
      current_plans: r.currentPlans,
      gap_plans: r.gapPlans,
    })),
  );
  if (rowsErr) {
    // Leave no half-written snapshot behind.
    await ctx.sb
      .from("nucleus_progress_snapshots")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("id", snap.id as string);
    return { ok: false, error: rowsErr.message };
  }

  return {
    ok: true,
    snapshot: {
      id: snap.id as string,
      capturedOn: input.capturedOn,
      source: "paste",
      academicYearCode: input.academicYearCode,
      capturedBy: input.capturedBy,
      note: input.note ?? "",
      rows,
      summary: summariseNucleus(rows),
    },
  };
}

/** The most recent reading, or null when Nucleus has never been pasted in. */
export async function latestNucleusSnapshot(
  academicYearCode: string,
): Promise<NucleusSnapshot | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;

  const { data: snap } = await ctx.sb
    .from("nucleus_progress_snapshots")
    .select("id, captured_on, source, academic_year_code, captured_by, note")
    .eq("tenant_id", ctx.tenantId)
    .eq("kind", "timeliness")
    .eq("academic_year_code", academicYearCode)
    .order("captured_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snap?.id) return null;

  const { data: rowData } = await ctx.sb
    .from("nucleus_progress_rows")
    .select("position, teacher_name, class_label, subject_label, total_plans, required_plans, current_plans, gap_plans")
    .eq("tenant_id", ctx.tenantId)
    .eq("snapshot_id", snap.id as string)
    .order("position", { ascending: true });

  const rows: NucleusProgressRow[] = (rowData ?? []).map((r) => ({
    position: Number(r.position),
    teacherName: String(r.teacher_name),
    classLabel: String(r.class_label),
    subjectLabel: String(r.subject_label),
    totalPlans: Number(r.total_plans),
    requiredPlans: Number(r.required_plans),
    currentPlans: Number(r.current_plans),
    gapPlans: Number(r.gap_plans),
  }));

  return {
    id: snap.id as string,
    capturedOn: String(snap.captured_on),
    source: (snap.source as "paste" | "token") ?? "paste",
    academicYearCode: String(snap.academic_year_code),
    capturedBy: String(snap.captured_by ?? ""),
    note: String(snap.note ?? ""),
    rows,
    summary: summariseNucleus(rows),
  };
}

// ── Assessments & Answer key ────────────────────────────────────────────

export type NucleusAssessmentSnapshot = {
  id: string;
  capturedOn: string;
  capturedBy: string;
  rows: NucleusAssessmentRow[];
  summary: AssessmentSummary;
};

export type SaveAssessmentResult =
  | { ok: true; snapshot: NucleusAssessmentSnapshot }
  | { ok: false; error: string; lineErrors?: string[] };

/** All rows or none, for the same reason as the timeliness paste. */
export async function saveNucleusAssessmentPaste(input: {
  text: string;
  academicYearCode: string;
  capturedOn: string;
  capturedBy: string;
}): Promise<SaveAssessmentResult> {
  const { rows, errors } = parseNucleusAssessments(input.text);
  if (errors.length) {
    return {
      ok: false,
      error: `${errors.length} row${errors.length === 1 ? "" : "s"} could not be read — nothing was saved.`,
      lineErrors: errors,
    };
  }
  if (rows.length === 0) {
    return { ok: false, error: "No papers found. Copy the Assessments & Answer key table from Nucleus." };
  }

  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No database connection." };

  const { data: snap, error: snapErr } = await ctx.sb
    .from("nucleus_progress_snapshots")
    .insert({
      tenant_id: ctx.tenantId,
      captured_on: input.capturedOn,
      kind: "assessments",
      source: "paste",
      academic_year_code: input.academicYearCode,
      captured_by: input.capturedBy,
      row_count: rows.length,
    })
    .select("id")
    .single();
  if (snapErr || !snap?.id) {
    return { ok: false, error: snapErr?.message ?? "Could not start the snapshot." };
  }

  const { error: rowsErr } = await ctx.sb.from("nucleus_assessment_rows").insert(
    rows.map((r, i) => ({
      tenant_id: ctx.tenantId,
      snapshot_id: snap.id as string,
      position: i + 1,
      class_label: r.classLabel,
      division: r.division,
      subject: r.subject,
      title: r.title,
      chapters: r.chapters,
      status_text: r.statusText,
      status: r.status,
    })),
  );
  if (rowsErr) {
    await ctx.sb
      .from("nucleus_progress_snapshots")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("id", snap.id as string);
    return { ok: false, error: rowsErr.message };
  }

  return {
    ok: true,
    snapshot: {
      id: snap.id as string,
      capturedOn: input.capturedOn,
      capturedBy: input.capturedBy,
      rows,
      summary: summariseAssessments(rows),
    },
  };
}

/** The most recent reading of the assessments table, or null. */
export async function latestNucleusAssessments(
  academicYearCode: string,
): Promise<NucleusAssessmentSnapshot | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;

  const { data: snap } = await ctx.sb
    .from("nucleus_progress_snapshots")
    .select("id, captured_on, captured_by")
    .eq("tenant_id", ctx.tenantId)
    .eq("kind", "assessments")
    .eq("academic_year_code", academicYearCode)
    .order("captured_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snap?.id) return null;

  const { data: rowData } = await ctx.sb
    .from("nucleus_assessment_rows")
    .select("class_label, division, subject, title, chapters, status_text, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("snapshot_id", snap.id as string)
    .order("position", { ascending: true });

  const rows: NucleusAssessmentRow[] = (rowData ?? []).map((r) => ({
    classLabel: String(r.class_label),
    division: String(r.division ?? ""),
    subject: String(r.subject),
    title: String(r.title),
    chapters: String(r.chapters ?? ""),
    statusText: String(r.status_text),
    status: (r.status as NucleusAssessmentRow["status"]) ?? "other",
  }));

  return {
    id: snap.id as string,
    capturedOn: String(snap.captured_on),
    capturedBy: String(snap.captured_by ?? ""),
    rows,
    summary: summariseAssessments(rows),
  };
}
