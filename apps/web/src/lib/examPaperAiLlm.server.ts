/**
 * LLM exam paper draft — parse JSON into ExamPaperSection[].
 */

import type { MastersState } from "@/lib/masters";
import { classGroupCodeForName } from "@/lib/masters";
import {
  detectSubjectFlavour,
  type PaperSubjectFlavour,
} from "@/lib/examPaperAi";
import { generateExamPaperJson } from "@/lib/aiLlm.server";
import {
  emptyQuestion,
  emptySection,
  type ExamPaperHardness,
  type ExamPaperQuestion,
  type ExamPaperQuestionType,
  type ExamPaperSection,
} from "@/lib/examPapers";

const VALID_TYPES = new Set<ExamPaperQuestionType>([
  "mcq",
  "short",
  "long",
  "fill",
  "true_false",
  "match",
  "numerical",
  "diagram",
  "primary_picture",
]);

const VALID_HARDNESS = new Set(["easy", "medium", "hard"]);

type LlmQuestion = {
  type?: string;
  text?: string;
  marks?: number;
  options?: string[];
  answerKey?: string;
  hardness?: string;
};

type LlmSection = {
  title?: string;
  instructions?: string;
  questions?: LlmQuestion[];
};

type LlmDraft = {
  sections?: LlmSection[];
  explanation?: string[];
};

function classLabel(masters: MastersState, classId: string): string {
  return masters.classes.find((c) => c.id === classId)?.name || classId;
}

function subjectName(masters: MastersState, subjectId: string): string {
  const s = (masters.subjects ?? []).find((x) => x.id === subjectId);
  return s?.nameEn || s?.code || subjectId;
}

function toQuestion(q: LlmQuestion, defaultHardness: ExamPaperHardness): ExamPaperQuestion {
  const type = VALID_TYPES.has(q.type as ExamPaperQuestionType)
    ? (q.type as ExamPaperQuestionType)
    : "short";
  const hardness =
    q.hardness && VALID_HARDNESS.has(q.hardness)
      ? (q.hardness as "easy" | "medium" | "hard")
      : defaultHardness === "mixed"
        ? "medium"
        : defaultHardness;
  return emptyQuestion({
    type,
    text: (q.text || "").trim(),
    marks: typeof q.marks === "number" && q.marks > 0 ? q.marks : 1,
    options: Array.isArray(q.options) ? q.options.map(String) : [],
    answerKey: (q.answerKey || "").trim(),
    hardness,
    source: "ai",
  });
}

function parseSections(
  raw: LlmDraft,
  defaultHardness: ExamPaperHardness,
): ExamPaperSection[] {
  const sections: ExamPaperSection[] = [];
  for (const sec of raw.sections || []) {
    const questions = (sec.questions || [])
      .map((q) => toQuestion(q, defaultHardness))
      .filter((q) => q.text.length > 0);
    if (!questions.length) continue;
    sections.push(
      emptySection({
        title: (sec.title || "Section").trim() || "Section",
        instructions: (sec.instructions || "").trim(),
        questions,
      }),
    );
  }
  return sections;
}

function buildDraftPrompt(opts: {
  masters: MastersState;
  classId: string;
  subjectId: string;
  hardness: ExamPaperHardness;
  maxMarks: number;
  flavour: PaperSubjectFlavour;
  className: string;
  subjectLabel: string;
}): { system: string; userMessage: string } {
  const system = [
    "You are an experienced Indian CBSE school teacher drafting an exam question paper.",
    "Output JSON only with shape:",
    '{"sections":[{"title":"Section A","instructions":"...","questions":[{"type":"mcq|short|long|fill|true_false|match|numerical|diagram|primary_picture","text":"...","marks":2,"options":["A","B"],"answerKey":"teacher key","hardness":"easy|medium|hard"}]}],"explanation":["brief note"]}',
    "Use age-appropriate language for the class. Include answerKey for teacher review (not shown to students).",
    "Aim total marks close to maxMarks. Mix question types appropriately.",
  ].join("\n");

  const userMessage = [
    `Class: ${opts.className}`,
    `Subject: ${opts.subjectLabel} (${opts.flavour})`,
    `Hardness: ${opts.hardness}`,
    `Target max marks: ${opts.maxMarks}`,
    "Create 2–4 sections with varied questions suitable for a school test.",
  ].join("\n");

  return { system, userMessage };
}

function stageForClass(masters: MastersState, classId: string): string {
  const cls = masters.classes.find((c) => c.id === classId);
  const group = cls?.groupCode ?? classGroupCodeForName(cls?.name ?? "");
  return group || "MIDDLE";
}

export async function suggestExamPaperDraftLlm(input: {
  masters: MastersState;
  classId: string;
  subjectId: string;
  hardness: ExamPaperHardness;
  maxMarks: number;
}): Promise<
  | {
      ok: true;
      sections: ExamPaperSection[];
      explanation: string[];
      engine: "openai" | "gemini";
    }
  | { ok: false; error: string }
> {
  const flavour = detectSubjectFlavour(
    input.masters,
    input.subjectId,
    stageForClass(input.masters, input.classId),
  );
  const { system, userMessage } = buildDraftPrompt({
    ...input,
    flavour,
    className: classLabel(input.masters, input.classId),
    subjectLabel: subjectName(input.masters, input.subjectId),
  });

  const llm = await generateExamPaperJson({ system, userMessage });
  if (!llm.ok) return { ok: false, error: llm.error };

  const engine = llm.engine === "openai" ? "openai" : "gemini";
  let parsed: LlmDraft;
  try {
    parsed = JSON.parse(llm.text) as LlmDraft;
  } catch {
    return { ok: false, error: "AI returned invalid JSON — use local draft or retry" };
  }

  const sections = parseSections(parsed, input.hardness);
  if (!sections.length) {
    return { ok: false, error: "AI draft had no usable questions" };
  }

  const total = sections.reduce(
    (s, sec) => s + sec.questions.reduce((a, q) => a + q.marks, 0),
    0,
  );
  const explanation = Array.isArray(parsed.explanation)
    ? parsed.explanation.map(String)
    : [];
  explanation.unshift(
    `AI draft (${llm.engine}) · ~${total} marks (target ${input.maxMarks}). Edit every line before printing.`,
  );

  return { ok: true, sections, explanation, engine };
}

export async function suggestMoreQuestionsLlm(input: {
  masters: MastersState;
  classId: string;
  subjectId: string;
  hardness: ExamPaperHardness;
  count?: number;
  excludeTexts?: string[];
}): Promise<
  | { ok: true; questions: ExamPaperQuestion[]; engine: "openai" | "gemini" }
  | { ok: false; error: string }
> {
  const count = input.count ?? 2;
  const system = [
    "You are a CBSE teacher adding more exam questions.",
    'Output JSON: {"questions":[{"type":"short","text":"...","marks":2,"options":[],"answerKey":"...","hardness":"medium"}]}',
    "JSON only.",
  ].join("\n");

  const userMessage = [
    `Class: ${classLabel(input.masters, input.classId)}`,
    `Subject: ${subjectName(input.masters, input.subjectId)}`,
    `Hardness: ${input.hardness === "mixed" ? "medium" : input.hardness}`,
    `Add ${count} new questions. Do not repeat:`,
    ...(input.excludeTexts || []).slice(0, 8).map((t) => `- ${t.slice(0, 120)}`),
  ].join("\n");

  const llm = await generateExamPaperJson({ system, userMessage });
  if (!llm.ok) return { ok: false, error: llm.error };

  const engine = llm.engine === "openai" ? "openai" : "gemini";

  let parsed: { questions?: LlmQuestion[] };
  try {
    parsed = JSON.parse(llm.text) as { questions?: LlmQuestion[] };
  } catch {
    return { ok: false, error: "Invalid AI response" };
  }

  const hardness = input.hardness === "mixed" ? "medium" : input.hardness;
  const questions = (parsed.questions || [])
    .map((q) => toQuestion(q, hardness))
    .filter((q) => q.text.length > 0)
    .slice(0, count);

  if (!questions.length) {
    return { ok: false, error: "No questions in AI response" };
  }

  return { ok: true, questions, engine };
}
