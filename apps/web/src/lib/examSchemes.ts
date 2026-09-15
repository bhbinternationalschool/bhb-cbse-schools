/**
 * Assessment schemes — how each class band is assessed, chosen by the school.
 *
 * Until 2026-09-15 the exam desk had ONE way of assessing everybody: an
 * 8-point A1–E scale on marks out of a school-wide maximum, printed as
 * Max / Obtained / Grade for Nursery and Class X alike, with one detention
 * rule for all. CBSE and NEP ask for different things per band — no marks
 * at all before Class III, 80 + 20 in the middle and secondary years,
 * theory and practical passed separately at XI–XII, no detention under RTE
 * up to VIII — and schools differ on the details. So every one of those
 * choices is a setting here, with CBSE presets a click away, and the
 * school decides. The default scheme reproduces the old behaviour exactly,
 * so nothing changes until someone chooses.
 *
 * Pure: no storage, no imports from exams.ts (which imports this).
 */

export type GradeBand = {
  /** What is printed: "A1", "B", "Proficient". */
  grade: string;
  /** Lowest percentage that earns this band (inclusive). */
  minPercent: number;
  /** Long form for descriptor cards: "Exceeds expectations". */
  label: string;
};

export type GradeScalePreset = "cbse8" | "five" | "three" | "custom";

/** What the report card shows for a subject. */
export type DisplayMode =
  /** Max · Obtained · Grade — Class III upwards. */
  | "marks_grade"
  /** Grade letters only — Classes I–II, or wherever the school prefers. */
  | "grade_only"
  /** Descriptive bands ("Meets expectations") — pre-primary. */
  | "descriptors";

export type PromotionRule =
  /** RTE §16: promoted regardless; failed subjects are noted. */
  | "no_detention"
  /** Failing = conditional, re-examination first (RTE 2019 amendment for V/VIII). */
  | "reexam_then_detain"
  /** Failing = detained (Class IX upwards). */
  | "detain_on_fail";

export type ComponentKind = "exam" | "internal";

/** One part of a subject's assessment: "Term exam 80", "Notebook 5", "Practical 30". */
export type SchemeComponent = {
  code: string;
  label: string;
  maxMarks: number;
  kind: ComponentKind;
};

export type CoScholasticArea = {
  code: string;
  label: string;
};

export type AssessmentScheme = {
  id: string;
  name: string;
  /** Classes assessed this way. The default scheme takes every class not named elsewhere. */
  classIds: string[];
  isDefault: boolean;
  gradeScale: GradeScalePreset;
  /** Effective bands, highest first. The last band is the failing one (its
   * minPercent is 0). Editable whatever the preset — editing makes it custom. */
  gradeBands: GradeBand[];
  displayMode: DisplayMode;
  /** Empty = one whole mark per subject out of the exam's maximum. */
  components: SchemeComponent[];
  /** Components apply to term exams only (Half-yearly / Annual) or to every
   * exam including unit tests. */
  componentsApplyTo: "term_exams" | "all";
  /** Overrides the school pass % when set. */
  passPercent: number | null;
  /** XI–XII: 33 % in theory AND in practical, separately. */
  passEachComponent: boolean;
  /** A subject below pass fails the student; null = school policy. */
  requireAllSubjectsPass: boolean | null;
  promotionRule: PromotionRule;
  showRank: boolean;
  showClassAverage: boolean;
  /** Print "Result: Promoted to VI" from the recorded decision. */
  showResultOnCard: boolean;
  /** Empty = the policy's legacy NEP pair, if co-scholastic is enabled. */
  coScholasticAreas: CoScholasticArea[];
  /** Exams this scheme's classes sit; empty = all. */
  termIds: string[];
  /** Print the child's profile photo on the report card. */
  showPhoto: boolean;
  /** Attendance on the card: null = the school-wide policy switch. */
  showAttendance: boolean | null;
  note: string;
};

export const DEFAULT_SCHEME_ID = "scheme_default";

/* ------------------------------------------------------------------ bands */

export function gradeBandsForPreset(
  preset: GradeScalePreset,
  passPercent: number,
): GradeBand[] {
  const p = Math.min(100, Math.max(1, Math.floor(passPercent)));
  switch (preset) {
    case "cbse8":
      return [
        { grade: "A1", minPercent: 91, label: "Outstanding" },
        { grade: "A2", minPercent: 81, label: "Excellent" },
        { grade: "B1", minPercent: 71, label: "Very good" },
        { grade: "B2", minPercent: 61, label: "Good" },
        { grade: "C1", minPercent: 51, label: "Above average" },
        { grade: "C2", minPercent: 41, label: "Average" },
        { grade: "D", minPercent: Math.min(p, 40), label: "Pass" },
        { grade: "E", minPercent: 0, label: "Needs improvement" },
      ];
    case "five":
      return [
        { grade: "A", minPercent: 90, label: "Outstanding" },
        { grade: "B", minPercent: 75, label: "Very good" },
        { grade: "C", minPercent: 56, label: "Good" },
        { grade: "D", minPercent: Math.min(p, 55), label: "Satisfactory" },
        { grade: "E", minPercent: 0, label: "Needs improvement" },
      ];
    case "three":
      return [
        { grade: "A", minPercent: 75, label: "Exceeds expectations" },
        { grade: "B", minPercent: 50, label: "Meets expectations" },
        { grade: "C", minPercent: 0, label: "Working towards expectations" },
      ];
    case "custom":
      return [
        { grade: "A", minPercent: 80, label: "Excellent" },
        { grade: "B", minPercent: 60, label: "Good" },
        { grade: "C", minPercent: p, label: "Pass" },
        { grade: "D", minPercent: 0, label: "Needs improvement" },
      ];
  }
}

/** Bands sorted highest first, de-duplicated, last band forced to 0. */
export function normalizeGradeBands(bands: GradeBand[] | undefined | null, fallback: GradeBand[]): GradeBand[] {
  const rows = (Array.isArray(bands) ? bands : [])
    .map((b) => ({
      grade: String(b?.grade ?? "").trim().slice(0, 12),
      minPercent: Math.min(100, Math.max(0, Number(b?.minPercent) || 0)),
      label: String(b?.label ?? "").trim().slice(0, 60),
    }))
    .filter((b) => b.grade);
  if (rows.length === 0) return fallback;
  rows.sort((a, b) => b.minPercent - a.minPercent);
  const seen = new Set<string>();
  const out = rows.filter((b) => (seen.has(b.grade) ? false : (seen.add(b.grade), true)));
  out[out.length - 1] = { ...out[out.length - 1]!, minPercent: 0 };
  return out;
}

/** Grade for a percentage under a scheme; "—" when there is no percentage. */
export function gradeForPercent(pct: number | null, scheme: AssessmentScheme): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  for (const b of scheme.gradeBands) {
    if (pct >= b.minPercent) return b.grade;
  }
  return scheme.gradeBands[scheme.gradeBands.length - 1]?.grade ?? "—";
}

export function gradeLabel(grade: string, scheme: AssessmentScheme): string {
  return scheme.gradeBands.find((b) => b.grade === grade)?.label ?? "";
}

/** The grades a teacher may pick when entering grades rather than marks. */
export function pickableGrades(scheme: AssessmentScheme): GradeBand[] {
  return scheme.gradeBands;
}

/* ----------------------------------------------------------- components */

function isUnitTestCode(code: string): boolean {
  const c = code.toUpperCase();
  return c.startsWith("UT") || c.startsWith("PT") || c.startsWith("PA");
}

/** The components that apply to one exam, or [] for a single whole mark. */
export function componentsForTerm(
  scheme: AssessmentScheme,
  termCode: string,
): SchemeComponent[] {
  if (scheme.components.length === 0) return [];
  if (scheme.componentsApplyTo === "all") return scheme.components;
  return isUnitTestCode(termCode) ? [] : scheme.components;
}

export function componentsTotalMax(components: SchemeComponent[]): number {
  return components.reduce((s, c) => s + c.maxMarks, 0);
}

export function normalizeComponents(list: unknown): SchemeComponent[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: SchemeComponent[] = [];
  for (const raw of list as Partial<SchemeComponent>[]) {
    const code = String(raw?.code ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
    if (!code || seen.has(code)) continue;
    const maxMarks = Math.floor(Number(raw?.maxMarks) || 0);
    if (maxMarks <= 0) continue;
    seen.add(code);
    out.push({
      code,
      label: String(raw?.label ?? code).trim().slice(0, 40) || code,
      maxMarks,
      kind: raw?.kind === "internal" ? "internal" : "exam",
    });
  }
  return out;
}

/* ---------------------------------------------------------- co-scholastic */

export const CBSE_CO_SCHOLASTIC_AREAS: CoScholasticArea[] = [
  { code: "WE", label: "Work Education" },
  { code: "ART", label: "Art Education" },
  { code: "HPE", label: "Health & Physical Education" },
  { code: "DISC", label: "Discipline" },
];

export const NEP_CO_SCHOLASTIC_AREAS: CoScholasticArea[] = [
  { code: "socioEmotional", label: "Socio-Emotional Skills" },
  { code: "psychomotor", label: "Psychomotor Skills" },
];

export function normalizeCoScholasticAreas(list: unknown): CoScholasticArea[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: CoScholasticArea[] = [];
  for (const raw of list as Partial<CoScholasticArea>[]) {
    const code = String(raw?.code ?? "").trim().replace(/\s+/g, "_").slice(0, 24);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, label: String(raw?.label ?? code).trim().slice(0, 60) || code });
  }
  return out;
}

/* ------------------------------------------------------------ the scheme */

export function defaultAssessmentScheme(passPercent = 33): AssessmentScheme {
  return {
    id: DEFAULT_SCHEME_ID,
    name: "School default",
    classIds: [],
    isDefault: true,
    gradeScale: "cbse8",
    gradeBands: gradeBandsForPreset("cbse8", passPercent),
    displayMode: "marks_grade",
    components: [],
    componentsApplyTo: "term_exams",
    passPercent: null,
    passEachComponent: false,
    requireAllSubjectsPass: null,
    promotionRule: "detain_on_fail",
    showRank: false,
    showClassAverage: false,
    showResultOnCard: true,
    coScholasticAreas: [],
    termIds: [],
    showPhoto: false,
    showAttendance: null,
    note: "",
  };
}

const DISPLAY_MODES: DisplayMode[] = ["marks_grade", "grade_only", "descriptors"];
const PROMOTION_RULES: PromotionRule[] = ["no_detention", "reexam_then_detain", "detain_on_fail"];
const SCALES: GradeScalePreset[] = ["cbse8", "five", "three", "custom"];

export function normalizeAssessmentScheme(
  raw: Partial<AssessmentScheme> | null | undefined,
  passPercent: number,
): AssessmentScheme {
  const d = defaultAssessmentScheme(passPercent);
  if (!raw) return d;
  const scale = SCALES.includes(raw.gradeScale as GradeScalePreset)
    ? (raw.gradeScale as GradeScalePreset)
    : "cbse8";
  const ownPass =
    raw.passPercent == null || !Number.isFinite(Number(raw.passPercent))
      ? null
      : Math.min(100, Math.max(1, Math.floor(Number(raw.passPercent))));
  const bands = normalizeGradeBands(
    raw.gradeBands,
    gradeBandsForPreset(scale, ownPass ?? passPercent),
  );
  return {
    id: String(raw.id || d.id),
    name: String(raw.name ?? d.name).trim().slice(0, 60) || d.name,
    classIds: Array.isArray(raw.classIds) ? raw.classIds.map(String).filter(Boolean) : [],
    isDefault: !!raw.isDefault,
    gradeScale: scale,
    gradeBands: bands,
    displayMode: DISPLAY_MODES.includes(raw.displayMode as DisplayMode)
      ? (raw.displayMode as DisplayMode)
      : "marks_grade",
    components: normalizeComponents(raw.components),
    componentsApplyTo: raw.componentsApplyTo === "all" ? "all" : "term_exams",
    passPercent: ownPass,
    passEachComponent: !!raw.passEachComponent,
    requireAllSubjectsPass:
      raw.requireAllSubjectsPass == null ? null : !!raw.requireAllSubjectsPass,
    promotionRule: PROMOTION_RULES.includes(raw.promotionRule as PromotionRule)
      ? (raw.promotionRule as PromotionRule)
      : "detain_on_fail",
    showRank: !!raw.showRank,
    showClassAverage: !!raw.showClassAverage,
    showResultOnCard: raw.showResultOnCard !== false,
    coScholasticAreas: normalizeCoScholasticAreas(raw.coScholasticAreas),
    termIds: Array.isArray(raw.termIds) ? raw.termIds.map(String).filter(Boolean) : [],
    showPhoto: !!raw.showPhoto,
    showAttendance: raw.showAttendance == null ? null : !!raw.showAttendance,
    note: String(raw.note ?? "").slice(0, 400),
  };
}

/**
 * A usable list: exactly one default (created if none), no class in two
 * schemes (the first keeps it), no duplicate ids. The default may name
 * classes too — it is simply also the fallback for every class no scheme
 * names.
 */
export function normalizeAssessmentSchemes(
  list: unknown,
  passPercent: number,
): AssessmentScheme[] {
  const rows = (Array.isArray(list) ? list : [])
    .map((s) => normalizeAssessmentScheme(s as Partial<AssessmentScheme>, passPercent));
  const seenIds = new Set<string>();
  const seenClasses = new Set<string>();
  const out: AssessmentScheme[] = [];
  let hasDefault = false;
  for (const s of rows) {
    if (seenIds.has(s.id)) continue;
    seenIds.add(s.id);
    const classIds = s.classIds.filter((c) => (seenClasses.has(c) ? false : (seenClasses.add(c), true)));
    const isDefault = s.isDefault && !hasDefault;
    if (isDefault) hasDefault = true;
    out.push({ ...s, classIds, isDefault });
  }
  if (!hasDefault) out.unshift(defaultAssessmentScheme(passPercent));
  // Default first, then by name.
  return out.sort((a, b) =>
    a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1,
  );
}

export function schemeForClass(
  classId: string,
  schemes: AssessmentScheme[],
): AssessmentScheme {
  return (
    schemes.find((s) => s.classIds.includes(classId)) ??
    schemes.find((s) => s.isDefault) ??
    defaultAssessmentScheme()
  );
}

/** Does this exam belong to the scheme's classes? */
export function schemeIncludesTerm(scheme: AssessmentScheme, termId: string): boolean {
  return scheme.termIds.length === 0 || scheme.termIds.includes(termId);
}

export function effectivePassPercent(scheme: AssessmentScheme, policyPass: number): number {
  return scheme.passPercent ?? policyPass;
}

/* ------------------------------------------------------------- presets */

export type SchemePreset = {
  key: string;
  label: string;
  /** CLASS_GROUPS code the preset is meant for; the school may re-assign. */
  band: "PRE_PRIMARY" | "PRIMARY" | "MIDDLE" | "SECONDARY" | "SENIOR";
  summary: string;
  build: (passPercent: number) => Partial<AssessmentScheme>;
};

export const SCHEME_PRESETS: SchemePreset[] = [
  {
    key: "pre_primary_descriptors",
    label: "Pre-primary · descriptors (NCF-FS / HPC)",
    band: "PRE_PRIMARY",
    summary: "No marks. Each learning area rated on a 3-band descriptor; no detention; no rank.",
    build: () => ({
      name: "Pre-primary (Nursery–UKG)",
      gradeScale: "three",
      gradeBands: [
        { grade: "A", minPercent: 75, label: "Exceeds expectations" },
        { grade: "B", minPercent: 50, label: "Meets expectations" },
        { grade: "C", minPercent: 0, label: "Working towards expectations" },
      ],
      displayMode: "descriptors",
      components: [],
      componentsApplyTo: "term_exams",
      passPercent: null,
      passEachComponent: false,
      requireAllSubjectsPass: false,
      promotionRule: "no_detention",
      showRank: false,
      showClassAverage: false,
      showResultOnCard: true,
      coScholasticAreas: [],
      termIds: [],
      note: "Observational assessment. Teachers pick a band per learning area; no numbers are printed.",
    }),
  },
  {
    key: "primary_grades_only",
    label: "Classes I–II · grades only (5-point)",
    band: "PRIMARY",
    summary: "Marks are entered but the card prints grades only; no detention.",
    build: (p) => ({
      name: "Classes I–II",
      gradeScale: "five",
      gradeBands: gradeBandsForPreset("five", p),
      displayMode: "grade_only",
      components: [],
      componentsApplyTo: "term_exams",
      passPercent: null,
      passEachComponent: false,
      requireAllSubjectsPass: false,
      promotionRule: "no_detention",
      showRank: false,
      showClassAverage: false,
      showResultOnCard: true,
      coScholasticAreas: CBSE_CO_SCHOLASTIC_AREAS.filter((a) => a.code !== "WE"),
      termIds: [],
      note: "",
    }),
  },
  {
    key: "primary_marks",
    label: "Classes III–V · marks + 8-point grade",
    band: "PRIMARY",
    summary: "Whole marks per subject, A1–E grade, co-scholastic A–C, no detention.",
    build: (p) => ({
      name: "Classes III–V",
      gradeScale: "cbse8",
      gradeBands: gradeBandsForPreset("cbse8", p),
      displayMode: "marks_grade",
      components: [],
      componentsApplyTo: "term_exams",
      passPercent: null,
      passEachComponent: false,
      requireAllSubjectsPass: null,
      promotionRule: "no_detention",
      showRank: false,
      showClassAverage: true,
      showResultOnCard: true,
      coScholasticAreas: CBSE_CO_SCHOLASTIC_AREAS,
      termIds: [],
      note: "",
    }),
  },
  {
    key: "cbse_middle",
    label: "Classes VI–VIII · CBSE 80 + 20",
    band: "MIDDLE",
    summary: "Term exam 80 + periodic test 10 + notebook 5 + subject enrichment 5; A1–E; re-exam before detention (V/VIII amendment) or no detention.",
    build: (p) => ({
      name: "Classes VI–VIII (CBSE)",
      gradeScale: "cbse8",
      gradeBands: gradeBandsForPreset("cbse8", p),
      displayMode: "marks_grade",
      components: [
        { code: "TE", label: "Term exam", maxMarks: 80, kind: "exam" },
        { code: "PT", label: "Periodic test", maxMarks: 10, kind: "internal" },
        { code: "NB", label: "Notebook", maxMarks: 5, kind: "internal" },
        { code: "SE", label: "Subject enrichment", maxMarks: 5, kind: "internal" },
      ],
      componentsApplyTo: "term_exams",
      passPercent: null,
      passEachComponent: false,
      requireAllSubjectsPass: null,
      promotionRule: "no_detention",
      showRank: false,
      showClassAverage: true,
      showResultOnCard: true,
      coScholasticAreas: CBSE_CO_SCHOLASTIC_AREAS,
      termIds: [],
      note: "Unit tests stay single-mark; the 80 + 20 split applies to Half-yearly and Annual.",
    }),
  },
  {
    key: "cbse_secondary",
    label: "Classes IX–X · CBSE 80 + 20 internal",
    band: "SECONDARY",
    summary: "Annual 80 + periodic assessment 5 + multiple assessment 5 + portfolio 5 + subject enrichment 5; 33 % pass; detained on failure.",
    build: (p) => ({
      name: "Classes IX–X (CBSE)",
      gradeScale: "cbse8",
      gradeBands: gradeBandsForPreset("cbse8", p),
      displayMode: "marks_grade",
      components: [
        { code: "TH", label: "Theory / annual", maxMarks: 80, kind: "exam" },
        { code: "PA", label: "Periodic assessment", maxMarks: 5, kind: "internal" },
        { code: "MA", label: "Multiple assessment", maxMarks: 5, kind: "internal" },
        { code: "PF", label: "Portfolio", maxMarks: 5, kind: "internal" },
        { code: "SE", label: "Subject enrichment", maxMarks: 5, kind: "internal" },
      ],
      componentsApplyTo: "term_exams",
      passPercent: 33,
      passEachComponent: false,
      requireAllSubjectsPass: true,
      promotionRule: "detain_on_fail",
      showRank: false,
      showClassAverage: true,
      showResultOnCard: true,
      coScholasticAreas: CBSE_CO_SCHOLASTIC_AREAS,
      termIds: [],
      note: "",
    }),
  },
  {
    key: "cbse_senior",
    label: "Classes XI–XII · theory + practical",
    band: "SENIOR",
    summary: "Theory 70 + practical 30 (edit per school: 80 + 20, 60 + 40); 33 % in each separately; detained on failure.",
    build: (p) => ({
      name: "Classes XI–XII (CBSE)",
      gradeScale: "cbse8",
      gradeBands: gradeBandsForPreset("cbse8", p),
      displayMode: "marks_grade",
      components: [
        { code: "TH", label: "Theory", maxMarks: 70, kind: "exam" },
        { code: "PR", label: "Practical / project", maxMarks: 30, kind: "internal" },
      ],
      componentsApplyTo: "term_exams",
      passPercent: 33,
      passEachComponent: true,
      requireAllSubjectsPass: true,
      promotionRule: "detain_on_fail",
      showRank: false,
      showClassAverage: true,
      showResultOnCard: true,
      coScholasticAreas: CBSE_CO_SCHOLASTIC_AREAS,
      termIds: [],
      note: "Subjects without a practical: set that component to 0 on the subject later, or use a separate scheme.",
    }),
  },
];

export function schemeFromPreset(
  preset: SchemePreset,
  passPercent: number,
  classIds: string[],
): AssessmentScheme {
  return normalizeAssessmentScheme(
    {
      ...defaultAssessmentScheme(passPercent),
      ...preset.build(passPercent),
      id: `scheme_${preset.key}_${Math.random().toString(36).slice(2, 8)}`,
      classIds,
      isDefault: false,
    },
    passPercent,
  );
}

/** A fresh scheme with the default settings, no classes, a new id. */
export function blankScheme(passPercent: number, name = "New scheme"): AssessmentScheme {
  return {
    ...defaultAssessmentScheme(passPercent),
    id: `scheme_${Math.random().toString(36).slice(2, 10)}`,
    name,
    isDefault: false,
    classIds: [],
  };
}

/** A copy of a scheme under a new id, no classes (they cannot be in two). */
export function duplicateScheme(source: AssessmentScheme): AssessmentScheme {
  return {
    ...source,
    id: `scheme_${Math.random().toString(36).slice(2, 10)}`,
    name: `${source.name} (copy)`.slice(0, 60),
    isDefault: false,
    classIds: [],
  };
}

export function displayModeLabel(mode: DisplayMode): string {
  return mode === "marks_grade"
    ? "Marks + grade"
    : mode === "grade_only"
      ? "Grade only"
      : "Descriptors";
}

export function promotionRuleLabel(rule: PromotionRule): string {
  return rule === "no_detention"
    ? "No detention (RTE)"
    : rule === "reexam_then_detain"
      ? "Re-examination, then detain"
      : "Detain on failure";
}

export function gradeScaleLabel(scale: GradeScalePreset): string {
  return scale === "cbse8"
    ? "8-point A1–E (CBSE)"
    : scale === "five"
      ? "5-point A–E"
      : scale === "three"
        ? "3-point A–C"
        : "Custom bands";
}

/** Short human summary for a list row: "80+20 · A1–E · marks+grade · no detention". */
export function schemeSummary(scheme: AssessmentScheme): string {
  const parts: string[] = [];
  if (scheme.components.length) {
    parts.push(scheme.components.map((c) => c.maxMarks).join("+"));
  } else {
    parts.push("single mark");
  }
  parts.push(gradeScaleLabel(scheme.gradeScale).split(" ")[0]!);
  parts.push(displayModeLabel(scheme.displayMode).toLowerCase());
  parts.push(promotionRuleLabel(scheme.promotionRule).toLowerCase());
  if (scheme.showRank) parts.push("rank");
  return parts.join(" · ");
}
