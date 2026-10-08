/**
 * School answers — UDISE+ profile questions with the same answer for nearly
 * every child, confirmed ONCE by the office instead of typed 200 times.
 *
 * The robot's first live run (ABHI PATEL, 7 Oct 2026) listed sixteen
 * "please type" questions per child; most were BPL / out-of-school / NCC /
 * nationality, whose answer is the school's to give, not the child record's.
 *
 * Unknown must not become fact: an answer is used only after a named person
 * has ticked it here (confirmedBy / confirmedAt), and a child whose own ERP
 * record says otherwise (marked CWSN, admitted under RTE, another nationality)
 * gets the record's answer, never the school default. The robot still fills
 * only EMPTY portal fields and never saves.
 *
 * Stored in module_local_state under "udise_school_answers".
 */

import type { SisStudent } from "@/lib/sis";
import type { UdiseFillField } from "@/lib/udisePortalFill";

export type UdiseSchoolAnswerKey =
  | "indianNational"
  | "notBpl"
  | "notOutOfSchool"
  | "notCwsnUnlessMarked"
  | "rteFromAdmissionType"
  | "noCompetitions"
  | "noNccNssScouts"
  | "noVocational"
  | "mediumEnglish"
  | "promotionByExam";

export type UdiseSchoolAnswers = {
  /** Only keys set true are used. */
  answers: Partial<Record<UdiseSchoolAnswerKey, boolean>>;
  confirmedBy: string;
  confirmedAt: string;
};

export const UDISE_SCHOOL_ANSWERS_KEY = "udise_school_answers" as const;

export const UDISE_SCHOOL_ANSWER_DEFS: {
  key: UdiseSchoolAnswerKey;
  question: string;
  answer: string;
}[] = [
  {
    key: "indianNational",
    question: "4.1.18 Is the student an Indian national?",
    answer: "Yes — except a child whose ERP record names another nationality (left for you)",
  },
  { key: "notBpl", question: "4.1.15 BPL beneficiary?", answer: "No, for every child" },
  {
    key: "notOutOfSchool",
    question: "4.1.19 Identified as Out-of-School-Child in current or previous years?",
    answer: "No, for every child",
  },
  {
    key: "notCwsnUnlessMarked",
    question: "4.1.17 CWSN (child with special needs)?",
    answer: "No — except children marked CWSN in the ERP, who get Yes",
  },
  {
    key: "rteFromAdmissionType",
    question: "4.2.6 Admitted under Section 12(1)(c) of the RTE Act?",
    answer: "Yes for children whose ERP admission type is RTE; No for every other child",
  },
  {
    key: "noCompetitions",
    question: "4.3.3 Appeared in State/National competitions or Olympiads?",
    answer: "No, for every child",
  },
  { key: "noNccNssScouts", question: "4.3.4 Participates in NCC / NSS / Scouts and Guides?", answer: "No to all three, for every child" },
  { key: "noVocational", question: "4.4.1 Undertook any vocational course?", answer: "No, for every child" },
  { key: "mediumEnglish", question: "4.2.3 (a) Medium of instruction", answer: "19 - English, for every child" },
  {
    key: "promotionByExam",
    question: "4.2.7 (a) Result in the previous class — for children who moved up a class",
    answer:
      "Promoted/Passed if last year's class was Class I or higher (exams held); Promoted/Passed without Exam if it was Nursery, LKG or UKG",
  },
];

const radio = (control: string, value: "1" | "2", label: string, shown: string): UdiseFillField => ({
  control,
  kind: "radio",
  value,
  label,
  shown,
});

/** Read a stored blob defensively: anything malformed is "nothing confirmed". */
export function normalizeUdiseSchoolAnswers(raw: unknown): UdiseSchoolAnswers {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const a = (r.answers && typeof r.answers === "object" ? r.answers : {}) as Record<string, unknown>;
  const answers: UdiseSchoolAnswers["answers"] = {};
  for (const d of UDISE_SCHOOL_ANSWER_DEFS) if (a[d.key] === true) answers[d.key] = true;
  const confirmedBy = typeof r.confirmedBy === "string" ? r.confirmedBy.trim() : "";
  const confirmedAt = typeof r.confirmedAt === "string" ? r.confirmedAt.trim() : "";
  // An answer nobody signed for is not an answer.
  if (!confirmedBy || !confirmedAt) return { answers: {}, confirmedBy: "", confirmedAt: "" };
  return { answers, confirmedBy, confirmedAt };
}

function isIndian(nationality: string): boolean | null {
  const n = (nationality || "").trim().toLowerCase();
  if (!n) return null;
  return /^(indian?|bharat(iya)?|bhartiya)$/.test(n);
}

/**
 * Fields from the confirmed school answers for this child, and the portal
 * questions still left (a child the default does not fit).
 */
export function schoolAnswerFields(
  school: UdiseSchoolAnswers,
  s: SisStudent,
): { fields: UdiseFillField[]; left: string[]; covers: Set<string> } {
  const on = (k: UdiseSchoolAnswerKey) => school.answers[k] === true;
  const fields: UdiseFillField[] = [];
  const left: string[] = [];
  /** Portal questions this answer set speaks for, even when it leaves one for a person. */
  const covers = new Set<string>();
  const by = "school answer";

  if (on("indianNational")) {
    covers.add("Nationality");
    // The normaliser writes "Indian" into every empty nationality, so only a
    // NON-Indian value is a fact here — and that child is the office's call.
    if (isIndian(s.nationality) === false) left.push(`Nationality (ERP says “${s.nationality}”)`);
    else fields.push(radio("natIndYN", "1", "Indian national", `Yes (${by})`));
  }
  if (on("notBpl")) {
    covers.add("BPL / AAY");
    fields.push(radio("isBplYN", "2", "BPL", `No (${by})`));
  }
  if (on("notOutOfSchool")) {
    covers.add("Out-of-school child");
    fields.push(radio("ooscYN", "2", "Out-of-school child", `No (${by})`));
  }
  if (on("notCwsnUnlessMarked")) {
    covers.add("CWSN (Yes/No)");
    // A child marked CWSN gets Yes from the ERP record itself (buildUdiseFillPlan).
    if (!s.isCwsn) fields.push(radio("cwsnYN", "2", "CWSN", `No (${by})`));
  }
  if (on("rteFromAdmissionType")) {
    const rte = String(s.studentType || "").toUpperCase() === "RTE";
    fields.push(radio("isRte", rte ? "1" : "2", "RTE 12(1)(c)", rte ? "Yes (ERP admission type RTE)" : `No (${by})`));
    if (rte) left.push("RTE amount claimed (4.2.6 b)");
  }
  if (on("noCompetitions")) fields.push(radio("olympdsNlc", "2", "Competitions / Olympiads", `No (${by})`));
  if (on("noNccNssScouts")) {
    fields.push(radio("nccYn", "2", "NCC", `No (${by})`));
    fields.push(radio("nssYn", "2", "NSS", `No (${by})`));
    fields.push(radio("scoutsYn", "2", "Scouts and Guides", `No (${by})`));
  }
  if (on("noVocational")) fields.push(radio("isUtvcYN", "2", "Vocational course", `No (${by})`));
  if (on("mediumEnglish")) {
    fields.push({ control: "mediumOfInstruction", kind: "select", value: "19", label: "Medium of instruction", shown: `English (${by})` });
  }
  return { fields, left, covers };
}
