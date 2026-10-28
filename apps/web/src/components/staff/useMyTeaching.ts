"use client";

import { ErpQueryError, useErpQuery } from "@/lib/data/client/hooks";
import type { TeachingSection } from "@/lib/staffTeachingScope";

/**
 * "My classes" for the signed-in member of staff, from the server
 * (GET /api/v1/staff/my-classes) — the same answer the server uses to allow
 * or refuse a save, so a picker can never offer a class the save will
 * reject.
 *
 * `unrestricted` = principal / office: list the whole school as before.
 * `null` while loading or when the answer could not be fetched; callers
 * must not treat that as "no classes" (unknown is not a fact).
 *
 * Read through the query kernel (data-layer 1.4) instead of a module-level
 * copy and a mount-only effect: one cached answer per tab (fresh for 60 s,
 * as the old copy was), refetched when the tab regains focus after that,
 * and when the versions poll sees the staff roster, the timetable or
 * Masters move — the inputs of the server's scope.
 */
export type MyTeaching = {
  unrestricted: boolean;
  academicYearCode: string;
  teaching: TeachingSection[];
  /**
   * Today's attendance cover: classes this person may take the REGISTER of
   * today only — as a substitute, or as co-ordinator while the class teacher
   * is away (lib/attendanceCover). Never offered by any other picker.
   */
  attendanceCover?: {
    classId: string;
    sectionId: string;
    className: string;
    sectionName: string;
    reason: "substitute" | "coordinator";
    detail: string;
  }[];
};

/** The answer, or a failed read: a shape without `unrestricted` / `teaching` is not "no classes". */
export function parseMyTeaching(data: unknown): MyTeaching {
  const d = data as Partial<MyTeaching> | null;
  if (!d || typeof d.unrestricted !== "boolean" || !Array.isArray(d.teaching)) {
    throw new ErpQueryError(502, "my-classes answered without unrestricted/teaching");
  }
  return d as MyTeaching;
}

/** The erp_versions keys the server builds the scope from (lib/api/v1/staffScope). */
export const MY_TEACHING_DESKS = ["sis_staff", "timetable", "masters"] as const;

export function useMyTeaching(): { my: MyTeaching | null; loading: boolean } {
  const q = useErpQuery<MyTeaching>("my-teaching", "/api/v1/staff/my-classes", {
    desk: MY_TEACHING_DESKS,
    parse: parseMyTeaching,
  });
  // The old contract: `loading` until the first answer or failure (a
  // background refetch does not flip it back); `my` null while loading and
  // when it could not be read. A failed background refetch keeps the last
  // good answer on screen (the old copy was replaced by null only on a remount
  // after 60 s).
  return { my: q.data ?? null, loading: q.isPending };
}

/** Restricted = a teacher whose pickers must be narrowed to `teaching`. */
export function isRestrictedTeacher(my: MyTeaching | null): my is MyTeaching {
  return !!my && !my.unrestricted;
}
