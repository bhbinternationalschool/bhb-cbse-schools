/**
 * The teaching plan and the timetable as the DATABASE holds them, for the
 * /api/v1/teaching/* routes.
 *
 * Until 13 Oct 2026 those routes called ensureTeachingHydratedServer() /
 * ensureTimetableHydratedServer() and then loadTeaching() / loadTimetable().
 * Both loaders are browser-only: on the server they return an empty state
 * (`typeof window === "undefined"`), and the hydrates write through
 * writeTeachingLocalRaw() / writeTimetableLocalRaw(), which are no-ops there.
 * So every route worked on an empty plan and an empty timetable:
 *  - /today answered "no published timetable" and, past that, no chapters
 *    and no lesson plans;
 *  - /lesson-plan answered 404 to every edit of an existing plan;
 *  - /log refused every chapter tag ("not in this subject's plan");
 *  - /syllabus-import de-duplicated a scan against nothing.
 * The /api/v1/staff/ai/* routes (PR #604) already read the stored blob for
 * the same reason; this is that read, made strict.
 *
 * Unknown is not empty: a failed read throws ApiError 503. Only a read that
 * succeeded and found no row is an empty plan ("never set up").
 */

import "server-only";
import { ApiError } from "@/lib/api/v1/errors";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  emptyTeachingState,
  mergeTeachingStates,
  normalizeTeachingState,
  type TeachingState,
} from "@/lib/teaching";
import { emptyTimetableState, type TimetableState } from "@/lib/timetable";

/** The stored teaching plan (`teaching_state`). Throws 503 when unreadable. */
export async function readTeachingStateServer(): Promise<TeachingState> {
  let why = "";
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) {
      why = "tenant not resolved";
    } else {
      const { data, error } = await ctx.sb
        .from("teaching_state")
        .select("state")
        .eq("tenant_id", ctx.tenantId)
        .maybeSingle();
      if (error) {
        why = `teaching_state: ${error.message}`;
      } else if (!data) {
        // Read fine, no row: the school has not set up a teaching plan.
        return emptyTeachingState();
      } else if (!data.state || typeof data.state !== "object") {
        why = "teaching_state row holds no plan";
      } else {
        return normalizeTeachingState(data.state);
      }
    }
  } catch (e) {
    why = e instanceof Error ? e.message : String(e);
  }
  console.error(`[teaching-v1] teaching plan read failed (${why}) — 503`);
  throw new ApiError("server_error", "Could not read the teaching plan — please try again.", 503);
}

/**
 * The timetable from its desk slices (`timetable_desk_slices` — the store
 * every timetable save writes; the old `timetable_state` blob stopped in
 * Aug 2026). Throws 503 when unreadable; no slices at all is an empty
 * timetable, which resolveExpectedPeriods reports as "no published
 * timetable".
 */
export async function readTimetableStateServer(): Promise<TimetableState> {
  const [{ fetchTimetableDeskFromDb }, { mergeDbDeskIntoTimetableState }] = await Promise.all([
    import("@/lib/timetableNormalized.server"),
    import("@/lib/timetableNormalizedMerge"),
  ]);
  let ok = false;
  let state: TimetableState = emptyTimetableState();
  try {
    const desk = await fetchTimetableDeskFromDb();
    ok = desk.ok;
    if (ok) state = mergeDbDeskIntoTimetableState(emptyTimetableState(), desk.bundle, { preferDb: true });
  } catch (e) {
    console.error("[teaching-v1] timetable read threw", e);
  }
  if (!ok) {
    console.error("[teaching-v1] timetable read failed — 503");
    throw new ApiError("server_error", "Could not read the timetable — please try again.", 503);
  }
  return state;
}

/**
 * Save a teaching plan a route has changed. Merges into the plan as stored
 * NOW (every teacher writes this module at once — see mergeTeachingStates),
 * so a period logged meanwhile by someone else survives.
 *
 * Unlike pushTeachingRemoteServer (teachingPersistence), a failed re-read
 * refuses the save instead of writing this route's copy unmerged.
 *
 * `dropLessonPlanIds`: the merge is a union with no tombstones, so a removed
 * plan would come straight back from the stored copy; it is filtered out
 * after the merge.
 */
export async function saveTeachingStateServer(
  state: TeachingState,
  opts?: { dropLessonPlanIds?: string[] },
): Promise<{ ok: true; state: TeachingState } | { ok: false; error: string }> {
  let stored: TeachingState;
  try {
    stored = await readTeachingStateServer();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const { pushServerBlob } = await import("@/lib/serverBlob");
  let next = mergeTeachingStates(stored, state);
  const drop = new Set(opts?.dropLessonPlanIds ?? []);
  if (drop.size > 0) {
    next = {
      ...next,
      lessonPlans: next.lessonPlans.filter((p) => !drop.has(p.id)),
      logs: next.logs.map((l) => (drop.has(l.lessonPlanId) ? { ...l, lessonPlanId: "" } : l)),
    };
  }
  const push = await pushServerBlob("teaching_state", next);
  return push.ok ? { ok: true, state: next } : { ok: false, error: push.error || "push failed" };
}
