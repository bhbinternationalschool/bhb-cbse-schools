import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  storeImportedPaper,
  type StoreImportedPaperMeta,
} from "@/lib/examPaperImportStore.server";

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
 *
 * The work itself is in `examPaperImportStore.server`, shared with the script
 * that filled the desk from the school's first download.
 */

const MAX_BYTES = 20 * 1024 * 1024;

function readMeta(raw: string | null): StoreImportedPaperMeta | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Partial<StoreImportedPaperMeta>;
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

  const result = await storeImportedPaper({
    sb: ctx.sb,
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    meta,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, set: result.set, facts: result.facts });
}
