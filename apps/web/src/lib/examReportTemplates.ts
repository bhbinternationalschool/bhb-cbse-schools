/**
 * Report card templates — how a class's printed card LOOKS, chosen by the
 * school per class (or per band at once).
 *
 * The assessment scheme (lib/examSchemes.ts) says how a class is assessed:
 * scale, components, pass and promotion rules. The template says what the
 * printed card carries and in which layout: the title, which identity
 * fields, whether the photo, attendance, co-scholastic areas, remarks,
 * component breakdown, rank, average and result appear, the signature
 * lines and a footer note. Several prefilled templates ship; every field
 * stays editable; "Classic" reproduces the card as it printed before.
 *
 * Where a template and a scheme both have a switch (photo, attendance,
 * rank, average, result), the template's tri-state wins when set and
 * otherwise defers to the scheme — so a school that only ever touches the
 * scheme keeps getting what it chose there.
 *
 * Pure: no storage; imported by exams.ts.
 */

export type CardLayout =
  /** Subject table with Max / Obtained / Grade, summary strip, remarks, signatures. */
  | "classic"
  /** Holistic Progress Card: learning areas with descriptors, no numbers, remarks first. */
  | "hpc"
  /** Dense one-page: smaller type, no watermark, table only. */
  | "compact"
  /** Term-wise: one column per contributing exam plus the total (aggregate cards). */
  | "termwise";

export type ReportCardTemplate = {
  id: string;
  name: string;
  classIds: string[];
  isDefault: boolean;
  layout: CardLayout;
  title: string;
  subtitle: string;
  // Identity block
  showPhoto: boolean | null;
  showParents: boolean;
  showAdmissionNo: boolean;
  showRollNo: boolean;
  showDob: boolean;
  showHealth: boolean;
  // Body
  showComponents: boolean;
  showSubjectRemarks: boolean;
  showGradeLegend: boolean;
  showPercent: boolean;
  showOverallGrade: boolean;
  showAttendance: boolean | null;
  showRank: boolean | null;
  showClassAverage: boolean | null;
  showResult: boolean | null;
  showCoScholastic: boolean;
  showRemarks: boolean;
  // Foot
  showSignatures: boolean;
  signatureLabels: string[];
  footerNote: string;
  showWatermark: boolean;
};

export const DEFAULT_TEMPLATE_ID = "tpl_classic";

const LAYOUTS: CardLayout[] = ["classic", "hpc", "compact", "termwise"];

export function layoutLabel(layout: CardLayout): string {
  return layout === "classic"
    ? "Classic table"
    : layout === "hpc"
      ? "Holistic Progress Card"
      : layout === "compact"
        ? "Compact one-page"
        : "Term-wise columns";
}

export function defaultReportCardTemplate(): ReportCardTemplate {
  return {
    id: DEFAULT_TEMPLATE_ID,
    name: "Classic",
    classIds: [],
    isDefault: true,
    layout: "classic",
    title: "Progress report",
    subtitle: "",
    showPhoto: null,
    showParents: true,
    showAdmissionNo: true,
    showRollNo: false,
    showDob: false,
    showHealth: false,
    showComponents: true,
    showSubjectRemarks: true,
    showGradeLegend: false,
    showPercent: true,
    showOverallGrade: true,
    showAttendance: null,
    showRank: null,
    showClassAverage: null,
    showResult: null,
    showCoScholastic: true,
    showRemarks: true,
    showSignatures: true,
    signatureLabels: ["Class teacher", "Examination in-charge", "Principal"],
    footerNote: "",
    showWatermark: true,
  };
}

function tri(v: unknown): boolean | null {
  return v == null ? null : !!v;
}

export function normalizeReportCardTemplate(
  raw: Partial<ReportCardTemplate> | null | undefined,
): ReportCardTemplate {
  const d = defaultReportCardTemplate();
  if (!raw) return d;
  const labels = Array.isArray(raw.signatureLabels)
    ? raw.signatureLabels.map((l) => String(l ?? "").trim().slice(0, 40)).filter(Boolean).slice(0, 4)
    : d.signatureLabels;
  return {
    id: String(raw.id || d.id),
    name: String(raw.name ?? d.name).trim().slice(0, 60) || d.name,
    classIds: Array.isArray(raw.classIds) ? raw.classIds.map(String).filter(Boolean) : [],
    isDefault: !!raw.isDefault,
    layout: LAYOUTS.includes(raw.layout as CardLayout) ? (raw.layout as CardLayout) : "classic",
    title: String(raw.title ?? d.title).trim().slice(0, 60) || d.title,
    subtitle: String(raw.subtitle ?? "").trim().slice(0, 120),
    showPhoto: tri(raw.showPhoto),
    showParents: raw.showParents !== false,
    showAdmissionNo: raw.showAdmissionNo !== false,
    showRollNo: !!raw.showRollNo,
    showDob: !!raw.showDob,
    showHealth: !!raw.showHealth,
    showComponents: raw.showComponents !== false,
    showSubjectRemarks: raw.showSubjectRemarks !== false,
    showGradeLegend: !!raw.showGradeLegend,
    showPercent: raw.showPercent !== false,
    showOverallGrade: raw.showOverallGrade !== false,
    showAttendance: tri(raw.showAttendance),
    showRank: tri(raw.showRank),
    showClassAverage: tri(raw.showClassAverage),
    showResult: tri(raw.showResult),
    showCoScholastic: raw.showCoScholastic !== false,
    showRemarks: raw.showRemarks !== false,
    showSignatures: raw.showSignatures !== false,
    signatureLabels: labels.length ? labels : d.signatureLabels,
    footerNote: String(raw.footerNote ?? "").trim().slice(0, 300),
    showWatermark: raw.showWatermark !== false,
  };
}

/** One default (created if none), no class in two templates, no duplicate ids. */
export function normalizeReportCardTemplates(list: unknown): ReportCardTemplate[] {
  const rows = (Array.isArray(list) ? list : []).map((t) =>
    normalizeReportCardTemplate(t as Partial<ReportCardTemplate>),
  );
  const seenIds = new Set<string>();
  const seenClasses = new Set<string>();
  const out: ReportCardTemplate[] = [];
  let hasDefault = false;
  for (const t of rows) {
    if (seenIds.has(t.id)) continue;
    seenIds.add(t.id);
    const classIds = t.classIds.filter((c) => (seenClasses.has(c) ? false : (seenClasses.add(c), true)));
    const isDefault = t.isDefault && !hasDefault;
    if (isDefault) hasDefault = true;
    out.push({ ...t, classIds, isDefault });
  }
  if (!hasDefault) out.unshift(defaultReportCardTemplate());
  return out.sort((a, b) =>
    a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1,
  );
}

export function reportCardTemplateForClass(
  classId: string,
  templates: ReportCardTemplate[],
): ReportCardTemplate {
  return (
    templates.find((t) => t.classIds.includes(classId)) ??
    templates.find((t) => t.isDefault) ??
    defaultReportCardTemplate()
  );
}

/* ------------------------------------------------------------- presets */

export type TemplatePreset = {
  key: string;
  label: string;
  band: "PRE_PRIMARY" | "PRIMARY" | "MIDDLE" | "SECONDARY" | "SENIOR" | "ALL";
  summary: string;
  build: () => Partial<ReportCardTemplate>;
};

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    key: "classic",
    label: "Classic marks card",
    band: "ALL",
    summary: "Subject table with max, obtained and grade; percentage and overall grade; remarks; three signatures.",
    build: () => ({ name: "Classic marks card", layout: "classic" }),
  },
  {
    key: "hpc",
    label: "Holistic Progress Card (pre-primary / I–II)",
    band: "PRE_PRIMARY",
    summary: "Learning areas with descriptors, no numbers or percentage, photo, remarks first, no rank.",
    build: () => ({
      name: "Holistic Progress Card",
      layout: "hpc",
      title: "Holistic Progress Card",
      showPhoto: true,
      showRollNo: false,
      showDob: true,
      showHealth: true,
      showComponents: false,
      showGradeLegend: true,
      showPercent: false,
      showOverallGrade: false,
      showRank: false,
      showClassAverage: false,
      showCoScholastic: true,
      showRemarks: true,
      showWatermark: false,
      footerNote: "This card records the child's progress across learning areas; it is not a ranking.",
    }),
  },
  {
    key: "primary_grades",
    label: "Grades card (I–V)",
    band: "PRIMARY",
    summary: "Classic layout with a grade legend, attendance and remarks; no rank.",
    build: () => ({
      name: "Grades card",
      layout: "classic",
      showGradeLegend: true,
      showRank: false,
      showAttendance: true,
      showRollNo: true,
    }),
  },
  {
    key: "board_style",
    label: "Board-style card (VI–XII)",
    band: "SECONDARY",
    summary: "Component breakdown (80 + 20 / theory + practical), grade legend, roll number, result line, class average.",
    build: () => ({
      name: "Board-style card",
      layout: "classic",
      title: "Statement of marks",
      showComponents: true,
      showGradeLegend: true,
      showRollNo: true,
      showDob: true,
      showResult: true,
      showClassAverage: true,
      showSubjectRemarks: false,
    }),
  },
  {
    key: "termwise",
    label: "Term-wise consolidated card",
    band: "MIDDLE",
    summary: "One column per contributing exam plus the weighted total, for Half-yearly and Annual cards.",
    build: () => ({
      name: "Term-wise card",
      layout: "termwise",
      title: "Consolidated progress report",
      showComponents: true,
      showGradeLegend: true,
      showResult: true,
    }),
  },
  {
    key: "compact",
    label: "Compact one-page",
    band: "ALL",
    summary: "Smaller type, no watermark, table and summary only — for unit tests and quick printing.",
    build: () => ({
      name: "Compact one-page",
      layout: "compact",
      title: "Mark sheet",
      showPhoto: false,
      showParents: false,
      showSubjectRemarks: false,
      showCoScholastic: false,
      showRemarks: false,
      showWatermark: false,
      showSignatures: true,
      signatureLabels: ["Class teacher", "Principal"],
    }),
  },
];

export function templateFromPreset(
  preset: TemplatePreset,
  classIds: string[],
): ReportCardTemplate {
  return normalizeReportCardTemplate({
    ...defaultReportCardTemplate(),
    ...preset.build(),
    id: `tpl_${preset.key}_${Math.random().toString(36).slice(2, 8)}`,
    classIds,
    isDefault: false,
  });
}

export function blankTemplate(name = "New template"): ReportCardTemplate {
  return {
    ...defaultReportCardTemplate(),
    id: `tpl_${Math.random().toString(36).slice(2, 10)}`,
    name,
    isDefault: false,
    classIds: [],
  };
}

export function duplicateTemplate(source: ReportCardTemplate): ReportCardTemplate {
  return {
    ...source,
    id: `tpl_${Math.random().toString(36).slice(2, 10)}`,
    name: `${source.name} (copy)`.slice(0, 60),
    isDefault: false,
    classIds: [],
  };
}

/* ------------------------------------------------------- presentation */

/** Everything the printed card needs to decide what to show, resolved from
 * the template with the scheme's switches as fallback. */
export type CardPresentation = {
  templateId: string;
  templateName: string;
  layout: CardLayout;
  title: string;
  subtitle: string;
  showPhoto: boolean;
  showParents: boolean;
  showAdmissionNo: boolean;
  showRollNo: boolean;
  showDob: boolean;
  showHealth: boolean;
  showComponents: boolean;
  showSubjectRemarks: boolean;
  showGradeLegend: boolean;
  showPercent: boolean;
  showOverallGrade: boolean;
  showAttendance: boolean;
  showRank: boolean;
  showClassAverage: boolean;
  showResult: boolean;
  showCoScholastic: boolean;
  showRemarks: boolean;
  showSignatures: boolean;
  signatureLabels: string[];
  footerNote: string;
  showWatermark: boolean;
};

export function resolvePresentation(
  template: ReportCardTemplate,
  fallback: {
    showPhoto: boolean;
    showAttendance: boolean;
    showRank: boolean;
    showClassAverage: boolean;
    showResult: boolean;
  },
): CardPresentation {
  return {
    templateId: template.id,
    templateName: template.name,
    layout: template.layout,
    title: template.title,
    subtitle: template.subtitle,
    showPhoto: template.showPhoto ?? fallback.showPhoto,
    showParents: template.showParents,
    showAdmissionNo: template.showAdmissionNo,
    showRollNo: template.showRollNo,
    showDob: template.showDob,
    showHealth: template.showHealth,
    showComponents: template.showComponents,
    showSubjectRemarks: template.showSubjectRemarks,
    showGradeLegend: template.showGradeLegend,
    showPercent: template.showPercent,
    showOverallGrade: template.showOverallGrade,
    showAttendance: template.showAttendance ?? fallback.showAttendance,
    showRank: template.showRank ?? fallback.showRank,
    showClassAverage: template.showClassAverage ?? fallback.showClassAverage,
    showResult: template.showResult ?? fallback.showResult,
    showCoScholastic: template.showCoScholastic,
    showRemarks: template.showRemarks,
    showSignatures: template.showSignatures,
    signatureLabels: template.signatureLabels,
    footerNote: template.footerNote,
    showWatermark: template.showWatermark,
  };
}

/** Short row summary: "classic · photo · legend · 3 signatures". */
export function templateSummary(t: ReportCardTemplate): string {
  const bits = [layoutLabel(t.layout).toLowerCase()];
  if (t.showPhoto === true) bits.push("photo");
  if (t.showGradeLegend) bits.push("grade legend");
  if (t.showRank === true) bits.push("rank");
  if (t.showResult === true) bits.push("result");
  if (!t.showRemarks) bits.push("no remarks");
  if (!t.showWatermark) bits.push("no watermark");
  bits.push(`${t.showSignatures ? t.signatureLabels.length : 0} signatures`);
  return bits.join(" · ");
}
