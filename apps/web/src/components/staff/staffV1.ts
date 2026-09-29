"use client";

import type { SisState, SisStudent } from "@/lib/sis";
import { studentsInSession } from "@/lib/sis";
import type { MyTeaching } from "@/components/staff/useMyTeaching";

/**
 * Small client helpers for the teacher-mode desks that read and write
 * through the section-scoped /api/v1/staff/* routes (discipline, health).
 *
 * Why not the desk's own localStorage save: a teacher has view + create on
 * those modules, not edit, so the whole-blob module_local_state save is
 * refused for them — and even if it were allowed, it would let a browser
 * write any child in the school. The v1 routes check the child's section
 * against the teacher's classes on the server. 2026-09-29.
 */

export type V1Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function staffV1<T>(url: string, init?: RequestInit): Promise<V1Result<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; data?: T; error?: { message?: string } | string }
      | null;
    if (!res.ok || !body?.ok) {
      const err = typeof body?.error === "string" ? body.error : body?.error?.message;
      return { ok: false, status: res.status, error: err || `Not saved (server said ${res.status})` };
    }
    return { ok: true, data: body.data as T };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the school server" };
  }
}

/**
 * Every section in `my.teaching`, fetched one by one and merged by id. Any
 * failure fails the whole read: a list missing one class would read as
 * "no incidents in that class", and unknown is not the same as none.
 */
export async function fetchForMySections<Row extends { id: string }, Body>(
  my: MyTeaching,
  path: string,
  pick: (body: Body) => Row[],
): Promise<V1Result<Row[]>> {
  const byId = new Map<string, Row>();
  for (const t of my.teaching) {
    const qs = new URLSearchParams({ classId: t.classId, sectionId: t.sectionId });
    const r = await staffV1<Body>(`${path}?${qs.toString()}`);
    if (!r.ok) return r;
    for (const row of pick(r.data)) byId.set(row.id, row);
  }
  return { ok: true, data: [...byId.values()] };
}

/** This session's children in the teacher's own sections — what a
 * teacher-mode picker may offer. The server re-checks every save. */
export function studentsOfMySections(sis: SisState, ay: string, my: MyTeaching): SisStudent[] {
  const mine = new Set(my.teaching.map((t) => `${t.classId}|${t.sectionId}`));
  return studentsInSession(sis, ay).filter((s) => mine.has(`${s.classId}|${s.sectionId}`));
}
