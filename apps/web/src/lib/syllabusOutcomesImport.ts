/**
 * Learning outcomes + CBSE LO codes import for one class × subject —
 * CSV/TSV with columns: chapter code, chapter title, learning outcomes
 * (separate lines with ";" or "|"), LO codes (comma-separated). Rows match
 * an existing chapter by code (case-insensitive) or exact title; unmatched
 * rows become new chapters. Pure: returns the next TeachingState.
 *
 * Codes are copied verbatim (uppercased) — the ERP never invents them; the
 * source is the board's LO document or the school's own mapping sheet.
 */

import { upsertSyllabusUnit, type SyllabusUnit, type TeachingState } from "@/lib/teaching";

export type OutcomesImportRow = { code: string; title: string; outcomes: string[]; codes: string[] };

function splitLine(line: string, delim: string): string[] {
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

export function parseOutcomesCsv(text: string): { rows: OutcomesImportRow[]; error?: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], error: "Need a header row and at least one chapter row" };
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const header = splitLine(lines[0], delim).map((h) => h.toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const cCode = col(/code$|^code|chapter code|ch\.? ?no|unit code/);
  const cTitle = col(/title|chapter name|chapter$|unit$|name/);
  const cOut = col(/outcome|learning/);
  const cCodes = col(/lo code|competenc|lo$|codes/);
  if (cTitle < 0 && cCode < 0) return { rows: [], error: "Header needs a chapter title or code column" };
  if (cOut < 0 && cCodes < 0) return { rows: [], error: "Header needs a 'learning outcomes' or 'LO codes' column" };
  const rows: OutcomesImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitLine(lines[i], delim);
    const title = cTitle >= 0 ? c[cTitle] ?? "" : "";
    const code = cCode >= 0 ? c[cCode] ?? "" : "";
    if (!title && !code) continue;
    const outcomes = (cOut >= 0 ? c[cOut] ?? "" : "")
      .split(/\s*[;|]\s*|\n/)
      .map((o) => o.trim())
      .filter(Boolean);
    const codes = Array.from(
      new Set(
        (cCodes >= 0 ? c[cCodes] ?? "" : "")
          .split(/[,\s;|]+/)
          .map((x) => x.trim().toUpperCase())
          .filter(Boolean),
      ),
    );
    rows.push({ code, title, outcomes, codes });
  }
  return { rows };
}

export function applyOutcomesImport(
  state: TeachingState,
  input: { academicYearCode: string; classId: string; subjectId: string; rows: OutcomesImportRow[]; replaceOutcomes?: boolean },
): { state: TeachingState; updated: number; created: number; errors: string[] } {
  let next = state;
  let updated = 0;
  let created = 0;
  const errors: string[] = [];
  const mine = () =>
    next.units.filter(
      (u) =>
        u.isActive &&
        u.academicYearCode === input.academicYearCode &&
        u.classId === input.classId &&
        u.subjectId === input.subjectId &&
        u.level === "chapter",
    );
  for (const row of input.rows) {
    const byCode = row.code
      ? mine().find((u) => u.code.trim().toLowerCase() === row.code.trim().toLowerCase())
      : undefined;
    const byTitle = row.title
      ? mine().find((u) => u.title.trim().toLowerCase() === row.title.trim().toLowerCase())
      : undefined;
    const existing: SyllabusUnit | undefined = byCode ?? byTitle;
    const learningOutcomes = existing && !input.replaceOutcomes && existing.learningOutcomes.trim()
      ? Array.from(new Set([...existing.learningOutcomes.split("\n").map((l) => l.trim()).filter(Boolean), ...row.outcomes])).join("\n")
      : row.outcomes.join("\n");
    const competencyCodes = existing
      ? Array.from(new Set([...existing.competencyCodes, ...row.codes]))
      : row.codes;
    const r = upsertSyllabusUnit(next, {
      ...(existing ?? {
        academicYearCode: input.academicYearCode,
        classId: input.classId,
        subjectId: input.subjectId,
        level: "chapter",
        parentId: null,
        code: row.code,
        title: row.title || row.code,
      }),
      learningOutcomes,
      competencyCodes,
    });
    if (!r.ok) {
      errors.push(`${row.code || row.title}: ${r.error}`);
      continue;
    }
    next = r.value.state;
    if (existing) updated += 1;
    else created += 1;
  }
  return { state: next, updated, created, errors };
}
