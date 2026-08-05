/**
 * Curriculum persistence — localStorage is always the working copy;
 * when Supabase is configured, push/pull overlays remote rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createBrowserSupabase,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { TENANT } from "@/lib/types";
import {
  normalizeCurriculum,
  normalizeCurriculumRequest,
  type CurriculumRequest,
  type StudentCurriculum,
} from "@/lib/studentCurriculum";
import type { ClassCurriculumTemplate } from "@/lib/officeCurriculumWorkflow";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "curriculum";

export type CurriculumRemoteBundle = {
  byStudentKey: Record<string, StudentCurriculum>;
  requests: CurriculumRequest[];
  templates: ClassCurriculumTemplate[];
};

type SisLike = {
  students: Array<{
    id: string;
    academicYearCode: string;
    curriculum: StudentCurriculum | null;
  }>;
  curriculumRequests: CurriculumRequest[];
};

type StudentCurriculumRow = {
  student_key: string;
  academic_year_code: string;
  senior_stream_id: string | null;
  chosen_subject_ids: string[] | null;
  confirmed_at: string | null;
  confirmed_by: "office" | "system" | null;
  updated_at?: string;
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

let tenantIdCache: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPush: SisLike | null = null;

export function curriculumRemoteEnabled() {
  return isSupabaseConfigured();
}

export function resetCurriculumPersistenceCache() {
  resetDeskHydrated(MODULE);
  tenantIdCache = null;
  pendingPush = null;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

async function clientAndTenant(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  const sb = createBrowserSupabase();
  if (!sb) return null;
  if (tenantIdCache) return { sb, tenantId: tenantIdCache };
  const { data, error } = await sb
    .from("tenants")
    .select("id")
    .eq("slug", TENANT.slug)
    .maybeSingle();
  if (error || !data?.id) {
    console.warn("[curriculum] tenant resolve failed", error?.message);
    return null;
  }
  tenantIdCache = data.id as string;
  return { sb, tenantId: tenantIdCache };
}

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

/** Pull curriculum + requests + templates for the BHB tenant. */
export async function fetchCurriculumRemote(): Promise<CurriculumRemoteBundle | null> {
  if (!curriculumRemoteEnabled()) return null;
  const ctx = await clientAndTenant();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;

  const [curRes, reqRes, tmplRes] = await Promise.all([
    sb
      .from("student_curriculum")
      .select(
        "student_key, academic_year_code, senior_stream_id, chosen_subject_ids, confirmed_at, confirmed_by, updated_at",
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

  if (curRes.error) {
    console.warn("[curriculum] pull curricula failed", curRes.error.message);
    return null;
  }
  if (reqRes.error) {
    console.warn("[curriculum] pull requests failed", reqRes.error.message);
    return null;
  }
  if (tmplRes.error) {
    console.warn("[curriculum] pull templates failed", tmplRes.error.message);
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

/**
 * Merge remote curriculum into a SIS-like state.
 * Remote wins when it has subject choices or a confirmation stamp.
 */
export function mergeCurriculumRemoteIntoSis<T extends SisLike>(
  state: T,
  remote: CurriculumRemoteBundle,
): T {
  const students = state.students.map((s) => {
    const remoteCur = remote.byStudentKey[s.id];
    if (!remoteCur) return s;
    const local = normalizeCurriculum(s.curriculum, s.academicYearCode);
    const remoteHas =
      remoteCur.chosenSubjectIds.length > 0 || Boolean(remoteCur.confirmedAt);
    if (!remoteHas) return s;
    const localHas =
      (local?.chosenSubjectIds.length ?? 0) > 0 || Boolean(local?.confirmedAt);
    // Prefer remote confirmation; otherwise prefer whichever has choices
    if (remoteCur.confirmedAt || !localHas) {
      return { ...s, curriculum: remoteCur };
    }
    return s;
  });

  const byId = new Map<string, CurriculumRequest>();
  for (const r of state.curriculumRequests ?? []) byId.set(r.id, r);
  for (const r of remote.requests) {
    const local = byId.get(r.id);
    if (!local) {
      byId.set(r.id, r);
      continue;
    }
    if (local.status === "pending" && r.status !== "pending") {
      byId.set(r.id, r);
    } else if (r.status === "pending" && local.status === "pending") {
      byId.set(r.id, r.requestedAt >= local.requestedAt ? r : local);
    } else {
      byId.set(r.id, r);
    }
  }

  return {
    ...state,
    students,
    curriculumRequests: [...byId.values()],
  };
}

/** Merge templates: newer updatedAt wins per class+AY. */
export function mergeCurriculumTemplates(
  local: ClassCurriculumTemplate[],
  remote: ClassCurriculumTemplate[],
): ClassCurriculumTemplate[] {
  const key = (t: ClassCurriculumTemplate) =>
    `${t.classId}::${t.academicYearCode}`;
  const map = new Map<string, ClassCurriculumTemplate>();
  for (const t of local) map.set(key(t), t);
  for (const t of remote) {
    const prev = map.get(key(t));
    if (!prev || t.updatedAt >= prev.updatedAt) map.set(key(t), t);
  }
  return [...map.values()];
}

export async function pushCurriculumState(
  state: SisLike,
): Promise<{ ok: boolean; error?: string }> {
  if (!curriculumRemoteEnabled()) return { ok: true };
  const ctx = await clientAndTenant();
  if (!ctx) return { ok: false, error: "Tenant not resolved" };
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

export async function pushClassCurriculumTemplatesRemote(
  list: ClassCurriculumTemplate[],
): Promise<{ ok: boolean; error?: string }> {
  if (!curriculumRemoteEnabled()) return { ok: true };
  const ctx = await clientAndTenant();
  if (!ctx) return { ok: false, error: "Tenant not resolved" };
  const { sb, tenantId } = ctx;

  if (list.length === 0) return { ok: true };

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

/** Debounced push after local saveSis. */
export function scheduleCurriculumSync(state: SisLike) {
  if (!curriculumRemoteEnabled()) return;
  if (typeof window === "undefined") return;
  pendingPush = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const payload = pendingPush;
    pendingPush = null;
    pushTimer = null;
    if (!payload) return;
    void pushCurriculumState(payload);
  }, 400);
}

export function scheduleTemplateSync(list: ClassCurriculumTemplate[]) {
  if (!curriculumRemoteEnabled()) return;
  if (typeof window === "undefined") return;
  void pushClassCurriculumTemplatesRemote(list);
}

/**
 * One-shot hydrate: pull remote and return merge helpers.
 * Caller writes localStorage (saveSis / save templates).
 */
export async function hydrateCurriculumRemoteOnce(): Promise<CurriculumRemoteBundle | null> {
  if (!curriculumRemoteEnabled()) return null;
  return fetchCurriculumRemote();
}

/**
 * Pull remote once and write merged curriculum into localStorage.
 * Safe to call from any workspace mount; no-ops when Supabase is unset.
 */
export async function ensureCurriculumHydrated(): Promise<boolean> {
  if (!curriculumRemoteEnabled()) return false;
  if (isDeskHydrated(MODULE)) return false;
  markDeskHydrated(MODULE);

  const remote = await hydrateCurriculumRemoteOnce();
  if (!remote) return false;
  const { loadSis, saveSis } = await import("@/lib/sis");
  const {
    loadClassCurriculumTemplates,
    saveClassCurriculumTemplates,
  } = await import("@/lib/officeCurriculumWorkflow");
  const merged = mergeCurriculumRemoteIntoSis(loadSis(), remote);
  saveSis(merged);
  saveClassCurriculumTemplates(
    mergeCurriculumTemplates(
      loadClassCurriculumTemplates(),
      remote.templates,
    ),
  );
  scheduleCurriculumSync(merged);
  return true;
}
