/**
 * Storing one answer key against the set it belongs to.
 *
 * Shared by the screen (which fetches keys from the publisher) and the
 * one-off script (which worked from a captured manifest), so a key attached
 * either way is attached identically.
 *
 * Reading the PDF needs `pdftotext`, which the container installs. Where it
 * is missing the key is still stored and still opens — it simply fills no
 * answers, and says so. That is the same outcome as a pre-primary key whose
 * answers are pictures, and it is an honest one: a key nobody could read
 * must not be made to look like a key somebody did.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentTypeFor, privateMediaUrl, sanitizeMediaPath } from "@/lib/media";
import { matchAnswerKeyToQuestions, parseAnswerKey } from "@/lib/answerKeyParse";
import type { ExamPaperSet } from "@/lib/examPapers";

export type AttachAnswerKeyResult =
  | { ok: true; set: ExamPaperSet; answersFilled: number; note: string }
  | { ok: false; error: string };

export function havePdfToText(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The text of a PDF, or null when no reader is available or it failed. */
export function pdfText(bytes: Uint8Array): string | null {
  if (!havePdfToText()) return null;
  const dir = mkdtempSync(join(tmpdir(), "answer-key-"));
  const file = join(dir, "key.pdf");
  try {
    writeFileSync(file, bytes);
    return execFileSync("pdftotext", ["-layout", file, "-"], {
      encoding: "utf8",
      maxBuffer: 64e6,
    });
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Store the key beside its set's question paper and, where the two
 * demonstrably line up, write each answer onto its question.
 *
 * The alignment check lives in `answerKeyParse`; nothing here second-guesses
 * it. When it refuses, the key is attached with the reason recorded, which is
 * what a teacher needs in order to know why the answers are not on screen.
 */
export async function fetchAndAttachAnswerKey(input: {
  sb: SupabaseClient;
  bytes: Uint8Array;
  fileHash: string;
  sourceUrl: string;
  importedBy: string;
  /** The set just built for this paper; its stored .docx says where to file. */
  set?: ExamPaperSet;
}): Promise<AttachAnswerKeyResult> {
  const set = input.set;
  if (!set) return { ok: false, error: "no set to attach the key to" };

  const folder = (set.source?.filePath ?? "").split("/").slice(0, -1).join("/");
  if (!folder) {
    return { ok: false, error: "the set has no stored question paper to sit beside" };
  }
  const path = sanitizeMediaPath(`${folder}/answer-key.pdf`);
  const contentType = contentTypeFor("school-files", path);
  if (!contentType) return { ok: false, error: "a .pdf cannot be stored here" };

  const up = await input.sb.storage.from("school-files").upload(path, input.bytes, {
    contentType,
    upsert: true,
    cacheControl: "31536000",
  });
  if (up.error) return { ok: false, error: `storage refused the key: ${up.error.message}` };

  let note = "";
  let answersFilled = 0;
  let sections = set.sections;

  const text = pdfText(input.bytes);
  if (!text) {
    note = "the key could not be read here, so it is attached as a document";
  } else {
    const key = parseAnswerKey(text);
    const questions = set.sections.flatMap((s) => s.questions);
    const match = matchAnswerKeyToQuestions(key, questions);
    if (!match.ok) {
      note = match.reason;
    } else if (match.withAnswers === 0) {
      note = "the key shows its answers as pictures";
    } else {
      let number = 0;
      sections = set.sections.map((section) => ({
        ...section,
        questions: section.questions.map((q) => {
          number += 1;
          const item = match.byNumber.get(number);
          if (!item) return q;
          const next = { ...q };
          const answer = item.answer.trim();
          // A teacher's own answer is better than the publisher's and is
          // never replaced; nor is a second run allowed to undo an edit.
          if (answer && !q.answerKey.trim()) {
            next.answerKey = answer;
            answersFilled += 1;
          }
          if (item.markingScheme.length && !q.markingScheme.length) {
            next.markingScheme = item.markingScheme;
          }
          return next;
        }),
      }));
    }
  }

  return {
    ok: true,
    answersFilled,
    note,
    set: {
      ...set,
      sections,
      answerKey: {
        filePath: path,
        fileUrl: privateMediaUrl(path),
        fileHash: input.fileHash,
        sourceUrl: input.sourceUrl.slice(0, 400),
        questionsFilled: answersFilled,
        note,
        importedAt: new Date().toISOString(),
        importedBy: input.importedBy,
      },
    },
  };
}
