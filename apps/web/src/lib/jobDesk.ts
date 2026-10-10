/**
 * The job desk on WhatsApp — both ends of it.
 *
 * A job seeker writes in: they are told where to send a CV (here, or the
 * school's job email), the CV is read, and whatever the CV did not say —
 * subject, classes, qualification — is asked for and saved. The school
 * then asks the bot "kya koi maths ke liye apply kiya hai", "primary ke
 * liye koi CV hai" and gets the list, each with the number to call and
 * the CV one tap away.
 *
 * Pure. The words people type become subject and class ids only through
 * matchSubjectWords / matchClassWords against the school's own masters —
 * never here, and never in a model call (see jobApplications.ts).
 */

import type { JobApplication } from "@/lib/jobApplications";

// ─── What a person teaches, in the words they use ──────────────────────

/** Canonical label → the ways people write it. The label is what gets stored as a word. */
const SUBJECT_VOCAB: [string, RegExp][] = [
  ["Maths", /(?<![\p{L}])(maths?|mathematics|ganit|गणित)(?![\p{L}])/iu],
  ["English", /(?<![\p{L}])(english|eng|angrezi|angreji|अंग्रेज़ी|अंग्रेजी|इंग्लिश)(?![\p{L}])/iu],
  ["Hindi", /(?<![\p{L}])(hindi|हिंदी|हिन्दी)(?![\p{L}])/iu],
  ["Sanskrit", /(?<![\p{L}])(sanskrit|संस्कृत)(?![\p{L}])/iu],
  ["Urdu", /(?<![\p{L}])(urdu|उर्दू)(?![\p{L}])/iu],
  ["Science", /(?<![\p{L}])(science|vigyan|विज्ञान)(?![\p{L}])/iu],
  ["EVS", /(?<![\p{L}])(evs|environmental\s+studies|paryavaran|पर्यावरण)(?![\p{L}])/iu],
  ["Physics", /(?<![\p{L}])(physics|bhautiki|भौतिकी)(?![\p{L}])/iu],
  ["Chemistry", /(?<![\p{L}])(chemistry|rasayan|रसायन)(?![\p{L}])/iu],
  ["Biology", /(?<![\p{L}])(biology|bio|jeev\s*vigyan|जीव\s*विज्ञान)(?![\p{L}])/iu],
  ["Social Science", /(?<![\p{L}])(sst|s\.s\.t|social\s+(science|studies)|samajik|सामाजिक)(?![\p{L}])/iu],
  ["History", /(?<![\p{L}])(history|itihas|इतिहास)(?![\p{L}])/iu],
  ["Geography", /(?<![\p{L}])(geography|bhugol|भूगोल)(?![\p{L}])/iu],
  ["Computer", /(?<![\p{L}])(computers?|computer\s+science|it|ict|कंप्यूटर|कम्प्यूटर)(?![\p{L}])/iu],
  ["Art", /(?<![\p{L}])(art|arts\s+and\s+craft|drawing|painting|chitrakala|कला|चित्रकला)(?![\p{L}])/iu],
  ["Music", /(?<![\p{L}])(music|sangeet|संगीत)(?![\p{L}])/iu],
  ["Dance", /(?<![\p{L}])(dance|nritya|नृत्य)(?![\p{L}])/iu],
  ["Physical Education", /(?<![\p{L}])(pe|p\.e|pt|p\.t|sports?|physical\s+education|games|khel|खेल)(?![\p{L}])/iu],
  ["Commerce", /(?<![\p{L}])(commerce|accounts|accountancy|economics|business\s+studies)(?![\p{L}])/iu],
  ["GK", /(?<![\p{L}])(gk|g\.k|general\s+knowledge|सामान्य\s+ज्ञान)(?![\p{L}])/iu],
];

/** The subjects a message names, as canonical words. */
export function subjectWordsIn(text: string): string[] {
  const t = text || "";
  const out: string[] = [];
  for (const [label, re] of SUBJECT_VOCAB) if (re.test(t) && !out.includes(label)) out.push(label);
  // "Social Science" also contains "Science": keep only the longer reading.
  if (out.includes("Social Science") && !/(?<![\p{L}])(science|vigyan|विज्ञान)(?![\p{L}])/iu.test(t.replace(/social\s+science/giu, ""))) {
    return out.filter((s) => s !== "Science");
  }
  return out;
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
const CLASS_TOKEN = String.raw`(\d{1,2}|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)`;

function tokenN(tok: string): number | null {
  const t = tok.toLowerCase();
  if (ROMAN[t] !== undefined) return ROMAN[t]!;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

/**
 * The classes a message names, in words matchClassWords reads: bands
 * ("Primary", "Pre-primary", "Middle", "Secondary") and ranges ("6-8").
 *
 * PRT / TGT are the grade bands Indian schools hire by: PRT is primary,
 * TGT is VI–X. PGT (XI–XII) is kept as a word the school does not run,
 * rather than being mapped onto classes it does.
 */
export function classWordsIn(text: string): string[] {
  let t = ` ${(text || "").toLowerCase()} `;
  const out: string[] = [];
  const add = (w: string) => {
    if (!out.includes(w)) out.push(w);
  };
  // Years of experience are not classes: "5 saal", "10 years".
  t = t.replace(/\d{1,2}\s*\+?\s*(years?|yrs?|saal|sal|वर्ष|साल)/giu, " ");
  if (/(?<![\p{L}])(pre[\s-]?primary|nursery|kindergarten|kg|lkg|ukg|ntt|montessori|pre[\s-]?school|प्री\s*प्राइमरी|नर्सरी)(?![\p{L}])/iu.test(t)) add("Pre-primary");
  if (/(?<![\p{L}])(upper\s+primary|middle|junior\s+high|माध्यमिक\s*पूर्व|उच्च\s*प्राथमिक)(?![\p{L}])/iu.test(t)) add("Middle");
  if (/(?<![\p{L}])(?<!upper\s)(?<!pre[\s-])(primary|prt|प्राथमिक|प्राइमरी)(?![\p{L}])/iu.test(t)) add("Primary");
  if (/(?<![\p{L}])(tgt)(?![\p{L}])/iu.test(t)) add("6-10");
  if (/(?<![\p{L}])(senior\s+secondary|higher\s+secondary|pgt|intermediate)(?![\p{L}])/iu.test(t)) add("Senior secondary");
  else if (/(?<![\p{L}])(secondary|high\s+school|हाई\s*स्कूल)(?![\p{L}])/iu.test(t)) add("Secondary");

  // "6-8", "VI to VIII", "1 se 5", "class 6 to 8"
  const rangeRe = new RegExp(String.raw`(?<![\p{L}\p{N}])${CLASS_TOKEN}(?:st|nd|rd|th)?\s*(?:-|–|—|to|se|tak|से)\s*${CLASS_TOKEN}(?:st|nd|rd|th)?(?![\p{L}\p{N}])`, "giu");
  let m: RegExpExecArray | null;
  const ranged: string[] = [];
  while ((m = rangeRe.exec(t))) {
    const lo = tokenN(m[1]!);
    const hi = tokenN(m[2]!);
    if (lo !== null && hi !== null && lo <= hi) {
      add(`${lo}-${hi}`);
      ranged.push(m[0]);
    }
  }
  for (const r of ranged) t = t.replace(r, " ");
  // "class 5", "kaksha 6", "5th class", "कक्षा 8"
  const oneRe = new RegExp(String.raw`(?:class|std|grade|kaksha|कक्षा)\s*${CLASS_TOKEN}(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(\d{1,2})(?:st|nd|rd|th)\s*(?:class|std|grade)`, "giu");
  while ((m = oneRe.exec(t))) {
    const n = tokenN(m[1] ?? m[2]!);
    if (n !== null) add(String(n));
  }
  return out;
}

const QUAL_RE =
  /(?<![\p{L}])(b\.?\s?ed|m\.?\s?ed|d\.?\s?el\.?\s?ed|btc|b\.?\s?t\.?\s?c|ntt|ctet|uptet|tet|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|m\.?\s?com|b\.?\s?a|m\.?\s?a|bca|mca|b\.?\s?tech|m\.?\s?tech|ph\.?\s?d|mba|bba|m\.?\s?phil|pgdca|graduate|graduation|post\s*graduate|post\s*graduation|intermediate|12th|स्नातक|परास्नातक|बी\.?\s?एड|एम\.?\s?ए|बी\.?\s?ए|बी\.?\s?एससी|एम\.?\s?एससी)(?![\p{L}])/giu;

/** Degrees and teaching certificates, as written, in the order they appear. */
export function qualificationIn(text: string): string {
  const out: string[] = [];
  for (const m of (text || "").matchAll(QUAL_RE)) {
    const raw = m[0]!.replace(/\s+/g, " ").trim();
    // "ba" / "ma" in a Hinglish sentence is a word, not a degree: without
    // dots, only the capitalised BA / MA counts.
    if (/^(b|m)\s?a$/i.test(raw) && raw !== raw.toUpperCase()) continue;
    // "B.A" and "BA" are one degree; compare without dots and spaces.
    const key = raw.toLowerCase().replace(/[.\s]/g, "");
    if (!out.some((x) => x.toLowerCase().replace(/[.\s]/g, "") === key)) out.push(raw);
  }
  return out.join(", ");
}

export function experienceYearsIn(text: string): string {
  const m = /(\d{1,2})\s*\+?\s*(years?|yrs?|saal|sal|वर्ष|साल)/iu.exec(text || "");
  return m ? String(parseInt(m[1]!, 10)) : "";
}

export type JobDetailsReply = {
  subjectWords: string[];
  classWords: string[];
  qualification: string;
  experienceYears: string;
};

/** A job seeker's typed reply: "Maths, class 6-8, M.Sc B.Ed, 5 saal". */
export function parseJobDetailsReply(text: string): JobDetailsReply {
  return {
    subjectWords: subjectWordsIn(text),
    classWords: classWordsIn(text),
    qualification: qualificationIn(text),
    experienceYears: experienceYearsIn(text),
  };
}

export function jobDetailsFound(r: JobDetailsReply): boolean {
  return r.subjectWords.length > 0 || r.classWords.length > 0 || !!r.qualification;
}

// ─── What is still missing, and asking for it ──────────────────────────

export type JobField = "subjects" | "classes" | "qualification";

export function jobMissingFields(app: Pick<JobApplication, "subjectWords" | "classWords" | "qualification">): JobField[] {
  const out: JobField[] = [];
  if (!app.subjectWords.length) out.push("subjects");
  if (!app.classWords.length) out.push("classes");
  if (!app.qualification.trim()) out.push("qualification");
  return out;
}

/** How many times a job seeker is asked for the same missing details. */
export const JOB_ASK_LIMIT = 2;

export function composeJobAsk(missing: JobField[], hindi: boolean, hadCv: boolean): string {
  const lineHi: Record<JobField, string> = {
    subjects: "• आप कौन-से *विषय* पढ़ाते हैं (जैसे गणित, अंग्रेज़ी)",
    classes: "• किन *कक्षाओं* को पढ़ाते हैं (जैसे 1–5, 6–8, प्राइमरी)",
    qualification: "• आपकी *योग्यता* (जैसे B.A., B.Ed, CTET)",
  };
  const lineEn: Record<JobField, string> = {
    subjects: "• the *subjects* you teach (e.g. Maths, English)",
    classes: "• the *classes* you teach (e.g. 1–5, 6–8, Primary)",
    qualification: "• your *qualification* (e.g. B.A., B.Ed, CTET)",
  };
  if (hindi) {
    return [
      hadCv ? "धन्यवाद 🙏 आपका बायोडाटा मिल गया। इसमें यह जानकारी नहीं मिली —" : "कृपया यह जानकारी एक ही संदेश में लिखें —",
      ...missing.map((f) => lineHi[f]),
      "",
      "उदाहरण: _गणित, कक्षा 6–8, M.Sc B.Ed, 5 साल अनुभव_",
    ].join("\n");
  }
  return [
    hadCv ? "Thank you 🙏 we have your CV. It doesn't say —" : "Please send these in one message —",
    ...missing.map((f) => lineEn[f]),
    "",
    "For example: _Maths, classes 6–8, M.Sc B.Ed, 5 years_",
  ].join("\n");
}

export function composeJobDone(hindi: boolean): string {
  return hindi
    ? "धन्यवाद 🙏 आपकी जानकारी स्कूल ऑफिस के पास सुरक्षित है। किसी पद से मेल खाने पर आपको कॉल किया जाएगा।"
    : "Thank you 🙏 the school office has your details. If they match a vacancy, someone will call you.";
}

/** The first thing a job seeker is told: where the CV goes. */
export function composeJobWelcome(name: string, careersEmail: string, schoolName: string, hindi: boolean): string {
  if (hindi) {
    return [
      `*नौकरी / करियर* — ${name}`,
      "",
      `${schoolName} में पढ़ाने में रुचि के लिए धन्यवाद 🙏`,
      "• अपना *बायोडाटा (CV)* यहीं PDF या साफ़ फ़ोटो में भेजें,",
      careersEmail ? `• या ईमेल करें: *${careersEmail}*` : "",
      "",
      "साथ में लिखें — आप कौन-से विषय और किन कक्षाओं को पढ़ाते हैं, और आपकी योग्यता।",
      "ऑफिस से बात के लिए *HUMAN* लिखें।",
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  }
  return [
    `*Job / career* — ${name}`,
    "",
    `Thank you for your interest in teaching at ${schoolName} 🙏`,
    "• Send your *CV / resume here* as a PDF or a clear photo,",
    careersEmail ? `• or email it to *${careersEmail}*` : "",
    "",
    "With it, tell us the subjects and classes you teach and your qualification.",
    "Reply *HUMAN* to reach the office.",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

// ─── The school asking: "koi maths ke liye CV hai?" ────────────────────

export type JobApplicantsQuery = {
  subjectWords: string[];
  classWords: string[];
  /** Only these statuses; empty = everything still open (not rejected, not hired). */
  statuses: JobApplication["status"][];
  /** "cv job_…" — a number picked from the list: send that CV. */
  cvFor?: string;
};

const JOB_NOUNS =
  /(?<![\p{L}])(resumes?|cvs?|c\.v|bio\s*-?data|biodata|बायोडाटा|applications?|applicants?|candidates?|आवेदन|आवेदक|job\s+seekers?|naukri\s+wale)(?![\p{L}])/iu;
const JOB_VERBS = /(?<![\p{L}])(apply|applied|aavedan|avedan|आवेदन|job|jobs|naukri|नौकरी|vacancy|vacancies|hiring|recruit\w*)(?![\p{L}])/iu;
const TEACHER_WORD = /(?<![\p{L}])(teachers?|sir|madam|mam|ma'am|faculty|shikshak|शिक्षक|अध्यापक|टीचर)(?![\p{L}])/iu;
/** A staff member's own leave or fee application is not a job application. */
const NOT_JOB = /(?<![\p{L}])(leave|chutti|chhutti|छुट्टी|fees?|admission|tc|transfer|pass\s*book|scholarship)(?![\p{L}])/iu;

/**
 * "kya koi math ke liye apply kiya hai", "koi resume hai", "primary ke
 * liye cv", "english teacher applications", "naye biodata", "job
 * applications" — or null.
 */
export function parseJobApplicantsQuery(text: string): JobApplicantsQuery | null {
  const t = (text || "").trim();
  if (!t || t.length > 160) return null;
  const pick = /^cv\s+(job_[a-z0-9]+)$/i.exec(t);
  if (pick) return { subjectWords: [], classWords: [], statuses: [], cvFor: pick[1]!.toLowerCase() };
  if (NOT_JOB.test(t)) return null;
  const subjectWords = subjectWordsIn(t);
  const classWords = classWordsIn(t);
  const noun = JOB_NOUNS.test(t);
  const verb = JOB_VERBS.test(t);
  const scoped = subjectWords.length > 0 || classWords.length > 0 || TEACHER_WORD.test(t);
  if (!(noun || (verb && scoped))) return null;
  const statuses: JobApplication["status"][] = [];
  if (/(?<![\p{L}])(shortlist\w*)(?![\p{L}])/iu.test(t)) statuses.push("shortlisted");
  if (/(?<![\p{L}])(interview\w*)(?![\p{L}])/iu.test(t)) statuses.push("interviewed");
  if (/(?<![\p{L}])(new|naye|naya|nayi|नए|नया)(?![\p{L}])/iu.test(t)) statuses.push("new");
  return { subjectWords, classWords, statuses };
}

/** What the filter resolved to — ids from the school's masters, plus the words. */
export type JobFilter = {
  subjectIds: string[];
  subjectWords: string[];
  classIds: string[];
  statuses: JobApplication["status"][];
};

const lc = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The applications a query asks for, newest first.
 *
 * A subject matches on the resolved id, or on the words when the school
 * has no master for it (a "Robotics" teacher is still findable). A class
 * filter matches on class ids only; an applicant whose classes are not
 * known is counted separately rather than silently included or dropped.
 */
export function filterJobApplicants(
  apps: JobApplication[],
  f: JobFilter,
): { rows: JobApplication[]; classUnknown: number } {
  const open = (a: JobApplication) =>
    f.statuses.length ? f.statuses.includes(a.status) : a.status !== "rejected" && a.status !== "hired";
  const subjectOk = (a: JobApplication) => {
    if (!f.subjectIds.length && !f.subjectWords.length) return true;
    if (a.subjectIds.some((id) => f.subjectIds.includes(id))) return true;
    const mine = a.subjectWords.map(lc);
    return f.subjectWords.some((w) => mine.some((m) => m.includes(lc(w))));
  };
  let classUnknown = 0;
  const rows = apps.filter((a) => {
    if (!open(a) || !subjectOk(a)) return false;
    if (!f.classIds.length) return true;
    if (!a.classIds.length) {
      classUnknown += 1;
      return false;
    }
    return a.classIds.some((id) => f.classIds.includes(id));
  });
  rows.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return { rows, classUnknown };
}

export type JobApplicantRow = {
  id: string;
  name: string;
  subjects: string;
  classes: string;
  qualification: string;
  experienceYears: string;
  mobile: string;
  appliedOn: string;
  status: JobApplication["status"];
  hasCv: boolean;
  driveUrl: string;
};

const JOB_SHOWN = 10;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function day(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${parseInt(m[3]!, 10)} ${MONTHS[parseInt(m[2]!, 10) - 1]}` : "";
}
function callNumber(m: string): string {
  let d = (m || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : d;
}

export function formatJobApplicantsReply(input: {
  title: string;
  rows: JobApplicantRow[];
  total: number;
  classUnknown: number;
  careersEmail: string;
}): string {
  const lines = [`*Job applicants${input.title ? ` · ${input.title}` : ""}*`];
  if (!input.total) {
    lines.push("Nobody has applied for this yet.");
    if (input.classUnknown) lines.push(`${input.classUnknown} applicant${input.classUnknown === 1 ? "" : "s"} for the subject didn't say which classes — send the subject alone to see them.`);
    lines.push("", `Applications come in on this WhatsApp number, the careers page, and ${input.careersEmail || "the job email"}.`);
    return lines.join("\n");
  }
  lines[0] += ` — ${input.total} found`;
  input.rows.slice(0, JOB_SHOWN).forEach((r, i) => {
    const what = [r.subjects || "subject not stated", r.classes].filter(Boolean).join(" · ");
    const facts = [r.qualification, r.experienceYears ? `${r.experienceYears} yr` : "", r.appliedOn ? `applied ${day(r.appliedOn)}` : "", r.status !== "new" ? r.status : ""]
      .filter(Boolean)
      .join(" · ");
    lines.push(
      "",
      `*${i + 1}.* ${r.name || "Name not given"} — ${what}`,
      ...(facts ? [`   ${facts}`] : []),
      `   📞 ${r.mobile ? callNumber(r.mobile) : "no number"}${r.hasCv ? " · CV ✓" : " · no CV yet"}`,
    );
  });
  if (input.total > JOB_SHOWN) lines.push("", `+${input.total - JOB_SHOWN} more — open Staff → Job applications in the ERP.`);
  if (input.classUnknown) lines.push("", `${input.classUnknown} more didn't say which classes they teach.`);
  lines.push("", "Send a number to get that CV here.");
  return lines.join("\n");
}

/** Each number sends that applicant's CV. */
export function jobApplicantPicks(rows: JobApplicantRow[]): { n: number; label: string; rerunText: string }[] {
  return rows.slice(0, JOB_SHOWN).map((r, i) => ({ n: i + 1, label: r.name, rerunText: `cv ${r.id}` }));
}

// ─── Where a CV is filed in Drive ──────────────────────────────────────

/** "Careers / 2026 / Neha Verma – 9876543210" — one folder per job seeker. */
export function jobCvArchiveFolder(applicantName: string, mobile: string, at: Date): string[] {
  const name = (applicantName || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Unnamed";
  const who = mobile ? `${name} – ${mobile}` : name;
  return ["Careers", String(at.getFullYear()), who];
}

export function jobCvArchiveFileName(applicantName: string, mime: string, at: Date): string {
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const name = (applicantName || "CV").replace(/[^\p{L}\p{N} ._-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "CV";
  return `${name} CV ${at.toISOString().slice(0, 10)}.${ext}`;
}
