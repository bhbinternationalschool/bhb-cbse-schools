/**
 * Curriculum persistence — localStorage is always the working copy;
 * when Supabase is configured, push/pull overlays remote rows.
 */

import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  normalizeCurriculum,
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

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPush: SisLike | null = null;

export function curriculumRemoteEnabled() {
  return isSupabaseConfigured();
}

export function resetCurriculumPersistenceCache() {
  resetDeskHydrated(MODULE);
  pendingPush = null;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

/** Browser: pull curriculum + requests + templates via the server API. */
export async function fetchCurriculumRemote(): Promise<CurriculumRemoteBundle | null> {
  if (!curriculumRemoteEnabled()) return null;
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/school-data/curriculum", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[curriculum] pull failed", res.status);
      return null;
    }
    const body = (await res.json()) as {
      ok?: boolean;
      byStudentKey?: Record<string, StudentCurriculum>;
      requests?: CurriculumRequest[];
      templates?: ClassCurriculumTemplate[];
    };
    if (!body.ok) return null;
    return {
      byStudentKey: body.byStudentKey ?? {},
      requests: body.requests ?? [],
      templates: body.templates ?? [],
    };
  } catch (e) {
    console.warn("[curriculum] pull error", e);
    return null;
  }
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

async function postCurriculum(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (!curriculumRemoteEnabled()) return { ok: true };
  if (typeof window === "undefined") return { ok: true };
  try {
    const res = await fetch("/api/school-data/curriculum", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const resBody = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;
    if (!res.ok || !resBody?.ok) {
      const message = resBody?.error || `HTTP ${res.status}`;
      console.warn("[curriculum] push failed", message);
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch (e) {
    console.warn("[curriculum] push error", e);
    return { ok: false, error: String(e) };
  }
}

/** Browser: push curriculum choices + requests via the server API. */
export async function pushCurriculumState(
  state: SisLike,
): Promise<{ ok: boolean; error?: string }> {
  return postCurriculum({
    students: state.students,
    curriculumRequests: state.curriculumRequests ?? [],
  });
}

/** Browser: push class curriculum templates via the server API. */
export async function pushClassCurriculumTemplatesRemote(
  list: ClassCurriculumTemplate[],
): Promise<{ ok: boolean; error?: string }> {
  if (list.length === 0) return { ok: true };
  return postCurriculum({ templates: list });
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
