/**
 * A CV (photo, scan or PDF) → the few things a school needs to route it:
 * who applied, how to reach them, what they teach, and which classes.
 * Pure shapes, prompt and parser; the route does the vision call.
 *
 * A CV is not an application form. It is unstructured, it is written to
 * flatter, and half of what is on it — hobbies, references, a photograph,
 * a date of birth, sometimes a marital status or a caste — is either
 * useless for shortlisting or actively something a school should not be
 * sorting people by. So this reads a deliberately NARROW set of fields
 * and nothing else. What the model is not asked for cannot be stored,
 * cannot leak, and cannot quietly become a filter.
 *
 * `subjects` and `classes` come back as the applicant's own words. The
 * mapping onto the school's real subject and class masters happens in
 * jobApplications.ts, against data the model never sees, because a model
 * inventing "Class 13" or a subject the school does not teach must not be
 * able to write it into a record.
 */

export type JobCvExtract = {
  fullName: string;
  /** 10 digits, no +91, or "" */
  mobile: string;
  email: string;
  /** As written: "Maths", "PGT Physics", "Primary" */
  subjects: string[];
  /** As written: "VI-VIII", "Class 9 & 10", "Primary" */
  classes: string[];
  /** Highest qualification as written: "M.Sc Physics, B.Ed" */
  qualification: string;
  /** Whole years; "" when the CV does not say or it cannot be totalled */
  experienceYears: string;
  /** Most recent school/employer */
  currentEmployer: string;
  /** Anything the office should look at: gaps, contradictions, unclear scans */
  notes: string;
  /** Asked-for fields that were not legibly on the CV */
  missing: string[];
};

export const JOB_CV_EXTRACT_SYSTEM = `You read a teaching-job CV (photo, scan or PDF) sent to an Indian CBSE school and extract ONLY the fields below as JSON, for the office to review.

Rules:
- Copy what is written; do not correct spellings and do not translate names.
- If a field is absent, illegible or you are unsure, leave it "" (or []) and add its name to "missing". Never guess.
- mobile: a 10-digit Indian number without +91 or 0. Anything else -> "".
- subjects: what this person teaches, in THEIR words, as a list. "PGT Physics" -> ["Physics"]. "Maths and Science" -> ["Maths","Science"]. Empty list if the CV does not say.
- classes: the classes/grades they say they teach, in their words: ["VI-VIII"], ["9 and 10"], ["Primary"]. Empty list if not stated.
- experienceYears: total years of teaching experience as a whole number string, only if the CV states it or it is unambiguous from dated roles; otherwise "".
- notes: short and factual - unexplained gaps, contradictory dates, an unreadable section.

Do NOT extract or mention: date of birth, age, gender, marital status, caste, category, religion, photograph, address, references, salary, hobbies, or family details. If the CV shows them, ignore them.

JSON only, exactly these keys:
{"fullName":"","mobile":"","email":"","subjects":[],"classes":[],"qualification":"","experienceYears":"","currentEmployer":"","notes":"","missing":[]}`;

export const JOB_CV_EXTRACT_PROMPT =
  "Extract the teaching-job fields from this CV.";

function strList(v: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = String(x ?? "").trim().slice(0, itemMax);
    if (s && !out.some((y) => y.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function parseJobCvExtract(text: string): JobCvExtract | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  // `typeof [] === "object"`, so an array would otherwise parse into an
  // all-empty extract and be stored as a genuine "we read nothing".
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (k: string, max = 200) =>
    String(r[k] ?? "").trim().slice(0, max);

  const mobile = str("mobile").replace(/\D/g, "").slice(-10);
  const years = str("experienceYears", 4).replace(/\D/g, "");
  const email = str("email", 120);

  return {
    fullName: str("fullName", 80),
    mobile: mobile.length === 10 ? mobile : "",
    // A CV is a document, not a form: an "email" that is not one is more
    // likely a misread line than a real address.
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    subjects: strList(r.subjects, 8, 40),
    classes: strList(r.classes, 8, 30),
    qualification: str("qualification", 120),
    // 50 years of teaching is a misread, not a career.
    experienceYears: years && Number(years) <= 50 ? String(Number(years)) : "",
    currentEmployer: str("currentEmployer", 120),
    notes: str("notes", 300),
    missing: strList(r.missing, 12, 40),
  };
}

/**
 * Did the read tell us enough to route this to anybody?
 *
 * A name alone is not enough — the office cannot call a name. Either a
 * mobile or a subject makes the application actionable; without both, it
 * is filed but flagged, never silently dropped.
 */
export function jobCvExtractIsUsable(x: JobCvExtract | null): boolean {
  if (!x) return false;
  return !!(x.mobile || x.subjects.length);
}
