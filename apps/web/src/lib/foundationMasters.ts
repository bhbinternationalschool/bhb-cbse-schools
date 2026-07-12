/**
 * Foundation masters — institution, academic, subjects, holidays, staff, series.
 * Stored inside MastersState (localStorage demo).
 */

import type { MastersState, SchoolClass } from "@/lib/masters";
import type { LanguageSubtype, NcfTagId } from "@/lib/cbseSubjectGroups";
import {
  defaultLanguageSubtype,
  defaultNcfTagForCode,
  normalizeNcfTagId,
} from "@/lib/cbseSubjectGroups";
import { TENANT } from "@/lib/types";

const FOUNDATION_DEFAULT_AY = "2025-26";

export type BoardMode = "UP_STATE" | "CBSE" | "DUAL";

export type SchoolProfile = {
  legalName: string;
  displayName: string;
  shortName: string;
  tagline: string;
  udiseCode: string;
  boardMode: BoardMode;
  affiliationNo: string;
  schoolCode: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  /** Landline / office phone */
  phone: string;
  mobile: string;
  whatsapp: string;
  email: string;
  website: string;
  facebook: string;
  instagram: string;
  /** Google Business / Maps / review link */
  google: string;
  youtube: string;
  logoUrl: string;
};

export type AyStatus = "current" | "closed" | "upcoming";

export type AcademicYearMaster = {
  id: string;
  code: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: AyStatus;
  isActive: boolean;
};

export type AcademicTerm = {
  id: string;
  academicYearCode: string;
  code: string;
  label: string;
  startsOn: string;
  endsOn: string;
  sortOrder: number;
};

export type SubjectCategory = "scholastic" | "co_scholastic";

/**
 * Subject or assessment component.
 * - `parentId` null = standalone / group head (e.g. English)
 * - `parentId` set = component under that group (e.g. English-Oral)
 */
export type Subject = {
  id: string;
  code: string;
  nameEn: string;
  category: SubjectCategory;
  /** Work Education / Art / HPE / Discipline — for co-scholastic */
  coScholasticArea: string;
  /** Parent group subject id, or null for top-level */
  parentId: string | null;
  isElective: boolean;
  isActive: boolean;
  sortOrder: number;
  /**
   * NCF tag A/B/C/D (legacy G1–G4 mapped on load).
   * Alias field `cbseGroupId` kept for older rows.
   */
  ncfTagId: NcfTagId;
  /** @deprecated Prefer ncfTagId — synced on normalize */
  cbseGroupId: NcfTagId | null;
  /** Only for Tag A languages */
  languageSubtype: LanguageSubtype;
};

export function normalizeSubject(
  s: Partial<Subject> & Pick<Subject, "id" | "code" | "nameEn">,
): Subject {
  const category =
    s.category === "co_scholastic" ? "co_scholastic" : "scholastic";
  const tag =
    normalizeNcfTagId(s.ncfTagId) ??
    normalizeNcfTagId(s.cbseGroupId) ??
    defaultNcfTagForCode(s.code, category);
  const langDefault = defaultLanguageSubtype(s.code);
  const languageSubtype: LanguageSubtype =
    tag === "A"
      ? s.languageSubtype === "native" ||
        s.languageSubtype === "regional" ||
        s.languageSubtype === "foreign"
        ? s.languageSubtype
        : langDefault || "foreign"
      : "";
  return {
    id: s.id,
    code: s.code,
    nameEn: s.nameEn,
    category,
    coScholasticArea: s.coScholasticArea ?? "",
    parentId: s.parentId ?? null,
    isElective: s.isElective ?? false,
    isActive: s.isActive ?? true,
    sortOrder: s.sortOrder ?? 0,
    ncfTagId: tag,
    cbseGroupId: tag,
    languageSubtype,
  };
}

/** Top-level subjects first; each followed by its children. */
export function subjectsInDisplayOrder(subjects: Subject[]): Subject[] {
  const list = subjects.map(normalizeSubject);
  const roots = list
    .filter((s) => !s.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const out: Subject[] = [];
  for (const root of roots) {
    out.push(root);
    const kids = list
      .filter((s) => s.parentId === root.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    out.push(...kids);
  }
  // Orphans (parent missing) at end
  const seen = new Set(out.map((s) => s.id));
  for (const s of list) {
    if (!seen.has(s.id)) out.push(s);
  }
  return out;
}

export function subjectChildren(
  subjects: Subject[],
  parentId: string,
): Subject[] {
  return subjects
    .filter((s) => s.parentId === parentId && s.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function isSubjectGroup(subjects: Subject[], id: string): boolean {
  return subjects.some((s) => s.parentId === id);
}

export type ClassSubjectLink = {
  id: string;
  classId: string;
  subjectId: string;
  periodsPerWeek: number;
  isActive: boolean;
  /** Student may choose this subject (elective / optional 6th). */
  isOptional?: boolean;
};

export type NumberSeries = {
  id: string;
  code: string;
  label: string;
  prefix: string;
  nextNumber: number;
  padWidth: number;
  resetOnAy: boolean;
};

export type HolidayKind = "national" | "school" | "exam" | "other";

export type Holiday = {
  id: string;
  academicYearCode: string;
  title: string;
  startsOn: string;
  endsOn: string;
  kind: HolidayKind;
  isPublished: boolean;
  publishedAt: string | null;
  publishedBy: string;
  note: string;
};

export type Department = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type Designation = {
  id: string;
  code: string;
  name: string;
  departmentId: string | null;
  isActive: boolean;
};

export type StaffStream = "teaching" | "non_teaching";
export type StaffCategory = "permanent" | "contract" | "part_time";

export type StaffRecord = {
  id: string;
  empCode: string;
  fullName: string;
  stream: StaffStream;
  category: StaffCategory;
  departmentId: string | null;
  designationId: string | null;
  mobile: string;
  status: "active" | "inactive";
};

export type CompletenessItem = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  tab?: string;
};

export type FoundationSlice = {
  schoolProfile: SchoolProfile;
  academicYears: AcademicYearMaster[];
  academicTerms: AcademicTerm[];
  subjects: Subject[];
  classSubjects: ClassSubjectLink[];
  /** XI–XII stream packages (Science / Commerce / Humanities / NEP flexible) */
  seniorStreams: SeniorStream[];
  numberSeries: NumberSeries[];
  holidays: Holiday[];
  departments: Department[];
  designations: Designation[];
  staff: StaffRecord[];
};

/** Higher secondary stream / pathway (Grades XI–XII). */
export type SeniorStream = {
  id: string;
  code: string;
  nameEn: string;
  /** Traditional label shown to parents (Science / Commerce / Arts) */
  traditionalLabel: string;
  /** NEP/NCF note — choice across groups, not hard walls */
  nepNote: string;
  grades: ("XI" | "XII")[];
  /** Subject codes typically in this package */
  coreCodes: string[];
  electiveCodes: string[];
  isActive: boolean;
  sortOrder: number;
};

export function normalizeSeniorStream(
  s: Partial<SeniorStream> & Pick<SeniorStream, "id" | "code" | "nameEn">,
): SeniorStream {
  return {
    id: s.id,
    code: s.code,
    nameEn: s.nameEn,
    traditionalLabel: s.traditionalLabel ?? s.nameEn,
    nepNote: s.nepNote ?? "",
    grades: s.grades?.length ? s.grades : ["XI", "XII"],
    coreCodes: s.coreCodes ?? [],
    electiveCodes: s.electiveCodes ?? [],
    isActive: s.isActive ?? true,
    sortOrder: s.sortOrder ?? 0,
  };
}

export function defaultSeniorStreams(): SeniorStream[] {
  return [
    {
      id: nid("stm"),
      code: "SCI_PCM",
      nameEn: "Science — PCM",
      traditionalLabel: "Science",
      nepNote:
        "NCF Group 4 emphasis (Science, Maths, CT). Students may still add Art / PE / Vocational / Humanities electives.",
      grades: ["XI", "XII"],
      coreCodes: ["ENG", "PHY", "CHE", "MAT"],
      electiveCodes: ["CT", "PEW", "VOC", "ART"],
      isActive: true,
      sortOrder: 1,
    },
    {
      id: nid("stm"),
      code: "SCI_PCB",
      nameEn: "Science — PCB",
      traditionalLabel: "Science",
      nepNote:
        "Physics, Chemistry, Biology pathway. Keep multidisciplinary electives open per NEP.",
      grades: ["XI", "XII"],
      coreCodes: ["ENG", "PHY", "CHE", "BIO"],
      electiveCodes: ["MAT", "CT", "PEW", "VOC", "PSY"],
      isActive: true,
      sortOrder: 2,
    },
    {
      id: nid("stm"),
      code: "COMM",
      nameEn: "Commerce",
      traditionalLabel: "Commerce",
      nepNote:
        "Accountancy, Business Studies, Economics — may mix with Maths / CT / Humanities under NEP choice.",
      grades: ["XI", "XII"],
      coreCodes: ["ENG", "ACC", "BST", "ECO"],
      electiveCodes: ["MAT", "APP-MAT", "CT", "PEW", "ART", "VOC"],
      isActive: true,
      sortOrder: 3,
    },
    {
      id: nid("stm"),
      code: "HUM",
      nameEn: "Humanities / Arts",
      traditionalLabel: "Arts / Humanities",
      nepNote:
        "NCF Group 3 (Social Science, Humanities, Interdisciplinary). Can combine with Science / Maths electives.",
      grades: ["XI", "XII"],
      coreCodes: ["ENG", "HIS", "GEO", "POL"],
      electiveCodes: ["ECO", "PSY", "SOC", "ART", "PEW", "VOC", "HIN", "SKT"],
      isActive: true,
      sortOrder: 4,
    },
    {
      id: nid("stm"),
      code: "MULTI",
      nameEn: "Multidisciplinary (optional)",
      traditionalLabel: "Flexible / NEP",
      nepNote:
        "Optional pathway — only if the school allows free choice across groups. Most CBSE schools still enrol students in Science / Commerce / Humanities packages below.",
      grades: ["XI", "XII"],
      coreCodes: ["ENG", "HIN"],
      electiveCodes: [
        "PHY",
        "CHE",
        "BIO",
        "MAT",
        "APP-MAT",
        "CT",
        "HIS",
        "GEO",
        "POL",
        "ECO",
        "ACC",
        "BST",
        "PSY",
        "SOC",
        "ART",
        "PEW",
        "VOC",
        "SKT",
      ],
      isActive: false,
      sortOrder: 5,
    },
  ];
}

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultSchoolProfile(): SchoolProfile {
  return {
    legalName: TENANT.name,
    displayName: TENANT.nameDisplay,
    shortName: TENANT.shortName,
    tagline: TENANT.tagline,
    udiseCode: "",
    boardMode: (TENANT.boardMode as BoardMode) || "DUAL",
    affiliationNo: TENANT.affiliationNo,
    schoolCode: TENANT.schoolCode,
    address: TENANT.schoolAddress,
    city: TENANT.city,
    state: TENANT.state,
    pincode: "221001",
    phone: "",
    mobile: "",
    whatsapp: "",
    email: `office@${TENANT.domain.replace(/^erp\./, "")}`,
    website: `https://${TENANT.domain.replace(/^erp\./, "")}`,
    facebook: "",
    instagram: "",
    google: "",
    youtube: "",
    logoUrl: TENANT.logoUrl,
  };
}

export function defaultFoundationSlice(classes: SchoolClass[]): FoundationSlice {
  const ayId = nid("ay");
  const academicYears: AcademicYearMaster[] = [
    {
      id: ayId,
      code: "2025-26",
      label: "2025-26",
      startsOn: "2025-04-01",
      endsOn: "2026-03-31",
      status: "current",
      isActive: true,
    },
    {
      id: nid("ay"),
      code: "2024-25",
      label: "2024-25",
      startsOn: "2024-04-01",
      endsOn: "2025-03-31",
      status: "closed",
      isActive: true,
    },
  ];

  const academicTerms: AcademicTerm[] = [
    {
      id: nid("trm"),
      academicYearCode: "2025-26",
      code: "T1",
      label: "Term 1 / Half-yearly",
      startsOn: "2025-04-01",
      endsOn: "2025-09-30",
      sortOrder: 1,
    },
    {
      id: nid("trm"),
      academicYearCode: "2025-26",
      code: "T2",
      label: "Term 2 / Final",
      startsOn: "2025-10-01",
      endsOn: "2026-03-31",
      sortOrder: 2,
    },
  ];

  const engId = nid("sub");
  const hinId = nid("sub");
  const subjects: Subject[] = [
    {
      id: engId,
      code: "ENG",
      nameEn: "English",
      category: "scholastic",
      coScholasticArea: "",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 1,
    },
    {
      id: nid("sub"),
      code: "ENG-ORAL",
      nameEn: "English — Oral",
      category: "scholastic",
      coScholasticArea: "",
      parentId: engId,
      isElective: false,
      isActive: true,
      sortOrder: 1,
    },
    {
      id: nid("sub"),
      code: "ENG-WRIT",
      nameEn: "English — Written",
      category: "scholastic",
      coScholasticArea: "",
      parentId: engId,
      isElective: false,
      isActive: true,
      sortOrder: 2,
    },
    {
      id: hinId,
      code: "HIN",
      nameEn: "Hindi",
      category: "scholastic",
      coScholasticArea: "",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 2,
    },
    {
      id: nid("sub"),
      code: "HIN-ORAL",
      nameEn: "Hindi — Oral",
      category: "scholastic",
      coScholasticArea: "",
      parentId: hinId,
      isElective: false,
      isActive: true,
      sortOrder: 1,
    },
    {
      id: nid("sub"),
      code: "HIN-WRIT",
      nameEn: "Hindi — Written",
      category: "scholastic",
      coScholasticArea: "",
      parentId: hinId,
      isElective: false,
      isActive: true,
      sortOrder: 2,
    },
    {
      id: nid("sub"),
      code: "MAT",
      nameEn: "Mathematics",
      category: "scholastic",
      coScholasticArea: "",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 3,
    },
    {
      id: nid("sub"),
      code: "SCI",
      nameEn: "Science",
      category: "scholastic",
      coScholasticArea: "",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 4,
    },
    {
      id: nid("sub"),
      code: "SST",
      nameEn: "Social Science",
      category: "scholastic",
      coScholasticArea: "",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 5,
    },
    {
      id: nid("sub"),
      code: "WE",
      nameEn: "Work Education",
      category: "co_scholastic",
      coScholasticArea: "Work Education",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 10,
    },
    {
      id: nid("sub"),
      code: "ART",
      nameEn: "Art Education",
      category: "co_scholastic",
      coScholasticArea: "Art Education",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 11,
    },
    {
      id: nid("sub"),
      code: "HPE",
      nameEn: "Health & Physical Education",
      category: "co_scholastic",
      coScholasticArea: "HPE",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 12,
    },
  ].map((s) =>
    normalizeSubject({
      ...s,
      category: s.category as SubjectCategory,
    }),
  );

  const mid = classes.filter((c) =>
    ["VI", "VII", "VIII"].includes(c.name),
  );
  const classSubjects: ClassSubjectLink[] = [];
  const mapSubjects = subjects.filter((s) => {
    if (s.category !== "scholastic" || !s.isActive) return false;
    // Prefer components + standalone; skip group heads that have children
    const hasKids = subjects.some((c) => c.parentId === s.id);
    return s.parentId != null || !hasKids;
  });
  for (const cls of mid.length ? mid : classes.slice(0, 3)) {
    for (const sub of mapSubjects) {
      classSubjects.push({
        id: nid("csub"),
        classId: cls.id,
        subjectId: sub.id,
        periodsPerWeek:
          sub.code.startsWith("ENG") || sub.code.startsWith("MAT") ? 6 : 5,
        isActive: true,
      });
    }
  }

  const numberSeries: NumberSeries[] = [
    {
      id: nid("ns"),
      code: "ADMISSION",
      label: "Admission number",
      prefix: "BHB-",
      nextNumber: 1001,
      padWidth: 4,
      resetOnAy: true,
    },
    {
      id: nid("ns"),
      code: "RECEIPT",
      label: "Fee receipt",
      prefix: "RCV-",
      nextNumber: 1,
      padWidth: 5,
      resetOnAy: true,
    },
    {
      id: nid("ns"),
      code: "SRN",
      label: "Scholar register (SRN)",
      prefix: "SRN-",
      nextNumber: 1,
      padWidth: 5,
      resetOnAy: false,
    },
    {
      id: nid("ns"),
      code: "TC",
      label: "Transfer certificate",
      prefix: "TC-",
      nextNumber: 1,
      padWidth: 4,
      resetOnAy: true,
    },
  ];

  const holidays: Holiday[] = [
    {
      id: nid("hol"),
      academicYearCode: FOUNDATION_DEFAULT_AY,
      title: "Independence Day",
      startsOn: "2025-08-15",
      endsOn: "2025-08-15",
      kind: "national",
      isPublished: true,
      publishedAt: new Date().toISOString(),
      publishedBy: "System",
      note: "",
    },
    {
      id: nid("hol"),
      academicYearCode: FOUNDATION_DEFAULT_AY,
      title: "Diwali break",
      startsOn: "2025-10-20",
      endsOn: "2025-10-24",
      kind: "school",
      isPublished: false,
      publishedAt: null,
      publishedBy: "",
      note: "Draft — publish when confirmed",
    },
  ];

  const departments: Department[] = [
    { id: nid("dep"), code: "TEACH", name: "Teaching", isActive: true },
    { id: nid("dep"), code: "ADMIN", name: "Administration", isActive: true },
    { id: nid("dep"), code: "ACCT", name: "Accounts", isActive: true },
    { id: nid("dep"), code: "TRANS", name: "Transport", isActive: true },
  ];

  const designations: Designation[] = [
    {
      id: nid("des"),
      code: "PRIN",
      name: "Principal",
      departmentId: departments[1]!.id,
      isActive: true,
    },
    {
      id: nid("des"),
      code: "TGT",
      name: "TGT",
      departmentId: departments[0]!.id,
      isActive: true,
    },
    {
      id: nid("des"),
      code: "PGT",
      name: "PGT",
      departmentId: departments[0]!.id,
      isActive: true,
    },
    {
      id: nid("des"),
      code: "CLK",
      name: "Clerk",
      departmentId: departments[1]!.id,
      isActive: true,
    },
    {
      id: nid("des"),
      code: "DRV",
      name: "Driver",
      departmentId: departments[3]!.id,
      isActive: true,
    },
  ];

  const staff: StaffRecord[] = [
    {
      id: nid("stf"),
      empCode: "EMP-001",
      fullName: "Priya Sharma",
      stream: "non_teaching",
      category: "permanent",
      departmentId: departments[2]!.id,
      designationId: designations[3]!.id,
      mobile: "9800000001",
      status: "active",
    },
    {
      id: nid("stf"),
      empCode: "EMP-002",
      fullName: "Anil Kumar",
      stream: "teaching",
      category: "permanent",
      departmentId: departments[0]!.id,
      designationId: designations[1]!.id,
      mobile: "9800000002",
      status: "active",
    },
  ];

  return {
    schoolProfile: defaultSchoolProfile(),
    academicYears,
    academicTerms,
    subjects,
    classSubjects,
    seniorStreams: defaultSeniorStreams(),
    numberSeries,
    holidays,
    departments,
    designations,
    staff,
  };
}

export function normalizeSchoolProfile(
  p?: Partial<SchoolProfile> | null,
): SchoolProfile {
  const d = defaultSchoolProfile();
  return {
    legalName: p?.legalName ?? d.legalName,
    displayName: p?.displayName ?? d.displayName,
    shortName: p?.shortName ?? d.shortName,
    tagline: p?.tagline ?? d.tagline,
    udiseCode: p?.udiseCode ?? "",
    boardMode: (p?.boardMode as BoardMode) || d.boardMode,
    affiliationNo: p?.affiliationNo ?? d.affiliationNo,
    schoolCode: p?.schoolCode ?? d.schoolCode,
    address: p?.address ?? d.address,
    city: p?.city ?? d.city,
    state: p?.state ?? d.state,
    pincode: p?.pincode ?? d.pincode,
    phone: p?.phone ?? "",
    mobile: p?.mobile ?? "",
    whatsapp: p?.whatsapp ?? "",
    email: p?.email ?? d.email,
    website: p?.website ?? d.website,
    facebook: p?.facebook ?? "",
    instagram: p?.instagram ?? "",
    google: p?.google ?? "",
    youtube: p?.youtube ?? "",
    logoUrl: p?.logoUrl ?? d.logoUrl,
  };
}

export function ensureFoundationOnMasters(state: MastersState): MastersState {
  const seed = defaultFoundationSlice(state.classes ?? []);
  const partial = state as MastersState & Partial<FoundationSlice>;
  const classIds = new Set((state.classes ?? []).map((c) => c.id));
  const classSubjects = (
    partial.classSubjects?.length ? partial.classSubjects : seed.classSubjects
  ).filter((l) => classIds.has(l.classId));
  return {
    ...state,
    schoolProfile: normalizeSchoolProfile(partial.schoolProfile),
    academicYears: partial.academicYears?.length
      ? partial.academicYears
      : seed.academicYears,
    academicTerms: partial.academicTerms?.length
      ? partial.academicTerms
      : seed.academicTerms,
    subjects: ensureSubjectGroups(
      partial.subjects?.length ? partial.subjects : seed.subjects,
    ),
    classSubjects,
    seniorStreams: (() => {
      const raw = partial.seniorStreams;
      if (raw?.length) {
        return raw.map((s) => {
          const n = normalizeSeniorStream(s);
          if (n.code.toUpperCase() !== "MULTI") return n;
          const legacyName =
            /NEP flexible|Multidisciplinary \(NEP/i.test(n.nameEn) ||
            n.nameEn.trim() === "Multidisciplinary";
          if (!legacyName) return n;
          return {
            ...n,
            nameEn: "Multidisciplinary (optional)",
            nepNote:
              "Optional pathway — only if the school allows free choice across groups. Most CBSE schools still enrol students in Science / Commerce / Humanities packages.",
            isActive: false,
          };
        });
      }
      return seed.seniorStreams;
    })(),
    numberSeries: partial.numberSeries?.length
      ? partial.numberSeries
      : seed.numberSeries,
    holidays: Array.isArray(partial.holidays) ? partial.holidays : seed.holidays,
    departments: partial.departments?.length
      ? partial.departments
      : seed.departments,
    designations: partial.designations?.length
      ? partial.designations
      : seed.designations,
    staff: Array.isArray(partial.staff) ? partial.staff : seed.staff,
  };
}

export function mastersCompleteness(
  state: MastersState & Partial<FoundationSlice>,
): {
  percent: number;
  items: CompletenessItem[];
  okCount: number;
  total: number;
} {
  const profile = normalizeSchoolProfile(state.schoolProfile);
  const feePublished = (state.feeGroups ?? []).some(
    (g) => g.isActive && g.structurePublishedAt,
  );
  const subjectsN = (state.subjects ?? []).filter((s) => s.isActive).length;
  const mapN = (state.classSubjects ?? []).filter((l) => l.isActive).length;
  const publishedHolidays = (state.holidays ?? []).filter(
    (h) => h.isPublished,
  ).length;
  const staffN = (state.staff ?? []).filter((s) => s.status === "active")
    .length;
  const seriesN = (state.numberSeries ?? []).length;
  const ayOk = (state.academicYears ?? []).some((y) => y.status === "current");

  const items: CompletenessItem[] = [
    {
      id: "udise",
      label: "UDISE code",
      ok: profile.udiseCode.trim().length >= 8,
      detail: profile.udiseCode || "Missing — set on School profile",
      tab: "school",
    },
    {
      id: "affiliation",
      label: "Board / affiliation",
      ok: !!profile.boardMode && !!profile.affiliationNo.trim(),
      detail: `${profile.boardMode} · ${profile.affiliationNo || "no affiliation no."}`,
      tab: "school",
    },
    {
      id: "ay",
      label: "Current academic year",
      ok: ayOk,
      detail: ayOk ? "Current year set" : "Add a current academic year",
      tab: "academic",
    },
    {
      id: "classes",
      label: "Classes & sections",
      ok: (state.classes?.length ?? 0) > 0 && (state.sections?.length ?? 0) > 0,
      detail: `${state.classes?.length ?? 0} classes · ${state.sections?.length ?? 0} sections`,
      tab: "classes",
    },
    {
      id: "subjects",
      label: "Subjects",
      ok: subjectsN >= 3,
      detail: `${subjectsN} active subject(s)`,
      tab: "subjects",
    },
    {
      id: "class-subjects",
      label: "Class–subject map",
      ok: mapN >= 3,
      detail: `${mapN} link(s)`,
      tab: "subjects",
    },
    {
      id: "fee-heads",
      label: "Fee heads",
      ok: (state.feeHeads?.filter((h) => h.isActive).length ?? 0) >= 3,
      detail: `${state.feeHeads?.filter((h) => h.isActive).length ?? 0} heads`,
      tab: "fee-heads",
    },
    {
      id: "fee-publish",
      label: "Fee structure published",
      ok: feePublished,
      detail: feePublished
        ? "At least one group published for Fee Take"
        : "Publish a fee group structure",
      tab: "fee-structure",
    },
    {
      id: "series",
      label: "Numbering series",
      ok: seriesN >= 3,
      detail: `${seriesN} series`,
      tab: "series",
    },
    {
      id: "streams",
      label: "XI–XII streams",
      ok: (state.seniorStreams?.filter((s) => s.isActive).length ?? 0) >= 3,
      detail: `${state.seniorStreams?.filter((s) => s.isActive).length ?? 0} stream(s)`,
      tab: "subjects",
    },
    {
      id: "holidays",
      label: "Published holidays",
      ok: publishedHolidays >= 1,
      detail: `${publishedHolidays} published`,
      tab: "holidays",
    },
    {
      id: "staff",
      label: "Staff roster",
      ok: staffN >= 1,
      detail: `${staffN} active staff`,
      tab: "staff",
    },
    {
      id: "mid-year",
      label: "Mid-year fee policy",
      ok: !!state.midYearFeePolicy,
      detail: "Configured",
      tab: "mid-year",
    },
  ];

  const okCount = items.filter((i) => i.ok).length;
  const total = items.length;
  const percent = Math.round((okCount / total) * 100);
  return { percent, items, okCount, total };
}

/** True if date falls on a published holiday for the AY. */
export function isPublishedHoliday(
  state: MastersState & Partial<FoundationSlice>,
  isoDate: string,
  academicYearCode = FOUNDATION_DEFAULT_AY,
): Holiday | null {
  const d = isoDate.slice(0, 10);
  for (const h of state.holidays ?? []) {
    if (!h.isPublished) continue;
    if (h.academicYearCode !== academicYearCode) continue;
    if (d >= h.startsOn && d <= h.endsOn) return h;
  }
  return null;
}

export const BOARD_MODES: { value: BoardMode; label: string }[] = [
  { value: "CBSE", label: "CBSE" },
  { value: "UP_STATE", label: "UP State" },
  { value: "DUAL", label: "Dual (UP + CBSE path)" },
];

export const HOLIDAY_KINDS: { value: HolidayKind; label: string }[] = [
  { value: "national", label: "National" },
  { value: "school", label: "School" },
  { value: "exam", label: "Exam / break" },
  { value: "other", label: "Other" },
];

export const STAFF_STREAMS: { value: StaffStream; label: string }[] = [
  { value: "teaching", label: "Teaching" },
  { value: "non_teaching", label: "Non-teaching" },
];

export const STAFF_CATEGORIES: { value: StaffCategory; label: string }[] = [
  { value: "permanent", label: "Permanent" },
  { value: "contract", label: "Contract" },
  { value: "part_time", label: "Part-time" },
];

export function ensureSubjectGroups(subjects: Subject[]): Subject[] {
  const list = subjects.map(normalizeSubject);
  const ensureComponents = (
    parentCode: string,
    components: { code: string; nameEn: string; sortOrder: number }[],
  ) => {
    const parent = list.find((s) => s.code === parentCode && !s.parentId);
    if (!parent) return;
    if (list.some((s) => s.parentId === parent.id)) return;
    for (const c of components) {
      list.push(
        normalizeSubject({
          id: nid("sub"),
          code: c.code,
          nameEn: c.nameEn,
          category: parent.category,
          coScholasticArea: "",
          parentId: parent.id,
          isElective: false,
          isActive: true,
          sortOrder: c.sortOrder,
        }),
      );
    }
  };
  ensureComponents("ENG", [
    { code: "ENG-ORAL", nameEn: "English — Oral", sortOrder: 1 },
    { code: "ENG-WRIT", nameEn: "English — Written", sortOrder: 2 },
  ]);
  ensureComponents("HIN", [
    { code: "HIN-ORAL", nameEn: "Hindi — Oral", sortOrder: 1 },
    { code: "HIN-WRIT", nameEn: "Hindi — Written", sortOrder: 2 },
  ]);
  return list;
}

export function newFoundationId(prefix: string) {
  return nid(prefix);
}
