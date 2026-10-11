/**
 * Admissions → Entrance test: the rules, with no I/O.
 *
 * The old SStudy ERP ran it as "set admission exam date → enter registration
 * subject marks → admission exam summary → change selected / not-selected →
 * send message". This file is every decision in that chain the office can
 * get wrong by hand: what a total is, when a child has one, what the pass
 * mark says, which results a bulk re-run may touch, and what a family is
 * told. The server (admissionEntranceTest.server.ts) and the screen
 * (EntranceTestPanel) both call it, so the two can never disagree.
 *
 * The one rule that matters most: a mark NOT ENTERED is unknown, not zero.
 * A child with a blank subject has no total, no percentage and no suggested
 * result — reading the blank as 0 would mark a child "Not selected" because
 * a teacher had not typed one box yet.
 */

export type EntranceSubject = {
  id: string;
  name: string;
  maxMarks: number;
};

export type EntranceResultStatus =
  | ""
  | "selected"
  | "waitlisted"
  | "not_selected"
  | "absent";

export type EntranceStatusSource = "" | "rule" | "manual";

export type EntranceSession = {
  id: string;
  academicYearCode: string;
  name: string;
  /** YYYY-MM-DD */
  testDate: string;
  /** "10:00" (24 h) or "" */
  startTime: string;
  venue: string;
  classIds: string[];
  subjects: EntranceSubject[];
  passPercent: number;
  /** Below the pass mark but at least this = Waitlisted. null = no waitlist band. */
  waitlistPercent: number | null;
  notes: string;
  updatedAt: string;
};

export type EntranceCandidate = {
  id: string;
  sessionId: string;
  leadId: string;
  rollNo: string;
  childName: string;
  guardianName: string;
  mobile: string;
  classId: string;
  applicationNo: string;
  enquiryNo: string;
  absent: boolean;
  /** subject id → marks. A missing key = not entered (never zero). */
  marks: Record<string, number>;
  resultStatus: EntranceResultStatus;
  statusSource: EntranceStatusSource;
  statusSetBy: string;
  statusSetAt: string;
  inviteSentAt: string;
  resultSentAt: string;
  updatedAt: string;
};

export const ENTRANCE_RESULT_STATUSES: {
  value: Exclude<EntranceResultStatus, "">;
  label: string;
}[] = [
  { value: "selected", label: "Selected" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "not_selected", label: "Not selected" },
  { value: "absent", label: "Absent" },
];

export function entranceStatusLabel(s: EntranceResultStatus): string {
  return ENTRANCE_RESULT_STATUSES.find((x) => x.value === s)?.label ?? "Not decided";
}

export function isEntranceResultStatus(v: unknown): v is EntranceResultStatus {
  return v === "" || ENTRANCE_RESULT_STATUSES.some((s) => s.value === v);
}

/** Lead stages that may sit the test: open, registered, verified. */
export const ENTRANCE_ELIGIBLE_STAGES = ["enquiry", "applied", "verified"] as const;

const MAX_SUBJECTS = 12;
const MAX_MARKS_CAP = 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ─── Session input ─────────────────────────────────────────────── */

export type EntranceSessionInput = {
  name?: unknown;
  academicYearCode?: unknown;
  testDate?: unknown;
  startTime?: unknown;
  venue?: unknown;
  classIds?: unknown;
  subjects?: unknown;
  passPercent?: unknown;
  waitlistPercent?: unknown;
  notes?: unknown;
};

export type EntranceSessionDraft = Omit<EntranceSession, "id" | "updatedAt">;

/**
 * Check and clean what the office typed for a sitting. Refuses rather than
 * guessing: no date means no date, not today; no academic year is an error,
 * never a fallback year (the 2026-08-10 incident).
 */
export function validateSessionInput(
  input: EntranceSessionInput,
): { ok: true; draft: EntranceSessionDraft } | { ok: false; error: string } {
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "Name the test (e.g. “Entrance test — Class VI, April”)." };

  const academicYearCode = String(input.academicYearCode ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(academicYearCode)) {
    return { ok: false, error: "The academic session is not known — choose a session in the header first." };
  }

  const testDate = String(input.testDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(testDate) || Number.isNaN(Date.parse(`${testDate}T00:00:00Z`))) {
    return { ok: false, error: "Pick the test date." };
  }

  const startTime = String(input.startTime ?? "").trim();
  if (startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
    return { ok: false, error: "Start time must look like 10:00." };
  }

  const venue = String(input.venue ?? "").trim().slice(0, 160);
  const notes = String(input.notes ?? "").trim().slice(0, 1000);

  const classIds = Array.isArray(input.classIds)
    ? [...new Set(input.classIds.map((c) => String(c ?? "").trim()).filter(Boolean))]
    : [];
  if (classIds.length === 0) return { ok: false, error: "Tick at least one class this test is for." };

  const subjectsRes = normalizeSubjects(input.subjects);
  if (!subjectsRes.ok) return subjectsRes;

  const passPercent = Number(input.passPercent);
  if (!Number.isFinite(passPercent) || passPercent < 0 || passPercent > 100) {
    return { ok: false, error: "Pass mark must be a percentage between 0 and 100." };
  }
  let waitlistPercent: number | null = null;
  const wRaw = input.waitlistPercent;
  if (wRaw !== null && wRaw !== undefined && String(wRaw).trim() !== "") {
    const w = Number(wRaw);
    if (!Number.isFinite(w) || w < 0 || w > 100) {
      return { ok: false, error: "Waitlist mark must be a percentage between 0 and 100." };
    }
    if (w >= passPercent) {
      return { ok: false, error: "Waitlist mark must be below the pass mark (or left blank)." };
    }
    waitlistPercent = round2(w);
  }

  return {
    ok: true,
    draft: {
      academicYearCode,
      name,
      testDate,
      startTime,
      venue,
      classIds,
      subjects: subjectsRes.subjects,
      passPercent: round2(passPercent),
      waitlistPercent,
      notes,
    },
  };
}

export function normalizeSubjects(
  raw: unknown,
): { ok: true; subjects: EntranceSubject[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Add at least one subject with its maximum marks." };
  }
  if (raw.length > MAX_SUBJECTS) {
    return { ok: false, error: `At most ${MAX_SUBJECTS} subjects in one test.` };
  }
  const out: EntranceSubject[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const name = String(o.name ?? "").trim().slice(0, 60);
    if (!name) return { ok: false, error: "Every subject needs a name." };
    const key = name.toLowerCase();
    if (names.has(key)) return { ok: false, error: `“${name}” is listed twice.` };
    names.add(key);
    const max = Number(o.maxMarks);
    if (!Number.isFinite(max) || max <= 0 || max > MAX_MARKS_CAP) {
      return { ok: false, error: `Maximum marks for ${name} must be between 1 and ${MAX_MARKS_CAP}.` };
    }
    let id = String(o.id ?? "").trim().slice(0, 40);
    if (!id || ids.has(id)) {
      let n = out.length + 1;
      while (ids.has(`s${n}`)) n++;
      id = `s${n}`;
    }
    ids.add(id);
    out.push({ id, name, maxMarks: round2(max) });
  }
  return { ok: true, subjects: out };
}

/**
 * May the subjects change now that marks exist? Removing a subject that
 * already holds marks would drop them silently; lowering a maximum below a
 * mark already entered would leave a child at 23 out of 20. Both refused,
 * with the reason.
 */
export function subjectChangeProblem(
  next: EntranceSubject[],
  candidates: Pick<EntranceCandidate, "marks" | "childName">[],
): string | null {
  const byId = new Map(next.map((s) => [s.id, s]));
  for (const c of candidates) {
    for (const [sid, v] of Object.entries(c.marks || {})) {
      const s = byId.get(sid);
      if (!s) {
        return `A subject being removed already has marks (e.g. ${c.childName || "one child"}). Clear those marks first.`;
      }
      if (v > s.maxMarks) {
        return `${s.name}: ${c.childName || "a child"} already has ${v}, above the new maximum ${s.maxMarks}.`;
      }
    }
  }
  return null;
}

/* ─── Marks ─────────────────────────────────────────────────────── */

/**
 * What one typed box means. "" = not entered (null). Never clamps: 26 out of
 * 25 is a typing mistake the teacher must see, not a 25.
 */
export function parseMarkInput(
  raw: string,
  maxMarks: number,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = String(raw ?? "").trim();
  if (!t) return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false, error: "Marks must be a number" };
  const v = Number(t);
  if (v > maxMarks) return { ok: false, error: `Above the maximum ${maxMarks}` };
  return { ok: true, value: round2(v) };
}

/**
 * Clean a marks object coming over the wire against the sitting's subjects.
 * Unknown subject ids, negatives and over-maximum values are refused, not
 * dropped — a silently dropped mark is a mark the teacher thinks was saved.
 */
export function cleanMarks(
  raw: unknown,
  subjects: EntranceSubject[],
): { ok: true; marks: Record<string, number> } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, marks: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Marks are malformed" };
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const out: Record<string, number> = {};
  for (const [sid, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "") continue; // not entered
    const s = byId.get(sid);
    if (!s) return { ok: false, error: `Unknown subject “${sid}” for this test` };
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${s.name}: marks must be a number` };
    if (n > s.maxMarks) return { ok: false, error: `${s.name}: ${n} is above the maximum ${s.maxMarks}` };
    out[sid] = round2(n);
  }
  return { ok: true, marks: out };
}

export function sessionMaxMarks(session: Pick<EntranceSession, "subjects">): number {
  return round2(session.subjects.reduce((s, x) => s + x.maxMarks, 0));
}

export type CandidateScore = {
  /** Every subject has a mark and the child was not absent. */
  complete: boolean;
  /** Sum of the marks entered so far (shown as "so far" when incomplete). */
  entered: number;
  max: number;
  /** null unless complete. */
  total: number | null;
  /** null unless complete. Two decimals. */
  percent: number | null;
  missing: string[];
};

export function candidateScore(
  session: Pick<EntranceSession, "subjects">,
  c: Pick<EntranceCandidate, "marks" | "absent">,
): CandidateScore {
  const max = sessionMaxMarks(session);
  let entered = 0;
  const missing: string[] = [];
  for (const s of session.subjects) {
    const v = c.marks?.[s.id];
    if (typeof v === "number" && Number.isFinite(v)) entered += v;
    else missing.push(s.id);
  }
  entered = round2(entered);
  const complete = !c.absent && missing.length === 0 && session.subjects.length > 0;
  return {
    complete,
    entered,
    max,
    total: complete ? entered : null,
    percent: complete && max > 0 ? round2((entered / max) * 100) : null,
    missing,
  };
}

/* ─── Results ───────────────────────────────────────────────────── */

/**
 * What the pass mark says about one child. null = cannot say yet (marks
 * missing) — the caller leaves the result undecided rather than inventing
 * one.
 */
export function suggestedStatus(
  session: Pick<EntranceSession, "subjects" | "passPercent" | "waitlistPercent">,
  c: Pick<EntranceCandidate, "marks" | "absent">,
): Exclude<EntranceResultStatus, ""> | null {
  if (c.absent) return "absent";
  const score = candidateScore(session, c);
  if (!score.complete || score.percent === null) return null;
  if (score.percent >= session.passPercent) return "selected";
  if (session.waitlistPercent !== null && score.percent >= session.waitlistPercent) return "waitlisted";
  return "not_selected";
}

export type StatusChange = { id: string; status: Exclude<EntranceResultStatus, "">; source: "rule" };

/**
 * "Apply pass mark" for the ticked children (or all). A manual decision is
 * the office's word and is left alone unless `includeManual`; a child whose
 * marks are incomplete is skipped and counted, never defaulted.
 */
export function ruleStatusChanges(
  session: Pick<EntranceSession, "subjects" | "passPercent" | "waitlistPercent">,
  candidates: EntranceCandidate[],
  opts: { includeManual?: boolean } = {},
): { changes: StatusChange[]; skippedIncomplete: number; skippedManual: number } {
  const changes: StatusChange[] = [];
  let skippedIncomplete = 0;
  let skippedManual = 0;
  for (const c of candidates) {
    if (c.statusSource === "manual" && !opts.includeManual) {
      skippedManual++;
      continue;
    }
    const s = suggestedStatus(session, c);
    if (!s) {
      skippedIncomplete++;
      continue;
    }
    if (s !== c.resultStatus || c.statusSource !== "rule") {
      changes.push({ id: c.id, status: s, source: "rule" });
    }
  }
  return { changes, skippedIncomplete, skippedManual };
}

/** Ranked list for the result screen: highest percentage first, incomplete last. */
export function rankCandidates(
  session: Pick<EntranceSession, "subjects">,
  candidates: EntranceCandidate[],
): EntranceCandidate[] {
  return [...candidates].sort((a, b) => {
    const pa = candidateScore(session, a).percent;
    const pb = candidateScore(session, b).percent;
    if (pa === null && pb === null) return rollCompare(a.rollNo, b.rollNo);
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pb - pa || rollCompare(a.rollNo, b.rollNo);
  });
}

export function rollCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

/* ─── Roll numbers ──────────────────────────────────────────────── */

/**
 * Next `count` roll numbers after the highest numeric one already on the
 * sitting, zero-padded to three digits ("001"). Gaps left by a removed child
 * are not reused: a printed roll list must never show one number twice.
 */
export function nextRollNumbers(existing: string[], count: number): string[] {
  let max = 0;
  for (const r of existing) {
    const n = Number.parseInt(String(r).replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(String(max + i).padStart(3, "0"));
  return out;
}

/* ─── Summary ───────────────────────────────────────────────────── */

export type EntranceClassSummaryRow = {
  classId: string;
  className: string;
  onRoll: number;
  appeared: number;
  absent: number;
  selected: number;
  waitlisted: number;
  notSelected: number;
  /** Appeared, but no result yet. */
  undecided: number;
  /** Highest / average percentage among those with complete marks. */
  topPercent: number | null;
  averagePercent: number | null;
};

/**
 * Class-by-class: who was on the roll, who sat it, and how it went.
 * "Appeared" = not marked absent; a child with no result is counted as
 * undecided, never folded into "not selected".
 */
export function classSummary(
  sessions: Pick<EntranceSession, "id" | "subjects">[],
  candidates: EntranceCandidate[],
  classNameOf: (classId: string) => string,
): EntranceClassSummaryRow[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const rows = new Map<string, EntranceClassSummaryRow & { pctSum: number; pctN: number }>();
  for (const c of candidates) {
    const key = c.classId || "";
    let r = rows.get(key);
    if (!r) {
      r = {
        classId: key,
        className: key ? classNameOf(key) || key : "Class not set",
        onRoll: 0,
        appeared: 0,
        absent: 0,
        selected: 0,
        waitlisted: 0,
        notSelected: 0,
        undecided: 0,
        topPercent: null,
        averagePercent: null,
        pctSum: 0,
        pctN: 0,
      };
      rows.set(key, r);
    }
    r.onRoll++;
    if (c.absent || c.resultStatus === "absent") {
      r.absent++;
      continue;
    }
    r.appeared++;
    if (c.resultStatus === "selected") r.selected++;
    else if (c.resultStatus === "waitlisted") r.waitlisted++;
    else if (c.resultStatus === "not_selected") r.notSelected++;
    else r.undecided++;
    const s = sessionById.get(c.sessionId);
    const pct = s ? candidateScore(s, c).percent : null;
    if (pct !== null) {
      r.topPercent = r.topPercent === null ? pct : Math.max(r.topPercent, pct);
      r.pctSum += pct;
      r.pctN++;
    }
  }
  return [...rows.values()]
    .map(({ pctSum, pctN, ...r }) => ({
      ...r,
      averagePercent: pctN ? round2(pctSum / pctN) : null,
    }))
    .sort((a, b) => a.className.localeCompare(b.className, "en", { numeric: true }));
}

/* ─── Family messages ───────────────────────────────────────────── */

/** WhatsApp template families (lib/waTemplates.ts SEED_DEFS). */
export const ENTRANCE_INVITE_FAMILY = "admissions_entrance_invite";
export const ENTRANCE_RESULT_FAMILY = "admissions_entrance_result";

export type EntranceNotifyKind = "invite" | "result";

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_HI = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];

/** "Sat, 14 Nov 2026" / "शनिवार, 14 नवंबर 2026". Calendar maths in UTC — the date has no time zone. */
export function formatTestDate(ymd: string, lang: "en" | "hi"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  if (!m) return ymd || "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const day = (lang === "hi" ? DAYS_HI : DAYS_EN)[d.getUTCDay()]!;
  const mon = (lang === "hi" ? MONTHS_HI : MONTHS_EN)[d.getUTCMonth()]!;
  return `${day}, ${Number(m[3])} ${mon} ${m[1]}`;
}

/** "10:00" → "10:00 AM" / "सुबह 10:00". "" stays "" (the caller says "time to be told"). */
export function formatTestTime(hhmm: string, lang: "en" | "hi"): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return "";
  const h = Number(m[1]);
  const h12 = ((h + 11) % 12) + 1;
  if (lang === "hi") {
    const part = h < 12 ? "सुबह" : h < 16 ? "दोपहर" : h < 19 ? "शाम" : "रात";
    return `${part} ${h12}:${m[2]}`;
  }
  return `${h12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** The two result lines a family reads, in their language. */
export function resultLines(
  status: Exclude<EntranceResultStatus, "">,
  lang: "en" | "hi",
): { testResult: string; nextStep: string } {
  if (lang === "hi") {
    switch (status) {
      case "selected":
        return {
          testResult: "चयनित — बधाई हो!",
          nextStep: "प्रवेश की औपचारिकताएँ पूरी करने के लिए कृपया विद्यालय कार्यालय आएँ।",
        };
      case "waitlisted":
        return {
          testResult: "प्रतीक्षा सूची में",
          nextStep: "सीट उपलब्ध होते ही हम आपसे संपर्क करेंगे।",
        };
      case "not_selected":
        return {
          testResult: "इस बार चयन नहीं हो सका",
          nextStep: "हमें चुनने के लिए धन्यवाद। मार्गदर्शन के लिए आप प्रधानाचार्य से मिल सकते हैं।",
        };
      case "absent":
        return {
          testResult: "परीक्षा में अनुपस्थित",
          nextStep: "नई तिथि के लिए कृपया विद्यालय कार्यालय से संपर्क करें।",
        };
    }
  }
  switch (status) {
    case "selected":
      return {
        testResult: "Selected — congratulations!",
        nextStep: "Please visit the school office to complete the admission formalities.",
      };
    case "waitlisted":
      return {
        testResult: "Waitlisted",
        nextStep: "We will contact you as soon as a seat becomes available.",
      };
    case "not_selected":
      return {
        testResult: "Not selected this time",
        nextStep: "Thank you for considering us. You are welcome to meet the principal for guidance.",
      };
    case "absent":
      return {
        testResult: "Absent from the test",
        nextStep: "Please contact the school office if you would like another test date.",
      };
  }
}

export type EntranceMessageVars = Record<string, string>;

/**
 * The template variables for one child — everything the two templates
 * name. `className` is the class the child is applying for.
 */
export function entranceMessageVars(
  kind: EntranceNotifyKind,
  session: Pick<EntranceSession, "testDate" | "startTime" | "venue">,
  c: Pick<EntranceCandidate, "childName" | "guardianName" | "rollNo" | "resultStatus" | "absent">,
  opts: { lang: "en" | "hi"; className: string; schoolName: string },
): { ok: true; vars: EntranceMessageVars } | { ok: false; error: string } {
  const base: EntranceMessageVars = {
    guardianName: c.guardianName || (opts.lang === "hi" ? "अभिभावक" : "Parent"),
    childName: c.childName || (opts.lang === "hi" ? "आपके बच्चे" : "your child"),
    className: opts.className || (opts.lang === "hi" ? "प्रवेश" : "admission"),
    schoolName: opts.schoolName,
  };
  if (kind === "invite") {
    if (!session.venue.trim()) return { ok: false, error: "Set the venue before inviting families." };
    if (!session.startTime) return { ok: false, error: "Set the start time before inviting families." };
    return {
      ok: true,
      vars: {
        ...base,
        testDate: formatTestDate(session.testDate, opts.lang),
        testTime: formatTestTime(session.startTime, opts.lang),
        venue: session.venue.trim(),
        rollNo: c.rollNo,
      },
    };
  }
  const status: EntranceResultStatus = c.resultStatus || (c.absent ? "absent" : "");
  if (!status) return { ok: false, error: "No result decided yet" };
  return { ok: true, vars: { ...base, ...resultLines(status, opts.lang) } };
}

/** Fill {{name}} placeholders. A variable with no value is left visible, so a preview shows the gap. */
export function fillTemplateBody(body: string, vars: EntranceMessageVars): string {
  return body.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (all, k: string) =>
    vars[k] !== undefined && vars[k] !== "" ? vars[k]! : all,
  );
}

/** Ten-digit Indian mobile or null — never a guess. */
export function tenDigitMobile(raw: string): string | null {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}
