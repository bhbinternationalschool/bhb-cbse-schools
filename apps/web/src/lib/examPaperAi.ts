/**
 * Local AI paper assistant — suggests sections + questions by class stage,
 * subject flavour, and hardness. No external LLM; offline and editable.
 */

import {
  emptyQuestion,
  emptySection,
  type ExamPaperHardness,
  type ExamPaperQuestion,
  type ExamPaperQuestionType,
  type ExamPaperSection,
} from "@/lib/examPapers";
import { classGroupCodeForName, type MastersState } from "@/lib/masters";

export type PaperSubjectFlavour =
  | "maths"
  | "physics"
  | "chemistry"
  | "biology"
  | "science"
  | "english"
  | "hindi"
  | "sst"
  | "primary"
  | "general";

export type AiSuggestInput = {
  masters: MastersState;
  classId: string;
  subjectId: string;
  hardness: ExamPaperHardness;
  maxMarks: number;
  /** Prefer this many questions overall (soft) */
  targetQuestions?: number;
};

export type AiSuggestResult = {
  sections: ExamPaperSection[];
  explanation: string[];
  flavour: PaperSubjectFlavour;
  stage: string;
};

function stageForClass(masters: MastersState, classId: string): string {
  const cls = masters.classes.find((c) => c.id === classId);
  const group = cls?.groupCode ?? classGroupCodeForName(cls?.name ?? "");
  return group || "MIDDLE";
}

export function detectSubjectFlavour(
  masters: MastersState,
  subjectId: string,
  classStage: string,
): PaperSubjectFlavour {
  const sub = (masters.subjects ?? []).find((s) => s.id === subjectId);
  const blob = `${sub?.code || ""} ${sub?.nameEn || ""}`.toLowerCase();
  if (
    classStage === "PRE_PRIMARY" ||
    classStage === "PRIMARY" ||
    /\b(evs|env|nursery|lkg|ukg)\b/.test(blob)
  ) {
    if (/math|ganit|numer/.test(blob)) return "maths";
    if (/eng|hindi|lang/.test(blob)) return "english";
    return "primary";
  }
  if (/phys|bhaut/.test(blob)) return "physics";
  if (/chem|rasayan/.test(blob)) return "chemistry";
  if (/bio|jiv/.test(blob)) return "biology";
  if (/\bsci|vigyan/.test(blob)) return "science";
  if (/math|ganit|arith/.test(blob)) return "maths";
  if (/\beng/.test(blob)) return "english";
  if (/hindi|हि/.test(blob)) return "hindi";
  if (/sst|social|hist|geo|civ|political/.test(blob)) return "sst";
  return "general";
}

type BankItem = {
  type: ExamPaperQuestionType;
  text: string;
  marks: number;
  hardness: "easy" | "medium" | "hard";
  options?: string[];
  formulas?: string[];
  icons?: string[];
  answerKey?: string;
};

const BANK: Record<PaperSubjectFlavour, BankItem[]> = {
  maths: [
    {
      type: "mcq",
      text: "The value of √64 is:",
      marks: 1,
      hardness: "easy",
      options: ["6", "8", "16", "32"],
      formulas: ["√64"],
      answerKey: "8",
    },
    {
      type: "numerical",
      text: "Find the HCF of 24 and 36.",
      marks: 2,
      hardness: "easy",
    },
    {
      type: "short",
      text: "Define a prime number. Give two examples.",
      marks: 2,
      hardness: "easy",
    },
    {
      type: "numerical",
      text: "Solve: 3x + 5 = 20",
      marks: 2,
      hardness: "medium",
      formulas: ["3x + 5 = 20"],
    },
    {
      type: "long",
      text: "Prove that the sum of any two odd numbers is even. Illustrate with an example.",
      marks: 4,
      hardness: "medium",
    },
    {
      type: "numerical",
      text: "Using the quadratic formula, solve x² − 5x + 6 = 0.",
      marks: 4,
      hardness: "hard",
      formulas: ["x = (−b ± √(b² − 4ac)) / 2a", "x² − 5x + 6 = 0"],
    },
    {
      type: "long",
      text: "In △ABC, if ∠A = 90° and AB = 6 cm, AC = 8 cm, find BC. State the theorem used.",
      marks: 5,
      hardness: "hard",
      formulas: ["a² + b² = c²"],
    },
    {
      type: "fill",
      text: "The area of a circle is ____ where r is the radius.",
      marks: 1,
      hardness: "easy",
      formulas: ["πr²"],
      answerKey: "πr²",
    },
  ],
  physics: [
    {
      type: "mcq",
      text: "SI unit of force is:",
      marks: 1,
      hardness: "easy",
      options: ["Joule", "Newton", "Watt", "Pascal"],
      answerKey: "Newton",
    },
    {
      type: "short",
      text: "State Newton’s second law of motion.",
      marks: 2,
      hardness: "easy",
      formulas: ["F = ma"],
    },
    {
      type: "numerical",
      text: "A body starts from rest and accelerates at 2 m/s² for 5 s. Find the distance travelled.",
      marks: 3,
      hardness: "medium",
      formulas: ["s = ut + ½at²"],
    },
    {
      type: "long",
      text: "Derive the relation v² = u² + 2as from the equations of motion.",
      marks: 5,
      hardness: "hard",
      formulas: ["v = u + at", "s = ut + ½at²", "v² = u² + 2as"],
    },
    {
      type: "true_false",
      text: "Work done is zero when force is perpendicular to displacement.",
      marks: 1,
      hardness: "medium",
      answerKey: "True",
    },
    {
      type: "short",
      text: "Define ohm’s law and write its formula.",
      marks: 2,
      hardness: "easy",
      formulas: ["V = IR"],
    },
  ],
  chemistry: [
    {
      type: "mcq",
      text: "Chemical formula of water is:",
      marks: 1,
      hardness: "easy",
      options: ["H₂O", "CO₂", "O₂", "NaCl"],
      formulas: ["H₂O"],
      answerKey: "H₂O",
    },
    {
      type: "short",
      text: "What is a physical change? Give one example.",
      marks: 2,
      hardness: "easy",
    },
    {
      type: "fill",
      text: "The pH of a neutral solution is ____.",
      marks: 1,
      hardness: "easy",
      answerKey: "7",
    },
    {
      type: "long",
      text: "Differentiate between metals and non-metals with at least three points each.",
      marks: 4,
      hardness: "medium",
    },
    {
      type: "short",
      text: "Write the balanced equation for the reaction of sodium with chlorine.",
      marks: 3,
      hardness: "hard",
      formulas: ["2Na + Cl₂ → 2NaCl"],
    },
  ],
  biology: [
    {
      type: "mcq",
      text: "The process by which green plants make food is called:",
      marks: 1,
      hardness: "easy",
      options: ["Respiration", "Photosynthesis", "Transpiration", "Digestion"],
      answerKey: "Photosynthesis",
    },
    {
      type: "short",
      text: "Write the word equation of photosynthesis.",
      marks: 2,
      hardness: "easy",
      formulas: ["6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂"],
    },
    {
      type: "diagram",
      text: "Draw a neat labelled diagram of a plant cell. Label any four parts.",
      marks: 4,
      hardness: "medium",
    },
    {
      type: "long",
      text: "Explain the human digestive system briefly. Name the organs involved.",
      marks: 5,
      hardness: "hard",
    },
    {
      type: "true_false",
      text: "Mitochondria are known as the powerhouse of the cell.",
      marks: 1,
      hardness: "easy",
      answerKey: "True",
    },
  ],
  science: [
    {
      type: "mcq",
      text: "Which of the following is a renewable source of energy?",
      marks: 1,
      hardness: "easy",
      options: ["Coal", "Petrol", "Solar", "Diesel"],
      answerKey: "Solar",
    },
    {
      type: "short",
      text: "Name any two methods of separating mixtures.",
      marks: 2,
      hardness: "easy",
    },
    {
      type: "diagram",
      text: "Draw a circuit diagram showing a cell, a switch and a bulb in series.",
      marks: 3,
      hardness: "medium",
    },
    {
      type: "long",
      text: "Explain the water cycle with a neat labelled diagram.",
      marks: 5,
      hardness: "medium",
    },
    {
      type: "numerical",
      text: "Convert 37°C to Kelvin.",
      marks: 2,
      hardness: "medium",
      formulas: ["K = °C + 273"],
    },
  ],
  english: [
    {
      type: "mcq",
      text: "Choose the correct synonym of ‘happy’:",
      marks: 1,
      hardness: "easy",
      options: ["Sad", "Joyful", "Angry", "Tired"],
      answerKey: "Joyful",
    },
    {
      type: "short",
      text: "Write two sentences using the word ‘because’.",
      marks: 2,
      hardness: "easy",
    },
    {
      type: "long",
      text: "Write a letter to your principal requesting leave for two days.",
      marks: 5,
      hardness: "medium",
    },
    {
      type: "long",
      text: "Write a short paragraph (80–100 words) on ‘My School’.",
      marks: 5,
      hardness: "medium",
    },
    {
      type: "fill",
      text: "The past tense of ‘go’ is ____.",
      marks: 1,
      hardness: "easy",
      answerKey: "went",
    },
  ],
  hindi: [
    {
      type: "mcq",
      text: "‘पुस्तक’ शब्द का बहुवचन है:",
      marks: 1,
      hardness: "easy",
      options: ["पुस्तकें", "पुस्तकों", "पुस्तक", "पुस्तकीय"],
      answerKey: "पुस्तकें",
    },
    {
      type: "short",
      text: "‘विद्यालय’ शब्द से दो वाक्य बनाइए।",
      marks: 2,
      hardness: "easy",
    },
    {
      type: "long",
      text: "‘मेरा प्रिय त्योहार’ विषय पर लगभग 80 शब्दों में अनुच्छेद लिखिए।",
      marks: 5,
      hardness: "medium",
    },
    {
      type: "fill",
      text: "‘आना’ क्रिया का भूतकाल रूप ____ है।",
      marks: 1,
      hardness: "easy",
    },
  ],
  sst: [
    {
      type: "mcq",
      text: "The capital of India is:",
      marks: 1,
      hardness: "easy",
      options: ["Mumbai", "New Delhi", "Kolkata", "Chennai"],
      answerKey: "New Delhi",
    },
    {
      type: "short",
      text: "Name any two fundamental rights of Indian citizens.",
      marks: 2,
      hardness: "easy",
    },
    {
      type: "long",
      text: "Describe the three organs of government in India.",
      marks: 5,
      hardness: "medium",
    },
    {
      type: "match",
      text: "Match the following: (a) Himalayas (b) Thar (c) Ganga — with Mountain / Desert / River.",
      marks: 3,
      hardness: "easy",
      options: ["Himalayas — Mountain", "Thar — Desert", "Ganga — River"],
    },
  ],
  primary: [
    {
      type: "primary_picture",
      text: "Circle the fruits. Cross out the animals.",
      marks: 2,
      hardness: "easy",
      icons: ["🍎", "🐶", "🍌", "🐱", "🍇"],
    },
    {
      type: "mcq",
      text: "How many legs does a dog have?",
      marks: 1,
      hardness: "easy",
      options: ["2", "3", "4", "6"],
      icons: ["🐶"],
      answerKey: "4",
    },
    {
      type: "fill",
      text: "The sun rises in the ____.",
      marks: 1,
      hardness: "easy",
      icons: ["☀️"],
      answerKey: "east",
    },
    {
      type: "short",
      text: "Write the names of any three colours you see in the rainbow.",
      marks: 2,
      hardness: "easy",
      icons: ["🌈"],
    },
    {
      type: "primary_picture",
      text: "Count and write: How many stars?",
      marks: 2,
      hardness: "easy",
      icons: ["⭐", "⭐", "⭐", "⭐", "⭐"],
      answerKey: "5",
    },
    {
      type: "short",
      text: "Draw a house and colour it. Write two sentences about your house.",
      marks: 4,
      hardness: "medium",
      icons: ["🏠"],
    },
  ],
  general: [
    {
      type: "short",
      text: "Answer briefly: What did you learn in this chapter? (any three points)",
      marks: 3,
      hardness: "easy",
    },
    {
      type: "mcq",
      text: "Choose the correct option for the statement given in your textbook exercise 1.",
      marks: 1,
      hardness: "easy",
      options: ["A", "B", "C", "D"],
    },
    {
      type: "long",
      text: "Write a detailed answer explaining the main concept of this unit with examples.",
      marks: 5,
      hardness: "medium",
    },
    {
      type: "true_false",
      text: "State whether the following statement is True or False (edit the statement for your chapter).",
      marks: 1,
      hardness: "easy",
    },
  ],
};

function hardnessOk(
  item: BankItem,
  wanted: ExamPaperHardness,
): boolean {
  if (wanted === "mixed") return true;
  return item.hardness === wanted;
}

function toQuestion(item: BankItem): ExamPaperQuestion {
  return emptyQuestion({
    type: item.type,
    text: item.text,
    marks: item.marks,
    options: item.options || [],
    formulas: item.formulas || [],
    icons: item.icons || [],
    answerKey: item.answerKey || "",
    hardness: item.hardness,
    source: "ai",
  });
}

/**
 * Build a suggested paper structure with sections A/B/C and questions
 * filtered by hardness. Teachers edit every line after insert.
 */
export function suggestExamPaperDraft(
  input: AiSuggestInput,
): AiSuggestResult {
  const stage = stageForClass(input.masters, input.classId);
  const flavour = detectSubjectFlavour(
    input.masters,
    input.subjectId,
    stage,
  );
  const bank = BANK[flavour] || BANK.general;
  const pool = bank.filter((b) => hardnessOk(b, input.hardness));
  const use = pool.length ? pool : bank;

  const target = input.targetQuestions ?? Math.min(12, Math.max(6, use.length));
  const picked = use.slice(0, target);

  const objective = picked.filter((q) =>
    ["mcq", "true_false", "fill", "match", "primary_picture"].includes(q.type),
  );
  const shortish = picked.filter((q) =>
    ["short", "numerical", "diagram"].includes(q.type),
  );
  const longish = picked.filter((q) => q.type === "long");
  // leftovers into short
  const used = new Set(
    [...objective, ...shortish, ...longish].map((q) => q.text),
  );
  for (const q of picked) {
    if (!used.has(q.text)) shortish.push(q);
  }

  const sections: ExamPaperSection[] = [];
  if (objective.length) {
    sections.push(
      emptySection({
        title: "Section A — Objective",
        instructions: "Choose the correct option / fill / match as asked.",
        questions: objective.map(toQuestion),
      }),
    );
  }
  if (shortish.length) {
    sections.push(
      emptySection({
        title: "Section B — Short / Numerical",
        instructions: "Answer briefly. Show working where required.",
        questions: shortish.map(toQuestion),
      }),
    );
  }
  if (longish.length) {
    sections.push(
      emptySection({
        title: "Section C — Long answers",
        instructions: "Write detailed answers. Draw diagrams where asked.",
        questions: longish.map(toQuestion),
      }),
    );
  }
  if (!sections.length) {
    sections.push(
      emptySection({
        title: "Section A",
        instructions: "Answer all questions.",
        questions: use.slice(0, 4).map(toQuestion),
      }),
    );
  }

  // Scale marks roughly toward maxMarks
  const total = sections.reduce(
    (s, sec) => s + sec.questions.reduce((a, q) => a + q.marks, 0),
    0,
  );
  const explanation = [
    `Suggested ${flavour} paper for stage ${stage} · hardness ${input.hardness}.`,
    `${sections.length} section(s), ${picked.length} question(s), ~${total} marks (target max ${input.maxMarks}).`,
    "Edit every question — AI draft is a starting point, not a final paper.",
  ];
  if (total !== input.maxMarks && input.maxMarks > 0) {
    explanation.push(
      `Tip: adjust question marks so the set totals ${input.maxMarks}.`,
    );
  }

  return { sections, explanation, flavour, stage };
}

/** Suggest more questions to append into an existing section */
export function suggestMoreQuestions(input: {
  masters: MastersState;
  classId: string;
  subjectId: string;
  hardness: ExamPaperHardness;
  count?: number;
  excludeTexts?: string[];
}): ExamPaperQuestion[] {
  const stage = stageForClass(input.masters, input.classId);
  const flavour = detectSubjectFlavour(
    input.masters,
    input.subjectId,
    stage,
  );
  const exclude = new Set(input.excludeTexts || []);
  const bank = (BANK[flavour] || BANK.general).filter(
    (b) => hardnessOk(b, input.hardness) && !exclude.has(b.text),
  );
  return bank.slice(0, input.count ?? 3).map(toQuestion);
}
