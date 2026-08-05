import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import {
  suggestExamPaperDraftLlm,
  suggestMoreQuestionsLlm,
} from "@/lib/examPaperAiLlm.server";
import {
  suggestExamPaperDraft,
  suggestMoreQuestions,
} from "@/lib/examPaperAi";
import type { ExamPaperHardness } from "@/lib/examPapers";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "exam-paper-ai",
    note: 'POST { mode: "draft" | "more", classId, subjectId, hardness, maxMarks?, sectionId?, excludeTexts? }',
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  if (!hasPermission(session, masters, "exams", "edit")) {
    return NextResponse.json(
      { error: "Exams edit permission required" },
      { status: 403 },
    );
  }

  let body: {
    mode?: "draft" | "more";
    classId?: string;
    subjectId?: string;
    hardness?: ExamPaperHardness;
    maxMarks?: number;
    count?: number;
    excludeTexts?: string[];
    preferLocal?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mode = body.mode || "draft";
  const classId = (body.classId || "").trim();
  const subjectId = (body.subjectId || "").trim();
  const hardness = body.hardness || "mixed";

  if (!classId || !subjectId) {
    return NextResponse.json(
      { error: "classId and subjectId required" },
      { status: 400 },
    );
  }

  if (mode === "draft") {
    const maxMarks =
      typeof body.maxMarks === "number" && body.maxMarks > 0
        ? body.maxMarks
        : 50;

    if (!body.preferLocal) {
      const llm = await suggestExamPaperDraftLlm({
        masters,
        classId,
        subjectId,
        hardness,
        maxMarks,
      });
      if (llm.ok) {
        return NextResponse.json({
          ok: true,
          engine: llm.engine,
          source: "llm",
          sections: llm.sections,
          explanation: llm.explanation,
        });
      }
    }

    const local = suggestExamPaperDraft({
      masters,
      classId,
      subjectId,
      hardness,
      maxMarks,
    });
    return NextResponse.json({
      ok: true,
      engine: "local",
      source: "local",
      sections: local.sections,
      explanation: local.explanation,
      flavour: local.flavour,
    });
  }

  if (mode === "more") {
    const count = body.count ?? 2;
    if (!body.preferLocal) {
      const llm = await suggestMoreQuestionsLlm({
        masters,
        classId,
        subjectId,
        hardness,
        count,
        excludeTexts: body.excludeTexts,
      });
      if (llm.ok) {
        return NextResponse.json({
          ok: true,
          engine: llm.engine,
          source: "llm",
          questions: llm.questions,
        });
      }
    }

    const questions = suggestMoreQuestions({
      masters,
      classId,
      subjectId,
      hardness: hardness === "mixed" ? "medium" : hardness,
      count,
      excludeTexts: body.excludeTexts,
    });
    return NextResponse.json({
      ok: true,
      engine: "local",
      source: "local",
      questions,
    });
  }

  return NextResponse.json({ error: "mode must be draft or more" }, { status: 400 });
}
