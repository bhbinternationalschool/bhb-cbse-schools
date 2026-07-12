/**
 * NCF subject tags (A/B/C/D) — primary filter for Masters + student cart.
 * Legacy G1–G4 ids still accepted and mapped on normalize.
 */

export type NcfTagId = "A" | "B" | "C" | "D" | "CO";

/** @deprecated Use NcfTagId — kept for old localStorage rows */
export type CbseGroupId = NcfTagId | "G1" | "G2" | "G3" | "G4" | "OTHER";

export type LanguageSubtype = "native" | "regional" | "foreign" | "";

export type NcfTagDef = {
  id: NcfTagId;
  label: string;
  shortLabel: string;
  hint: string;
  /** Shopping-cart bucket order (lower = earlier) */
  cartOrder: number;
};

export type CbseGroupDef = NcfTagDef;

export const NCF_SUBJECT_TAGS: NcfTagDef[] = [
  {
    id: "A",
    label: "Tag A · Languages",
    shortLabel: "Languages",
    hint: "Native, regional, and foreign languages",
    cartOrder: 1,
  },
  {
    id: "B",
    label: "Tag B · Vocational / Skill",
    shortLabel: "Skill / Voc",
    hint: "Coding, AI, IT, vocational & skill courses",
    cartOrder: 2,
  },
  {
    id: "C",
    label: "Tag C · Academic electives",
    shortLabel: "Electives",
    hint: "Physics, History, Accountancy, Maths, Art, PE…",
    cartOrder: 3,
  },
  {
    id: "D",
    label: "Tag D · Mandatory modules",
    shortLabel: "Mandatory",
    hint: "Environmental education, ethics, school-mandatory modules",
    cartOrder: 4,
  },
  {
    id: "CO",
    label: "Co-scholastic / development",
    shortLabel: "Co-scholastic",
    hint: "Lower-stage habits, socio-emotional (not in senior cart rules)",
    cartOrder: 5,
  },
];

/** Alias used across Masters UI */
export const CBSE_SUBJECT_GROUPS = NCF_SUBJECT_TAGS;

export const NCF_TAG_IDS: NcfTagId[] = NCF_SUBJECT_TAGS.map((t) => t.id);
export const CBSE_GROUP_IDS = NCF_TAG_IDS;

const LEGACY_TO_NCF: Record<string, NcfTagId> = {
  G1: "A",
  G2: "B",
  G3: "C",
  G4: "C",
  OTHER: "D",
  CO: "CO",
  A: "A",
  B: "B",
  C: "C",
  D: "D",
};

/** Default NCF tag from subject code */
export const CODE_TO_NCF_TAG: Record<string, NcfTagId> = {
  ENG: "A",
  HIN: "A",
  SKT: "A",
  URDU: "A",
  L1: "A",
  L2: "A",
  L3: "A",
  "L-IND": "A",
  "ENG-ORAL": "A",
  "ENG-WRIT": "A",
  "HIN-ORAL": "A",
  "HIN-WRIT": "A",
  VOC: "B",
  WE: "B",
  IT: "B",
  AI: "B",
  ICT: "B",
  CT: "C",
  HIS: "C",
  GEO: "C",
  POL: "C",
  ECO: "C",
  ACC: "C",
  BST: "C",
  PSY: "C",
  SOC: "C",
  SST: "C",
  PHY: "C",
  CHE: "C",
  BIO: "C",
  MAT: "C",
  "APP-MAT": "C",
  NUM: "C",
  SCI: "C",
  ART: "C",
  MUS: "C",
  PEW: "C",
  HPE: "C",
  EVS: "D",
  WAU: "D",
  ENV: "D",
  ETH: "D",
  SEE: "CO",
  HAB: "CO",
};

export const CODE_TO_CBSE_GROUP = CODE_TO_NCF_TAG;

/** Default language subtype from code (India / UP context). */
export const CODE_TO_LANGUAGE_SUBTYPE: Record<string, LanguageSubtype> = {
  HIN: "native",
  "HIN-ORAL": "native",
  "HIN-WRIT": "native",
  "L-IND": "native",
  L1: "native",
  SKT: "regional",
  URDU: "regional",
  L3: "regional",
  ENG: "foreign",
  "ENG-ORAL": "foreign",
  "ENG-WRIT": "foreign",
  L2: "foreign",
};

/** Lab-heavy codes for soft counselor warning */
export const LAB_HEAVY_CODES = new Set([
  "PHY",
  "CHE",
  "BIO",
  "CT",
  "IT",
  "AI",
  "SCI",
]);

export function defaultNcfTagForCode(
  code: string,
  category?: string,
): NcfTagId {
  const hit = CODE_TO_NCF_TAG[code.toUpperCase()];
  if (hit) return hit;
  if (category === "co_scholastic") return "CO";
  return "C";
}

export function defaultCbseGroupForCode(
  code: string,
  category?: string,
): NcfTagId {
  return defaultNcfTagForCode(code, category);
}

export function defaultLanguageSubtype(code: string): LanguageSubtype {
  return CODE_TO_LANGUAGE_SUBTYPE[code.toUpperCase()] ?? "";
}

export function isNcfTagId(v: string | null | undefined): v is NcfTagId {
  return !!v && (NCF_TAG_IDS as string[]).includes(v);
}

export function isCbseGroupId(v: string | null | undefined): v is NcfTagId {
  if (!v) return false;
  const mapped = LEGACY_TO_NCF[v] ?? (isNcfTagId(v) ? v : null);
  return mapped != null;
}

export function normalizeNcfTagId(
  v: string | null | undefined,
): NcfTagId | null {
  if (!v) return null;
  return LEGACY_TO_NCF[v] ?? (isNcfTagId(v) ? v : null);
}

export function ncfTagForSubject(subject: {
  code: string;
  category: string;
  cbseGroupId?: string | null;
  ncfTagId?: string | null;
}): NcfTagId {
  const fromNew = normalizeNcfTagId(subject.ncfTagId);
  if (fromNew) return fromNew;
  const fromLegacy = normalizeNcfTagId(subject.cbseGroupId);
  if (fromLegacy) return fromLegacy;
  return defaultNcfTagForCode(subject.code, subject.category);
}

/** @deprecated use ncfTagForSubject */
export function cbseGroupForSubject(subject: {
  code: string;
  category: string;
  cbseGroupId?: string | null;
  ncfTagId?: string | null;
}): NcfTagId {
  return ncfTagForSubject(subject);
}

export function groupSubjectsByNcf<
  T extends {
    code: string;
    category: string;
    cbseGroupId?: string | null;
    ncfTagId?: string | null;
  },
>(subjects: T[]): { group: NcfTagDef; subjects: T[] }[] {
  const buckets = new Map<NcfTagId, T[]>();
  for (const g of NCF_SUBJECT_TAGS) buckets.set(g.id, []);
  for (const s of subjects) {
    buckets.get(ncfTagForSubject(s))!.push(s);
  }
  return NCF_SUBJECT_TAGS.map((group) => ({
    group,
    subjects: buckets.get(group.id) ?? [],
  })).filter((row) => row.subjects.length > 0);
}

export function groupSubjectsByCbse<
  T extends {
    code: string;
    category: string;
    cbseGroupId?: string | null;
    ncfTagId?: string | null;
  },
>(subjects: T[]): { group: NcfTagDef; subjects: T[] }[] {
  return groupSubjectsByNcf(subjects);
}

export function ncfTagDef(id: NcfTagId): NcfTagDef {
  return NCF_SUBJECT_TAGS.find((g) => g.id === id) ?? NCF_SUBJECT_TAGS[2]!;
}

export function cbseGroupDef(id: string): NcfTagDef {
  const n = normalizeNcfTagId(id) ?? "C";
  return ncfTagDef(n);
}

export function languageSubtypeOf(subject: {
  code: string;
  languageSubtype?: LanguageSubtype | null;
}): LanguageSubtype {
  if (
    subject.languageSubtype === "native" ||
    subject.languageSubtype === "regional" ||
    subject.languageSubtype === "foreign"
  ) {
    return subject.languageSubtype;
  }
  return defaultLanguageSubtype(subject.code);
}

export function isLabHeavy(subject: { code: string }): boolean {
  return LAB_HEAVY_CODES.has(subject.code.toUpperCase());
}
