#!/usr/bin/env npx tsx
/**
 * Attach the publisher's answer keys to the papers already on the desk.
 *
 * The keys are public files on the publisher's CDN, one per paper, listed in
 * a manifest captured from the school's own portal session (the portal has no
 * bulk answer-key download — its bulk dialog offers question papers only).
 * Each row of the manifest names a class, subject, assessment and set, and
 * gives the key's URL.
 *
 * What this does per row: find the paper and set on the desk, fetch the PDF,
 * store it beside that set's question paper, and — only when the key and the
 * paper demonstrably line up — write each answer and its marking scheme onto
 * the question it belongs to.
 *
 * The alignment check is the whole point. An answer filed against the wrong
 * question is a mistake a teacher carries into marking a child's paper, so
 * unless the key and the paper agree on the number of questions, on their
 * numbering and on what each is worth, nothing is written onto the questions
 * and the key stays a document the teacher reads themselves. Half the keys in
 * this school's set are pre-primary papers whose answers are pictures; those
 * are always document-only, and that is correct rather than a failure.
 *
 * Reading the PDF needs `pdftotext` (poppler) on the PATH. Without it the run
 * still attaches every key; it just fills no questions, and says so.
 *
 *   cd apps/web
 *   npx tsx scripts/import-answer-keys.mts <manifest.json>
 *   ALLOW_LOCAL_PROD_WRITES=1 npx tsx scripts/import-answer-keys.mts <manifest.json> --commit
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "./lib/loadEnvLocal";
import { DEFAULT_AY } from "../src/lib/masters";
import { getServerTenantContext } from "../src/lib/serverTenant";
import {
  fetchDeskSliceFromDb,
  pushDeskSliceToDb,
} from "../src/lib/deskSliceNormalized.server";
import {
  classifyExam,
  mergeImportMappings,
  normalizeWord,
  readSetNumber,
  setCodeForNumber,
  type ImportMappings,
} from "../src/lib/examPaperImport";
import {
  matchAnswerKeyToQuestions,
  parseAnswerKey,
} from "../src/lib/answerKeyParse";
import {
  applyAnswerKey,
  normalizeExamPapersState,
  type ExamPaper,
  type ExamPapersState,
} from "../src/lib/examPapers";
import { contentTypeFor, privateMediaUrl, sanitizeMediaPath } from "../src/lib/media";

loadEnvLocal();

type ManifestRow = {
  paperId: string;
  classLabel: string;
  division: string;
  subject: string;
  title: string;
  unit: string;
  asmId: number;
  answerKeyUrl: string;
  questionPaperDocxUrl?: string;
};

type Args = { manifest: string; commit: boolean; year: string; actor: string };

function parseArgs(argv: string[]): Args {
  const out: Args = { manifest: "", commit: false, year: DEFAULT_AY, actor: "Answer key import" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--commit") out.commit = true;
    else if (a === "--year") out.year = argv[++i] ?? out.year;
    else if (a === "--actor") out.actor = argv[++i] ?? out.actor;
    else if (!a.startsWith("--")) out.manifest = a;
  }
  return out;
}

function havePdfToText(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Same comparison the paper import uses for a publisher's own label. */
function sameLabel(a: string, b: string): boolean {
  return normalizeWord(a) === normalizeWord(b);
}

/**
 * Find the set this key belongs to.
 *
 * The publisher's own label is the strongest match — it is the folder name the
 * paper arrived in, kept on the set for exactly this. Set code is the
 * fallback, for a paper whose label was edited on the desk.
 */
function findTarget(
  papers: ExamPaper[],
  row: ManifestRow,
  ids: { classId: string; subjectId: string; examTermId: string; ay: string },
): { paper: ExamPaper; setCode: string } | { error: string } {
  const candidates = papers.filter(
    (p) =>
      p.academicYearCode === ids.ay &&
      p.classId === ids.classId &&
      p.subjectId === ids.subjectId &&
      p.examTermId === ids.examTermId,
  );
  if (!candidates.length) return { error: "no paper on the desk for this class / subject / exam" };

  for (const paper of candidates) {
    const byLabel = paper.sets.find((s) =>
      sameLabel(s.source?.publisherLabel ?? s.label, row.title),
    );
    if (byLabel) return { paper, setCode: byLabel.setCode };
  }
  const wanted = setCodeForNumber(readSetNumber(row.title));
  for (const paper of candidates) {
    const bySet = paper.sets.find((s) => s.setCode === wanted);
    if (bySet) return { paper, setCode: bySet.setCode };
  }
  return { error: `paper found but no set matching "${row.title}"` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !existsSync(args.manifest)) {
    console.error("Usage: import-answer-keys.mts <manifest.json> [--commit]");
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(args.manifest, "utf8")) as {
    capturedOn?: string;
    rows: ManifestRow[];
  };
  const canRead = havePdfToText();
  console.log(
    `${manifest.rows.length} keys in the manifest (captured ${manifest.capturedOn ?? "?"})` +
      (canRead ? "" : " — pdftotext not found, keys will be attached but not read"),
  );

  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("Supabase service role not configured");

  const desk = await fetchDeskSliceFromDb("exam_papers");
  if (!desk.ok) throw new Error(`Could not read the papers desk: ${desk.error}`);
  let state: ExamPapersState = normalizeExamPapersState({ version: 1, ...desk.bundle });

  const [classes, subjects, terms] = await Promise.all([
    ctx.sb.from("masters_desk_classes").select("id,name").eq("tenant_id", ctx.tenantId),
    ctx.sb.from("masters_desk_subjects").select("id,code").eq("tenant_id", ctx.tenantId),
    ctx.sb
      .from("exam_desk_terms")
      .select("id,code,academic_year_code")
      .eq("tenant_id", ctx.tenantId),
  ]);
  const classByName = new Map(
    (classes.data ?? []).map((c) => [normalizeWord(String(c.name)).replace(/\s+/g, ""), String(c.id)]),
  );
  const subjectByCode = new Map(
    (subjects.data ?? []).map((s) => [String(s.code).toUpperCase(), String(s.id)]),
  );
  const termByCode = new Map(
    (terms.data ?? [])
      .filter((t) => String(t.academic_year_code) === args.year)
      .map((t) => [String(t.code).toUpperCase(), String(t.id)]),
  );

  const mappings: ImportMappings = mergeImportMappings({
    classes: { ...state.importMappings?.classes },
    subjects: { ...state.importMappings?.subjects },
    exams: { ...state.importMappings?.exams },
  });

  const tmp = mkdtempSync(join(tmpdir(), "answer-keys-"));
  const skipped: string[] = [];
  const attachedOnly: string[] = [];
  let attached = 0;
  let filled = 0;
  let alreadyThere = 0;

  for (const row of manifest.rows) {
    const className = mappings.classes[normalizeWord(row.classLabel)] ?? "";
    const subjectCode = mappings.subjects[normalizeWord(row.subject)] ?? "";
    const exam = classifyExam(
      { docTitle: row.title, paperFolder: row.title, bucketFolder: row.unit },
      mappings,
    );
    const classId = classByName.get(normalizeWord(className).replace(/\s+/g, "")) ?? "";
    const subjectId = subjectByCode.get(subjectCode.toUpperCase()) ?? "";
    const examTermId = termByCode.get(exam.code.toUpperCase()) ?? "";
    const who = `${row.classLabel} ${row.subject} · ${row.title}`;

    if (!classId || !subjectId || !examTermId) {
      skipped.push(`${who} — could not resolve class/subject/exam`);
      continue;
    }

    const target = findTarget(state.papers, row, { classId, subjectId, examTermId, ay: args.year });
    if ("error" in target) {
      skipped.push(`${who} — ${target.error}`);
      continue;
    }
    const set = target.paper.sets.find((s) => s.setCode === target.setCode)!;

    const res = await fetch(row.answerKeyUrl);
    if (!res.ok) {
      skipped.push(`${who} — the key would not download (${res.status})`);
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const fileHash = createHash("sha256").update(bytes).digest("hex");

    if (set.answerKey?.fileHash === fileHash) {
      alreadyThere += 1;
      continue;
    }

    // Beside the question paper it belongs to, so a set's files live together.
    const folder = (set.source?.filePath ?? "").split("/").slice(0, -1).join("/");
    if (!folder) {
      skipped.push(`${who} — the set has no stored question paper to sit beside`);
      continue;
    }
    const path = sanitizeMediaPath(`${folder}/answer-key.pdf`);
    const contentType = contentTypeFor("school-files", path);
    if (!contentType) {
      skipped.push(`${who} — a .pdf cannot be stored here`);
      continue;
    }

    if (args.commit) {
      const up = await ctx.sb.storage.from("school-files").upload(path, bytes, {
        contentType,
        upsert: true,
        cacheControl: "31536000",
      });
      if (up.error) {
        skipped.push(`${who} — storage refused it: ${up.error.message}`);
        continue;
      }
    }

    // Read it, and decide whether it may be written onto the questions.
    let byNumber: Map<number, { answer: string; markingScheme: string[] }> | undefined;
    let note = canRead ? "" : "pdftotext was not available, so the key was not read";
    if (canRead) {
      const pdfPath = join(tmp, `${row.paperId}.pdf`);
      writeFileSync(pdfPath, bytes);
      try {
        const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
          encoding: "utf8",
          maxBuffer: 64e6,
        });
        const key = parseAnswerKey(text);
        const questions = set.sections.flatMap((s) => s.questions);
        const match = matchAnswerKeyToQuestions(key, questions);
        if (match.ok) {
          if (match.withAnswers === 0) {
            note = "the key shows its answers as pictures";
          } else {
            byNumber = new Map(
              [...match.byNumber].map(([n, item]) => [
                n,
                { answer: item.answer, markingScheme: item.markingScheme },
              ]),
            );
          }
        } else {
          note = match.reason;
        }
      } catch (e) {
        note = `could not read the PDF: ${e instanceof Error ? e.message : e}`;
      }
    }

    const outcome = applyAnswerKey(state, {
      paperId: target.paper.id,
      setCode: target.setCode,
      file: {
        filePath: path,
        fileUrl: privateMediaUrl(path),
        fileHash,
        sourceUrl: row.answerKeyUrl,
        questionsFilled: 0,
        note: "",
        importedAt: new Date().toISOString(),
        importedBy: args.actor,
      },
      byNumber,
      note,
    });
    if (outcome.error) {
      skipped.push(`${who} — ${outcome.error}`);
      continue;
    }
    state = outcome.state;
    attached += 1;
    filled += outcome.filled;
    if (!outcome.filled) attachedOnly.push(`${who} — ${note || "no answers to write"}`);

    process.stdout.write(
      `\r  ${attached} keys attached, ${filled} questions answered        `,
    );
  }
  process.stdout.write("\n");

  if (!args.commit) {
    console.log(
      `\nDry run — nothing written. Would attach ${attached}, answer ${filled} questions, ` +
        `skip ${skipped.length}, ${alreadyThere} already present.`,
    );
  } else {
    const push = await pushDeskSliceToDb("exam_papers", state);
    if (!push.ok) {
      console.error(`\nFiles stored but the desk write failed: ${push.error}`);
      process.exit(1);
    }
    console.log(
      `\nattached ${attached} keys · answered ${filled} questions · ` +
        `${alreadyThere} already present · ${skipped.length} skipped`,
    );
  }

  if (attachedOnly.length) {
    console.log(`\n${attachedOnly.length} key(s) attached as a document only:`);
    for (const s of attachedOnly.slice(0, 40)) console.log(`  ${s}`);
    if (attachedOnly.length > 40) console.log(`  …and ${attachedOnly.length - 40} more`);
  }
  if (skipped.length) {
    console.log(`\n${skipped.length} skipped:`);
    for (const s of skipped.slice(0, 40)) console.log(`  ${s}`);
    if (skipped.length > 40) console.log(`  …and ${skipped.length - 40} more`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
