/**
 * Nucleus "Assessments & Answer key" — which papers LEAD has prepared for each
 * class, division and subject, and which are still missing.
 *
 * The office needs this BEFORE an exam week, not during it: a paper that says
 * "Not Created" a fortnight out is a decision (write our own, or ask LEAD); the
 * same line discovered on the morning of the exam is a crisis.
 *
 * Read the same way as the timeliness table: the principal copies the table,
 * this file turns it into rows. Statuses are kept exactly as Nucleus words
 * them, so nothing here has to guess what "Ready to Download" implies.
 */

export type AssessmentStatus = "ready" | "not_created" | "other";

export type NucleusAssessmentRow = {
  classLabel: string;
  division: string;
  subject: string;
  /** "Formative Assessment 1 - Set 2", "Summative Assessment 1 - Set 1" */
  title: string;
  /** "2 Chapters" as printed, or "" when Nucleus shows a dash. */
  chapters: string;
  /** Nucleus's own wording, kept verbatim for the screen. */
  statusText: string;
  status: AssessmentStatus;
};

export type AssessmentParseResult = {
  rows: NucleusAssessmentRow[];
  errors: string[];
};

const STATUS_WORDS: { re: RegExp; status: AssessmentStatus }[] = [
  { re: /ready to download/i, status: "ready" },
  { re: /not created/i, status: "not_created" },
];

function classifyStatus(text: string): AssessmentStatus {
  for (const s of STATUS_WORDS) if (s.re.test(text)) return s.status;
  return "other";
}

/** A dash is Nucleus's "nothing here", not a value. */
function cell(value: string | undefined): string {
  const v = (value ?? "").trim();
  return v === "-" || v === "–" ? "" : v;
}

/**
 * Read a pasted Assessments & Answer key table.
 *
 * Rows arrive as: class, division, subject, title, chapters, teacher, status,
 * then the "View Paper" link when there is a paper. The copy breaks cells over
 * several lines, so a row is gathered from the first cell until the next line
 * that looks like the start of one (a class label followed by a division).
 */
export function parseNucleusAssessments(text: string): AssessmentParseResult {
  const rows: NucleusAssessmentRow[] = [];
  const errors: string[] = [];

  // A row starts with a class and a single-letter division: "Nursery\tA\t…",
  // "Class 8\tA\t…". Everything up to the next such line belongs to it.
  const START =
    /^((?:class\s*)?(?:nursery|lkg|ukg|[ivx]+|\d{1,2}))\s*[\t|]\s*([a-z])\s*[\t|]\s*(.*)$/i;

  const lines = text.split(/\r?\n/);
  let current: { head: RegExpExecArray; body: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const classLabel = current.head[1]!.trim();
    const division = current.head[2]!.trim().toUpperCase();
    const body = [current.head[3] ?? "", ...current.body].join("\n");
    const cells = body
      .split(/\t|\n/)
      .map((c) => c.trim())
      .filter((c) => c && !/^view paper$/i.test(c));
    const subject = cell(cells[0]);
    const title = cell(cells[1]);
    const chapters = cell(cells[2]);
    const statusText = cells.find((c) => classifyStatus(c) !== "other") ?? "";
    const where = `${classLabel} ${division} · ${subject || "?"} · ${title || "?"}`;
    current = null;
    if (!subject || !title) {
      errors.push(`${where}: could not read the subject and paper name.`);
      return;
    }
    if (!statusText) {
      errors.push(`${where}: no status ("Ready to Download" / "Not Created") on this row.`);
      return;
    }
    rows.push({
      classLabel,
      division,
      subject,
      title,
      chapters,
      statusText,
      status: classifyStatus(statusText),
    });
  };

  for (const line of lines) {
    const m = START.exec(line.trim());
    if (m) {
      flush();
      current = { head: m, body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();

  return { rows, errors };
}

export type AssessmentGap = {
  classLabel: string;
  division: string;
  subject: string;
  /** The papers Nucleus has not prepared, e.g. ["Formative Assessment 2", …] */
  missing: string[];
};

export type AssessmentSummary = {
  rowCount: number;
  ready: number;
  notCreated: number;
  /** One line per class-division-subject that is missing at least one paper. */
  gaps: AssessmentGap[];
};

/** Group the "Not Created" lines the way the office reads them: by class, then subject. */
export function summariseAssessments(rows: NucleusAssessmentRow[]): AssessmentSummary {
  const byKey = new Map<string, AssessmentGap>();
  for (const r of rows) {
    if (r.status !== "not_created") continue;
    const key = `${r.classLabel}|${r.division}|${r.subject}`;
    const gap = byKey.get(key) ?? {
      classLabel: r.classLabel,
      division: r.division,
      subject: r.subject,
      missing: [],
    };
    gap.missing.push(r.title);
    byKey.set(key, gap);
  }
  return {
    rowCount: rows.length,
    ready: rows.filter((r) => r.status === "ready").length,
    notCreated: rows.filter((r) => r.status === "not_created").length,
    gaps: [...byKey.values()].sort(
      (a, b) =>
        b.missing.length - a.missing.length ||
        a.classLabel.localeCompare(b.classLabel) ||
        a.subject.localeCompare(b.subject),
    ),
  };
}
