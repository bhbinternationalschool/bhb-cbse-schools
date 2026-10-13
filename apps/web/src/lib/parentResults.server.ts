import "server-only";

import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { loadAttendance, rosterForSection } from "@/lib/attendance";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { normalizeAttendanceResultOverrides } from "@/lib/attendanceResultOverrides";
import { fetchDefaulterPolicy, fetchLiveHoldDecisions } from "@/lib/defaulterHold.server";
import { gateFor } from "@/lib/defaulterHoldPolicy";
import { isReleasedToParents, releaseSwitchFor } from "@/lib/examParentRelease";
import { readExamParentRelease } from "@/lib/examParentRelease.server";
import {
  buildClassResultSheet,
  buildReportCard,
  loadExams,
  reportTemplateForClassId,
  schemeForClassId,
  getExamPolicy,
  type ExamDeps,
  type ExamTerm,
  type ExamsState,
  type ReportCard,
} from "@/lib/exams";
import { ensureExamsHydratedServer } from "@/lib/examsPersistence";
import { loadFees } from "@/lib/fees";
import { studentHoldContext, type HoldCheck } from "@/lib/holds";
import { indexStandingDecisions, resolveHold, standingKey } from "@/lib/holdResolve";
import type { MastersState } from "@/lib/masters";
import { readModuleLocalState } from "@/lib/moduleLocalState.server";
import { classLabelForStudent, householdForSession } from "@/lib/parentPortal";
import {
  toParentPrintableCard,
  toParentReportCardView,
  type ParentChildDateSheet,
  type ParentChildResults,
  type ParentDateSheetExam,
  type ParentTermResult,
} from "@/lib/parentResults";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { childrenOfHousehold, loadSis, type SisState, type SisStudent } from "@/lib/sis";

const NO_MARKS = "Marks for this exam are not ready yet. Please check again later.";
const HELD =
  "This report card is being held by the school office. Please contact the office.";
const UNKNOWN_HOLD =
  "Could not check this report card right now. Please try again in a few minutes.";

function ayKey(code: string): string {
  const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  return full ? `${full[1]}-${full[2]!.slice(2)}` : t;
}

function childKey(s: SisStudent): string {
  const name = (s.fullName || "").trim().toUpperCase();
  const adm = (s.admissionNo || "").trim().toUpperCase();
  return adm ? `${adm}::${name}` : name;
}

/**
 * This child's SIS row for an academic year — the class and section they
 * sat that year's exams in. Same keying as childrenOfHousehold.
 */
function rowForAy(sis: SisState, child: SisStudent, ay: string): SisStudent | null {
  const key = childKey(child);
  const want = ayKey(ay);
  return (
    sis.students.find(
      (s) =>
        s.householdId === child.householdId &&
        childKey(s) === key &&
        ayKey(s.academicYearCode || "") === want,
    ) ?? null
  );
}

/** The session household's children, one row each — never another family's. */
export function sessionChildren(sis: SisState, householdId: string, ay: string): SisStudent[] {
  const hh = householdForSession(sis, householdId);
  if (!hh) throw new ApiError("not_found", "Household not found", 404);
  const kids = childrenOfHousehold(sis, hh.id, ay);
  return kids.length > 0 || !ay ? kids : childrenOfHousehold(sis, hh.id);
}

const ALLOWED: HoldCheck = { allowed: true, stage: "S0", overdueDays: 0, overdueAmountPaise: 0 };

/**
 * HOLD_REPORT_CARD, decided on the server from server truth: the defaulter
 * policy, the standing decisions and the child's dues. The office's
 * browser-only Principal PIN override is not visible here, so a child the
 * principal let through by PIN is still held in the app — the safe side.
 * Returns null when any input could not be read (unknown, never "allowed").
 */
async function reportCardHoldChecker(
  sis: SisState,
  masters: MastersState,
): Promise<((studentId: string) => boolean) | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const [policy, decisions] = await Promise.all([
    fetchDefaulterPolicy(ctx.sb, ctx.tenantId),
    fetchLiveHoldDecisions(ctx.sb, ctx.tenantId, "HOLD_REPORT_CARD"),
  ]);
  if (!policy.ok || !decisions.ok) return null;
  const gate = gateFor(policy.policy, "HOLD_REPORT_CARD");
  const standing = indexStandingDecisions(decisions.decisions);
  const fees = loadFees();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return (studentId: string) => {
    const hold = studentHoldContext(studentId, today, { sis, masters, fees });
    if (!hold) return true;
    const verdict = resolveHold({
      holdCode: "HOLD_REPORT_CARD",
      label: "Report card",
      gate,
      facts: {
        studentId,
        stage: hold.stage,
        overdueDays: hold.overdueDays,
        overdueAmountPaise: hold.overdueAmountPaise,
      },
      standing: standing.get(standingKey(studentId, "HOLD_REPORT_CARD")) ?? null,
      decisionsKnown: true,
      pinOverrideUntil: null,
    });
    return !verdict.allowed;
  };
}

/** Same choice as the exams desk's openReport: the class sheet when the card prints rank / average / result. */
function cardFor(
  student: SisStudent,
  term: ExamTerm,
  sis: SisState,
  masters: MastersState,
  deps: ExamDeps,
): ReportCard | null {
  const policy = getExamPolicy(deps.state);
  const scheme = schemeForClassId(student.classId, policy);
  const template = reportTemplateForClassId(student.classId, policy);
  const classLabel = classLabelForStudent(student, masters);
  const ay = term.academicYearCode;
  const needsSection =
    (template.showRank ?? scheme.showRank) ||
    (template.showClassAverage ?? scheme.showClassAverage) ||
    (template.showResult ?? scheme.showResultOnCard);
  if (needsSection) {
    const roster = rosterForSection(sis.students, student.sectionId, {
      classId: student.classId,
      academicYearCode: ay,
    });
    const holdChecks = new Map(roster.map((s) => [s.id, ALLOWED] as const));
    const sheet = buildClassResultSheet({
      students: roster,
      classLabel,
      classId: student.classId,
      sectionId: student.sectionId,
      examTermId: term.id,
      academicYearCode: ay,
      deps: { ...deps, holdChecks },
    });
    if ("error" in sheet) return null;
    return sheet.rows.find((r) => r.student.id === student.id)?.card ?? null;
  }
  const card = buildReportCard({
    student,
    classLabel,
    examTermId: term.id,
    academicYearCode: ay,
    deps: { ...deps, holdChecks: new Map([[student.id, ALLOWED]]) },
  });
  return "error" in card ? null : card;
}

/**
 * Every child of the session's household, each with the exam terms the
 * school RELEASED to parents for that child's year. Unreleased terms are not
 * listed at all.
 */
export async function buildParentResults(
  ctx: ApiAuthContext,
  householdId: string,
): Promise<{ releasedTermCount: number; children: ParentChildResults[] }> {
  const release = await readExamParentRelease();
  if (!release) {
    throw new ApiError("server_error", "Could not check which results the school has published. Please try again.", 503);
  }

  await ensureSchoolMirrorHydrated();
  await Promise.all([ensureExamsHydratedServer(), ensureAttendanceHydratedServer()]);

  const sis = loadSis();
  const masters = ctx.masters;
  const kids = sessionChildren(sis, householdId, ctx.session.academicYearCode || "");
  const state: ExamsState = loadExams();
  const released = state.terms
    .filter((t) => isReleasedToParents(release.state, t.id, "results"))
    .sort((a, b) => a.academicYearCode.localeCompare(b.academicYearCode) || a.sortOrder - b.sortOrder);

  if (released.length === 0 || kids.length === 0) {
    return {
      releasedTermCount: released.length,
      children: kids.map((k) => ({
        studentId: k.id,
        fullName: k.fullName,
        classLabel: classLabelForStudent(k, masters),
        terms: [],
      })),
    };
  }

  // Corrections made to a result's attendance. Unreadable → no attendance
  // figure on the card at all, rather than a computed one the school's own
  // printed card would contradict.
  const overridesRow = await readModuleLocalState<unknown>("attendance_result_overrides");
  const attendanceKnown = overridesRow !== null;
  const deps: ExamDeps = {
    state,
    masters,
    sis,
    attendance: loadAttendance(),
    attendanceOverrides: normalizeAttendanceResultOverrides(overridesRow?.state ?? null),
  };
  const isHeld = await reportCardHoldChecker(sis, masters);

  const children: ParentChildResults[] = kids.map((kid) => {
    const terms: ParentTermResult[] = [];
    for (const term of released) {
      const row = rowForAy(sis, kid, term.academicYearCode);
      if (!row) continue; // not at this school that year
      const base = {
        termId: term.id,
        termCode: term.code,
        termLabel: term.label,
        academicYearCode: term.academicYearCode,
        releasedAt: releaseSwitchFor(release.state, term.id, "results")?.at ?? "",
      };
      if (!isHeld) {
        terms.push({ ...base, status: "unavailable", message: UNKNOWN_HOLD, card: null, printable: null });
        continue;
      }
      if (isHeld(row.id)) {
        terms.push({ ...base, status: "held", message: HELD, card: null, printable: null });
        continue;
      }
      let card = cardFor(row, term, sis, masters, deps);
      if (!card) {
        terms.push({ ...base, status: "no_marks", message: NO_MARKS, card: null, printable: null });
        continue;
      }
      if (!attendanceKnown) card = { ...card, attendance: null };
      terms.push({
        ...base,
        status: "ready",
        message: "",
        card: toParentReportCardView(card),
        printable: toParentPrintableCard(card),
      });
    }
    return {
      studentId: kid.id,
      fullName: kid.fullName,
      classLabel: classLabelForStudent(kid, masters),
      terms,
    };
  });

  return { releasedTermCount: released.length, children };
}



/**
 * Upcoming papers (today onwards, IST) of each child's class, from the date
 * sheets the school PUBLISHED to parents. A published exam whose papers are
 * all past is left out; an unpublished one is never listed.
 */
export async function buildParentDateSheet(
  ctx: ApiAuthContext,
  householdId: string,
): Promise<{ publishedTermCount: number; today: string; children: ParentChildDateSheet[] }> {
  const release = await readExamParentRelease();
  if (!release) {
    throw new ApiError("server_error", "Could not check which date sheets the school has published. Please try again.", 503);
  }
  await ensureSchoolMirrorHydrated();
  await ensureExamsHydratedServer();

  const sis = loadSis();
  const masters = ctx.masters;
  const kids = sessionChildren(sis, householdId, ctx.session.academicYearCode || "");
  const state = loadExams();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const published = state.terms
    .filter((t) => isReleasedToParents(release.state, t.id, "dateSheet"))
    .sort((a, b) => a.academicYearCode.localeCompare(b.academicYearCode) || a.sortOrder - b.sortOrder);

  const subjectName = (id: string) =>
    state.subjects.find((s) => s.id === id)?.name ||
    masters.subjects.find((s) => s.id === id)?.nameEn ||
    "";

  const children: ParentChildDateSheet[] = kids.map((kid) => {
    const exams: ParentDateSheetExam[] = [];
    for (const term of published) {
      const row = rowForAy(sis, kid, term.academicYearCode);
      if (!row) continue;
      const rows = (state.dateSheet ?? [])
        .filter(
          (r) =>
            r.examTermId === term.id &&
            r.academicYearCode === term.academicYearCode &&
            r.classId === row.classId &&
            r.date >= today,
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
        .map((r) => ({
          date: r.date,
          startTime: r.startTime,
          durationMinutes: r.durationMinutes,
          // A paper whose subject cannot be named says so — never a guess.
          subjectName: subjectName(r.subjectId) || "Subject not named",
          note: r.note,
        }));
      if (rows.length === 0) continue;
      exams.push({
        termId: term.id,
        termLabel: term.label,
        publishedAt: releaseSwitchFor(release.state, term.id, "dateSheet")?.at ?? "",
        rows,
      });
    }
    return {
      studentId: kid.id,
      fullName: kid.fullName,
      classLabel: classLabelForStudent(kid, masters),
      exams,
    };
  });

  return { publishedTermCount: published.length, today, children };
}
