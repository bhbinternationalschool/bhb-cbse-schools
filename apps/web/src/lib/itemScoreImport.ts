/**
 * Item-score grid import — CSV / TSV pasted from a spreadsheet or exported
 * by an OMR tool. One row per student, one column per question. Pure.
 *
 * Matching is by admission number, then roll number, then exact full name;
 * a row that matches nothing is reported, never guessed. Marks above the
 * question's max or non-numeric are reported and skipped; blank = not
 * marked (null), "A"/"AB"/"ABS" = absent → null.
 */

export type ImportStudent = { id: string; admissionNo: string; rollNo: string; fullName: string };
export type ImportQuestion = { id: string; marks: number };

export type ItemScoreImportResult = {
  scores: { studentId: string; questionId: string; marks: number | null }[];
  matched: number;
  /** Row numbers (1-based, excluding header) that matched no student */
  unmatchedRows: { row: number; key: string }[];
  /** Cell problems: row, question, raw value, reason */
  problems: { row: number; question: string; value: string; reason: string }[];
  /** Question columns found in the header, e.g. ["Q1","Q2"] */
  questionColumns: string[];
};

function splitLine(line: string, delim: string): string[] {
  // Minimal CSV: handles quoted fields with commas; TSV needs no quoting.
  if (delim === "\t") return line.split("\t").map((c) => c.trim());
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const ABSENT = new Set(["a", "ab", "abs", "absent", "-", "—"]);

export function parseItemScoreGrid(
  text: string,
  ctx: { students: ImportStudent[]; questions: ImportQuestion[] },
): ItemScoreImportResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  const res: ItemScoreImportResult = { scores: [], matched: 0, unmatchedRows: [], problems: [], questionColumns: [] };
  if (lines.length < 2) return res;
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const header = splitLine(lines[0], delim).map((h) => h.trim());
  // Question columns: "Q1", "q 2", "Q3 (/4)" → index 1..n
  const qCols: { col: number; qIndex: number }[] = [];
  header.forEach((h, col) => {
    const m = h.match(/^q\s*(\d+)/i);
    if (m) {
      const qIndex = Number(m[1]) - 1;
      if (qIndex >= 0 && qIndex < ctx.questions.length) qCols.push({ col, qIndex });
    }
  });
  res.questionColumns = qCols.map(({ col }) => header[col]);
  if (qCols.length === 0) return res;
  const idCols = header
    .map((h, i) => ({ h: h.toLowerCase(), i }))
    .filter(({ h }) => /adm|roll|name|student/.test(h))
    .map(({ i }) => i);

  const byAdm = new Map(ctx.students.filter((s) => s.admissionNo).map((s) => [s.admissionNo.trim().toLowerCase(), s]));
  const byRoll = new Map(ctx.students.filter((s) => s.rollNo).map((s) => [s.rollNo.trim().toLowerCase(), s]));
  const byName = new Map(ctx.students.map((s) => [s.fullName.trim().toLowerCase().replace(/\s+/g, " "), s]));

  for (let r = 1; r < lines.length; r++) {
    const cells = splitLine(lines[r], delim);
    // Try every id-ish column, then any non-question column, in order.
    const candidates = (idCols.length ? idCols : cells.map((_, i) => i).filter((i) => !qCols.some((q) => q.col === i)))
      .map((i) => (cells[i] ?? "").trim())
      .filter(Boolean);
    let student: ImportStudent | undefined;
    for (const c of candidates) {
      const k = c.toLowerCase().replace(/\s+/g, " ");
      student = byAdm.get(k) ?? byRoll.get(k) ?? byName.get(k);
      if (student) break;
    }
    if (!student) {
      res.unmatchedRows.push({ row: r, key: candidates[0] ?? "" });
      continue;
    }
    res.matched += 1;
    for (const { col, qIndex } of qCols) {
      const raw = (cells[col] ?? "").trim();
      const q = ctx.questions[qIndex];
      if (raw === "" || ABSENT.has(raw.toLowerCase())) {
        res.scores.push({ studentId: student.id, questionId: q.id, marks: null });
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        res.problems.push({ row: r, question: header[col], value: raw, reason: "not a number" });
        continue;
      }
      if (n < 0) {
        res.problems.push({ row: r, question: header[col], value: raw, reason: "negative" });
        continue;
      }
      if (n > q.marks) {
        res.problems.push({ row: r, question: header[col], value: raw, reason: `above max ${q.marks}` });
        continue;
      }
      res.scores.push({ studentId: student.id, questionId: q.id, marks: n });
    }
  }
  return res;
}

/** CSV template: one row per student, blank question cells. */
export function itemScoreTemplateCsv(students: ImportStudent[], questions: ImportQuestion[]): string {
  const head = ["Admission No", "Roll", "Student", ...questions.map((q, i) => `Q${i + 1} (/${q.marks})`)];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = students.map((s) => [s.admissionNo, s.rollNo, s.fullName, ...questions.map(() => "")].map(esc).join(","));
  return [head.map(esc).join(","), ...rows].join("\n");
}
