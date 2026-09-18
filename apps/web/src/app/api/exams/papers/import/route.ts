import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { contentTypeFor, maxBytesFor, privateMediaUrl, sanitizeMediaPath } from "@/lib/media";
import { readPaperFile } from "@/lib/examPaperRead";
import type { ExamPaperSection, ExamPaperSet } from "@/lib/examPapers";

export const runtime = "nodejs";

/**
 * Import one question paper — the bytes half of the job.
 *
 * The browser has already read every file in the folder, worked out what each
 * one is and shown the school a table of it; nothing reaches this route until
 * somebody has approved that table. So this does the part the browser cannot:
 * it stores the original Word file and every picture inside it, and hands back
 * a set whose questions point at stored URLs.
 *
 * It re-reads and re-parses the file rather than trusting the questions the
 * browser sends. The file is the evidence; a client-built question list is
 * just a claim about it, and the two are checked against each other by hash
 * before anything is stored.
 *
 * One file per request, deliberately: a folder is 50 MB, and a single upload
 * that fails at file 74 would leave the school with no idea what did and did
 * not land. Per-file, the screen can show exactly where it stopped and carry
 * on from there.
 */

const MAX_BYTES = 20 * 1024 * 1024;

type Meta = {
  relPath: string;
  academicYearCode: string;
  examTermCode: string;
  className: string;
  subjectCode: string;
  setCode: string;
  publisherLabel: string;
  /** What the browser hashed. A mismatch means the file changed underneath. */
  fileHash: string;
  importedBy: string;
};

function readMeta(raw: string | null): Meta | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Partial<Meta>;
    if (!m.fileHash || !m.setCode) return null;
    return {
      relPath: String(m.relPath || ""),
      academicYearCode: String(m.academicYearCode || ""),
      examTermCode: String(m.examTermCode || ""),
      className: String(m.className || ""),
      subjectCode: String(m.subjectCode || ""),
      setCode: String(m.setCode).toUpperCase().slice(0, 1),
      publisherLabel: String(m.publisherLabel || "").slice(0, 200),
      fileHash: String(m.fileHash),
      importedBy: String(m.importedBy || "").slice(0, 120),
    };
  } catch {
    return null;
  }
}

/**
 * Where a paper lives in storage. The hash is in the name so re-importing a
 * corrected paper writes a new object instead of overwriting the one a
 * teacher may have open — files are served with a year-long cache header.
 */
function paperFolder(meta: Meta): string {
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

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "exams", "edit");
  if (!auth.ok) return auth.response;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Supabase service role not configured" },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  const file = form.get("file");
  const meta = readMeta(form.get("meta") as string | null);
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!meta) {
    return NextResponse.json({ error: "Missing or unreadable meta" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `${file.name} is larger than 20 MB` },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const read = await readPaperFile(meta.relPath || file.name, bytes);

  if (read.facts.readError || !read.body) {
    return NextResponse.json(
      { error: read.facts.readError || "Could not read the paper" },
      { status: 422 },
    );
  }
  // The browser judged a specific file. If these bytes are different bytes,
  // the school approved something else — stop rather than import an unseen
  // paper under an approved one's name.
  if (read.facts.fileHash !== meta.fileHash) {
    return NextResponse.json(
      { error: "This file changed since the preview was built — run the preview again" },
      { status: 409 },
    );
  }
  if (!read.body.questionCount) {
    return NextResponse.json(
      { error: "No questions could be read from this file" },
      { status: 422 },
    );
  }

  const folder = paperFolder(meta);

  // The original, first: a set with no readable source is worth less than no
  // set at all, because the teacher has nothing to fall back on.
  const docxName = file.name.toLowerCase().endsWith(".docx")
    ? file.name
    : `${file.name}.docx`;
  const docxPath = sanitizeMediaPath(`${folder}/${docxName}`);
  const docxType = contentTypeFor("school-files", docxPath);
  if (!docxType) {
    return NextResponse.json(
      { error: "Only .docx question papers can be imported" },
      { status: 415 },
    );
  }
  if (file.size > maxBytesFor("school-files", docxType)) {
    return NextResponse.json({ error: `${file.name} is too large` }, { status: 413 });
  }

  const upload = await ctx.sb.storage
    .from("school-files")
    .upload(docxPath, bytes, {
      contentType: docxType,
      upsert: true,
      cacheControl: "31536000",
    });
  if (upload.error) {
    return NextResponse.json(
      { error: `Could not store the paper: ${upload.error.message}` },
      { status: 500 },
    );
  }

  // Pictures. A question whose picture could not be stored keeps its text and
  // loses the picture — it is never given a link that will not load.
  const urlByRid = new Map<string, string>();
  const failedImages: string[] = [];
  for (const image of read.images) {
    const path = sanitizeMediaPath(`${folder}/media/${image.rid}.${image.extension}`);
    const type = contentTypeFor("school-files", path);
    if (!type) {
      failedImages.push(`${image.rid} (.${image.extension} cannot be stored)`);
      continue;
    }
    const res = await ctx.sb.storage.from("school-files").upload(path, image.bytes, {
      contentType: type,
      upsert: true,
      cacheControl: "31536000",
    });
    if (res.error) {
      failedImages.push(`${image.rid} (${res.error.message})`);
      continue;
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
    id: `set_${meta.fileHash.slice(0, 10)}`,
    setCode: meta.setCode,
    label: meta.publisherLabel || `Set ${meta.setCode}`,
    sections,
    source: {
      fileName: file.name,
      filePath: docxPath,
      fileUrl: privateMediaUrl(docxPath),
      fileHash: read.facts.fileHash,
      publisherLabel: meta.publisherLabel,
      importedAt: new Date().toISOString(),
      importedBy: meta.importedBy,
    },
  };

  return NextResponse.json({
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
      imagesFailed: failedImages,
    },
  });
}
