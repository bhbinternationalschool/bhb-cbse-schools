/**
 * The capture an office user brings back from Nucleus.
 *
 * The publisher has no API and its login is behind a captcha, so nothing can
 * sign in unattended. What *can* be automated is everything after that: the
 * question papers and answer keys are public files, so once their addresses
 * are known the ERP fetches them itself, server-side, for as long as they
 * exist.
 *
 * So the office's job shrinks to producing this list — one click of a
 * bookmark on the Nucleus page — and pasting it here. This module is the
 * part that reads the paste and decides what it means. It does not fetch
 * anything; `app/api/exams/papers/from-nucleus` does that.
 */

export type NucleusManifestRow = {
  /** The publisher's own id for the paper; the file names carry it too. */
  paperId: string;
  classLabel: string;
  division: string;
  subject: string;
  /** "Summative Assessment 1 - Set 1" — the publisher's name for the paper. */
  title: string;
  /** "Assessment 1" / "MOY" — the publisher's grouping, a hint only. */
  unit: string;
  answerKeyUrl: string;
  questionPaperDocxUrl: string;
};

export type ReadManifestResult =
  | { ok: true; capturedOn: string; rows: NucleusManifestRow[]; ignored: string[] }
  | { ok: false; error: string };

/**
 * Only the publisher's own file store, over https.
 *
 * The paste is text a person carried in from another site, so it decides
 * what this server will go and download. Anything that is not the address of
 * a paper we expect is dropped, and the row it came from is reported rather
 * than silently skipped.
 */
const ALLOWED_HOST = "question-bank-assets.s3.amazonaws.com";

export function isPublisherFileUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === ALLOWED_HOST;
  } catch {
    return false;
  }
}

function text(v: unknown, max = 200): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Read a pasted capture.
 *
 * Nothing here trusts the paste: every row must name a class, a subject, a
 * title and at least one publisher URL, or it is ignored by name so the
 * person can see what was left out.
 */
export function readNucleusManifest(raw: string): ReadManifestResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Nothing pasted" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      error:
        "That does not look like a capture. Click the bookmark on the Nucleus page and paste what it copies.",
    };
  }

  const body = parsed as { capturedOn?: unknown; rows?: unknown };
  const list = Array.isArray(body?.rows) ? body.rows : null;
  if (!list) {
    return { ok: false, error: "The capture has no rows in it" };
  }

  const rows: NucleusManifestRow[] = [];
  const ignored: string[] = [];
  for (const item of list) {
    const r = item as Record<string, unknown>;
    const classLabel = text(r.classLabel, 40);
    const subject = text(r.subject, 60);
    const title = text(r.title, 200);
    const paper = text(r.questionPaperDocxUrl, 400);
    const key = text(r.answerKeyUrl, 400);
    const who = [classLabel, subject, title].filter(Boolean).join(" ") || "a row with no class or subject";

    if (!classLabel || !subject || !title) {
      ignored.push(`${who} — missing class, subject or title`);
      continue;
    }
    const paperOk = paper && isPublisherFileUrl(paper);
    const keyOk = key && isPublisherFileUrl(key);
    if (!paperOk && !keyOk) {
      ignored.push(`${who} — no usable publisher link`);
      continue;
    }
    rows.push({
      paperId: text(r.paperId, 40),
      classLabel,
      division: text(r.division, 20),
      subject,
      title,
      unit: text(r.unit, 60),
      questionPaperDocxUrl: paperOk ? paper : "",
      answerKeyUrl: keyOk ? key : "",
    });
  }

  if (!rows.length) {
    return { ok: false, error: "No usable rows in that capture" };
  }
  return { ok: true, capturedOn: text(body.capturedOn, 20), rows, ignored };
}

/**
 * The path the folder importer would have seen for this row.
 *
 * Reusing it means the capture and a downloaded folder are judged by exactly
 * the same rules — the same class and subject mapping, the same "the paper
 * says what it is", the same set-collapsing. A second code path would drift.
 */
export function syntheticPaperPath(row: NucleusManifestRow): string {
  const safe = (s: string) => s.replace(/[\\/]+/g, "-").trim();
  return [
    safe(row.classLabel),
    `Division ${safe(row.division) || "A"}`,
    safe(row.subject),
    "Editable",
    safe(row.unit) || "Assessment",
    safe(row.title),
    `${safe(row.title)}_Question Paper_paper_doc.docx`,
  ].join("/");
}

/* -------------------------------------------------------------------------- */
/* Planning a capture                                                         */
/* -------------------------------------------------------------------------- */

import {
  classifyExam,
  normalizeWord,
  readSetNumber,
  setCodeForNumber,
  type ImportCatalog,
  type ImportMappings,
} from "@/lib/examPaperImport";

export type CaptureVerdict = "fetch" | "already_here" | "needs_mapping" | "rejected";

export type CapturePlanRow = {
  row: NucleusManifestRow;
  who: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectCode: string;
  examTermId: string;
  examTermCode: string;
  examTermLabel: string;
  setCode: string;
  verdict: CaptureVerdict;
  reason: string;
  /** `subject:Moral Science` — a word the school has not taught it yet. */
  unmapped: string;
};

export type CapturePlan = {
  rows: CapturePlanRow[];
  counts: Record<CaptureVerdict, number>;
  unmapped: string[];
};

/**
 * Decide what a capture would do, from the names alone.
 *
 * Unlike the folder import there is nothing to read yet — the papers are
 * still on the publisher's server — so this cannot say how many questions a
 * paper has. What it can say is the thing the office needs before agreeing:
 * which papers are new, which are already here, and which words it does not
 * understand. Everything it decides uses the same mappings and the same
 * reading of a paper's name as the folder import, so the two agree.
 */
export function planNucleusCapture(input: {
  rows: NucleusManifestRow[];
  catalog: ImportCatalog;
  mappings: ImportMappings;
  /** What is already on the desk: one entry per set. */
  existing: {
    academicYearCode: string;
    examTermId: string;
    classId: string;
    subjectId: string;
    publisherLabel: string;
  }[];
}): CapturePlan {
  const { catalog, mappings } = input;
  const ay = catalog.academicYearCode;

  const classByName = new Map(
    catalog.classes.map((c) => [normalizeWord(c.name).replace(/\s+/g, ""), c] as const),
  );
  const subjectByCode = new Map(
    catalog.subjects.map((s) => [s.code.toUpperCase(), s] as const),
  );
  const termByCode = new Map(
    catalog.terms
      .filter((t) => t.academicYearCode === ay)
      .map((t) => [t.code.toUpperCase(), t] as const),
  );
  const here = new Set(
    input.existing.map((e) =>
      [e.academicYearCode, e.examTermId, e.classId, e.subjectId, normalizeWord(e.publisherLabel)].join("|"),
    ),
  );

  const rows: CapturePlanRow[] = [];
  for (const row of input.rows) {
    const who = `${row.classLabel} ${row.subject} · ${row.title}`;
    const out: CapturePlanRow = {
      row, who,
      classId: "", className: "", subjectId: "", subjectCode: "",
      examTermId: "", examTermCode: "", examTermLabel: "",
      setCode: "", verdict: "fetch", reason: "", unmapped: "",
    };

    const className = mappings.classes[normalizeWord(row.classLabel)] ?? "";
    const subjectCode = mappings.subjects[normalizeWord(row.subject)] ?? "";
    const exam = classifyExam(
      { docTitle: row.title, paperFolder: row.title, bucketFolder: row.unit },
      mappings,
    );

    if (!className) out.unmapped = `class:${row.classLabel}`;
    else if (!subjectCode) out.unmapped = `subject:${row.subject}`;
    else if (!exam.code) out.unmapped = `exam:${row.title}`;

    if (out.unmapped) {
      out.verdict = "needs_mapping";
      out.reason = `not mapped yet: ${out.unmapped.split(":").slice(1).join(":")}`;
      rows.push(out);
      continue;
    }

    const cls = classByName.get(normalizeWord(className).replace(/\s+/g, ""));
    const sub = subjectByCode.get(subjectCode.toUpperCase());
    const term = termByCode.get(exam.code.toUpperCase());
    if (!cls || !sub || !term) {
      out.verdict = "rejected";
      out.reason = !cls
        ? `masters has no class "${className}"`
        : !sub
          ? `masters has no subject with code ${subjectCode}`
          : `no ${exam.code} exam exists in ${ay}`;
      rows.push(out);
      continue;
    }

    out.classId = cls.id;
    out.className = cls.name;
    out.subjectId = sub.id;
    out.subjectCode = sub.code;
    out.examTermId = term.id;
    out.examTermCode = term.code;
    out.examTermLabel = term.label;
    out.setCode = setCodeForNumber(readSetNumber(row.title));

    if (!row.questionPaperDocxUrl) {
      out.verdict = "rejected";
      out.reason = "the capture has no question paper for this row";
    } else if (here.has([ay, term.id, cls.id, sub.id, normalizeWord(row.title)].join("|"))) {
      out.verdict = "already_here";
      out.reason = "this paper is already on the desk";
    }
    rows.push(out);
  }

  const counts: Record<CaptureVerdict, number> = {
    fetch: 0, already_here: 0, needs_mapping: 0, rejected: 0,
  };
  for (const r of rows) counts[r.verdict] += 1;
  return {
    rows,
    counts,
    unmapped: [...new Set(rows.map((r) => r.unmapped).filter(Boolean))].sort(),
  };
}
