/**
 * Teaching delivery & syllabus pacing.
 *
 * Answers "was this period actually taught, and how far through the
 * syllabus are we" from data the school owns, independent of any vendor
 * classroom portal. The published timetable is the denominator; teacher
 * period logs (web or mobile) are the numerator.
 *
 * Demo store: localStorage `bhb_teaching_v1`.
 *
 * Deliberate design rule (see the recurring "unknown must not become
 * fact" defect class): a period with no log is NEVER represented as
 * "not delivered". It is `pending` (not yet due / inside grace) or
 * `unlogged` (past grace, needs follow-up). Only a teacher or admin
 * explicitly saying so produces `not_delivered`. Likewise, when the
 * timetable for a day cannot be resolved, expected-period resolution
 * refuses with a reason instead of returning an empty list — an empty
 * list would read as "no classes scheduled" and silently score the day
 * as fully covered.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { classifyClassHolidayDay } from "@/lib/holidayPolicy";
import { isoDateWeekday } from "@/lib/examTimetable";
import type { MastersState } from "@/lib/masters";
import {
  teachingPeriods,
  type BellPeriod,
  type TimetableGrid,
  type TimetableState,
} from "@/lib/timetable";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Kind of teaching material a link points at. `ebook` is the common case
 * here — the school's subject books already live on a vendor platform,
 * so the ERP stores a reference, never a copy of the file.
 */
export type ResourceKind = "ebook" | "pdf" | "video" | "link";

/**
 * A pointer to teaching content. Deliberately a URL and not an upload:
 * the school's books are licensed and hosted elsewhere, and copying them
 * into the ERP would be both a storage problem and a licensing one.
 */
export type ResourceLink = {
  id: string;
  kind: ResourceKind;
  title: string;
  /** Always http(s) — see `safeResourceUrl` */
  url: string;
  /** Where in the book this points, e.g. "p. 42" or "Ch 3"; "" if n/a */
  locator: string;
  addedBy: string;
  addedAt: string;
};

/** Chapter, or a topic inside one. */
export type SyllabusLevel = "chapter" | "topic";

/**
 * One node of the year plan for a class + subject.
 *
 * Two levels only: chapters (`parentId: null`) and the topics inside
 * them. Rows written before the hierarchy existed normalize to chapters,
 * so an existing flat plan keeps working untouched.
 */
export type SyllabusUnit = {
  id: string;
  academicYearCode: string;
  classId: string;
  subjectId: string;
  level: SyllabusLevel;
  /** Owning chapter for a topic; null for a chapter */
  parentId: string | null;
  /** Display + teaching order within its own level */
  sortOrder: number;
  /** School's own label — "Ch 1", "Unit 2.3", "" if unnumbered */
  code: string;
  title: string;
  /** Periods the plan allots to this unit; 0 = not estimated */
  plannedPeriods: number;
  /** Target window, YYYY-MM-DD; "" = no target set (pacing unavailable) */
  targetStartDate: string;
  targetEndDate: string;
  /** What the learner should be able to do; free text, one per line */
  learningOutcomes: string;
  /**
   * CBSE / NCERT learning-outcome codes for this unit as printed in the
   * board's LO document (e.g. "M601", "S704"). Entered by the teacher from
   * the published document — never generated. Used to tag exam questions.
   */
  competencyCodes: string[];
  /** E-book / video / worksheet links for this chapter or topic */
  resources: ResourceLink[];
  isActive: boolean;
  updatedAt: string;
};

/**
 * A teacher's plan for delivering one lesson.
 *
 * Distinct from SyllabusUnit: the unit is *what* the school committed to
 * cover, the lesson plan is *how* one teacher intends to teach it. A
 * chapter can have several lesson plans; a lesson plan can span several
 * topics.
 */
/** Who wrote the plan's text: typed, accepted AI draft, or AI draft then edited. */
export type LessonPlanSource = "manual" | "ai" | "ai_edited";

export function normalizeLessonPlanSource(v: unknown): LessonPlanSource {
  return v === "ai" || v === "ai_edited" ? v : "manual";
}

export type LessonPlan = {
  id: string;
  academicYearCode: string;
  classId: string;
  subjectId: string;
  /** Optional — a plan for a whole class, not a named section */
  sectionId: string;
  /** Chapters/topics this lesson covers */
  unitIds: string[];
  title: string;
  /** Intended teaching date, YYYY-MM-DD; "" = unscheduled */
  plannedDate: string;
  /** Periods this lesson is expected to take */
  plannedPeriods: number;
  objectives: string;
  /** Board work, models, lab kit, smart-board content… */
  teachingAids: string;
  /** Sequence of classroom activities */
  activities: string;
  /** How understanding is checked in the period */
  assessment: string;
  homework: string;
  resources: ResourceLink[];
  /** Provenance of the text fields; plans saved before this existed are "manual" */
  source: LessonPlanSource;
  /** Model that produced the draft when source is ai / ai_edited; "" otherwise */
  aiModel: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * What a human asserted about a period. There is no "unknown" member on
 * purpose — absence of a log is absence of a log, and is modelled by
 * PeriodDeliveryStatus instead.
 */
export type TeachingLogStatus = "delivered" | "not_delivered" | "substituted";

export type TeachingLogSource =
  | "teacher_log"
  | "nucleus_import"
  | "admin_override";

/**
 * Where the teacher was standing when they filed the log, judged against
 * the campus geofence.
 *
 * `unknown` is the honest default and by far the most common value: a
 * phone with GPS off, a log filed from a desk browser, and an import all
 * produce it. Only `off_campus` is evidence of anything, and even then
 * it is a flag for a human to ask about — never grounds to reject the
 * log, because teachers do teach and phones do lose their fix.
 */
export type TeachingLogLocationCheck = "on_campus" | "off_campus" | "unknown";

/**
 * Deliberately stores the *verdict and distance*, not the coordinates.
 * This blob is replicated to every staff browser (localStorage-first), so
 * keeping raw lat/lng would scatter a map of where each teacher was at
 * 3pm — including their home — across every desk in the school. The
 * distance is all the coverage report needs.
 */
export type TeachingLogLocation = {
  check: TeachingLogLocationCheck;
  /** Metres from campus centre; null when there was no fix to measure */
  distanceM: number | null;
  /** Reported GPS accuracy in metres; null when not supplied */
  accuracyM: number | null;
  /** When the fix was taken; "" when there was none */
  checkedAt: string;
};

export function unknownTeachingLogLocation(): TeachingLogLocation {
  return { check: "unknown", distanceM: null, accuracyM: null, checkedAt: "" };
}

/** One teacher's record of one period of one section on one date. */
export type TeachingLog = {
  id: string;
  academicYearCode: string;
  /** YYYY-MM-DD */
  date: string;
  periodNo: number;
  classId: string;
  sectionId: string;
  subjectId: string;
  /** Staff who actually took the period */
  staffId: string;
  /** Roster teacher, when the period was substituted; "" otherwise */
  scheduledStaffId: string;
  status: TeachingLogStatus;
  /** ISO timestamps; "" when the teacher logged after the fact */
  startedAt: string;
  endedAt: string;
  /** SyllabusUnit ids covered in this period (chapters and/or topics) */
  unitIds: string[];
  /** LessonPlan actually delivered, when the teacher picked one; "" otherwise */
  lessonPlanId: string;
  note: string;
  source: TeachingLogSource;
  /** Provenance for imported rows (vendor row id / batch ref) */
  sourceRef: string;
  /** Campus-presence check taken when the log was filed */
  location: TeachingLogLocation;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TeachingPolicy = {
  /** Minutes after period start before an unlogged period is flagged */
  unattendedGraceMinutes: number;
  /** How many days back a teacher may still log a period */
  backdateDays: number;
  /**
   * Require at least one syllabus unit when logging a period as taught —
   * whether the roster teacher took it or a substitute did.
   */
  requireTopicOnDelivery: boolean;
  /** Minutes after period start that still counts as an on-time start */
  onTimeToleranceMinutes: number;
};

export type TeachingState = {
  version: 1;
  units: SyllabusUnit[];
  lessonPlans: LessonPlan[];
  logs: TeachingLog[];
  policy: TeachingPolicy;
};

const STORAGE_KEY = "bhb_teaching_v1";

/**
 * Defaults are the school's actual policy today — there is no policy
 * editor yet, so a value set here is the value that runs.
 *
 * `backdateDays: 1` is deliberate. A week-long window lets a teacher fill
 * in five days on Saturday, which makes every start time in the coverage
 * report a fiction; one day covers the genuine "my phone died in period
 * 7" case and nothing more. Older periods are still loggable, but only
 * through an `admin_override`, which is exactly the conversation that
 * should happen.
 */
export const DEFAULT_TEACHING_POLICY: TeachingPolicy = {
  unattendedGraceMinutes: 15,
  backdateDays: 1,
  requireTopicOnDelivery: true,
  onTimeToleranceMinutes: 5,
};

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/* ------------------------------------------------------------------ */
/* Normalization + storage                                             */
/* ------------------------------------------------------------------ */

export function emptyTeachingState(): TeachingState {
  return {
    version: 1,
    units: [],
    lessonPlans: [],
    logs: [],
    policy: { ...DEFAULT_TEACHING_POLICY },
  };
}

/**
 * Accept a pasted resource URL, or refuse it.
 *
 * These links are typed in by staff and later rendered as clickable
 * anchors and opened on teachers' phones, so the scheme allowlist is a
 * security boundary, not tidiness: `javascript:` and `data:` URLs in an
 * href execute in the app's origin. Anything not plainly http(s) is
 * rejected rather than "cleaned up" into something that might still run.
 */
export function safeResourceUrl(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  // A bare "books.example.com/x" is a common paste; assume https rather
  // than letting the URL parser guess a scheme.
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  return parsed.toString();
}

function normalizeResourceKind(v: unknown): ResourceKind {
  return v === "pdf" || v === "video" || v === "link" ? v : "ebook";
}

export function normalizeResourceLink(
  raw: Partial<ResourceLink>,
): ResourceLink | null {
  const url = safeResourceUrl(String(raw.url || ""));
  // A resource with no usable URL is not a resource — dropping it beats
  // storing a dead row that renders as a broken link on a teacher's phone.
  if (!url) return null;
  return {
    id: raw.id || nid("res"),
    kind: normalizeResourceKind(raw.kind),
    title: String(raw.title || "").trim() || "Untitled resource",
    url,
    locator: String(raw.locator || "").trim(),
    addedBy: String(raw.addedBy || ""),
    addedAt: raw.addedAt || nowIso(),
  };
}

function normalizeResourceList(raw: unknown): ResourceLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => normalizeResourceLink(r as Partial<ResourceLink>))
    .filter((r): r is ResourceLink => !!r);
}

export function normalizeTeachingPolicy(
  p?: Partial<TeachingPolicy> | null,
): TeachingPolicy {
  const grace = Number(p?.unattendedGraceMinutes);
  const backdate = Number(p?.backdateDays);
  const tolerance = Number(p?.onTimeToleranceMinutes);
  return {
    unattendedGraceMinutes: Number.isFinite(grace)
      ? Math.max(0, Math.min(240, grace))
      : DEFAULT_TEACHING_POLICY.unattendedGraceMinutes,
    backdateDays: Number.isFinite(backdate)
      ? Math.max(0, Math.min(90, backdate))
      : DEFAULT_TEACHING_POLICY.backdateDays,
    requireTopicOnDelivery: Boolean(p?.requireTopicOnDelivery),
    onTimeToleranceMinutes: Number.isFinite(tolerance)
      ? Math.max(0, Math.min(60, tolerance))
      : DEFAULT_TEACHING_POLICY.onTimeToleranceMinutes,
  };
}

export function normalizeSyllabusUnit(
  raw: Partial<SyllabusUnit>,
  idx = 0,
): SyllabusUnit | null {
  const academicYearCode = String(raw.academicYearCode || "");
  const classId = String(raw.classId || "");
  const subjectId = String(raw.subjectId || "");
  // A unit that cannot be placed against a class+subject+year is not a
  // unit — dropping it beats storing a row that matches every query.
  if (!academicYearCode || !classId || !subjectId) return null;
  const planned = Number(raw.plannedPeriods);
  const sort = Number(raw.sortOrder);
  // Rows written before the hierarchy existed carry neither field; they
  // are chapters, which is what a flat plan always meant.
  const parentId = raw.parentId ? String(raw.parentId) : null;
  // A topic is defined by having a parent. A row claiming level "topic"
  // with no parent would be invisible to every tree walk, so it becomes
  // a chapter instead of a row nothing renders.
  const level: SyllabusLevel =
    parentId && raw.level !== "chapter" ? "topic" : "chapter";
  return {
    id: raw.id || nid("syu"),
    academicYearCode,
    classId,
    subjectId,
    level,
    // A topic without a parent is a contradiction; demote it to a chapter
    // rather than leaving an orphan that no tree walk would ever show.
    parentId: level === "topic" ? parentId : null,
    sortOrder: Number.isFinite(sort) ? sort : idx,
    code: String(raw.code || ""),
    title: String(raw.title || ""),
    plannedPeriods:
      Number.isFinite(planned) && planned > 0 ? Math.floor(planned) : 0,
    targetStartDate: isIsoDate(String(raw.targetStartDate || ""))
      ? String(raw.targetStartDate)
      : "",
    targetEndDate: isIsoDate(String(raw.targetEndDate || ""))
      ? String(raw.targetEndDate)
      : "",
    learningOutcomes: String(raw.learningOutcomes || ""),
    competencyCodes: Array.isArray(raw.competencyCodes)
      ? Array.from(
          new Set(
            raw.competencyCodes
              .map((c) => String(c ?? "").trim().toUpperCase().slice(0, 20))
              .filter(Boolean),
          ),
        )
      : [],
    resources: normalizeResourceList(raw.resources),
    isActive: raw.isActive !== false,
    updatedAt: raw.updatedAt || nowIso(),
  };
}

export function normalizeLessonPlan(
  raw: Partial<LessonPlan>,
): LessonPlan | null {
  const academicYearCode = String(raw.academicYearCode || "");
  const classId = String(raw.classId || "");
  const subjectId = String(raw.subjectId || "");
  if (!academicYearCode || !classId || !subjectId) return null;
  const planned = Number(raw.plannedPeriods);
  const plannedDate = String(raw.plannedDate || "");
  return {
    id: raw.id || nid("lpl"),
    academicYearCode,
    classId,
    subjectId,
    sectionId: String(raw.sectionId || ""),
    unitIds: Array.isArray(raw.unitIds)
      ? raw.unitIds.map(String).filter(Boolean)
      : [],
    title: String(raw.title || "").trim(),
    plannedDate: isIsoDate(plannedDate) ? plannedDate : "",
    plannedPeriods:
      Number.isFinite(planned) && planned > 0 ? Math.floor(planned) : 1,
    objectives: String(raw.objectives || ""),
    teachingAids: String(raw.teachingAids || ""),
    activities: String(raw.activities || ""),
    assessment: String(raw.assessment || ""),
    homework: String(raw.homework || ""),
    resources: normalizeResourceList(raw.resources),
    source: normalizeLessonPlanSource(raw.source),
    aiModel: String(raw.aiModel || ""),
    createdBy: String(raw.createdBy || ""),
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || raw.createdAt || nowIso(),
  };
}

function normalizeLogStatus(v: unknown): TeachingLogStatus {
  return v === "not_delivered" || v === "substituted" ? v : "delivered";
}

function normalizeLogSource(v: unknown): TeachingLogSource {
  return v === "nucleus_import" || v === "admin_override" ? v : "teacher_log";
}

function finiteOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Anything that is not an explicit on/off verdict normalizes to
 * `unknown`, and an unknown verdict carries no distance. A stray
 * `distanceM` on an unchecked log would render as "0 m from campus",
 * which reads as the strongest possible confirmation of presence.
 */
export function normalizeTeachingLogLocation(
  raw: unknown,
): TeachingLogLocation {
  const r = (raw ?? {}) as Partial<TeachingLogLocation>;
  const check: TeachingLogLocationCheck =
    r.check === "on_campus" || r.check === "off_campus" ? r.check : "unknown";
  if (check === "unknown") return unknownTeachingLogLocation();
  const distanceM = finiteOrNull(r.distanceM);
  return {
    check,
    distanceM: distanceM === null ? null : Math.max(0, Math.round(distanceM)),
    accuracyM: finiteOrNull(r.accuracyM),
    checkedAt: String(r.checkedAt || ""),
  };
}

export function normalizeTeachingLog(
  raw: Partial<TeachingLog>,
): TeachingLog | null {
  const date = String(raw.date || "").slice(0, 10);
  const periodNo = Number(raw.periodNo);
  const academicYearCode = String(raw.academicYearCode || "");
  // Same rule as units: a log that cannot be pinned to a real slot is
  // discarded rather than kept as a floating "something happened".
  if (!isIsoDate(date) || !Number.isFinite(periodNo) || !academicYearCode) {
    return null;
  }
  if (!raw.classId || !raw.sectionId) return null;
  return {
    id: raw.id || nid("tlg"),
    academicYearCode,
    date,
    periodNo: Math.floor(periodNo),
    classId: String(raw.classId),
    sectionId: String(raw.sectionId),
    subjectId: String(raw.subjectId || ""),
    staffId: String(raw.staffId || ""),
    scheduledStaffId: String(raw.scheduledStaffId || ""),
    status: normalizeLogStatus(raw.status),
    startedAt: String(raw.startedAt || ""),
    endedAt: String(raw.endedAt || ""),
    unitIds: Array.isArray(raw.unitIds)
      ? raw.unitIds.map(String).filter(Boolean)
      : [],
    lessonPlanId: String(raw.lessonPlanId || ""),
    note: String(raw.note || ""),
    source: normalizeLogSource(raw.source),
    sourceRef: String(raw.sourceRef || ""),
    location: normalizeTeachingLogLocation(raw.location),
    createdBy: String(raw.createdBy || ""),
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || raw.createdAt || nowIso(),
  };
}

export function normalizeTeachingState(rawInput: unknown): TeachingState {
  const raw = (rawInput ?? {}) as Partial<TeachingState>;
  const units = Array.isArray(raw.units)
    ? raw.units
        .map((u, i) => normalizeSyllabusUnit(u as Partial<SyllabusUnit>, i))
        .filter((u): u is SyllabusUnit => !!u)
    : [];
  const lessonPlans = Array.isArray(raw.lessonPlans)
    ? raw.lessonPlans
        .map((p) => normalizeLessonPlan(p as Partial<LessonPlan>))
        .filter((p): p is LessonPlan => !!p)
    : [];
  const logs = Array.isArray(raw.logs)
    ? raw.logs
        .map((l) => normalizeTeachingLog(l as Partial<TeachingLog>))
        .filter((l): l is TeachingLog => !!l)
    : [];
  return {
    version: 1,
    units,
    lessonPlans,
    logs: dedupeLogs(logs),
    policy: normalizeTeachingPolicy(raw.policy),
  };
}

/** Natural key for a log — one authoritative row per scheduled slot. */
export function teachingLogKey(l: {
  academicYearCode: string;
  date: string;
  periodNo: number;
  classId: string;
  sectionId: string;
}): string {
  return `${l.academicYearCode}|${l.date}|${l.periodNo}|${l.classId}|${l.sectionId}`;
}

/**
 * Collapse duplicate logs for the same slot. Ids are minted per browser,
 * so two clients can log the same period independently; the natural key
 * is what identifies the slot. A human's own log outranks an import, and
 * within the same rank the later `updatedAt` wins.
 */
export function dedupeLogs(logs: TeachingLog[]): TeachingLog[] {
  const rank: Record<TeachingLogSource, number> = {
    admin_override: 3,
    teacher_log: 2,
    nucleus_import: 1,
  };
  const byKey = new Map<string, TeachingLog>();
  for (const log of logs) {
    const key = teachingLogKey(log);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, log);
      continue;
    }
    const better =
      rank[log.source] > rank[prev.source] ||
      (rank[log.source] === rank[prev.source] && log.updatedAt >= prev.updatedAt);
    if (better) byKey.set(key, log);
  }
  return [...byKey.values()];
}

export function loadTeaching(): TeachingState {
  if (typeof window === "undefined") return emptyTeachingState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyTeachingState();
    return normalizeTeachingState(JSON.parse(raw));
  } catch {
    return emptyTeachingState();
  }
}

export function saveTeaching(state: TeachingState) {
  if (!assertModulePermission("teaching", "edit", "saveTeaching")) return;
  if (typeof window === "undefined") return;
  const next = normalizeTeachingState(state);
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn(
      "[teaching] localStorage quota exceeded — relying on server DB sync",
      e,
    );
  }
  void import("@/lib/teachingPersistence").then(({ scheduleTeachingSync }) => {
    scheduleTeachingSync(next);
  });
}

/** Hydrate path — write local without scheduling a cloud push. */
export function writeTeachingLocalRaw(state: TeachingState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizeTeachingState(state)),
    );
  } catch (e) {
    console.warn(
      "[teaching] localStorage quota exceeded — relying on server DB sync",
      e,
    );
  }
}

export function teachingStateIsEmpty(state: TeachingState): boolean {
  return (
    (state.units?.length ?? 0) === 0 &&
    (state.lessonPlans?.length ?? 0) === 0 &&
    (state.logs?.length ?? 0) === 0
  );
}

/**
 * Union two copies of the module state.
 *
 * Unlike fees or timetable — which one office desk owns — this module is
 * written concurrently by every teacher from their own phone or browser.
 * A last-writer-wins blob sync would silently drop the logs of whichever
 * teacher pushed first, so hydration must merge rather than replace.
 *
 * Logs merge by natural key under the same source/recency rule as
 * `dedupeLogs`. Units merge by id, newest `updatedAt` winning. Policy is
 * a school-level setting an admin owns, so the remote copy wins.
 *
 * Caveat, consistent with the rest of this codebase: there are no
 * tombstones, so a unit deleted on one client reappears if another
 * client still holds it. Deleting a unit is an admin action on the
 * syllabus desk, and needs to be done there to stick.
 */
export function mergeTeachingStates(
  local: TeachingState,
  remote: TeachingState,
): TeachingState {
  const units = new Map<string, SyllabusUnit>();
  for (const u of local.units) units.set(u.id, u);
  for (const u of remote.units) {
    const prev = units.get(u.id);
    if (!prev || u.updatedAt >= prev.updatedAt) units.set(u.id, u);
  }

  // Lesson plans are authored per teacher, so two teachers planning the
  // same subject on different devices must both survive the merge.
  const plans = new Map<string, LessonPlan>();
  for (const p of local.lessonPlans ?? []) plans.set(p.id, p);
  for (const p of remote.lessonPlans ?? []) {
    const prev = plans.get(p.id);
    if (!prev || p.updatedAt >= prev.updatedAt) plans.set(p.id, p);
  }

  return {
    version: 1,
    units: [...units.values()],
    lessonPlans: [...plans.values()],
    logs: dedupeLogs([...local.logs, ...remote.logs]),
    policy: normalizeTeachingPolicy(remote.policy ?? local.policy),
  };
}

/* ------------------------------------------------------------------ */
/* Expected periods — the denominator                                  */
/* ------------------------------------------------------------------ */

/** One scheduled teaching period on a specific date. */
export type ExpectedPeriod = {
  date: string;
  weekday: number;
  periodNo: number;
  bellLabel: string;
  startTime: string;
  endTime: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  /** Teacher on the published grid */
  scheduledStaffId: string;
  /** Who is expected to take it today — substitute when arranged */
  effectiveStaffId: string;
  /** True when a substitution moved this period off the roster teacher */
  isSubstituted: boolean;
  /** Substitution left deliberately unfilled (period free) */
  isUnfilled: boolean;
};

export type ExpectedPeriodsRefusal =
  | "no_published_timetable"
  | "non_working_weekday"
  | "holiday"
  | "invalid_date";

/**
 * Resolution result. The failure arm carries no `periods` property at
 * all, so a caller cannot accidentally treat "we could not work out the
 * schedule" as "there were no classes".
 */
export type ExpectedPeriodsResult =
  | { ok: true; date: string; periods: ExpectedPeriod[] }
  | { ok: false; reason: ExpectedPeriodsRefusal; detail: string };

function bellByPeriodNo(bell: BellPeriod[]): Map<number, BellPeriod> {
  const map = new Map<number, BellPeriod>();
  for (const p of teachingPeriods(bell)) map.set(p.no, p);
  return map;
}

/**
 * Every teaching period scheduled on `date`, after substitutions.
 *
 * Reads `publishedGrids`, not `grids` — a draft grid is a plan the school
 * has not committed to, and grading a teacher against an uncommitted
 * draft is exactly the kind of guess this module refuses to make.
 */
export function resolveExpectedPeriods(input: {
  timetable: TimetableState;
  masters: MastersState;
  academicYearCode: string;
  date: string;
  /** Limit to one teacher's periods (roster or substitute) */
  staffId?: string;
  /** Limit to one section */
  classId?: string;
  sectionId?: string;
}): ExpectedPeriodsResult {
  const { timetable, masters, academicYearCode, date } = input;

  const weekday = isoDateWeekday(date);
  if (weekday === null) {
    return { ok: false, reason: "invalid_date", detail: `Bad date "${date}"` };
  }

  const working = timetable.workingWeekdays ?? [];
  if (working.length > 0 && !working.includes(weekday)) {
    return {
      ok: false,
      reason: "non_working_weekday",
      detail: "Not a working day on the bell calendar",
    };
  }

  const published = (timetable.publishedGrids ?? []).filter(
    (g) => g.academicYearCode === academicYearCode,
  );
  if (published.length === 0) {
    return {
      ok: false,
      reason: "no_published_timetable",
      detail: `No published timetable for ${academicYearCode}`,
    };
  }

  const bell = bellByPeriodNo(timetable.bellTemplate ?? []);
  if (bell.size === 0) {
    return {
      ok: false,
      reason: "no_published_timetable",
      detail: "Bell template has no teaching periods",
    };
  }

  // Substitutions are keyed per date; index them before the grid walk.
  const subs = new Map<string, (typeof timetable.substitutions)[number]>();
  for (const s of timetable.substitutions ?? []) {
    if (s.academicYearCode !== academicYearCode || s.date !== date) continue;
    subs.set(`${s.periodNo}|${s.classId}|${s.sectionId}`, s);
  }

  const grids: TimetableGrid[] = published.filter((g) => {
    if (input.classId && g.classId !== input.classId) return false;
    if (input.sectionId && g.sectionId !== input.sectionId) return false;
    return true;
  });

  const out: ExpectedPeriod[] = [];
  let sawAnyClass = false;

  for (const grid of grids) {
    // Holidays can be scoped to one class group, so classify per class
    // rather than once for the day.
    const holiday = classifyClassHolidayDay(
      masters,
      date,
      academicYearCode,
      grid.classId,
    );
    if (holiday.status === "holiday") continue;
    sawAnyClass = true;

    for (const slot of grid.slots) {
      if (slot.weekday !== weekday) continue;
      const period = bell.get(slot.periodNo);
      if (!period) continue; // break/assembly or a stale period number
      if (!slot.subjectId) continue; // free period on the grid

      const sub = subs.get(`${slot.periodNo}|${grid.classId}|${grid.sectionId}`);
      const isSubstituted = Boolean(sub);
      const substituteId = sub?.substituteTeacherId ?? "";
      const effectiveStaffId = isSubstituted ? substituteId : slot.teacherId;

      if (input.staffId) {
        // A teacher's day includes periods handed to them as a
        // substitute, and excludes their own periods handed away.
        if (effectiveStaffId !== input.staffId) continue;
      }

      out.push({
        date,
        weekday,
        periodNo: slot.periodNo,
        bellLabel: period.label,
        startTime: period.startTime,
        endTime: period.endTime,
        classId: grid.classId,
        sectionId: grid.sectionId,
        subjectId: slot.subjectId,
        scheduledStaffId: slot.teacherId,
        effectiveStaffId,
        isSubstituted,
        isUnfilled: isSubstituted && !substituteId,
      });
    }
  }

  if (!sawAnyClass) {
    return {
      ok: false,
      reason: "holiday",
      detail: "Holiday for every class in scope",
    };
  }

  out.sort(
    (a, b) =>
      a.periodNo - b.periodNo ||
      a.classId.localeCompare(b.classId) ||
      a.sectionId.localeCompare(b.sectionId),
  );
  return { ok: true, date, periods: out };
}

/* ------------------------------------------------------------------ */
/* Delivery status — matching logs to expected periods                 */
/* ------------------------------------------------------------------ */

/**
 * `pending` and `unlogged` both mean "no log exists". They are separated
 * because only `unlogged` is actionable, and neither is evidence that
 * the class did not happen.
 */
export type PeriodDeliveryStatus =
  | "delivered"
  | "not_delivered"
  | "substituted"
  | "unlogged"
  | "pending";

export type PeriodDelivery = {
  expected: ExpectedPeriod;
  log: TeachingLog | null;
  status: PeriodDeliveryStatus;
  /** Minutes after scheduled start the teacher logged in; null if no log */
  minutesLate: number | null;
  /** null when there is no start stamp to judge */
  startedOnTime: boolean | null;
};

function minutesOfClock(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/** Minutes since local midnight for an ISO timestamp, in IST. */
function istMinutesOfDay(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(d);
  return minutesOfClock(parts);
}

/** IST calendar date (YYYY-MM-DD) for an instant. */
export function istDateOf(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(at);
  return parts;
}

export function indexLogsBySlot(logs: TeachingLog[]): Map<string, TeachingLog> {
  const map = new Map<string, TeachingLog>();
  for (const l of dedupeLogs(logs)) map.set(teachingLogKey(l), l);
  return map;
}

/**
 * Join expected periods to logs.
 *
 * `now` decides only whether an unlogged period is `pending` or
 * `unlogged`; it never converts either into `not_delivered`.
 */
export function computeDelivery(input: {
  expected: ExpectedPeriod[];
  logs: TeachingLog[];
  academicYearCode: string;
  policy?: TeachingPolicy;
  now?: Date;
}): PeriodDelivery[] {
  const policy = normalizeTeachingPolicy(input.policy);
  const now = input.now ?? new Date();
  const nowDate = istDateOf(now);
  const nowMinutes = istMinutesOfDay(now.toISOString()) ?? 0;
  const bySlot = indexLogsBySlot(input.logs);

  return input.expected.map((expected) => {
    const log =
      bySlot.get(
        teachingLogKey({
          academicYearCode: input.academicYearCode,
          date: expected.date,
          periodNo: expected.periodNo,
          classId: expected.classId,
          sectionId: expected.sectionId,
        }),
      ) ?? null;

    if (log) {
      const startMin = minutesOfClock(expected.startTime);
      const loggedMin = istMinutesOfDay(log.startedAt);
      const minutesLate =
        startMin !== null && loggedMin !== null ? loggedMin - startMin : null;
      return {
        expected,
        log,
        status: log.status as PeriodDeliveryStatus,
        minutesLate,
        startedOnTime:
          minutesLate === null
            ? null
            : minutesLate <= policy.onTimeToleranceMinutes,
      };
    }

    // No log. Decide pending vs unlogged purely on the clock.
    const startMin = minutesOfClock(expected.startTime);
    let due: boolean;
    if (expected.date < nowDate) {
      due = true;
    } else if (expected.date > nowDate) {
      due = false;
    } else {
      due =
        startMin === null
          ? false
          : nowMinutes >= startMin + policy.unattendedGraceMinutes;
    }

    return {
      expected,
      log: null,
      status: due ? "unlogged" : "pending",
      minutesLate: null,
      startedOnTime: null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

export type CoverageSummary = {
  expectedPeriods: number;
  delivered: number;
  notDelivered: number;
  substituted: number;
  unlogged: number;
  pending: number;
  onTimeStarts: number;
  lateStarts: number;
  /**
   * Logs that carried a usable GPS fix. The denominator for `offCampus`:
   * "2 off campus" means nothing until you know whether 3 logs were
   * checked or 300.
   */
  locationChecked: number;
  /** Logs filed from outside the campus geofence. A flag, not a verdict. */
  offCampus: number;
  /**
   * Share of *decided* periods that were taught, 0-100. `null` when no
   * period has been decided yet — a school with 40 unlogged periods and
   * nothing else must not be shown "100%".
   */
  deliveryPercent: number | null;
  /**
   * Share of due periods that carry any log at all, 0-100. This is the
   * trust number: a high deliveryPercent on a low logPercent means the
   * data is thin, not that teaching is going well.
   */
  logPercent: number | null;
};

export function emptyCoverageSummary(): CoverageSummary {
  return {
    expectedPeriods: 0,
    delivered: 0,
    notDelivered: 0,
    substituted: 0,
    unlogged: 0,
    pending: 0,
    onTimeStarts: 0,
    lateStarts: 0,
    locationChecked: 0,
    offCampus: 0,
    deliveryPercent: null,
    logPercent: null,
  };
}

export function summarizeCoverage(rows: PeriodDelivery[]): CoverageSummary {
  const s = emptyCoverageSummary();
  s.expectedPeriods = rows.length;
  for (const r of rows) {
    if (r.status === "delivered") s.delivered += 1;
    else if (r.status === "not_delivered") s.notDelivered += 1;
    else if (r.status === "substituted") s.substituted += 1;
    else if (r.status === "unlogged") s.unlogged += 1;
    else s.pending += 1;

    if (r.startedOnTime === true) s.onTimeStarts += 1;
    else if (r.startedOnTime === false) s.lateStarts += 1;

    const check = r.log?.location.check;
    if (check === "on_campus" || check === "off_campus") {
      s.locationChecked += 1;
      if (check === "off_campus") s.offCampus += 1;
    }
  }

  const decided = s.delivered + s.notDelivered + s.substituted;
  s.deliveryPercent =
    decided === 0
      ? null
      : Math.round(((s.delivered + s.substituted) / decided) * 1000) / 10;

  const due = decided + s.unlogged;
  s.logPercent =
    due === 0 ? null : Math.round((decided / due) * 1000) / 10;

  return s;
}

export type TeacherCoverageRow = {
  staffId: string;
  summary: CoverageSummary;
};

/** Group delivery rows by the teacher who was expected to take them. */
export function summarizeByTeacher(
  rows: PeriodDelivery[],
): TeacherCoverageRow[] {
  const byStaff = new Map<string, PeriodDelivery[]>();
  for (const r of rows) {
    const staffId = r.expected.effectiveStaffId || r.expected.scheduledStaffId;
    if (!staffId) continue; // unfilled substitution — nobody to attribute it to
    const list = byStaff.get(staffId);
    if (list) list.push(r);
    else byStaff.set(staffId, [r]);
  }
  return [...byStaff.entries()]
    .map(([staffId, list]) => ({ staffId, summary: summarizeCoverage(list) }))
    .sort((a, b) => a.staffId.localeCompare(b.staffId));
}

/* ------------------------------------------------------------------ */
/* Syllabus progress                                                   */
/* ------------------------------------------------------------------ */

export type UnitStatus = "not_started" | "in_progress" | "complete" | "unknown";

export type UnitProgress = {
  unit: SyllabusUnit;
  /**
   * Distinct periods logged as delivered/substituted naming this unit.
   * For a chapter this includes periods that named only one of its
   * topics — teaching a topic is teaching part of its chapter.
   */
  periodsTaught: number;
  /** First and last date this unit was taught; "" when never */
  firstTaughtOn: string;
  lastTaughtOn: string;
  /**
   * A topic, or a chapter with no topics, is scored on period count
   * against plan. A chapter *with* topics is scored on its topics: it is
   * complete only when every topic is. `unknown` means taught but with
   * no plannedPeriods to measure against — never "complete".
   */
  status: UnitStatus;
  /** Topics inside this chapter; empty for a topic */
  topics: UnitProgress[];
};

export type SyllabusProgress = {
  academicYearCode: string;
  classId: string;
  subjectId: string;
  /** Chapters, each carrying its topics */
  units: UnitProgress[];
  /** Chapter counts */
  totalUnits: number;
  completeUnits: number;
  /** Topic counts across every chapter */
  totalTopics: number;
  completeTopics: number;
  plannedPeriods: number;
  /** Distinct periods that named any unit in this plan */
  taughtPeriods: number;
  /**
   * Pace against the plan's target dates as of `asOf`.
   * `null` when no unit in this plan carries a target window.
   */
  pace: { status: "ahead" | "on_track" | "behind"; unitsBehind: number } | null;
};

export function computeSyllabusProgress(input: {
  state: TeachingState;
  academicYearCode: string;
  classId: string;
  subjectId: string;
  /** Restrict to one section's logs; omit to count the whole class */
  sectionId?: string;
  asOf?: string;
}): SyllabusProgress {
  const asOf = input.asOf || istDateOf();
  const units = input.state.units
    .filter(
      (u) =>
        u.isActive &&
        u.academicYearCode === input.academicYearCode &&
        u.classId === input.classId &&
        u.subjectId === input.subjectId,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const relevantLogs = input.state.logs.filter((l) => {
    if (l.academicYearCode !== input.academicYearCode) return false;
    if (l.classId !== input.classId) return false;
    if (l.subjectId !== input.subjectId) return false;
    if (input.sectionId && l.sectionId !== input.sectionId) return false;
    return l.status === "delivered" || l.status === "substituted";
  });

  const byUnit = new Map<string, TeachingLog[]>();
  for (const log of relevantLogs) {
    for (const unitId of log.unitIds) {
      const list = byUnit.get(unitId);
      if (list) list.push(log);
      else byUnit.set(unitId, [log]);
    }
  }

  /** Count a set of logs once each, even if several ids point at them. */
  function summarize(logs: TeachingLog[]) {
    const distinct = [...new Map(logs.map((l) => [l.id, l])).values()].sort(
      (a, b) => a.date.localeCompare(b.date),
    );
    return {
      periodsTaught: distinct.length,
      firstTaughtOn: distinct[0]?.date ?? "",
      lastTaughtOn: distinct[distinct.length - 1]?.date ?? "",
      logs: distinct,
    };
  }

  function statusByPeriods(unit: SyllabusUnit, taught: number): UnitStatus {
    if (unit.plannedPeriods <= 0) {
      return taught > 0 ? "unknown" : "not_started";
    }
    if (taught === 0) return "not_started";
    return taught >= unit.plannedPeriods ? "complete" : "in_progress";
  }

  const chapters = units.filter((u) => u.level === "chapter");
  const topicsByParent = new Map<string, SyllabusUnit[]>();
  for (const u of units) {
    if (u.level !== "topic" || !u.parentId) continue;
    const list = topicsByParent.get(u.parentId);
    if (list) list.push(u);
    else topicsByParent.set(u.parentId, [u]);
  }

  const rows: UnitProgress[] = chapters.map((chapter) => {
    const topicUnits = (topicsByParent.get(chapter.id) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );

    const topics: UnitProgress[] = topicUnits.map((topic) => {
      const s = summarize(byUnit.get(topic.id) ?? []);
      return {
        unit: topic,
        periodsTaught: s.periodsTaught,
        firstTaughtOn: s.firstTaughtOn,
        lastTaughtOn: s.lastTaughtOn,
        status: statusByPeriods(topic, s.periodsTaught),
        topics: [],
      };
    });

    // A period that named a topic also advanced its chapter.
    const chapterLogs = [
      ...(byUnit.get(chapter.id) ?? []),
      ...topicUnits.flatMap((t) => byUnit.get(t.id) ?? []),
    ];
    const s = summarize(chapterLogs);

    let status: UnitStatus;
    if (topics.length === 0) {
      status = statusByPeriods(chapter, s.periodsTaught);
    } else if (topics.every((t) => t.status === "complete")) {
      status = "complete";
    } else if (topics.some((t) => t.status !== "not_started")) {
      // Includes the `unknown` case: a chapter with an unestimated topic
      // that has been taught is under way, but cannot be called done.
      status = "in_progress";
    } else {
      status = "not_started";
    }

    return {
      unit: chapter,
      periodsTaught: s.periodsTaught,
      firstTaughtOn: s.firstTaughtOn,
      lastTaughtOn: s.lastTaughtOn,
      status,
      topics,
    };
  });

  // Pace: a unit is "behind" when its target end date has passed and it
  // is not complete. Chapters and topics both count — a topic with its
  // own deadline is a commitment too. Units without a target contribute
  // nothing, and if none has one we report null rather than guessing
  // "on track".
  const allRows = rows.flatMap((r) => [r, ...r.topics]);
  const dated = allRows.filter((r) => r.unit.targetEndDate);
  let pace: SyllabusProgress["pace"] = null;
  if (dated.length > 0) {
    const overdue = dated.filter(
      (r) => r.unit.targetEndDate < asOf && r.status !== "complete",
    );
    const earlyDone = dated.filter(
      (r) => r.status === "complete" && r.unit.targetEndDate > asOf,
    );
    pace = {
      status:
        overdue.length > 0
          ? "behind"
          : earlyDone.length > 0
            ? "ahead"
            : "on_track",
      unitsBehind: overdue.length,
    };
  }

  const allTopics = rows.flatMap((r) => r.topics);
  // Distinct across the whole plan, so a period naming both a chapter
  // and one of its topics is still one period taught.
  const distinctTaught = new Set(
    units.flatMap((u) => (byUnit.get(u.id) ?? []).map((l) => l.id)),
  ).size;

  return {
    academicYearCode: input.academicYearCode,
    classId: input.classId,
    subjectId: input.subjectId,
    units: rows,
    totalUnits: rows.length,
    completeUnits: rows.filter((r) => r.status === "complete").length,
    totalTopics: allTopics.length,
    completeTopics: allTopics.filter((t) => t.status === "complete").length,
    // Once a chapter is broken into topics, the topics carry the
    // estimate — adding the chapter's own figure on top would count the
    // same teaching twice.
    plannedPeriods: rows.reduce(
      (sum, r) =>
        sum +
        (r.topics.length > 0
          ? r.topics.reduce((s, t) => s + t.unit.plannedPeriods, 0)
          : r.unit.plannedPeriods),
      0,
    ),
    taughtPeriods: distinctTaught,
    pace,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export type SaveLogInput = {
  academicYearCode: string;
  date: string;
  periodNo: number;
  classId: string;
  sectionId: string;
  subjectId: string;
  staffId: string;
  scheduledStaffId?: string;
  status: TeachingLogStatus;
  startedAt?: string;
  endedAt?: string;
  unitIds?: string[];
  lessonPlanId?: string;
  note?: string;
  source?: TeachingLogSource;
  sourceRef?: string;
  location?: TeachingLogLocation;
  createdBy?: string;
};

/** A period someone claims was actually taught, by whoever took it. */
export function isTaughtStatus(s: TeachingLogStatus): boolean {
  return s === "delivered" || s === "substituted";
}

export type SaveResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Upsert one period log by natural key. Returns an error rather than
 * writing when the input cannot be placed on a real slot, or when the
 * date is outside the backdating window the school allows.
 */
export function upsertTeachingLog(
  state: TeachingState,
  input: SaveLogInput,
  opts?: { now?: Date; skipBackdateCheck?: boolean },
): SaveResult<{ state: TeachingState; log: TeachingLog }> {
  const now = opts?.now ?? new Date();
  const policy = normalizeTeachingPolicy(state.policy);

  if (!isIsoDate(input.date)) {
    return { ok: false, error: "Pick a valid date" };
  }
  if (!input.classId || !input.sectionId) {
    return { ok: false, error: "Period is missing its class or section" };
  }
  if (!Number.isFinite(input.periodNo)) {
    return { ok: false, error: "Period number is missing" };
  }
  // Covers "substituted" too. The API rewrites a substitute's "delivered"
  // into "substituted" before it reaches here, so checking only
  // "delivered" let every covered period through untagged — and a
  // substituted period is precisely the one whose syllabus position
  // nobody can reconstruct later.
  if (
    isTaughtStatus(input.status) &&
    policy.requireTopicOnDelivery &&
    (input.unitIds ?? []).length === 0
  ) {
    return { ok: false, error: "Pick the topic covered before saving" };
  }

  if (!opts?.skipBackdateCheck) {
    const today = istDateOf(now);
    if (input.date > today) {
      return { ok: false, error: "Cannot log a period in the future" };
    }
    const limit = new Date(`${today}T12:00:00`);
    limit.setDate(limit.getDate() - policy.backdateDays);
    const earliest = istDateOf(limit);
    if (input.date < earliest) {
      return {
        ok: false,
        error: `Periods older than ${policy.backdateDays} days need an admin override`,
      };
    }
  }

  const key = teachingLogKey(input);
  const existing = state.logs.find((l) => teachingLogKey(l) === key) ?? null;
  const stamp = now.toISOString();

  const candidate = normalizeTeachingLog({
    ...(existing ?? {}),
    ...input,
    id: existing?.id,
    scheduledStaffId: input.scheduledStaffId ?? existing?.scheduledStaffId ?? "",
    unitIds: input.unitIds ?? existing?.unitIds ?? [],
    lessonPlanId: input.lessonPlanId ?? existing?.lessonPlanId ?? "",
    note: input.note ?? existing?.note ?? "",
    source: input.source ?? "teacher_log",
    sourceRef: input.sourceRef ?? existing?.sourceRef ?? "",
    // An edit that arrives without a fresh fix must not inherit the old
    // one — the previous "on campus" was evidence about the previous
    // submission, not this one.
    location: normalizeTeachingLogLocation(input.location),
    createdBy: existing?.createdBy || input.createdBy || input.staffId,
    createdAt: existing?.createdAt || stamp,
    updatedAt: stamp,
  });
  if (!candidate) {
    return { ok: false, error: "Could not save — period details incomplete" };
  }

  const logs = state.logs.filter((l) => teachingLogKey(l) !== key);
  logs.push(candidate);
  return {
    ok: true,
    value: { state: { ...state, logs }, log: candidate },
  };
}

export function upsertSyllabusUnit(
  state: TeachingState,
  input: Partial<SyllabusUnit>,
): SaveResult<{ state: TeachingState; unit: SyllabusUnit }> {
  const isTopic = input.level === "topic" || Boolean(input.parentId);
  if (!input.title?.trim()) {
    return {
      ok: false,
      error: isTopic ? "Give the topic a title" : "Give the chapter a title",
    };
  }

  if (isTopic) {
    const parent = state.units.find((u) => u.id === input.parentId);
    if (!parent) {
      return { ok: false, error: "Pick the chapter this topic belongs to" };
    }
    if (parent.level !== "chapter") {
      // Two levels only. Allowing a topic under a topic would make every
      // rollup ambiguous and the tree unbounded.
      return { ok: false, error: "Topics can only sit under a chapter" };
    }
  }

  const siblingCount = state.units.filter(
    (u) =>
      u.academicYearCode === input.academicYearCode &&
      u.classId === input.classId &&
      u.subjectId === input.subjectId &&
      (isTopic ? u.parentId === input.parentId : u.level === "chapter"),
  ).length;

  const unit = normalizeSyllabusUnit({
    ...input,
    level: isTopic ? "topic" : "chapter",
    title: input.title.trim(),
    sortOrder: input.sortOrder ?? siblingCount,
    updatedAt: nowIso(),
  });
  if (!unit) {
    return { ok: false, error: "Pick a class, subject and academic year" };
  }
  if (
    unit.targetStartDate &&
    unit.targetEndDate &&
    unit.targetEndDate < unit.targetStartDate
  ) {
    return { ok: false, error: "Target end date is before the start date" };
  }
  const units = state.units.filter((u) => u.id !== unit.id);
  units.push(unit);
  return { ok: true, value: { state: { ...state, units }, unit } };
}

/**
 * Remove a unit, its topics if it is a chapter, and every reference to
 * them. References are cleared rather than left dangling — a log or plan
 * pointing at a deleted id would otherwise render as taught-but-missing.
 */
export function removeSyllabusUnit(
  state: TeachingState,
  unitId: string,
): TeachingState {
  const doomed = new Set<string>([unitId]);
  for (const u of state.units) {
    if (u.parentId === unitId) doomed.add(u.id);
  }
  const strip = (ids: string[]) => ids.filter((id) => !doomed.has(id));

  return {
    ...state,
    units: state.units.filter((u) => !doomed.has(u.id)),
    lessonPlans: state.lessonPlans.map((p) =>
      p.unitIds.some((id) => doomed.has(id))
        ? { ...p, unitIds: strip(p.unitIds), updatedAt: nowIso() }
        : p,
    ),
    logs: state.logs.map((l) =>
      l.unitIds.some((id) => doomed.has(id))
        ? { ...l, unitIds: strip(l.unitIds) }
        : l,
    ),
  };
}

export type SyllabusImportChapter = {
  code?: string;
  title: string;
  plannedPeriods?: number;
  topics?: { code?: string; title: string; plannedPeriods?: number }[];
};

export type SyllabusImportSummary = {
  chaptersAdded: number;
  topicsAdded: number;
  /** Titles already in the plan, left untouched */
  skipped: string[];
};

/**
 * Add a batch of chapters (with topics) to one class + subject plan.
 *
 * Used by the OCR importer, where a teacher has reviewed the detected
 * list and pressed save. Matching is by normalized title within the same
 * class+subject: re-importing the same contents page updates nothing and
 * duplicates nothing, so a second scan after fixing one typo is safe.
 */
export function importSyllabusUnits(
  state: TeachingState,
  input: {
    academicYearCode: string;
    classId: string;
    subjectId: string;
    chapters: SyllabusImportChapter[];
  },
): SaveResult<{ state: TeachingState; summary: SyllabusImportSummary }> {
  if (!input.academicYearCode || !input.classId || !input.subjectId) {
    return { ok: false, error: "Pick a class, subject and academic year" };
  }
  const wanted = input.chapters.filter((c) => c.title?.trim());
  if (wanted.length === 0) {
    return { ok: false, error: "Nothing selected to import" };
  }

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  let next = state;
  const summary: SyllabusImportSummary = {
    chaptersAdded: 0,
    topicsAdded: 0,
    skipped: [],
  };

  const inScope = (u: SyllabusUnit) =>
    u.academicYearCode === input.academicYearCode &&
    u.classId === input.classId &&
    u.subjectId === input.subjectId;

  for (const chapter of wanted) {
    const existing = next.units.find(
      (u) => inScope(u) && u.level === "chapter" && norm(u.title) === norm(chapter.title),
    );

    let chapterId: string;
    if (existing) {
      summary.skipped.push(chapter.title.trim());
      chapterId = existing.id;
    } else {
      const created = upsertSyllabusUnit(next, {
        academicYearCode: input.academicYearCode,
        classId: input.classId,
        subjectId: input.subjectId,
        code: chapter.code ?? "",
        title: chapter.title,
        plannedPeriods: chapter.plannedPeriods ?? 0,
      });
      // One bad row must not abort the whole import; skip it and carry on
      // so the teacher gets the rest of the page.
      if (!created.ok) {
        summary.skipped.push(chapter.title.trim());
        continue;
      }
      next = created.value.state;
      chapterId = created.value.unit.id;
      summary.chaptersAdded += 1;
    }

    for (const topic of chapter.topics ?? []) {
      if (!topic.title?.trim()) continue;
      const dupe = next.units.find(
        (u) =>
          inScope(u) &&
          u.parentId === chapterId &&
          norm(u.title) === norm(topic.title),
      );
      if (dupe) {
        summary.skipped.push(topic.title.trim());
        continue;
      }
      const created = upsertSyllabusUnit(next, {
        academicYearCode: input.academicYearCode,
        classId: input.classId,
        subjectId: input.subjectId,
        parentId: chapterId,
        code: topic.code ?? "",
        title: topic.title,
        plannedPeriods: topic.plannedPeriods ?? 0,
      });
      if (!created.ok) {
        summary.skipped.push(topic.title.trim());
        continue;
      }
      next = created.value.state;
      summary.topicsAdded += 1;
    }
  }

  if (summary.chaptersAdded === 0 && summary.topicsAdded === 0) {
    return {
      ok: false,
      error: "Everything on that page is already in the plan",
    };
  }
  return { ok: true, value: { state: next, summary } };
}

/* ---- Lesson plans ------------------------------------------------- */

export function upsertLessonPlan(
  state: TeachingState,
  input: Partial<LessonPlan>,
): SaveResult<{ state: TeachingState; plan: LessonPlan }> {
  if (!input.title?.trim()) {
    return { ok: false, error: "Give the lesson a title" };
  }
  const plan = normalizeLessonPlan({
    ...input,
    title: input.title.trim(),
    updatedAt: nowIso(),
  });
  if (!plan) {
    return { ok: false, error: "Pick a class, subject and academic year" };
  }

  // Every referenced unit must exist in this same class+subject plan,
  // so a lesson cannot claim to cover a chapter from another subject.
  const known = new Set(
    state.units
      .filter(
        (u) =>
          u.academicYearCode === plan.academicYearCode &&
          u.classId === plan.classId &&
          u.subjectId === plan.subjectId,
      )
      .map((u) => u.id),
  );
  const stray = plan.unitIds.filter((id) => !known.has(id));
  if (stray.length > 0) {
    return {
      ok: false,
      error: "That chapter or topic is not in this subject's plan",
    };
  }

  const lessonPlans = state.lessonPlans.filter((p) => p.id !== plan.id);
  lessonPlans.push(plan);
  return { ok: true, value: { state: { ...state, lessonPlans }, plan } };
}

export function removeLessonPlan(
  state: TeachingState,
  planId: string,
): TeachingState {
  return {
    ...state,
    lessonPlans: state.lessonPlans.filter((p) => p.id !== planId),
    logs: state.logs.map((l) =>
      l.lessonPlanId === planId ? { ...l, lessonPlanId: "" } : l,
    ),
  };
}

/** Lesson plans for a class + subject, most recently planned first. */
export function listLessonPlans(
  state: TeachingState,
  filter: {
    academicYearCode: string;
    classId: string;
    subjectId: string;
    unitId?: string;
  },
): LessonPlan[] {
  return state.lessonPlans
    .filter(
      (p) =>
        p.academicYearCode === filter.academicYearCode &&
        p.classId === filter.classId &&
        p.subjectId === filter.subjectId &&
        (!filter.unitId || p.unitIds.includes(filter.unitId)),
    )
    .sort(
      (a, b) =>
        (b.plannedDate || "").localeCompare(a.plannedDate || "") ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
}

/* ---- Resources ---------------------------------------------------- */

export type ResourceOwner =
  | { kind: "unit"; id: string }
  | { kind: "lessonPlan"; id: string };

/**
 * Attach a content link to a chapter, topic or lesson plan. Returns an
 * error for a URL that is not plainly http(s) rather than storing
 * something that would become an unsafe href.
 */
export function addResourceLink(
  state: TeachingState,
  owner: ResourceOwner,
  input: { kind?: ResourceKind; title: string; url: string; locator?: string },
  addedBy = "",
): SaveResult<{ state: TeachingState; resource: ResourceLink }> {
  const resource = normalizeResourceLink({
    kind: input.kind,
    title: input.title,
    url: input.url,
    locator: input.locator,
    addedBy,
  });
  if (!resource) {
    return {
      ok: false,
      error: "Enter a valid web link (http:// or https://)",
    };
  }

  if (owner.kind === "unit") {
    const target = state.units.find((u) => u.id === owner.id);
    if (!target) return { ok: false, error: "Chapter or topic not found" };
    return {
      ok: true,
      value: {
        state: {
          ...state,
          units: state.units.map((u) =>
            u.id === owner.id
              ? {
                  ...u,
                  resources: [...u.resources, resource],
                  updatedAt: nowIso(),
                }
              : u,
          ),
        },
        resource,
      },
    };
  }

  const target = state.lessonPlans.find((p) => p.id === owner.id);
  if (!target) return { ok: false, error: "Lesson plan not found" };
  return {
    ok: true,
    value: {
      state: {
        ...state,
        lessonPlans: state.lessonPlans.map((p) =>
          p.id === owner.id
            ? {
                ...p,
                resources: [...p.resources, resource],
                updatedAt: nowIso(),
              }
            : p,
        ),
      },
      resource,
    },
  };
}

export function removeResourceLink(
  state: TeachingState,
  owner: ResourceOwner,
  resourceId: string,
): TeachingState {
  if (owner.kind === "unit") {
    return {
      ...state,
      units: state.units.map((u) =>
        u.id === owner.id
          ? {
              ...u,
              resources: u.resources.filter((r) => r.id !== resourceId),
              updatedAt: nowIso(),
            }
          : u,
      ),
    };
  }
  return {
    ...state,
    lessonPlans: state.lessonPlans.map((p) =>
      p.id === owner.id
        ? {
            ...p,
            resources: p.resources.filter((r) => r.id !== resourceId),
            updatedAt: nowIso(),
          }
        : p,
    ),
  };
}

/**
 * Every resource a teacher would want in one period: the ones on the
 * topics being taught, plus their chapters', plus the lesson plan's.
 */
export function resourcesForUnits(
  state: TeachingState,
  unitIds: string[],
  lessonPlanId = "",
): ResourceLink[] {
  const wanted = new Set(unitIds);
  for (const id of unitIds) {
    const unit = state.units.find((u) => u.id === id);
    if (unit?.parentId) wanted.add(unit.parentId);
  }
  const out: ResourceLink[] = [];
  for (const unit of state.units) {
    if (wanted.has(unit.id)) out.push(...unit.resources);
  }
  if (lessonPlanId) {
    const plan = state.lessonPlans.find((p) => p.id === lessonPlanId);
    if (plan) out.push(...plan.resources);
  }
  return [...new Map(out.map((r) => [r.id, r])).values()];
}
