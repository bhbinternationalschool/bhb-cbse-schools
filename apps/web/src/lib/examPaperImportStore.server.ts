/**
 * Storing one imported question paper: the original file, its pictures, and
 * the set that points at them.
 *
 * This lives apart from the route so the same code does the work whichever
 * way an import is run — the office pressing Import in the Question Papers
 * tab, or the one-off script that filled the desk from the school's first
 * download. If the two had their own copies, a paper imported by the script
 * and one imported by hand would differ in ways nobody would notice until a
 * teacher printed the wrong thing.
 *
 * Server-only: it needs a service-role Supabase client to write storage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contentTypeFor,
  maxBytesFor,
  privateMediaUrl,
  sanitizeMediaPath,
} from "@/lib/media";
import { readPaperFile } from "@/lib/examPaperRead";
import type { ExamPaperSection, ExamPaperSet } from "@/lib/examPapers";
import type { PaperHeader } from "@/lib/examPaperImport";

export type StoreImportedPaperMeta = {
  relPath: string;
  academicYearCode: string;
  examTermCode: string;
  className: string;
  subjectCode: string;
  setCode: string;
  publisherLabel: string;
  /** What the caller hashed. A mismatch means these are not those bytes. */
  fileHash: string;
  importedBy: string;
};

export type StoreImportedPaperResult =
  | {
      ok: true;
      set: ExamPaperSet;
      facts: {
        relPath: string;
        fileHash: string;
        header: PaperHeader;
        questionCount: number;
        parsedMarks: number;
        unassignedMarks: number;
        unassignedSections: string[];
        imagesStored: number;
        imagesFailed: string[];
      };
    }
  | { ok: false; status: number; error: string };

/**
 * Where a paper lives in storage. The hash is in the folder name so
 * re-importing a corrected paper writes new objects instead of overwriting
 * ones a teacher may have open — files are served with a year-long cache
 * header, and a silently changed paper is worse than a second copy.
 */
export function paperStorageFolder(meta: StoreImportedPaperMeta): string {
  return sanitizeMediaPath(
    [
      "exam-papers",
      meta.academicYearCode || "no-year",
      meta.examTermCode || "no-exam",
      meta.className || "no-class",
      meta.subjectCode || "no-subject",
      `${meta.setCode}-${meta.fileHash.slice(0, 12)}`,
    ].join("/"),
  );
}

export async function storeImportedPaper(input: {
  sb: SupabaseClient;
  bytes: Uint8Array;
  fileName: string;
  meta: StoreImportedPaperMeta;
  /** true = parse and report, write nothing. */
  dryRun?: boolean;
}): Promise<StoreImportedPaperResult> {
  const { sb, bytes, fileName, meta } = input;

  const read = await readPaperFile(meta.relPath || fileName, bytes);
  if (read.facts.readError || !read.body) {
    return {
      ok: false,
      status: 422,
      error: read.facts.readError || "Could not read the paper",
    };
  }
  // The preview judged a specific file. If these are different bytes, the
  // school approved something else — stop rather than import an unseen paper
  // under an approved one's name.
  if (meta.fileHash && read.facts.fileHash !== meta.fileHash) {
    return {
      ok: false,
      status: 409,
      error: "This file changed since the preview was built — run the preview again",
    };
  }
  if (!read.body.questionCount) {
    return { ok: false, status: 422, error: "No questions could be read from this file" };
  }

  const folder = paperStorageFolder({ ...meta, fileHash: read.facts.fileHash });

  // The original first: a set whose source cannot be opened is worth less
  // than no set at all, because the teacher has nothing to fall back on.
  const docxName = fileName.toLowerCase().endsWith(".docx") ? fileName : `${fileName}.docx`;
  const docxPath = sanitizeMediaPath(`${folder}/${docxName}`);
  const docxType = contentTypeFor("school-files", docxPath);
  if (!docxType) {
    return { ok: false, status: 415, error: "Only .docx question papers can be imported" };
  }
  if (bytes.byteLength > maxBytesFor("school-files", docxType)) {
    return { ok: false, status: 413, error: `${fileName} is too large` };
  }

  if (!input.dryRun) {
    const upload = await sb.storage.from("school-files").upload(docxPath, bytes, {
      contentType: docxType,
      upsert: true,
      cacheControl: "31536000",
    });
    if (upload.error) {
      return {
        ok: false,
        status: 500,
        error: `Could not store the paper: ${upload.error.message}`,
      };
    }
  }

  // Pictures. A question whose picture could not be stored keeps its text and
  // loses the picture — it is never given a link that will not load.
  const urlByRid = new Map<string, string>();
  const imagesFailed: string[] = [];
  for (const image of read.images) {
    const path = sanitizeMediaPath(`${folder}/media/${image.rid}.${image.extension}`);
    const type = contentTypeFor("school-files", path);
    if (!type) {
      imagesFailed.push(`${image.rid} (.${image.extension} cannot be stored)`);
      continue;
    }
    if (!input.dryRun) {
      const res = await sb.storage.from("school-files").upload(path, image.bytes, {
        contentType: type,
        upsert: true,
        cacheControl: "31536000",
      });
      if (res.error) {
        imagesFailed.push(`${image.rid} (${res.error.message})`);
        continue;
      }
    }
    urlByRid.set(image.rid, privateMediaUrl(path));
  }

  const sections: ExamPaperSection[] = read.body.sections.map((section) => ({
    ...section,
    questions: section.questions.map((q) => ({
      ...q,
      images: q.images
        .map((img) => ({ ...img, dataUrl: urlByRid.get(img.id) ?? "" }))
        .filter((img) => img.dataUrl),
    })),
  }));

  const set: ExamPaperSet = {
    id: `set_${read.facts.fileHash.slice(0, 10)}`,
    setCode: meta.setCode,
    label: meta.publisherLabel || `Set ${meta.setCode}`,
    sections,
    source: {
      fileName,
      filePath: docxPath,
      fileUrl: privateMediaUrl(docxPath),
      fileHash: read.facts.fileHash,
      publisherLabel: meta.publisherLabel,
      importedAt: new Date().toISOString(),
      importedBy: meta.importedBy,
    },
    // The key is imported separately, from the publisher's own answer-key file.
    answerKey: null,
  };

  return {
    ok: true,
    set,
    facts: {
      relPath: read.facts.relPath,
      fileHash: read.facts.fileHash,
      header: read.facts.header,
      questionCount: read.facts.questionCount,
      parsedMarks: read.facts.parsedMarks,
      unassignedMarks: read.facts.unassignedMarks ?? 0,
      unassignedSections: read.facts.unassignedSections ?? [],
      imagesStored: urlByRid.size,
      imagesFailed,
    },
  };
}
