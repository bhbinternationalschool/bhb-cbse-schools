/**
 * Exam desk — Supabase normalized tables (exam_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultExamPolicy,
  examMarkRowId,
  normalizeExamPolicy,
  type ExamDateSheetEntry,
  type ExamPolicy,
  type ExamSubject,
  type ExamTerm,
  type ExamsState,
  type MarkSheet,
  type PromotionDecision,
  type PromotionRecord,
  normalizeRemarkSource,
  type StudentExamAbsence,
  type StudentCoScholasticEntry,
  type StudentOverallRemark,
  type StudentItemScore,
  type StudentSubjectMark,
} from "@/lib/exams";
import { examsDualWriteDbEnabled } from "@/lib/examsDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";
import { replaceChildRows } from "./replaceChildRows.server";
import { sameInstant } from "@/lib/examsSheetVersion";

export type ExamDeskSyncMeta = {
  termCount: number;
  subjectCount: number;
  sheetCount: number;
  markCount: number;
  promotionCount: number;
  lastSheetAt: string | null;
  updatedAt: string;
};

export type ExamDeskBundle = {
  terms: ExamTerm[];
  subjects: ExamSubject[];
  dateSheet: ExamDateSheetEntry[];
  sheets: MarkSheet[];
  policy: ExamPolicy;
  promotions: PromotionRecord[];
};

const META_SELECT =
  "term_count, subject_count, sheet_count, mark_count, promotion_count, last_sheet_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

/**
 * Delete rows the client no longer holds — never on an empty payload.
 *
 * An empty keep-set means every stored row is "stale", so this deleted the
 * entire table. That is never what a sync means: a client with nothing to say
 * is a client whose cache was dropped, not an instruction to erase the
 * school's records.
 *
 * It is not hypothetical. On 2026-08-11 the attendance register for the
 * previous day was gone — pushed away by a phone whose localStorage had been
 * dropped on quota, with the emptiness check running AFTER the delete. This
 * same function is copied into 20 modules and called from 86 places, almost
 * none of them guarded, covering bank and cash ledgers, payroll runs, fee
 * cheques, library issues and 1,919 admission records.
 *
 * This floor stops the catastrophic case everywhere at once. It does NOT make
 * a partial payload safe — a client holding 3 of 900 rows still prunes 897.
 * That needs per-module scoping, the way attendance now prunes only within
 * the dates its payload covers. See docs/TODO.md.
 *
 * The read error is also surfaced now. It was discarded, which happened to
 * fail safe here (no data → nothing deleted), but "we could not read the
 * table" and "the table is empty" must not be the same value in a function
 * that deletes.
 */
async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  if (keepIds.size === 0) {
    console.warn(
      `[${table}] refusing to prune: the payload holds no ids at all. ` +
        "An empty client is not an instruction to delete every row.",
    );
    return;
  }
  const { data, error } = await sb
    .from(table)
    .select("id")
    .eq("tenant_id", tenantId);
  if (error) {
    console.error(
      `[${table}] prune skipped — could not read existing ids:`,
      error.message,
    );
    return;
  }
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

function termToRow(tenantId: string, t: ExamTerm): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: t.id,
    tenant_id: tenantId,
    code: t.code,
    label: t.label,
    academic_year_code: t.academicYearCode,
    max_marks: t.maxMarks,
    sort_order: t.sortOrder,
    is_active: t.isActive,
    starts_on: t.startsOn || null,
    ends_on: t.endsOn || null,
    note: t.note || "",
    counts_toward_hy: t.countsTowardHy,
    counts_toward_final: t.countsTowardFinal,
    weight_in_hy: t.weightInHy,
    weight_in_final: t.weightInFinal,
    required_on_marksheet: t.requiredOnMarksheet,
    requires_separate_marksheet: t.requiresSeparateMarksheet,
    updated_at: now,
  };
}

function rowToTerm(r: Record<string, unknown>): ExamTerm {
  return {
    id: String(r.id),
    code: String(r.code),
    label: String(r.label),
    academicYearCode: String(r.academic_year_code),
    maxMarks: Number(r.max_marks || 100),
    sortOrder: Number(r.sort_order || 0),
    isActive: r.is_active !== false,
    startsOn: r.starts_on ? String(r.starts_on).slice(0, 10) : "",
    endsOn: r.ends_on ? String(r.ends_on).slice(0, 10) : "",
    note: String(r.note || ""),
    countsTowardHy: r.counts_toward_hy !== false,
    countsTowardFinal: r.counts_toward_final !== false,
    weightInHy: Number(r.weight_in_hy ?? 20),
    weightInFinal: Number(r.weight_in_final ?? 20),
    requiredOnMarksheet: r.required_on_marksheet !== false,
    requiresSeparateMarksheet: r.requires_separate_marksheet !== false,
  };
}

function subjectToRow(
  tenantId: string,
  s: ExamSubject,
): Record<string, unknown> {
  return {
    id: s.id,
    tenant_id: tenantId,
    code: s.code,
    name: s.name,
    class_ids: s.classIds ?? [],
    max_marks: s.maxMarks,
    sort_order: s.sortOrder,
    is_active: s.isActive,
    updated_at: new Date().toISOString(),
  };
}

function rowToSubject(r: Record<string, unknown>): ExamSubject {
  const classIds = Array.isArray(r.class_ids)
    ? (r.class_ids as string[])
    : [];
  return {
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    classIds,
    maxMarks: Number(r.max_marks || 100),
    sortOrder: Number(r.sort_order || 0),
    isActive: r.is_active !== false,
  };
}

function dateSheetToRow(
  tenantId: string,
  e: ExamDateSheetEntry,
): Record<string, unknown> {
  return {
    id: e.id,
    tenant_id: tenantId,
    academic_year_code: e.academicYearCode,
    exam_term_id: e.examTermId,
    class_id: e.classId,
    subject_id: e.subjectId,
    slot_date: e.date,
    start_time: e.startTime || "09:00",
    duration_minutes: e.durationMinutes,
    note: e.note || "",
    updated_at: e.updatedAt || new Date().toISOString(),
  };
}

function rowToDateSheet(r: Record<string, unknown>): ExamDateSheetEntry {
  return {
    id: String(r.id),
    academicYearCode: String(r.academic_year_code),
    examTermId: String(r.exam_term_id),
    classId: String(r.class_id),
    subjectId: String(r.subject_id),
    date: String(r.slot_date).slice(0, 10),
    startTime: String(r.start_time || "09:00"),
    durationMinutes: Number(r.duration_minutes || 60),
    note: String(r.note || ""),
    updatedAt: String(r.updated_at || new Date().toISOString()),
  };
}

function sheetToRows(
  tenantId: string,
  s: MarkSheet,
): {
  header: Record<string, unknown>;
  marks: Record<string, unknown>[];
  absences: Record<string, unknown>[];
  coScholastic: Record<string, unknown>[];
  remarks: Record<string, unknown>[];
  itemScores: Record<string, unknown>[];
} {
  const header = {
    id: s.id,
    tenant_id: tenantId,
    academic_year_code: s.academicYearCode,
    exam_term_id: s.examTermId,
    class_id: s.classId,
    section_id: s.sectionId,
    locked_at: s.lockedAt,
    entered_by: s.enteredBy || "",
    updated_at: s.updatedAt || new Date().toISOString(),
  };
  const marks = (s.marks || []).map((m) => ({
    id: examMarkRowId(s.id, m),
    mark_sheet_id: s.id,
    tenant_id: tenantId,
    student_id: m.studentId,
    subject_id: m.subjectId,
    component: m.component || "",
    marks_obtained: m.marksObtained,
    grade: m.grade || "—",
    remark: m.remark || "",
    remark_source: normalizeRemarkSource(m.remarkSource),
  }));
  const absences = (s.absences || []).map((a) => ({
    id: `${s.id}:${a.studentId}:${a.subjectId}`,
    mark_sheet_id: s.id,
    tenant_id: tenantId,
    student_id: a.studentId,
    subject_id: a.subjectId,
    reason: a.reason || "",
    updated_at: s.updatedAt || new Date().toISOString(),
  }));
  const coScholastic = (s.coScholastic || []).map((e) => ({
    id: `${s.id}:${e.studentId}:${e.domain}`,
    mark_sheet_id: s.id,
    tenant_id: tenantId,
    student_id: e.studentId,
    domain: e.domain,
    rating: e.rating || "",
  }));
  const remarks = (s.overallRemarks || []).map((r) => ({
    id: `${s.id}:${r.studentId}`,
    mark_sheet_id: s.id,
    tenant_id: tenantId,
    student_id: r.studentId,
    text: r.text || "",
    text_hi: r.textHi || "",
    source: normalizeRemarkSource(r.source),
    generated_at: r.generatedAt,
    model: r.model || "",
    updated_at: s.updatedAt || new Date().toISOString(),
  }));
  const itemScores = (s.itemScores || []).map((e) => ({
    id: `${s.id}:${e.studentId}:${e.paperId}:${e.setCode}:${e.questionId}`,
    mark_sheet_id: s.id,
    tenant_id: tenantId,
    student_id: e.studentId,
    subject_id: e.subjectId,
    paper_id: e.paperId,
    set_code: e.setCode,
    question_id: e.questionId,
    marks_obtained: e.marks,
    updated_at: s.updatedAt || new Date().toISOString(),
  }));
  return { header, marks, absences, coScholastic, remarks, itemScores };
}

function rowToSheet(
  header: Record<string, unknown>,
  markRows: Record<string, unknown>[],
  coScholasticRows: Record<string, unknown>[] = [],
  remarkRows: Record<string, unknown>[] = [],
  itemScoreRows: Record<string, unknown>[] = [],
  absenceRows: Record<string, unknown>[] = [],
): MarkSheet {
  return {
    id: String(header.id),
    academicYearCode: String(header.academic_year_code),
    examTermId: String(header.exam_term_id),
    classId: String(header.class_id),
    sectionId: String(header.section_id),
    lockedAt: (header.locked_at as string | null) ?? null,
    enteredBy: String(header.entered_by || ""),
    updatedAt: String(header.updated_at || new Date().toISOString()),
    marks: markRows.map(
      (m): StudentSubjectMark => ({
        studentId: String(m.student_id),
        subjectId: String(m.subject_id),
        component: String(m.component ?? ""),
        marksObtained:
          m.marks_obtained === null || m.marks_obtained === undefined
            ? null
            : Number(m.marks_obtained),
        grade: String(m.grade || "—"),
        remark: String(m.remark || ""),
        remarkSource: normalizeRemarkSource(m.remark_source),
      }),
    ),
    absences: absenceRows.map(
      (r): StudentExamAbsence => ({
        studentId: String(r.student_id),
        subjectId: String(r.subject_id || ""),
        reason: String(r.reason || ""),
      }),
    ),
    overallRemarks: remarkRows.map(
      (r): StudentOverallRemark => ({
        studentId: String(r.student_id),
        text: String(r.text || ""),
        textHi: String(r.text_hi || ""),
        source: normalizeRemarkSource(r.source),
        generatedAt: (r.generated_at as string | null) ?? null,
        model: String(r.model || ""),
      }),
    ),
    coScholastic: coScholasticRows.map((r): StudentCoScholasticEntry => {
      const rating = r.rating === "A" || r.rating === "B" || r.rating === "C" ? r.rating : null;
      const domain = r.domain === "psychomotor" ? "psychomotor" : "socioEmotional";
      return {
        studentId: String(r.student_id),
        domain,
        rating,
      };
    }),
    itemScores: itemScoreRows.map(
      (r): StudentItemScore => ({
        studentId: String(r.student_id),
        subjectId: String(r.subject_id),
        paperId: String(r.paper_id),
        setCode: String(r.set_code || "A"),
        questionId: String(r.question_id),
        marks:
          r.marks_obtained === null || r.marks_obtained === undefined
            ? null
            : Number(r.marks_obtained),
      }),
    ),
  };
}

function promotionToRow(
  tenantId: string,
  p: PromotionRecord,
): Record<string, unknown> {
  return {
    id: p.id,
    tenant_id: tenantId,
    student_id: p.studentId,
    exam_term_id: p.examTermId,
    academic_year_code: p.academicYearCode,
    from_class_id: p.fromClassId || "",
    from_section_id: p.fromSectionId || "",
    decision: p.decision,
    to_class_id: p.toClassId || "",
    to_section_id: p.toSectionId || "",
    remark: p.remark || "",
    percent: p.percent,
    overall_grade: p.overallGrade || "—",
    passed: p.passed,
    decided_at: p.decidedAt,
    decided_by: p.decidedBy || "",
    applied_to_sis_at: p.appliedToSisAt,
    updated_at: new Date().toISOString(),
  };
}

function rowToPromotion(r: Record<string, unknown>): PromotionRecord {
  const decision = String(r.decision) as PromotionDecision;
  return {
    id: String(r.id),
    studentId: String(r.student_id),
    examTermId: String(r.exam_term_id),
    academicYearCode: String(r.academic_year_code),
    fromClassId: String(r.from_class_id || ""),
    fromSectionId: String(r.from_section_id || ""),
    decision:
      decision === "promoted" ||
      decision === "detained" ||
      decision === "conditional"
        ? decision
        : "pending",
    toClassId: String(r.to_class_id || ""),
    toSectionId: String(r.to_section_id || ""),
    remark: String(r.remark || ""),
    percent: Number(r.percent || 0),
    overallGrade: String(r.overall_grade || "—"),
    passed: !!r.passed,
    decidedAt: (r.decided_at as string | null) ?? null,
    decidedBy: String(r.decided_by || ""),
    appliedToSisAt: (r.applied_to_sis_at as string | null) ?? null,
  };
}

function mapMetaRow(
  metaRow: Record<string, unknown> | null,
): ExamDeskSyncMeta | null {
  if (!metaRow) return null;
  return {
    termCount: metaRow.term_count as number,
    subjectCount: metaRow.subject_count as number,
    sheetCount: metaRow.sheet_count as number,
    markCount: metaRow.mark_count as number,
    promotionCount: metaRow.promotion_count as number,
    lastSheetAt: metaRow.last_sheet_at as string | null,
    updatedAt: String(metaRow.updated_at),
  };
}

async function upsertChunks(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunk = 200,
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + chunk));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function pushExamDeskToDb(
  state: ExamsState,
): Promise<{ ok: boolean; error?: string }> {
  if (!examsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const terms = state.terms ?? [];
  const subjects = state.subjects ?? [];
  const dateSheet = state.dateSheet ?? [];
  const promotions = state.promotions ?? [];
  const policy = normalizeExamPolicy(state.policy);

  // Sheets are NOT written here any more. They arrive one at a time through
  // pushExamSheetToDb (see examsSheetSync.ts): a whole-desk payload is this
  // browser's copy of every sheet, and pruning the server to it deleted the
  // sheets other teachers had saved since this tab last hydrated — marks
  // cascade-deleted with them. This push is setup only: terms, subjects, the
  // date sheet, promotions and the policy.
  await Promise.all([
    deleteStale(sb, tenantId, "exam_desk_terms", new Set(terms.map((t) => t.id))),
    deleteStale(
      sb,
      tenantId,
      "exam_desk_subjects",
      new Set(subjects.map((s) => s.id)),
    ),
    deleteStale(
      sb,
      tenantId,
      "exam_desk_date_sheet",
      new Set(dateSheet.map((d) => d.id)),
    ),
    deleteStale(
      sb,
      tenantId,
      "exam_desk_promotions",
      new Set(promotions.map((p) => p.id)),
    ),
  ]);

  let r = await upsertChunks(
    sb,
    "exam_desk_terms",
    terms.map((t) => termToRow(tenantId, t)),
  );
  if (!r.ok) return r;

  r = await upsertChunks(
    sb,
    "exam_desk_subjects",
    subjects.map((s) => subjectToRow(tenantId, s)),
  );
  if (!r.ok) return r;

  r = await upsertChunks(
    sb,
    "exam_desk_date_sheet",
    dateSheet.map((d) => dateSheetToRow(tenantId, d)),
  );
  if (!r.ok) return r;

  // Deleting an exam (allowed only while it has no marks) drops its sheets
  // locally; mirror that for sheets that have no marks and whose exam is gone.
  if (terms.length > 0) {
    await deleteOrphanEmptySheets(sb, tenantId, new Set(terms.map((t) => t.id)));
  }

  r = await upsertChunks(
    sb,
    "exam_desk_promotions",
    promotions.map((p) => promotionToRow(tenantId, p)),
  );
  if (!r.ok) return r;

  await sb.from("exam_desk_policy").upsert({
    tenant_id: tenantId,
    policy_json: policy,
    updated_at: now,
  });

  await writeSyncMeta(sb, tenantId, {
    term_count: terms.length,
    subject_count: subjects.length,
    promotion_count: promotions.length,
    updated_at: now,
  });

  return { ok: true };
}

async function countRows(
  sb: SupabaseClient,
  table: string,
  tenantId: string,
): Promise<number | null> {
  const { count, error } = await sb
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) return null;
  return count ?? 0;
}

/**
 * sync_meta carries the counts the client compares on hydrate. They used to
 * be the size of the pushed payload; now that sheets and setup are written
 * by different calls, each write counts what the tables actually hold.
 */
async function writeSyncMeta(
  sb: SupabaseClient,
  tenantId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const [sheetCount, markCount] = await Promise.all([
    countRows(sb, "exam_desk_sheets", tenantId),
    countRows(sb, "exam_desk_marks", tenantId),
  ]);
  const { data: latest } = await sb
    .from("exam_desk_sheets")
    .select("updated_at")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  await sb.from("exam_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      ...(sheetCount === null ? {} : { sheet_count: sheetCount }),
      ...(markCount === null ? {} : { mark_count: markCount }),
      last_sheet_at: (latest?.updated_at as string | null) ?? null,
      updated_at: new Date().toISOString(),
      ...patch,
    },
    { onConflict: "tenant_id" },
  );
}

async function deleteOrphanEmptySheets(
  sb: SupabaseClient,
  tenantId: string,
  keepTermIds: Set<string>,
): Promise<void> {
  const { data, error } = await sb
    .from("exam_desk_sheets")
    .select("id, exam_term_id")
    .eq("tenant_id", tenantId);
  if (error || !data) return;
  const orphans = data
    .filter((r) => !keepTermIds.has(String(r.exam_term_id)))
    .map((r) => String(r.id));
  if (orphans.length === 0) return;
  const { data: marked } = await sb
    .from("exam_desk_marks")
    .select("mark_sheet_id")
    .eq("tenant_id", tenantId)
    .in("mark_sheet_id", orphans)
    .not("marks_obtained", "is", null)
    .limit(orphans.length);
  const hasMarks = new Set((marked ?? []).map((r) => String(r.mark_sheet_id)));
  const empty = orphans.filter((id) => !hasMarks.has(id));
  if (empty.length === 0) return;
  const { error: delErr } = await sb
    .from("exam_desk_sheets")
    .delete()
    .in("id", empty);
  if (delErr) {
    console.error("[exam_desk_sheets] orphan cleanup failed:", delErr.message);
  }
}


export async function fetchExamDeskFromDb(): Promise<{
  bundle: ExamDeskBundle;
  meta: ExamDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty: ExamDeskBundle = {
    terms: [],
    subjects: [],
    dateSheet: [],
    sheets: [],
    policy: defaultExamPolicy(),
    promotions: [],
  };
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [
    { data: termRows },
    { data: subjectRows },
    { data: dateRows },
    { data: sheetHeaders },
    { data: policyRow },
    { data: promoRows },
    { data: metaRow },
  ] = await Promise.all([
    sb.from("exam_desk_terms").select("*").eq("tenant_id", tenantId),
    sb.from("exam_desk_subjects").select("*").eq("tenant_id", tenantId),
    sb.from("exam_desk_date_sheet").select("*").eq("tenant_id", tenantId),
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb.from("exam_desk_sheets").select("*").eq("tenant_id", tenantId).order("id", { ascending: true }).range(from, to),
    ).then((r) => ({ data: r.rows, error: r.error ? { message: r.error } : null })),
    sb
      .from("exam_desk_policy")
      .select("policy_json")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    sb.from("exam_desk_promotions").select("*").eq("tenant_id", tenantId),
    sb
      .from("exam_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const terms = (termRows ?? [])
    .map((r) => rowToTerm(r as Record<string, unknown>))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const subjects = (subjectRows ?? [])
    .map((r) => rowToSubject(r as Record<string, unknown>))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const dateSheet = (dateRows ?? []).map((r) =>
    rowToDateSheet(r as Record<string, unknown>),
  );

  let markRows: Record<string, unknown>[] = [];
  const sheetIds = (sheetHeaders ?? []).map((h) => String(h.id));
  if (sheetIds.length) {
    const { rows } = await fetchByIds<Record<string, unknown>>(sheetIds, (chunk, from, to) =>
      sb
        .from("exam_desk_marks")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("mark_sheet_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    );
    markRows = rows;
  }

  const marksBySheet = new Map<string, Record<string, unknown>[]>();
  for (const m of markRows) {
    const sid = String(m.mark_sheet_id);
    const list = marksBySheet.get(sid) ?? [];
    list.push(m);
    marksBySheet.set(sid, list);
  }

  let coScholasticRows: Record<string, unknown>[] = [];
  if (sheetIds.length) {
    const { rows } = await fetchByIds<Record<string, unknown>>(sheetIds, (chunk, from, to) =>
      sb
        .from("exam_desk_coscholastic")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("mark_sheet_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    );
    coScholasticRows = rows;
  }

  const coScholasticBySheet = new Map<string, Record<string, unknown>[]>();
  for (const e of coScholasticRows) {
    const sid = String(e.mark_sheet_id);
    const list = coScholasticBySheet.get(sid) ?? [];
    list.push(e);
    coScholasticBySheet.set(sid, list);
  }

  let remarkRows: Record<string, unknown>[] = [];
  if (sheetIds.length) {
    const { rows } = await fetchByIds<Record<string, unknown>>(sheetIds, (chunk, from, to) =>
      sb
        .from("exam_desk_remarks")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("mark_sheet_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    );
    remarkRows = rows;
  }
  const remarksBySheet = new Map<string, Record<string, unknown>[]>();
  for (const e of remarkRows) {
    const sid = String(e.mark_sheet_id);
    const list = remarksBySheet.get(sid) ?? [];
    list.push(e);
    remarksBySheet.set(sid, list);
  }

  let absenceRows: Record<string, unknown>[] = [];
  if (sheetIds.length) {
    const { rows } = await fetchByIds<Record<string, unknown>>(sheetIds, (chunk, from, to) =>
      sb
        .from("exam_desk_absences")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("mark_sheet_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    );
    absenceRows = rows;
  }
  const absencesBySheet = new Map<string, Record<string, unknown>[]>();
  for (const e of absenceRows) {
    const sid = String(e.mark_sheet_id);
    const list = absencesBySheet.get(sid) ?? [];
    list.push(e);
    absencesBySheet.set(sid, list);
  }

  const itemScoreRows: Record<string, unknown>[] = [];
  if (sheetIds.length) {
    // Item scores can be large (students × questions × papers): page through.
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data } = await sb
        .from("exam_desk_item_scores")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("mark_sheet_id", sheetIds)
        .order("id")
        .range(from, from + PAGE - 1);
      const rows = (data ?? []) as Record<string, unknown>[];
      itemScoreRows.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  const itemScoresBySheet = new Map<string, Record<string, unknown>[]>();
  for (const e of itemScoreRows) {
    const sid = String(e.mark_sheet_id);
    const list = itemScoresBySheet.get(sid) ?? [];
    list.push(e);
    itemScoresBySheet.set(sid, list);
  }

  const sheets = (sheetHeaders ?? []).map((h) =>
    rowToSheet(
      h as Record<string, unknown>,
      marksBySheet.get(String(h.id)) ?? [],
      coScholasticBySheet.get(String(h.id)) ?? [],
      remarksBySheet.get(String(h.id)) ?? [],
      itemScoresBySheet.get(String(h.id)) ?? [],
      absencesBySheet.get(String(h.id)) ?? [],
    ),
  );

  const policy = normalizeExamPolicy(
    (policyRow?.policy_json as Partial<ExamPolicy> | undefined) ?? undefined,
  );

  const promotions = (promoRows ?? []).map((r) =>
    rowToPromotion(r as Record<string, unknown>),
  );

  return {
    bundle: { terms, subjects, dateSheet, sheets, policy, promotions },
    meta: mapMetaRow(metaRow as Record<string, unknown> | null),
  };
}

export type SheetPushResult =
  | { ok: true }
  | { ok: false; error: string; conflict?: boolean };

/**
 * Write one section's sheet: header, then each child table inside its own
 * transaction, then the counts.
 *
 * `expectedUpdatedAt` is the version the caller edited from (null = the
 * caller created the sheet). When the stored header is at a different
 * version somebody else saved in between; the write is refused with
 * `conflict: true` and nothing is changed. Omit it to write unconditionally
 * (only the mirror service does).
 */
export async function pushExamSheetToDb(
  sheet: MarkSheet,
  opts?: {
    subjectsUsed?: ExamSubject[];
    expectedUpdatedAt?: string | null;
  },
): Promise<SheetPushResult> {
  if (!examsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "No tenant" };
  const { sb, tenantId } = ctx;
  const { header, marks, absences, coScholastic, remarks, itemScores } = sheetToRows(tenantId, sheet);

  if (opts && "expectedUpdatedAt" in opts) {
    const { data: current, error: curErr } = await sb
      .from("exam_desk_sheets")
      .select("id, updated_at, entered_by")
      .eq("tenant_id", tenantId)
      .eq("id", sheet.id)
      .maybeSingle();
    if (curErr) return { ok: false, error: curErr.message };
    const storedAt = (current?.updated_at as string | null) ?? null;
    if (!sameInstant(storedAt, opts.expectedUpdatedAt ?? null)) {
      const who = String(current?.entered_by || "someone else");
      const when = storedAt
        ? new Date(storedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        : "";
      return {
        ok: false,
        conflict: true,
        error: storedAt
          ? `${who} saved this mark sheet at ${when}, after you opened it. Reload to see their marks, then enter yours again. Nothing you typed has been sent.`
          : "This mark sheet was removed on the server after you opened it. Reload before saving again.",
      };
    }
    if (!current) {
      // New here — but the (year, exam, section) key may already be taken
      // by a sheet this browser never saw.
      const { data: twin } = await sb
        .from("exam_desk_sheets")
        .select("id, entered_by, updated_at")
        .eq("tenant_id", tenantId)
        .eq("academic_year_code", sheet.academicYearCode)
        .eq("exam_term_id", sheet.examTermId)
        .eq("section_id", sheet.sectionId)
        .maybeSingle();
      if (twin && String(twin.id) !== sheet.id) {
        return {
          ok: false,
          conflict: true,
          error: `${String(twin.entered_by || "Someone")} already saved a mark sheet for this exam and section. Reload to see it, then enter your marks on that sheet.`,
        };
      }
    }
  }

  if (opts?.subjectsUsed?.length) {
    const r = await upsertChunks(
      sb,
      "exam_desk_subjects",
      opts.subjectsUsed.map((s) => subjectToRow(tenantId, s)),
    );
    if (!r.ok) return { ok: false, error: r.error ?? "exam subjects not written" };
  }

  const { error: hErr } = await sb.from("exam_desk_sheets").upsert(header);
  if (hErr) return { ok: false, error: hErr.message };

  // Each of these four was a delete followed by an insert, with nothing tying
  // them together. A failed insert left the deletes committed — a mark sheet
  // with no marks, which is a term's assessment gone. Same shape that emptied
  // every fee receipt on 2026-09-06; each is now one transaction that rolls
  // its own delete back.
  //
  // The four are still four calls, not one. They are independent tables and a
  // failure in the third must not silently undo the first two's *successful*
  // work — it returns, and the sheet is re-pushed. What matters is that no
  // single table is ever left emptied.
  for (const part of [
    { table: "exam_desk_marks", rows: marks },
    { table: "exam_desk_absences", rows: absences },
    { table: "exam_desk_coscholastic", rows: coScholastic },
    { table: "exam_desk_remarks", rows: remarks },
    { table: "exam_desk_item_scores", rows: itemScores },
  ] as const) {
    const write = await replaceChildRows(sb, {
      table: part.table,
      tenantId,
      match: { mark_sheet_id: sheet.id },
      rows: part.rows as Record<string, unknown>[],
    });
    if (!write.ok) return { ok: false, error: write.error };
  }

  await writeSyncMeta(sb, tenantId, {});

  return { ok: true };
}

/** One sheet with all its child rows, by id. */
export async function fetchExamSheetFromDb(
  sheetId: string,
): Promise<MarkSheet | null> {
  const ctx = await resolveCtx();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;
  const { data: header } = await sb
    .from("exam_desk_sheets")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", sheetId)
    .maybeSingle();
  if (!header) return null;
  return loadSheetChildren(sb, tenantId, header as Record<string, unknown>);
}

/** One sheet by its natural key (year, exam, section). */
export async function fetchExamSheetByKeyFromDb(
  academicYearCode: string,
  examTermId: string,
  sectionId: string,
): Promise<MarkSheet | null> {
  const ctx = await resolveCtx();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;
  const { data: header } = await sb
    .from("exam_desk_sheets")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("academic_year_code", academicYearCode)
    .eq("exam_term_id", examTermId)
    .eq("section_id", sectionId)
    .maybeSingle();
  if (!header) return null;
  return loadSheetChildren(sb, tenantId, header as Record<string, unknown>);
}

async function loadSheetChildren(
  sb: SupabaseClient,
  tenantId: string,
  header: Record<string, unknown>,
): Promise<MarkSheet> {
  const sheetId = String(header.id);
  const child = (table: string) =>
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb
        .from(table)
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("mark_sheet_id", sheetId)
        .order("id", { ascending: true })
        .range(from, to),
    ).then((r) => r.rows);
  const [marks, co, remarks, items, absences] = await Promise.all([
    child("exam_desk_marks"),
    child("exam_desk_coscholastic"),
    child("exam_desk_remarks"),
    child("exam_desk_item_scores"),
    child("exam_desk_absences"),
  ]);
  return rowToSheet(header, marks, co, remarks, items, absences);
}
