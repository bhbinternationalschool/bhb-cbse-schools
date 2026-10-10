import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  isPublisherFileUrl,
  syntheticPaperPath,
  type NucleusManifestRow,
} from "@/lib/nucleusManifest";
import { storeImportedPaper } from "@/lib/examPaperImportStore.server";
import { fetchAndAttachAnswerKey } from "@/lib/answerKeyStore.server";
import { fileHashOf } from "@/lib/examPaperRead";
import type { ExamPaperSet } from "@/lib/examPapers";

export const runtime = "nodejs";
/** A batch fetches, parses and stores several papers; give it room. */
export const maxDuration = 300;

/**
 * Fetch question papers and answer keys straight from the publisher.
 *
 * The office user never downloads a folder and never opens a paper to find
 * its answer key. They bring back a capture — a list of class, subject,
 * assessment and the two public file addresses — and this route does the
 * rest: it fetches each paper, parses it with the same reader the folder
 * import uses, stores the original and its pictures, then fetches the key
 * and writes the answers onto the questions that pass the alignment check.
 *
 * Two things this route will not do. It will not fetch a URL that is not the
 * publisher's own file store: the capture is text carried in from another
 * site, and it decides what this server downloads. And it does not decide
 * where a paper belongs — the browser has already planned that with the same
 * planner the folder import uses, and sends the decision per row.
 *
 * Work is done a few rows at a time so the screen can show progress and a
 * failure names the paper it happened on.
 */

type RowRequest = {
  row: NucleusManifestRow;
  /** What the browser's plan decided for this row. */
  academicYearCode: string;
  examTermCode: string;
  className: string;
  subjectCode: string;
  setCode: string;
};

export type FromNucleusResult = {
  paperId: string;
  title: string;
  who: string;
  /** The set, with its key attached and its answers written in. */
  set?: ExamPaperSet;
  questionCount?: number;
  answersFilled?: number;
  /** Why the key filled nothing, when it filled nothing. */
  note?: string;
  error?: string;
};

const MAX_ROWS_PER_CALL = 8;
const MAX_BYTES = 20 * 1024 * 1024;

async function fetchPublisherFile(
  url: string,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  if (!isPublisherFileUrl(url)) {
    return { ok: false, error: "That address is not the publisher's file store" };
  }
  let res: Response;
  try {
    res = await fetch(url, { redirect: "error" });
  } catch {
    return { ok: false, error: "Could not reach the publisher" };
  }
  if (!res.ok) return { ok: false, error: `The publisher returned ${res.status}` };
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return { ok: false, error: "That file is larger than 20 MB" };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) {
    return { ok: false, error: "That file is larger than 20 MB" };
  }
  return { ok: true, bytes };
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

  let body: { rows?: RowRequest[]; actorName?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS_PER_CALL) : [];
  if (!rows.length) {
    return NextResponse.json({ error: "No rows to fetch" }, { status: 400 });
  }
  const actorName = String(body.actorName ?? "").slice(0, 120);

  const results: FromNucleusResult[] = [];
  for (const item of rows) {
    const row = item.row;
    const who = `${row.classLabel} ${row.subject} · ${row.title}`;
    const out: FromNucleusResult = { paperId: row.paperId, title: row.title, who };

    // One paper's failure is that paper's failure. An exception escaping here
    // would take the whole batch with it and reach the screen as an
    // unreadable response, which tells the office nothing about which paper
    // to look at.
    try {

      if (!row.questionPaperDocxUrl) {
        results.push({ ...out, error: "this row has no question paper to fetch" });
        continue;
      }

      const got = await fetchPublisherFile(row.questionPaperDocxUrl);
      if (!got.ok) {
        results.push({ ...out, error: got.error });
        continue;
      }
      const stored = await storeImportedPaper({
        sb: ctx.sb,
        bytes: got.bytes,
        fileName: `${row.title}_Question Paper_paper_doc.docx`,
        meta: {
          relPath: syntheticPaperPath(row),
          academicYearCode: item.academicYearCode,
          examTermCode: item.examTermCode,
          className: item.className,
          subjectCode: item.subjectCode,
          setCode: item.setCode,
          publisherLabel: row.title,
          // The browser never saw these bytes, so there is nothing to check
          // them against; the publisher's own address is the provenance here.
          fileHash: "",
          importedBy: actorName,
        },
      });
      if (!stored.ok) {
        results.push({ ...out, error: stored.error });
        continue;
      }
      out.set = stored.set;
      out.questionCount = stored.facts.questionCount;

      // The key, straight after, so a paper and its answers arrive together.
      if (row.answerKeyUrl) {
        const key = await fetchPublisherFile(row.answerKeyUrl);
        if (!key.ok) {
          out.note = `the key did not download: ${key.error}`;
        } else {
          const attached = await fetchAndAttachAnswerKey({
            sb: ctx.sb,
            bytes: key.bytes,
            fileHash: await fileHashOf(key.bytes),
            sourceUrl: row.answerKeyUrl,
            importedBy: actorName,
            set: out.set,
          });
          if (attached.ok) {
            out.set = attached.set;
            out.answersFilled = attached.answersFilled;
            out.note = attached.note || out.note;
          } else {
            out.note = attached.error;
          }
        }
      }

      results.push(out);
    } catch (e) {
      results.push({
        ...out,
        error: e instanceof Error ? e.message : "Something went wrong fetching this paper",
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}
