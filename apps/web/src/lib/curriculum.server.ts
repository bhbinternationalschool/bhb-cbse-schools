/**
 * Server-side curriculum read/write (student_curriculum, curriculum_requests,
 * class_curriculum_templates) — used by /api/school-data/curriculum so the
 * browser no longer needs direct Supabase table access for this module.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  normalizeCurriculum,
  normalizeCurriculumRequest,
  type CurriculumRequest,
  type StudentCurriculum,
} from "@/lib/studentCurriculum";
import type { ClassCurriculumTemplate } from "@/lib/officeCurriculumWorkflow";
import type { CurriculumRemoteBundle } from "@/lib/curriculumPersistence";

type StudentCurriculumRow = {
  student_key: string;
  academic_year_code: string;
  senior_stream_id: string | null;
  chosen_subject_ids: string[] | null;
  confirmed_at: string | null;
  confirmed_by: "office" | "system" | null;
};

type CurriculumRequestRow = {
  id: string;
  student_key: string;
  academic_year_code: string;
  proposed_stream_id: string | null;
  proposed_chosen_subject_ids: string[] | null;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};

type TemplateRow = {
  id: string;
  class_key: string;
  academic_year_code: string;
  label: string;
  chosen_subject_ids: string[] | null;
  senior_stream_id: string | null;
  updated_at: string;
};

function rowToCurriculum(row: StudentCurriculumRow): StudentCurriculum {
  return normalizeCurriculum(
    {
      academicYearCode: row.academic_year_code,
      seniorStreamId: row.senior_stream_id,
      chosenSubjectIds: row.chosen_subject_ids ?? [],
      confirmedAt: row.confirmed_at ?? "",
      confirmedBy: row.confirmed_by ?? "system",
    },
    row.academic_year_code,
  )!;
}

function rowToRequest(row: CurriculumRequestRow): CurriculumRequest {
  return normalizeCurriculumRequest({
    id: row.id,
    studentId: row.student_key,
    academicYearCode: row.academic_year_code,
    proposedStreamId: row.proposed_stream_id,
    proposedChosenSubjectIds: row.proposed_chosen_subject_ids ?? [],
    note: row.note ?? "",
    status: row.status,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note ?? "",
  });
}

function rowToTemplate(row: TemplateRow): ClassCurriculumTemplate {
  return {
    id: row.id,
    classId: row.class_key,
    academicYearCode: row.academic_year_code,
    label: row.label || "Class template",
    chosenSubjectIds: row.chosen_subject_ids ?? [],
    seniorStreamId: row.senior_stream_id,
    updatedAt: row.updated_at,
  };
}

export async function fetchCurriculumRemoteServer(): Promise<CurriculumRemoteBundle | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;

  const [curRes, reqRes, tmplRes] = await Promise.all([
    sb
      .from("student_curriculum")
      .select(
        "student_key, academic_year_code, senior_stream_id, chosen_subject_ids, confirmed_at, confirmed_by",
      )
      .eq("tenant_id", tenantId),
    sb
      .from("curriculum_requests")
      .select(
        "id, student_key, academic_year_code, proposed_stream_id, proposed_chosen_subject_ids, note, status, requested_at, reviewed_at, review_note",
      )
      .eq("tenant_id", tenantId),
    sb
      .from("class_curriculum_templates")
      .select(
        "id, class_key, academic_year_code, label, chosen_subject_ids, senior_stream_id, updated_at",
      )
      .eq("tenant_id", tenantId),
  ]);

  if (curRes.error || reqRes.error || tmplRes.error) {
    console.warn(
      "[curriculum] server pull failed",
      curRes.error?.message || reqRes.error?.message || tmplRes.error?.message,
    );
    return null;
  }

  const byStudentKey: Record<string, StudentCurriculum> = {};
  for (const row of (curRes.data ?? []) as StudentCurriculumRow[]) {
    byStudentKey[row.student_key] = rowToCurriculum(row);
  }

  return {
    byStudentKey,
    requests: ((reqRes.data ?? []) as CurriculumRequestRow[]).map(rowToRequest),
    templates: ((tmplRes.data ?? []) as TemplateRow[]).map(rowToTemplate),
  };
}

type SisLike = {
  students: Array<{
    id: string;
    academicYearCode: string;
    curriculum: StudentCurriculum | null;
  }>;
  curriculumRequests: CurriculumRequest[];
};

export async function pushCurriculumStateServer(
  state: SisLike,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const curriculumRows: Array<{
    tenant_id: string;
    student_key: string;
    academic_year_code: string;
    senior_stream_id: string | null;
    chosen_subject_ids: string[];
    confirmed_at: string | null;
    confirmed_by: "office" | "system" | null;
    updated_at: string;
  }> = [];
  for (const s of state.students) {
    const cur = normalizeCurriculum(s.curriculum, s.academicYearCode);
    if (!cur || cur.chosenSubjectIds.length === 0) continue;
    curriculumRows.push({
      tenant_id: tenantId,
      student_key: s.id,
      academic_year_code: cur.academicYearCode || s.academicYearCode,
      senior_stream_id: cur.seniorStreamId,
      chosen_subject_ids: cur.chosenSubjectIds,
      confirmed_at: cur.confirmedAt || null,
      confirmed_by: cur.confirmedAt ? cur.confirmedBy : null,
      updated_at: now,
    });
  }

  if (curriculumRows.length > 0) {
    const { error } = await sb.from("student_curriculum").upsert(curriculumRows, {
      onConflict: "tenant_id,student_key,academic_year_code",
    });
    if (error) {
      console.warn("[curriculum] push curricula failed", error.message);
      return { ok: false, error: error.message };
    }
  }

  const requestRows = (state.curriculumRequests ?? []).map((r) => ({
    id: r.id,
    tenant_id: tenantId,
    student_key: r.studentId,
    academic_year_code: r.academicYearCode,
    proposed_stream_id: r.proposedStreamId,
    proposed_chosen_subject_ids: r.proposedChosenSubjectIds,
    note: r.note ?? "",
    status: r.status,
    requested_at: r.requestedAt,
    reviewed_at: r.reviewedAt,
    review_note: r.reviewNote ?? "",
  }));

  if (requestRows.length > 0) {
    const { error } = await sb.from("curriculum_requests").upsert(requestRows, {
      onConflict: "id",
    });
    if (error) {
      console.warn("[curriculum] push requests failed", error.message);
      return { ok: false, error: error.message };
    }
  }

  return { ok: true };
}

export async function pushClassCurriculumTemplatesServer(
  list: ClassCurriculumTemplate[],
): Promise<{ ok: boolean; error?: string }> {
  if (list.length === 0) return { ok: true };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;

  const rows = list.map((t) => ({
    id: t.id,
    tenant_id: tenantId,
    class_key: t.classId,
    academic_year_code: t.academicYearCode,
    label: t.label,
    chosen_subject_ids: t.chosenSubjectIds,
    senior_stream_id: t.seniorStreamId,
    updated_at: t.updatedAt || new Date().toISOString(),
  }));

  const { error } = await sb.from("class_curriculum_templates").upsert(rows, {
    onConflict: "id",
  });
  if (error) {
    console.warn("[curriculum] push templates failed", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
