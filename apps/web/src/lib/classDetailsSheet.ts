/**
 * My class → Class sheet: the UDISE+ details a class teacher can collect for
 * the whole class in one sitting — measured height and weight, blood group,
 * mother tongue, religion, category, both parents' education and CWSN.
 * Pure: the phone screen and the server use the same fields and checks.
 *
 * Why (7 Oct 2026, 228 children this year): blood group missing for 205,
 * mother tongue 206, father's education 219, mother's education 218,
 * religion 21, category 8; height 1 and weight 14 recorded. The UDISE robot
 * fills the portal from these, so a value typed here once reaches UDISE+.
 *
 * Values are stored the way the ERP already writes them (HINDU, HINDI,
 * GRADUATE …). Parents' education uses the UDISE+ 4.3.7 scale in words that
 * lib/udisePortalFill parentEducationCode reads back exactly.
 */

import { BLOOD_GROUPS, normalizeBloodGroup, STUDENT_CATEGORIES } from "@/lib/sis";
import { checkMeasurement } from "@/lib/studentMeasurements";

export type SheetGroup = "measure" | "blood" | "family" | "education" | "cwsn";

export const SHEET_GROUPS: { id: SheetGroup; label: string; hint: string }[] = [
  { id: "measure", label: "Height & weight", hint: "Measure each child — tape and scale, never a guess" },
  { id: "blood", label: "Blood group", hint: "From a report or the parents; leave blank if not known" },
  { id: "family", label: "Mother tongue, religion, category", hint: "As the family gives it" },
  { id: "education", label: "Parents' education", hint: "Highest class each parent completed" },
  { id: "cwsn", label: "Special needs (CWSN)", hint: "Tick only a child with a disability or special need" },
];

export const RELIGIONS = ["HINDU", "MUSLIM", "CHRISTIAN", "SIKH", "BUDDHIST", "JAIN", "PARSI", "OTHER"] as const;
export const MOTHER_TONGUE_SUGGESTIONS = ["HINDI", "BHOJPURI", "AWADHI", "URDU", "ENGLISH", "BENGALI", "MAITHILI"] as const;

/** UDISE+ 4.3.7 scale, in words parentEducationCode maps to 6,1,2,3,4,5,5. */
export const EDUCATION_LEVELS = [
  "NO SCHOOLING",
  "PRIMARY (CLASS 5)",
  "UPPER PRIMARY (CLASS 8)",
  "SECONDARY (10TH)",
  "HIGHER SECONDARY (12TH)",
  "GRADUATE",
  "POST GRADUATE",
] as const;

/** The values one row of the sheet can carry. Absent key = not changed. */
export type SheetValues = Partial<{
  heightCm: string;
  weightKg: string;
  bloodGroup: string;
  motherTongue: string;
  religion: string;
  category: string;
  fatherQualification: string;
  motherQualification: string;
  isCwsn: boolean;
}>;

/** Which keys each group sends. */
export const GROUP_KEYS: Record<SheetGroup, (keyof SheetValues)[]> = {
  measure: ["heightCm", "weightKg"],
  blood: ["bloodGroup"],
  family: ["motherTongue", "religion", "category"],
  education: ["fatherQualification", "motherQualification"],
  cwsn: ["isCwsn"],
};

export type SheetCheck = { ok: true; values: SheetValues } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Check one child's row. `current` is what the record holds now: a value the
 * ERP already had that is not on our lists (an old "B.A. BTC") may be sent
 * back unchanged, so opening the sheet never forces a re-answer.
 */
export function checkSheetRow(input: Record<string, unknown>, current: SheetValues = {}): SheetCheck {
  const out: SheetValues = {};
  const keep = (k: keyof SheetValues, v: string) => v === str(current[k]);

  if ("heightCm" in input || "weightKg" in input) {
    const m = checkMeasurement(str(input.heightCm), str(input.weightKg));
    if (!m.ok) return m;
    out.heightCm = m.heightCm;
    out.weightKg = m.weightKg;
  }
  if ("bloodGroup" in input) {
    const raw = str(input.bloodGroup);
    const v = normalizeBloodGroup(raw) || (keep("bloodGroup", raw) ? raw : raw.toUpperCase());
    if (!(BLOOD_GROUPS as readonly string[]).includes(v) && !keep("bloodGroup", raw)) {
      return { ok: false, error: "Pick a blood group from the list" };
    }
    out.bloodGroup = v;
  }
  if ("motherTongue" in input) {
    const v = str(input.motherTongue).toUpperCase().replace(/\s+/g, " ");
    if (v && !/^[A-Z][A-Z .-]{1,39}$/.test(v)) return { ok: false, error: "Mother tongue: letters only, e.g. HINDI" };
    out.motherTongue = v;
  }
  if ("religion" in input) {
    const v = str(input.religion).toUpperCase();
    if (v && !(RELIGIONS as readonly string[]).includes(v) && !keep("religion", str(input.religion))) {
      return { ok: false, error: "Pick a religion from the list" };
    }
    out.religion = keep("religion", str(input.religion)) ? str(input.religion) : v;
  }
  if ("category" in input) {
    const v = str(input.category).toUpperCase();
    if (!STUDENT_CATEGORIES.some((c) => c.value === v)) return { ok: false, error: "Pick a category from the list" };
    out.category = v;
  }
  for (const k of ["fatherQualification", "motherQualification"] as const) {
    if (!(k in input)) continue;
    const v = str(input[k]);
    if (v && !(EDUCATION_LEVELS as readonly string[]).includes(v) && !keep(k, v)) {
      return { ok: false, error: `${k === "fatherQualification" ? "Father" : "Mother"}'s education: pick from the list` };
    }
    out[k] = v;
  }
  if ("isCwsn" in input) {
    if (typeof input.isCwsn !== "boolean") return { ok: false, error: "CWSN must be ticked or not" };
    out.isCwsn = input.isCwsn;
  }
  return { ok: true, values: out };
}

/** Columns of sis_students vs keys of the profile jsonb. */
export const SHEET_COLUMNS: Partial<Record<keyof SheetValues, string>> = {
  bloodGroup: "blood_group",
  motherTongue: "mother_tongue",
  religion: "religion",
  category: "category",
};
