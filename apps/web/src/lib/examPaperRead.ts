/**
 * One Word file → everything the importer needs to know about it.
 *
 * This is the seam between the bytes and the judgement: `docxText` turns the
 * file into lines and pictures, `examPaperImport` decides what those lines
 * mean, and this puts the two together so the browser (building the preview)
 * and the server (doing the import for real) read every paper exactly the
 * same way. If they diverged, the school would approve one thing and get
 * another.
 */

import { readDocx, type DocxImage } from "@/lib/docxText";
import {
  parsePaperBody,
  readPaperHeader,
  type ImportFileFacts,
  type ParsedPaperBody,
} from "@/lib/examPaperImport";

export type ReadPaperResult = {
  facts: ImportFileFacts;
  /** Absent when the file could not be opened — `facts.readError` says so. */
  body: ParsedPaperBody | null;
  images: DocxImage[];
};

/** sha-256 of the file, hex. The import's idempotency key. */
export async function fileHashOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function readPaperFile(
  relPath: string,
  bytes: Uint8Array,
  ids?: { questionId: (n: number) => string; sectionId: (n: number) => string },
): Promise<ReadPaperResult> {
  const fileHash = await fileHashOf(bytes);
  const doc = await readDocx(bytes);

  if (!doc) {
    return {
      facts: {
        relPath,
        fileHash,
        header: {
          docClass: "",
          docTitle: "",
          docSubject: "",
          maxMarks: 0,
          durationMinutes: 0,
        },
        questionCount: 0,
        parsedMarks: 0,
        readError: "Could not open this as a Word document",
      },
      body: null,
      images: [],
    };
  }

  const header = readPaperHeader(doc.lines);
  let q = 0;
  let s = 0;
  const body = parsePaperBody(doc.lines, {
    questionId: ids?.questionId ?? (() => `q_${++q}`),
    sectionId: ids?.sectionId ?? (() => `sec_${++s}`),
  });

  return {
    facts: {
      relPath,
      fileHash,
      header,
      questionCount: body.questionCount,
      parsedMarks: body.parsedMarks,
      unassignedMarks: body.unassignedMarks,
      unassignedSections: body.unassignedSections,
    },
    body,
    images: doc.images,
  };
}
