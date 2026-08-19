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
  normalizeBloomLevel,
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
  "case_study",
  "assertion_reason",
  "competency",
]);

const VALID_HARDNESS = new Set(["easy", "medium", "hard"]);

/**
 * Syllabus units the paper should draw from — sent by the client from the
 * Teaching module (title, code, learning outcomes, CBSE LO codes). The
 * model may only tag a question with a competencyCode / unitId that appears
 * here; anything else is dropped on parse so an invented code never lands
 * on a paper.
 */
export type ExamPaperUnitFact = {
  id: string;
  code: string;
  title: string;
  level: "chapter" | "topic";
  learningOutcomes: string;
  competencyCodes: string[];
};

export function cleanUnitFacts(raw: unknown): ExamPaperUnitFact[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  return raw
    .map((u) => {
      const x = (u ?? {}) as Record<string, unknown>;
      const id = str(x.id, 60);
      const title = str(x.title, 120);
      if (!id || !title) return null;
      return {
        id,
        code: str(x.code, 20),
        title,
        level: x.level === "topic" ? ("topic" as const) : ("chapter" as const),
        learningOutcomes: str(x.learningOutcomes, 1500),
        competencyCodes: Array.isArray(x.competencyCodes)
          ? Array.from(
              new Set(
                x.competencyCodes.map((c) => str(c, 20).toUpperCase()).filter(Boolean),
              ),
            ).slice(0, 12)
          : [],
      };
    })
    .filter((u): u is NonNullable<typeof u> => !!u)
    .slice(0, 12);
}

type LlmQuestion = {
  type?: string;
  text?: string;
  marks?: number;
  options?: string[];
  answerKey?: string;
  hardness?: string;
  competencyCode?: string;
  unitId?: string;
  bloomLevel?: string;
  markingScheme?: string[];
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

/** Codes and unit ids the model is allowed to use — anything else is dropped. */
type TagAllowlist = { codes: Set<string>; unitIds: Set<string> };

function allowlistFor(units: ExamPaperUnitFact[]): TagAllowlist {
  return {
    codes: new Set(units.flatMap((u) => u.competencyCodes)),
    unitIds: new Set(units.map((u) => u.id)),
  };
}

function toQuestion(
  q: LlmQuestion,
  defaultHardness: ExamPaperHardness,
  allow: TagAllowlist,
): ExamPaperQuestion {
  const type = VALID_TYPES.has(q.type as ExamPaperQuestionType)
    ? (q.type as ExamPaperQuestionType)
    : "short";
  const hardness =
    q.hardness && VALID_HARDNESS.has(q.hardness)
      ? (q.hardness as "easy" | "medium" | "hard")
      : defaultHardness === "mixed"
        ? "medium"
        : defaultHardness;
  const code = String(q.competencyCode || "").trim().toUpperCase();
  const unitId = String(q.unitId || "").trim();
  return emptyQuestion({
    type,
    text: (q.text || "").trim(),
    marks: typeof q.marks === "number" && q.marks > 0 ? q.marks : 1,
    options: Array.isArray(q.options) ? q.options.map(String) : [],
    answerKey: (q.answerKey || "").trim(),
    hardness,
    source: "ai",
    // Never let the model mint an LO code or point at a chapter it wasn't given.
    competencyCode: allow.codes.has(code) ? code : "",
    unitId: allow.unitIds.has(unitId) ? unitId : "",
    bloomLevel: normalizeBloomLevel(q.bloomLevel),
    markingScheme: Array.isArray(q.markingScheme)
      ? q.markingScheme.map((m) => String(m ?? "").trim()).filter(Boolean).slice(0, 12)
      : [],
  });
}

function parseSections(
  raw: LlmDraft,
  defaultHardness: ExamPaperHardness,
  allow: TagAllowlist,
): ExamPaperSection[] {
  const sections: ExamPaperSection[] = [];
  for (const sec of raw.sections || []) {
    const questions = (sec.questions || [])
      .map((q) => toQuestion(q, defaultHardness, allow))
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

/** How the paper's units and their outcomes are shown to the model. */
function unitsBlock(units: ExamPaperUnitFact[]): string[] {
  if (units.length === 0) return ["Syllabus coverage: whole subject (no chapters specified)."];
  const L = ["Syllabus coverage — draw every question from these units only:"];
  for (const u of units) {
    L.push(
      `- unitId=${u.id} [${u.level}] ${u.code ? `${u.code} · ` : ""}${u.title}${
        u.competencyCodes.length ? ` · LO codes: ${u.competencyCodes.join(", ")}` : ""
      }`,
    );
    const los = u.learningOutcomes
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 8);
    for (const lo of los) L.push(`    outcome: ${lo}`);
  }
  return L;
}

const FORMAT_RULES = [
  "Question types and how to write each:",
  "- mcq: 4 options, exactly one correct; answerKey is the option text.",
  "- assertion_reason: text = 'Assertion (A): … Reason (R): …'; options must be exactly the four CBSE choices: 'Both A and R are true and R is the correct explanation of A', 'Both A and R are true but R is not the correct explanation of A', 'A is true but R is false', 'A is false but R is true'; answerKey names the correct one.",
  "- case_study: text = a short passage / data table / source (60–120 words, original, age-appropriate) followed by 3–4 numbered sub-questions on new lines, each with its own marks in brackets; marks = total; markingScheme lists one line per sub-question.",
  "- competency: an application / HOTS item set in a real-life or unfamiliar context that requires using the concept, not recalling it; bloomLevel apply or above.",
  "- numerical: give the worked answer in answerKey and step marks in markingScheme so the total equals marks.",
  "- short / long / fill / true_false / match / diagram / primary_picture: as usual for a school test.",
  "For every question also give: competencyCode (one of the LO codes listed for its unit, or \"\" if that unit has none — never invent a code), unitId (the unitId it is drawn from, \"\" if whole-subject), bloomLevel (remember|understand|apply|analyse|evaluate|create), markingScheme (array of strings; step-wise value points for the teacher copy — required for anything above 1 mark).",
];

function buildDraftPrompt(opts: {
  masters: MastersState;
  classId: string;
  subjectId: string;
  hardness: ExamPaperHardness;
  maxMarks: number;
  flavour: PaperSubjectFlavour;
  className: string;
  subjectLabel: string;
  units: ExamPaperUnitFact[];
  competencyShare: number;
}): { system: string; userMessage: string } {
  const system = [
    "You are an experienced Indian CBSE school teacher drafting an exam question paper that follows the board's competency-based assessment pattern.",
    "Output JSON only with shape:",
    '{"sections":[{"title":"Section A","instructions":"...","questions":[{"type":"mcq|short|long|fill|true_false|match|numerical|diagram|primary_picture|case_study|assertion_reason|competency","text":"...","marks":2,"options":["A","B"],"answerKey":"teacher key","hardness":"easy|medium|hard","competencyCode":"","unitId":"","bloomLevel":"apply","markingScheme":["step 1 — 1 mark","step 2 — 1 mark"]}]}],"explanation":["brief note"]}',
    ...FORMAT_RULES,
    "Use age-appropriate language for the class. answerKey and markingScheme are for the teacher only.",
    "The marks of all questions MUST add up to exactly maxMarks — before answering, total your marks and add or resize questions until they do; a paper that is short of maxMarks is unusable. Sections in the usual CBSE order: objective (mcq / assertion_reason / fill / true_false) first, then short, then long / case_study / competency.",
    "Do not reuse a passage, context or numbers across questions. No question may depend on a diagram you cannot describe in text.",
  ].join("\n");

  const userMessage = [
    `Class: ${opts.className}`,
    `Subject: ${opts.subjectLabel} (${opts.flavour})`,
    `Hardness: ${opts.hardness}`,
    `Target max marks: ${opts.maxMarks} (the paper must total exactly this)`,
    `Competency-based share: about ${opts.competencyShare}% of marks from case_study / assertion_reason / competency items (CBSE weighting); the rest conventional.`,
    ...unitsBlock(opts.units),
    "Create 3–5 sections with varied questions suitable for a school test.",
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
  units?: ExamPaperUnitFact[];
  /** % of marks from competency-based formats; CBSE weighting is ~40–50 for IX–XII, lower below */
  competencyShare?: number;
}): Promise<
  | {
      ok: true;
      sections: ExamPaperSection[];
      explanation: string[];
      engine: "openai" | "gemini";
      generationId: string;
    }
  | { ok: false; error: string }
> {
  const flavour = detectSubjectFlavour(
    input.masters,
    input.subjectId,
    stageForClass(input.masters, input.classId),
  );
  const units = input.units ?? [];
  const stage = stageForClass(input.masters, input.classId);
  const competencyShare =
    typeof input.competencyShare === "number"
      ? Math.max(0, Math.min(100, Math.round(input.competencyShare)))
      : stage === "SENIOR" || stage === "SECONDARY"
        ? 50
        : stage === "MIDDLE"
          ? 30
          : 10;
  const { system, userMessage } = buildDraftPrompt({
    ...input,
    flavour,
    className: classLabel(input.masters, input.classId),
    subjectLabel: subjectName(input.masters, input.subjectId),
    units,
    competencyShare,
  });

  const llm = await generateExamPaperJson({ system, userMessage, promptVersion: "v2" });
  if (!llm.ok) return { ok: false, error: llm.error };

  const engine = llm.engine === "openai" ? "openai" : "gemini";
  let parsed: LlmDraft;
  try {
    parsed = JSON.parse(llm.text) as LlmDraft;
  } catch {
    return { ok: false, error: "AI returned invalid JSON — use local draft or retry" };
  }

  const sections = parseSections(parsed, input.hardness, allowlistFor(units));
  if (!sections.length) {
    return { ok: false, error: "AI draft had no usable questions" };
  }

  // Models routinely stop 30–50% short of maxMarks whatever the prompt says.
  // One deterministic top-up: ask for questions worth exactly the shortfall
  // and append them to the last section. Still a draft the teacher edits.
  let total = sections.reduce(
    (s, sec) => s + sec.questions.reduce((a, q) => a + q.marks, 0),
    0,
  );
  const shortfall = input.maxMarks - total;
  if (shortfall >= 2) {
    const topUp = await suggestMoreQuestionsLlm({
      masters: input.masters,
      classId: input.classId,
      subjectId: input.subjectId,
      hardness: input.hardness,
      count: Math.min(8, Math.max(1, Math.ceil(shortfall / 3))),
      excludeTexts: sections.flatMap((sec) => sec.questions.map((q) => q.text)),
      units,
      exactMarks: shortfall,
    });
    if (topUp.ok && topUp.questions.length) {
      const last = sections[sections.length - 1]!;
      // Never overshoot: take questions in order until the shortfall is met.
      let room = shortfall;
      const take: ExamPaperQuestion[] = [];
      for (const q of topUp.questions) {
        if (q.marks > room) continue;
        take.push(q);
        room -= q.marks;
        if (room <= 0) break;
      }
      last.questions.push(...take);
      total = sections.reduce(
        (s, sec) => s + sec.questions.reduce((a, q) => a + q.marks, 0),
        0,
      );
    }
  }
  const explanation = Array.isArray(parsed.explanation)
    ? parsed.explanation.map(String)
    : [];
  const tagged = sections.reduce(
    (n, sec) => n + sec.questions.filter((q) => q.competencyCode).length,
    0,
  );
  const compMarks = sections.reduce(
    (n, sec) =>
      n +
      sec.questions
        .filter((q) => q.type === "case_study" || q.type === "assertion_reason" || q.type === "competency")
        .reduce((a, q) => a + q.marks, 0),
    0,
  );
  explanation.unshift(
    `AI draft (${llm.engine}) · ~${total} marks (target ${input.maxMarks}) · ${compMarks} marks competency-based${
      units.length ? ` · ${tagged} question(s) LO-tagged` : ""
    }. Edit every line before printing.`,
  );

  return { ok: true, sections, explanation, engine, generationId: llm.generationId };
}

export async function suggestMoreQuestionsLlm(input: {
  masters: MastersState;
  classId: string;
  subjectId: string;
  hardness: ExamPaperHardness;
  count?: number;
  excludeTexts?: string[];
  units?: ExamPaperUnitFact[];
  /** Ask for a specific format, e.g. "case_study"; omit for the model's choice */
  type?: ExamPaperQuestionType;
  /** The new questions must add up to exactly this many marks (draft top-up) */
  exactMarks?: number;
  /** Extra instruction, e.g. "remedial practice for students who scored under 50 % on M802" */
  focus?: string;
  promptVersion?: string;
}): Promise<
  | { ok: true; questions: ExamPaperQuestion[]; engine: "openai" | "gemini"; generationId: string }
  | { ok: false; error: string }
> {
  const count = input.count ?? 2;
  const units = input.units ?? [];
  const wantType = input.type && VALID_TYPES.has(input.type) ? input.type : null;
  const system = [
    "You are a CBSE teacher adding more exam questions.",
    'Output JSON: {"questions":[{"type":"short","text":"...","marks":2,"options":[],"answerKey":"...","hardness":"medium","competencyCode":"","unitId":"","bloomLevel":"apply","markingScheme":[]}]}',
    ...FORMAT_RULES,
    "JSON only.",
  ].join("\n");

  const userMessage = [
    `Class: ${classLabel(input.masters, input.classId)}`,
    `Subject: ${subjectName(input.masters, input.subjectId)}`,
    `Hardness: ${input.hardness === "mixed" ? "medium" : input.hardness}`,
    ...unitsBlock(units),
    ...(input.focus ? [`Purpose: ${input.focus.slice(0, 600)}`] : []),
    `Add ${count} new question(s)${wantType ? ` of type ${wantType}` : ""}${
      input.exactMarks ? ` whose marks add up to exactly ${input.exactMarks}` : ""
    }. Do not repeat:`,
    ...(input.excludeTexts || []).slice(0, 8).map((t) => `- ${t.slice(0, 120)}`),
  ].join("\n");

  const llm = await generateExamPaperJson({
    system,
    userMessage,
    promptVersion: input.promptVersion ?? "v2",
  });
  if (!llm.ok) return { ok: false, error: llm.error };

  const engine = llm.engine === "openai" ? "openai" : "gemini";

  let parsed: { questions?: LlmQuestion[] };
  try {
    parsed = JSON.parse(llm.text) as { questions?: LlmQuestion[] };
  } catch {
    return { ok: false, error: "Invalid AI response" };
  }

  const hardness = input.hardness === "mixed" ? "medium" : input.hardness;
  const allow = allowlistFor(units);
  const questions = (parsed.questions || [])
    .map((q) => toQuestion(q, hardness, allow))
    .filter((q) => q.text.length > 0)
    .slice(0, count);

  if (!questions.length) {
    return { ok: false, error: "No questions in AI response" };
  }

  return { ok: true, questions, engine, generationId: llm.generationId };
}

/* ─── Blueprint cells ────────────────────────────────────────────── */

export type BlueprintCellRequest = {
  rowId: string;
  type: ExamPaperQuestionType;
  /** Marks per question */
  marks: number;
  /** Questions still needed after the bank was consulted */
  count: number;
  hardness: ExamPaperHardness;
  unitId: string;
  competencyCode: string;
};

export function cleanBlueprintCells(raw: unknown): BlueprintCellRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      const rowId = String(x.rowId ?? "").trim().slice(0, 40);
      const type = String(x.type ?? "") as ExamPaperQuestionType;
      const marks = Number(x.marks);
      const count = Math.floor(Number(x.count));
      if (!rowId || !VALID_TYPES.has(type) || !(marks > 0) || !(count > 0)) return null;
      const h = String(x.hardness ?? "mixed");
      return {
        rowId,
        type,
        marks: Math.min(20, marks),
        count: Math.min(10, count),
        hardness: (h === "easy" || h === "medium" || h === "hard" ? h : "mixed") as ExamPaperHardness,
        unitId: String(x.unitId ?? "").trim().slice(0, 60),
        competencyCode: String(x.competencyCode ?? "").trim().toUpperCase().slice(0, 40),
      };
    })
    .filter((c): c is NonNullable<typeof c> => !!c)
    .slice(0, 12);
}

/**
 * Generate the questions a blueprint still needs after the bank was
 * consulted — one model call per cell so type, marks-each, unit and LO
 * code are exact. Tags are restricted to the units given (allow-list).
 */
export async function generateBlueprintCellsLlm(input: {
  masters: MastersState;
  classId: string;
  subjectId: string;
  units: ExamPaperUnitFact[];
  cells: BlueprintCellRequest[];
}): Promise<{
  cells: { rowId: string; questions: ExamPaperQuestion[]; error?: string }[];
  engine: "openai" | "gemini" | "none";
  generationIds: string[];
}> {
  const out: { rowId: string; questions: ExamPaperQuestion[]; error?: string }[] = [];
  const generationIds: string[] = [];
  let engine: "openai" | "gemini" | "none" = "none";
  for (const cell of input.cells) {
    const unit = input.units.find((u) => u.id === cell.unitId);
    const units = unit ? [unit] : input.units;
    const r = await suggestMoreQuestionsLlm({
      masters: input.masters,
      classId: input.classId,
      subjectId: input.subjectId,
      hardness: cell.hardness,
      count: cell.count,
      units,
      type: cell.type,
      exactMarks: cell.count * cell.marks,
      focus: `Blueprint cell: exactly ${cell.count} question(s) of type ${cell.type}, EACH worth exactly ${cell.marks} mark(s)${
        unit ? `, drawn only from ${unit.code ? `${unit.code} · ` : ""}${unit.title}` : ""
      }${cell.competencyCode ? `, each assessing LO code ${cell.competencyCode} (set competencyCode to it)` : ""}.`,
      promptVersion: "v2-blueprint",
    });
    if (!r.ok) {
      out.push({ rowId: cell.rowId, questions: [], error: r.error });
      continue;
    }
    engine = r.engine;
    generationIds.push(r.generationId);
    // Enforce marks-each and LO tag deterministically; the model is told but not trusted.
    const questions = r.questions.slice(0, cell.count).map((q) => ({
      ...q,
      marks: cell.marks,
      unitId: unit ? unit.id : q.unitId,
      competencyCode:
        cell.competencyCode && unit?.competencyCodes.includes(cell.competencyCode)
          ? cell.competencyCode
          : q.competencyCode,
    }));
    out.push({ rowId: cell.rowId, questions });
  }
  return { cells: out, engine, generationIds };
}
