import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { ExamsState } from "@/lib/exams";
import { examsDualWriteDbEnabled } from "@/lib/examsDbConfig";
import {
  fetchExamDeskFromDb,
  pushExamDeskToDb,
} from "@/lib/examsNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

/** GET — pull exam desk from normalized tables */
export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, meta } = await fetchExamDeskFromDb();
  return NextResponse.json({
    ok: true,
    terms: bundle.terms,
    subjects: bundle.subjects,
    dateSheet: bundle.dateSheet,
    sheets: bundle.sheets,
    policy: bundle.policy,
    promotions: bundle.promotions,
    sheetCount: bundle.sheets.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type ExamsDeskPostBody = Pick<
  ExamsState,
  "terms" | "subjects" | "dateSheet" | "sheets" | "policy" | "promotions"
>;

/** POST — push full exam desk snapshot */
export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!examsDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "EXAMS_DUAL_WRITE_DB disabled",
    });
  }

  let body: ExamsDeskPostBody;
  try {
    body = (await req.json()) as ExamsDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushExamDeskToDb({
    version: 1,
    terms: Array.isArray(body.terms) ? body.terms : [],
    subjects: Array.isArray(body.subjects) ? body.subjects : [],
    dateSheet: Array.isArray(body.dateSheet) ? body.dateSheet : [],
    sheets: Array.isArray(body.sheets) ? body.sheets : [],
    policy: body.policy!,
    promotions: Array.isArray(body.promotions) ? body.promotions : [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    sheetCount: body.sheets?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
