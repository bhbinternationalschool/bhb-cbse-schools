/**
 * Nucleus "Teacher Timeliness" — the publisher's reading of how far each
 * class-subject has got through its day plans.
 *
 * LEAD has no API and their login sits behind reCAPTCHA, so nothing here logs
 * in. The principal copies the table out of Nucleus and pastes it; this file
 * turns that paste into rows. When a session token's shape is known the same
 * row type will come from their JSON instead — the store and the screen do not
 * care which.
 *
 * A paste that does not parse must SAY SO, line by line: a silent half-import
 * would leave the principal reading last month's numbers as if they were this
 * week's.
 */

import { num, readCapture, str } from "@/lib/nucleusCapture";

export type NucleusProgressRow = {
  /** Nucleus's own row number, kept so two readings can be diffed in order. */
  position: number;
  teacherName: string;
  /** "Class1-Propel Hindi" → "Class1" and "Propel Hindi", as they spell them. */
  classLabel: string;
  subjectLabel: string;
  totalPlans: number;
  requiredPlans: number;
  currentPlans: number;
  /** current − required. Positive = ahead, negative = behind. */
  gapPlans: number;
};

export type NucleusParseResult = {
  rows: NucleusProgressRow[];
  /** One line per row that could not be read, naming what was wrong. */
  errors: string[];
};

/** "35% Course (49/140 day plans)" → { done: 49, total: 140 } */
const PROGRESS = /(\d+)\s*%\s*Course\s*\((\d+)\s*\/\s*(\d+)\s*day plans\)/gi;

/** "39 Day Plans Behind", "1 Day Plan Ahead", "On Schedule" */
const STATUS = /(\d+)\s*Day Plans?\s*(Behind|Ahead)|On\s*Schedule/i;

/**
 * Split the paste into one chunk per row. Nucleus numbers its rows 1..N in the
 * first column, so a line that is just a number starts a row. Everything until
 * the next such line belongs to it — the table wraps each cell over several
 * lines and sprinkles blank ones.
 */
function chunk(text: string): { position: number; body: string }[] {
  const lines = text.split(/\r?\n/);
  const out: { position: number; body: string[] }[] = [];
  for (const line of lines) {
    const t = line.trim();
    const m = /^(\d{1,3})(?:\s*[\t|]\s*(.*))?$/.exec(t);
    if (m && (!m[2] || m[2].trim())) {
      // A bare number, or a number followed by the rest of the row on one line.
      out.push({ position: Number(m[1]), body: m[2] ? [m[2]] : [] });
      continue;
    }
    if (out.length) out[out.length - 1]!.body.push(line);
  }
  return out.map((c) => ({ position: c.position, body: c.body.join("\n") }));
}

/** "Class1-Propel Hindi" → ["Class1", "Propel Hindi"]; no dash → whole as subject. */
function splitClassSubject(cell: string): { classLabel: string; subjectLabel: string } {
  const s = cell.trim();
  const dash = s.indexOf("-");
  if (dash < 0) return { classLabel: "", subjectLabel: s };
  return {
    classLabel: s.slice(0, dash).trim(),
    subjectLabel: s.slice(dash + 1).trim(),
  };
}

/**
 * The teacher's name and the class-subject are the first two text cells before
 * the first "…% Course (…)". Tabs separate them when the paste keeps them;
 * when it does not, they arrive on their own lines.
 */
function namesFrom(head: string): { teacherName: string; classSubject: string } {
  const cells = head
    .split(/\t|\n/)
    .map((c) => c.trim())
    .filter(Boolean);
  return { teacherName: cells[0] ?? "", classSubject: cells[1] ?? "" };
}

/**
 * Read a pasted Teacher Timeliness table.
 *
 * Tolerant of how the copy arrives (tabs or line breaks, blank lines, the
 * header row, the chart's axis labels above it), strict about what a row must
 * contain: a teacher, a class-subject, and two progress figures over the same
 * total. Nucleus's own "N Day Plans Behind" is used as a CHECK, not as the
 * number stored — if its arithmetic disagrees with (current − required), the
 * row is rejected and named, rather than quietly trusting one of them.
 */
/**
 * A reading captured by the bookmark, rather than copied as a table.
 *
 * The bookmark reads the same table cell by cell, so the numbers arrive as
 * numbers. A row missing them is still refused by name: a capture is easier
 * to trust than a clipboard, not exempt from being checked.
 */
function fromCapture(rows: unknown[]): NucleusParseResult {
  const out: NucleusProgressRow[] = [];
  const errors: string[] = [];
  for (const [i, raw] of rows.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const teacherName = str(r.teacherName, 120);
    const classLabel = str(r.classLabel, 60);
    const subjectLabel = str(r.subjectLabel, 80);
    const totalPlans = num(r.totalPlans);
    const requiredPlans = num(r.requiredPlans);
    const currentPlans = num(r.currentPlans);
    const who = [classLabel, subjectLabel].filter(Boolean).join(" ") || `row ${i + 1}`;

    if (!teacherName || !classLabel || !subjectLabel) {
      errors.push(`${who}: missing teacher, class or subject`);
      continue;
    }
    if (!totalPlans) {
      errors.push(`${who}: no day-plan total`);
      continue;
    }
    out.push({
      position: num(r.position) || i + 1,
      teacherName,
      classLabel,
      subjectLabel,
      totalPlans,
      requiredPlans,
      currentPlans,
      // Trust the arithmetic over a sentence: "40 Day Plans Behind" is the
      // same fact as current minus required, and one of them can be stale.
      gapPlans: currentPlans - requiredPlans,
    });
  }
  return { rows: out, errors };
}

export function parseNucleusTimeliness(text: string): NucleusParseResult {
  const capture = readCapture(text);
  if (capture?.timeliness) return fromCapture(capture.timeliness);

  const rows: NucleusProgressRow[] = [];
  const errors: string[] = [];
  const seen = new Set<number>();

  for (const c of chunk(text)) {
    const progress = [...c.body.matchAll(PROGRESS)];
    if (progress.length === 0) continue; // chart labels, headers, page furniture
    const where = `Row ${c.position}`;
    if (progress.length < 2) {
      errors.push(`${where}: only one progress figure — expected required and current.`);
      continue;
    }
    const required = { done: Number(progress[0]![2]), total: Number(progress[0]![3]) };
    const current = { done: Number(progress[1]![2]), total: Number(progress[1]![3]) };
    if (required.total !== current.total) {
      errors.push(
        `${where}: the two figures count different courses (${required.total} vs ${current.total} day plans).`,
      );
      continue;
    }
    const head = c.body.slice(0, progress[0]!.index ?? 0);
    const { teacherName, classSubject } = namesFrom(head);
    if (!teacherName || !classSubject) {
      errors.push(`${where}: could not read the teacher name and class/subject.`);
      continue;
    }
    const gap = current.done - required.done;

    // Cross-check against Nucleus's own wording when the paste carried it.
    const status = STATUS.exec(c.body.slice(progress[1]!.index ?? 0));
    if (status && status[1]) {
      const stated = Number(status[1]) * (/Behind/i.test(status[2] ?? "") ? -1 : 1);
      if (stated !== gap) {
        errors.push(
          `${where}: Nucleus says ${status[1]} day plans ${status[2]?.toLowerCase()}, but the figures give ${Math.abs(gap)} ${gap < 0 ? "behind" : "ahead"}.`,
        );
        continue;
      }
    }
    if (seen.has(c.position)) {
      errors.push(`${where}: appears twice in the paste.`);
      continue;
    }
    seen.add(c.position);

    const { classLabel, subjectLabel } = splitClassSubject(classSubject);
    rows.push({
      position: c.position,
      teacherName,
      classLabel,
      subjectLabel,
      totalPlans: required.total,
      requiredPlans: required.done,
      currentPlans: current.done,
      gapPlans: gap,
    });
  }

  rows.sort((a, b) => a.position - b.position);
  return { rows, errors };
}

/** How far behind counts as "the principal should look". */
export const BEHIND_THRESHOLD = 10;

export type NucleusSummary = {
  rowCount: number;
  behind: NucleusProgressRow[];
  ahead: number;
  onTrack: number;
  /** Worst first — the screen leads with these. */
  worst: NucleusProgressRow[];
};

export function summariseNucleus(rows: NucleusProgressRow[]): NucleusSummary {
  const behind = rows.filter((r) => r.gapPlans <= -BEHIND_THRESHOLD);
  return {
    rowCount: rows.length,
    behind,
    ahead: rows.filter((r) => r.gapPlans > 0).length,
    onTrack: rows.filter((r) => r.gapPlans <= 0 && r.gapPlans > -BEHIND_THRESHOLD).length,
    worst: [...behind].sort((a, b) => a.gapPlans - b.gapPlans).slice(0, 10),
  };
}

/**
 * A reading is of a date, not of today. Over a week old and the screen says so
 * rather than showing the numbers as current.
 */
export function readingIsStale(capturedOn: string, today: string, days = 7): boolean {
  const a = Date.parse(`${capturedOn}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  return b - a > days * 86_400_000;
}
