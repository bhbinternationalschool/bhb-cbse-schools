import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureTimetableHydratedServer } from "@/lib/timetablePersistence";
import { ensureTeachingHydratedServer } from "@/lib/teachingPersistence";
import { loadTimetable } from "@/lib/timetable";
import {
  computeDelivery,
  istDateOf,
  loadTeaching,
  resolveExpectedPeriods,
  resourcesForUnits,
} from "@/lib/teaching";

export const runtime = "nodejs";

/**
 * GET /api/v1/teaching/today?date=YYYY-MM-DD — the signed-in teacher's
 * periods for a date, each with its current log status.
 *
 * When the schedule cannot be resolved the response says so explicitly
 * (`scheduleAvailable: false` plus a reason) rather than returning an
 * empty period list, which the app would otherwise render as "you have
 * no classes today".
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "teaching", "view");

    const url = new URL(request.url);
    const staffId =
      ctx.session.staffId || url.searchParams.get("staffId")?.trim() || "";
    if (!staffId) {
      throw new ApiError(
        "bad_request",
        "No staff record on this session — cannot resolve a teaching day",
        400,
      );
    }

    const date = url.searchParams.get("date")?.trim() || istDateOf();

    await ensureSchoolMirrorHydrated();
    await Promise.all([
      ensureTimetableHydratedServer(),
      ensureTeachingHydratedServer(),
    ]);

    const ay = ctx.session.academicYearCode;
    const expected = resolveExpectedPeriods({
      timetable: loadTimetable(),
      masters: ctx.masters,
      academicYearCode: ay,
      date,
      staffId,
    });

    if (!expected.ok) {
      return apiOk({
        date,
        academicYearCode: ay,
        scheduleAvailable: false,
        reason: expected.reason,
        detail: expected.detail,
        periods: [],
      });
    }

    const teaching = loadTeaching();
    const rows = computeDelivery({
      expected: expected.periods,
      logs: teaching.logs,
      academicYearCode: ay,
      policy: teaching.policy,
    });

    const classNameOf = (id: string) =>
      ctx.masters.classes.find((c) => c.id === id)?.name || "";
    const sectionNameOf = (id: string) =>
      ctx.masters.sections.find((s) => s.id === id)?.name || "";
    const subjectNameOf = (id: string) =>
      ctx.masters.subjects.find((s) => s.id === id)?.nameEn || "";

    /** Chapter → topic tree for one class + subject, with content links. */
    const chaptersFor = (classId: string, subjectId: string) => {
      const mine = teaching.units.filter(
        (u) =>
          u.isActive &&
          u.academicYearCode === ay &&
          u.classId === classId &&
          u.subjectId === subjectId,
      );
      return mine
        .filter((u) => u.level === "chapter")
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({
          id: c.id,
          code: c.code,
          title: c.title,
          resources: c.resources,
          topics: mine
            .filter((t) => t.parentId === c.id)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((t) => ({
              id: t.id,
              code: t.code,
              title: t.title,
              resources: t.resources,
            })),
        }));
    };

    return apiOk({
      date,
      academicYearCode: ay,
      scheduleAvailable: true,
      requireTopic: teaching.policy.requireTopicOnDelivery,
      periods: rows.map((r) => ({
        periodNo: r.expected.periodNo,
        label: r.expected.bellLabel,
        startTime: r.expected.startTime,
        endTime: r.expected.endTime,
        classId: r.expected.classId,
        sectionId: r.expected.sectionId,
        subjectId: r.expected.subjectId,
        className: classNameOf(r.expected.classId),
        sectionName: sectionNameOf(r.expected.sectionId),
        subjectName: subjectNameOf(r.expected.subjectId),
        isSubstituted: r.expected.isSubstituted,
        status: r.status,
        startedAt: r.log?.startedAt || "",
        locationCheck: r.log?.location.check ?? "unknown",
        unitIds: r.log?.unitIds ?? [],
        lessonPlanId: r.log?.lessonPlanId ?? "",
        note: r.log?.note ?? "",
        // The chapters (with their topics) this period can be tagged
        // against, sent as a tree so the app can group the picker the
        // same way the syllabus desk shows it.
        chapters: chaptersFor(r.expected.classId, r.expected.subjectId),
        // Lesson plans written for this class + subject.
        lessonPlans: teaching.lessonPlans
          .filter(
            (p) =>
              p.academicYearCode === ay &&
              p.classId === r.expected.classId &&
              p.subjectId === r.expected.subjectId &&
              (!p.sectionId || p.sectionId === r.expected.sectionId),
          )
          .sort((a, b) =>
            (b.plannedDate || "").localeCompare(a.plannedDate || ""),
          )
          .map((p) => ({
            id: p.id,
            title: p.title,
            plannedDate: p.plannedDate,
            objectives: p.objectives,
            teachingAids: p.teachingAids,
            activities: p.activities,
            assessment: p.assessment,
            homework: p.homework,
            unitIds: p.unitIds,
            resources: p.resources,
          })),
        // Everything already tagged on this period, flattened for the
        // "open the book" button: topic links plus their chapter's plus
        // the lesson plan's.
        resources: resourcesForUnits(
          teaching,
          r.log?.unitIds ?? [],
          r.log?.lessonPlanId ?? "",
        ),
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
