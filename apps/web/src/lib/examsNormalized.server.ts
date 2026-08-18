/**
 * Exam desk — Supabase normalized tables (exam_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultExamPolicy,
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
  type StudentCoScholasticEntry,
  type StudentOverallRemark,
  type StudentSubjectMark,
} from "@/lib/exams";
import { examsDualWriteDbEnabled } from "@/lib/examsDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

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
  coScholastic: Record<string, unknown>[];
  remarks: Record<string, unknown>[];
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
    id: `${s.id}:${m.studentId}:${m.subjectId}`,
    mark_sheet_id: s.id,
    tenant_id: tenantId,
    student_id: m.studentId,
    subject_id: m.subjectId,
    marks_obtained: m.marksObtained,
    grade: m.grade || "—",
    remark: m.remark || "",
    remark_source: normalizeRemarkSource(m.remarkSource),
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
  return { header, marks, coScholastic, remarks };
}

function rowToSheet(
  header: Record<string, unknown>,
  markRows: Record<string, unknown>[],
  coScholasticRows: Record<string, unknown>[] = [],
  remarkRows: Record<string, unknown>[] = [],
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
        marksObtained:
          m.marks_obtained === null || m.marks_obtained === undefined
            ? null
            : Number(m.marks_obtained),
        grade: String(m.grade || "—"),
        remark: String(m.remark || ""),
        remarkSource: normalizeRemarkSource(m.remark_source),
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
  const sheets = state.sheets ?? [];
  const promotions = state.promotions ?? [];
  const policy = normalizeExamPolicy(state.policy);

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
      "exam_desk_sheets",
      new Set(sheets.map((s) => s.id)),
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

  const sheetHeaders: Record<string, unknown>[] = [];
  const allMarks: Record<string, unknown>[] = [];
  const allCoScholastic: Record<string, unknown>[] = [];
  const allRemarks: Record<string, unknown>[] = [];
  let lastSheetAt: string | null = null;

  for (const sheet of sheets) {
    const { header, marks, coScholastic, remarks } = sheetToRows(tenantId, sheet);
    sheetHeaders.push(header);
    allMarks.push(...marks);
    allCoScholastic.push(...coScholastic);
    allRemarks.push(...remarks);
    const updated = String(header.updated_at);
    if (!lastSheetAt || updated > lastSheetAt) lastSheetAt = updated;
  }

  r = await upsertChunks(sb, "exam_desk_sheets", sheetHeaders);
  if (!r.ok) return r;

  const sheetIds = new Set(sheets.map((s) => s.id));
  const { data: existingMarks } = await sb
    .from("exam_desk_marks")
    .select("id, mark_sheet_id")
    .eq("tenant_id", tenantId);
  const staleMarkIds = (existingMarks ?? [])
    .filter((m) => sheetIds.has(String(m.mark_sheet_id)))
    .map((m) => String(m.id));
  if (staleMarkIds.length) {
    await sb.from("exam_desk_marks").delete().in("id", staleMarkIds);
  }

  r = await upsertChunks(sb, "exam_desk_marks", allMarks, 500);
  if (!r.ok) return r;

  const { data: existingCoScholastic } = await sb
    .from("exam_desk_coscholastic")
    .select("id, mark_sheet_id")
    .eq("tenant_id", tenantId);
  const staleCoScholasticIds = (existingCoScholastic ?? [])
    .filter((e) => sheetIds.has(String(e.mark_sheet_id)))
    .map((e) => String(e.id));
  if (staleCoScholasticIds.length) {
    await sb.from("exam_desk_coscholastic").delete().in("id", staleCoScholasticIds);
  }

  r = await upsertChunks(sb, "exam_desk_coscholastic", allCoScholastic, 500);
  if (!r.ok) return r;

  const { data: existingRemarks } = await sb
    .from("exam_desk_remarks")
    .select("id, mark_sheet_id")
    .eq("tenant_id", tenantId);
  const staleRemarkIds = (existingRemarks ?? [])
    .filter((e) => sheetIds.has(String(e.mark_sheet_id)))
    .map((e) => String(e.id));
  if (staleRemarkIds.length) {
    await sb.from("exam_desk_remarks").delete().in("id", staleRemarkIds);
  }

  r = await upsertChunks(sb, "exam_desk_remarks", allRemarks, 500);
  if (!r.ok) return r;

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

  await sb.from("exam_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      term_count: terms.length,
      subject_count: subjects.length,
      sheet_count: sheets.length,
      mark_count: allMarks.length,
      promotion_count: promotions.length,
      last_sheet_at: lastSheetAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
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
    sb.from("exam_desk_sheets").select("*").eq("tenant_id", tenantId),
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
    const { data } = await sb
      .from("exam_desk_marks")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("mark_sheet_id", sheetIds);
    markRows = (data ?? []) as Record<string, unknown>[];
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
    const { data } = await sb
      .from("exam_desk_coscholastic")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("mark_sheet_id", sheetIds);
    coScholasticRows = (data ?? []) as Record<string, unknown>[];
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
    const { data } = await sb
      .from("exam_desk_remarks")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("mark_sheet_id", sheetIds);
    remarkRows = (data ?? []) as Record<string, unknown>[];
  }
  const remarksBySheet = new Map<string, Record<string, unknown>[]>();
  for (const e of remarkRows) {
    const sid = String(e.mark_sheet_id);
    const list = remarksBySheet.get(sid) ?? [];
    list.push(e);
    remarksBySheet.set(sid, list);
  }

  const sheets = (sheetHeaders ?? []).map((h) =>
    rowToSheet(
      h as Record<string, unknown>,
      marksBySheet.get(String(h.id)) ?? [],
      coScholasticBySheet.get(String(h.id)) ?? [],
      remarksBySheet.get(String(h.id)) ?? [],
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

export async function pushExamSheetToDb(
  sheet: MarkSheet,
): Promise<{ ok: boolean; error?: string }> {
  if (!examsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "No tenant" };
  const { sb, tenantId } = ctx;
  const { header, marks, coScholastic, remarks } = sheetToRows(tenantId, sheet);

  const { error: hErr } = await sb.from("exam_desk_sheets").upsert(header);
  if (hErr) return { ok: false, error: hErr.message };

  await sb.from("exam_desk_marks").delete().eq("mark_sheet_id", sheet.id);
  if (marks.length) {
    const { error: mErr } = await sb.from("exam_desk_marks").upsert(marks);
    if (mErr) return { ok: false, error: mErr.message };
  }
  await sb.from("exam_desk_coscholastic").delete().eq("mark_sheet_id", sheet.id);
  if (coScholastic.length) {
    const { error: cErr } = await sb.from("exam_desk_coscholastic").upsert(coScholastic);
    if (cErr) return { ok: false, error: cErr.message };
  }
  await sb.from("exam_desk_remarks").delete().eq("mark_sheet_id", sheet.id);
  if (remarks.length) {
    const { error: rErr } = await sb.from("exam_desk_remarks").upsert(remarks);
    if (rErr) return { ok: false, error: rErr.message };
  }

  await sb.from("exam_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      last_sheet_at: header.updated_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}
