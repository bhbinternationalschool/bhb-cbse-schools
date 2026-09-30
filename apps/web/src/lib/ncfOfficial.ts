/**
 * The subjects NCERT and CBSE list for each class, as DIKSHA publishes them,
 * and how a school turns that list into its own subjects.
 *
 * WHAT THE SOURCE IS — honestly
 *   DIKSHA (the government's school platform, run by NCERT) publishes a
 *   "framework" per board: for every class, the subjects its content is
 *   tagged with. It is machine-readable and keyless, and it moves when NCERT
 *   or CBSE add or rename a subject — "Physical Education And Well Being"
 *   arrived beside "Health And Physical Education" with NCF 2023. It is NOT
 *   the scheme of studies: no periods, no components, some tagging noise
 *   ("Education", "CBSE Training"). So it is a change detector and a
 *   starting list, reviewed by a person, never applied silently.
 *
 * WHAT THE SCHOOL DOES WITH IT
 *   Picks a class, applies the list (all or some) — each official subject is
 *   matched to a school subject or created as one, and linked to the class —
 *   then keeps, removes or renames per its own practice. A rename keeps the
 *   match, because the match is stored by school subject id, not by name.
 *
 * Pure; the network and tables are in ncfOfficial.server.ts.
 */

import {
  newFoundationId,
  normalizeSubject,
  type ClassSubjectLink,
  type Subject,
} from "@/lib/foundationMasters";

export type NcfBoard = "NCERT" | "CBSE";

export const NCF_FRAMEWORKS: { board: NcfBoard; frameworkId: string; label: string }[] = [
  { board: "NCERT", frameworkId: "ncert_k-12", label: "NCERT (NCF 2023)" },
  { board: "CBSE", frameworkId: "ekstep_ncert_k-12", label: "CBSE" },
];

export function frameworkUrl(frameworkId: string): string {
  return `https://diksha.gov.in/api/framework/v1/read/${encodeURIComponent(frameworkId)}?categories=gradeLevel,subject`;
}

/** DIKSHA grade names the ERP has classes for, in order. */
export const NCF_GRADES = [
  "Preschool 1",
  "Preschool 2",
  "Preschool 3",
  ...Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`),
];

/** Tags on DIKSHA that are not subjects a class studies. */
const NOT_SUBJECTS = new Set(["education", "cbse training", "cpd", "others", "adult education", "cwsn", "teacher education"]);

/**
 * Spellings DIKSHA lists twice for one subject. Conservative on purpose:
 * only exact synonyms. "Health And Physical Education" and "Physical
 * Education And Well Being" are the old and the NCF 2023 name — both kept,
 * the school maps both to its own PE subject.
 */
const SAME_SUBJECT: Record<string, string> = {
  evs: "Environmental Studies",
  accounts: "Accountancy",
  "political science/civics": "Political Science",
  "information and communication technology": "ICT",
};

function clean(name: string): string {
  return String(name ?? "").replace(/\s+/g, " ").trim();
}

/** The subject as the school will see it, or null when it is noise. */
export function canonicalOfficialSubject(raw: string): string | null {
  const name = clean(raw);
  if (!name) return null;
  const key = name.toLowerCase();
  if (NOT_SUBJECTS.has(key)) return null;
  // Workbooks are books, not subjects ("English Workbook", "Sanskrit workbook").
  if (/\bworkbook\b/i.test(name)) return null;
  return SAME_SUBJECT[key] ?? name;
}

export function officialKey(name: string): string {
  return clean(name).toLowerCase();
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * grade → subjects, from DIKSHA's framework read. Only the grades the ERP
 * has classes for; subjects cleaned, de-duplicated and sorted.
 *
 * Returns null for a shape it does not recognise: "DIKSHA said nothing"
 * must never read as "every subject was dropped".
 */
export function parseFramework(raw: unknown): Map<string, string[]> | null {
  const root = obj(raw);
  const fw = obj(obj(root?.result)?.framework);
  const cats = Array.isArray(fw?.categories) ? fw.categories : null;
  if (!cats) return null;
  const grades = cats.map(obj).find((c) => c?.code === "gradeLevel");
  const terms = grades && Array.isArray(grades.terms) ? grades.terms : null;
  if (!terms) return null;
  const want = new Set(NCF_GRADES);
  const out = new Map<string, string[]>();
  for (const t of terms) {
    const term = obj(t);
    const grade = clean(String(term?.name ?? ""));
    if (!want.has(grade)) continue;
    const seen = new Map<string, string>();
    for (const a of Array.isArray(term?.associations) ? term.associations : []) {
      const assoc = obj(a);
      if (assoc?.category !== "subject") continue;
      const name = canonicalOfficialSubject(String(assoc.name ?? ""));
      if (name) seen.set(officialKey(name), name);
    }
    out.set(grade, [...seen.values()].sort((x, y) => x.localeCompare(y)));
  }
  return out.size > 0 ? out : null;
}

/* ── Classes ─────────────────────────────────────────────────────────── */

const ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};

/** The DIKSHA grade for a school class name, or null. */
export function dikshaGradeForClass(className: string): string | null {
  const n = clean(className).toUpperCase().replace(/^CLASS\s+/, "");
  if (/^(NUR|NURSERY|PRE-?NURSERY|PG|PLAY ?GROUP)$/.test(n)) return "Preschool 1";
  if (/^(LKG|KG ?1|KG-1)$/.test(n)) return "Preschool 2";
  if (/^(UKG|KG ?2|KG-2)$/.test(n)) return "Preschool 3";
  const num = ROMAN[n] ?? (/^\d{1,2}$/.test(n) ? Number(n) : 0);
  return num >= 1 && num <= 12 ? `Class ${num}` : null;
}

/* ── Change detection ────────────────────────────────────────────────── */

export type StoredOfficial = { board: NcfBoard; grade: string; subject: string; removedAt: string | null };

export type OfficialChange = { board: NcfBoard; grade: string; subject: string; kind: "added" | "removed" };

/**
 * What changed since the last sync, for one board.
 *
 * The first sync of a board records a baseline and reports NOTHING — a
 * school should not open Masters to 150 "NCERT added" notices on day one.
 * A grade DIKSHA stops listing altogether is left alone: a grade vanishing
 * is far likelier a DIKSHA hiccup than NCERT abolishing Class 7.
 */
export function diffOfficial(
  board: NcfBoard,
  stored: StoredOfficial[],
  fresh: Map<string, string[]>,
): { changes: OfficialChange[]; baseline: boolean } {
  const mine = stored.filter((s) => s.board === board);
  if (mine.length === 0) return { changes: [], baseline: true };
  const active = new Map<string, Set<string>>();
  for (const s of mine) {
    if (s.removedAt) continue;
    const set = active.get(s.grade) ?? new Set<string>();
    set.add(officialKey(s.subject));
    active.set(s.grade, set);
  }
  const changes: OfficialChange[] = [];
  for (const [grade, subjects] of fresh) {
    const had = active.get(grade) ?? new Set<string>();
    const now = new Set(subjects.map(officialKey));
    for (const s of subjects) {
      if (!had.has(officialKey(s))) changes.push({ board, grade, subject: s, kind: "added" });
    }
    for (const s of mine) {
      if (s.grade !== grade || s.removedAt) continue;
      if (!now.has(officialKey(s.subject))) changes.push({ board, grade, subject: s.subject, kind: "removed" });
    }
  }
  return { changes, baseline: false };
}

/* ── Matching an official subject to a school subject ────────────────── */

/** The ERP's usual code for a subject name, so NCERT's "Mathematics" finds the school's MAT. */
const USUAL_CODES: Record<string, string> = {
  english: "ENG",
  hindi: "HIN",
  mathematics: "MAT",
  science: "SCI",
  "social science": "SST",
  sanskrit: "SKT",
  urdu: "URDU",
  "environmental studies": "EVS",
  "the world around us": "EVS",
  arts: "ART",
  "art education": "ART",
  "fine arts": "ART",
  "health and physical education": "PEW",
  "physical education and well being": "PEW",
  ict: "ICT",
  "vocational education": "VOC",
  "skill education": "VOC",
  history: "HIS",
  geography: "GEO",
  "political science": "POL",
  economics: "ECO",
  accountancy: "ACC",
  "business studies": "BST",
  biology: "BIO",
  chemistry: "CHE",
  physics: "PHY",
  "computer science": "CT",
  "informatics practices": "CT",
  psychology: "PSY",
  sociology: "SOC",
};

export type NcfMapping = { subjectKey: string; schoolSubjectId: string };

/**
 * The school subject an official subject stands for, or null (to be
 * created). In order: the school's own saved match (by id, so a renamed
 * subject stays matched) → the usual code → the same name.
 */
export function resolveSchoolSubject(
  officialName: string,
  subjects: Subject[],
  mappings: NcfMapping[],
): Subject | null {
  const key = officialKey(officialName);
  const mapped = mappings.find((m) => m.subjectKey === key);
  if (mapped) {
    const hit = subjects.find((s) => s.id === mapped.schoolSubjectId);
    if (hit) return hit;
  }
  const code = USUAL_CODES[key];
  const tops = subjects.filter((s) => !s.parentId);
  if (code) {
    const byCode = tops.find((s) => s.code.trim().toUpperCase() === code);
    if (byCode) return byCode;
  }
  return tops.find((s) => officialKey(s.nameEn) === key) ?? null;
}

/** A code for a subject the school does not have yet: the usual one, else from the name; never a clash. */
export function codeForNewSubject(officialName: string, subjects: Subject[]): string {
  const taken = new Set(subjects.map((s) => s.code.trim().toUpperCase()));
  const usual = USUAL_CODES[officialKey(officialName)];
  const words = clean(officialName)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["AND", "OF", "THE", "FOR", "IN"].includes(w));
  const base =
    usual ??
    (words.length === 1 ? words[0]!.slice(0, 4) : words.map((w) => w[0]).join("").slice(0, 6)) ??
    "SUB";
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const c = `${base}${i}`;
    if (!taken.has(c)) return c;
  }
  return `${base}${Date.now() % 1000}`;
}

/* ── Applying a class's list ─────────────────────────────────────────── */

export type ApplyPlanRow = {
  official: string;
  /** Existing school subject, or the one this plan creates. */
  subject: Subject;
  created: boolean;
  /** Already linked to the class — nothing to do for the link. */
  alreadyLinked: boolean;
};

export type ApplyPlan = {
  rows: ApplyPlanRow[];
  newSubjects: Subject[];
  newLinks: ClassSubjectLink[];
  /** Matches to remember, so a later rename keeps them. */
  newMappings: NcfMapping[];
};

/**
 * Apply official subjects to one class: match or create each school
 * subject, link it to the class once. Two official names that resolve to one
 * school subject ("Health And Physical Education" and "Physical Education And
 * Well Being" → PEW) link it once. An inactive school subject is linked but
 * not reactivated — the school switched it off for a reason.
 */
export function planApplyToClass(input: {
  officialSubjects: string[];
  classId: string;
  subjects: Subject[];
  classSubjects: ClassSubjectLink[];
  mappings: NcfMapping[];
  periodsFor: (s: Subject) => number;
}): ApplyPlan {
  let pool = [...input.subjects];
  const newSubjects: Subject[] = [];
  const newLinks: ClassSubjectLink[] = [];
  const newMappings: NcfMapping[] = [];
  const rows: ApplyPlanRow[] = [];
  const linked = new Set(
    input.classSubjects.filter((l) => l.isActive && l.classId === input.classId).map((l) => l.subjectId),
  );
  for (const official of input.officialSubjects) {
    const key = officialKey(official);
    let subject = resolveSchoolSubject(official, pool, input.mappings);
    let created = false;
    if (!subject) {
      subject = normalizeSubject({
        id: newFoundationId("sub"),
        code: codeForNewSubject(official, pool),
        nameEn: clean(official),
        parentId: null,
        isActive: true,
        sortOrder: pool.filter((s) => !s.parentId).length + 1,
      });
      pool = [...pool, subject];
      newSubjects.push(subject);
      created = true;
    }
    if (!input.mappings.some((m) => m.subjectKey === key && m.schoolSubjectId === subject!.id)) {
      newMappings.push({ subjectKey: key, schoolSubjectId: subject.id });
    }
    const alreadyLinked = linked.has(subject.id);
    if (!alreadyLinked) {
      linked.add(subject.id);
      newLinks.push({
        id: newFoundationId("csub"),
        classId: input.classId,
        subjectId: subject.id,
        periodsPerWeek: input.periodsFor(subject),
        isActive: true,
        isOptional: subject.isElective,
      });
    }
    rows.push({ official, subject, created, alreadyLinked });
  }
  return { rows, newSubjects, newLinks, newMappings };
}
