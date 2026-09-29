"use client";

import type { LessonPlan, ResourceKind, TeachingLogStatus } from "@/lib/teaching";

/**
 * A teacher's writes on the web Teaching desk (2026-09-29).
 *
 * The desk used to save by pushing the whole teaching blob, which the
 * server accepted from anyone holding "teaching.edit" — so a teacher could
 * write plans for any class, and a stale tab could rewrite other people's
 * logs. A teacher now saves one period log or one lesson plan at a time,
 * through the same v1 routes the staff app uses, and the server checks the
 * period is on their timetable / the class and subject are theirs.
 * The office and principal still save through the blob.
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; data?: T; error?: { message?: string } | string }
      | null;
    if (!res.ok || !json?.ok) {
      const err = json?.error;
      const message =
        (typeof err === "string" ? err : err?.message) || `Could not save (${res.status})`;
      return { ok: false, error: message };
    }
    return { ok: true, data: json.data as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the server" };
  }
}

export type PeriodLogWrite = {
  date: string;
  periodNo: number;
  classId: string;
  sectionId: string;
  status: TeachingLogStatus;
  unitIds: string[];
  lessonPlanId: string;
  note: string;
  startedAt?: string;
};

export function postPeriodLog(body: PeriodLogWrite) {
  return post<{ logId: string; status: TeachingLogStatus }>("/api/v1/teaching/log", body);
}

export type LessonPlanWrite =
  | {
      action: "save";
      id?: string;
      classId: string;
      subjectId: string;
      sectionId?: string;
      title: string;
      unitIds: string[];
      plannedDate: string;
      plannedPeriods: number;
      objectives: string;
      teachingAids: string;
      activities: string;
      assessment: string;
      homework: string;
      source: string;
      aiModel: string;
    }
  | { action: "remove"; id: string }
  | {
      action: "add_resource";
      id: string;
      resource: { kind: ResourceKind; title: string; url: string; locator: string };
    }
  | { action: "remove_resource"; id: string; resourceId: string };

export type LessonPlanWriteResult = ApiResult<{ id: string; plan: LessonPlan | null }>;

export function postLessonPlan(body: LessonPlanWrite): Promise<LessonPlanWriteResult> {
  return post<{ id: string; plan: LessonPlan | null }>("/api/v1/teaching/lesson-plan", body);
}
