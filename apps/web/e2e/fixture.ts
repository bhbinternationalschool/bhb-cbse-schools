/**
 * The seeded school for the local test stack (data-layer step 1.0).
 *
 * Pure data, no I/O, fully determined by this file: every id, name and count
 * is computed from indices, so two runs seed the same school and a test can
 * assert exact numbers (`expected` below). The names are obviously fake.
 *
 * The shape mirrors production on 13 Oct 2026 (masters_desk_sync_meta /
 * sis_sync_meta): 15 classes, 14 sections, 44 subjects, 35 staff of whom 34
 * are active, ~250 current-year children — and the awkward parts that broke
 * production before, kept on purpose:
 *  - 30 % of children carry 2–4 per-year rows (one active row per year,
 *    memory note erp-stale-academic-year-rows), some with a blank
 *    academic_year_code;
 *  - two different children share an admission number (the database's unique
 *    index is (tenant, admission_no, academic_year_code), so they sit in
 *    different years — the only way production can hold them);
 *  - one household whose children are all inactive;
 *  - placeholder 0000000000 mobiles;
 *  - an office member whose office role comes from a Masters → Roles
 *    assignment, and a teacher whose ONLY link to any section is the
 *    published timetable.
 */

import type { DemoSession } from "@/lib/auth";
import type { MastersState, SchoolClass, Section } from "@/lib/masters";
import { emptyMastersShell, normalizeSchoolClass } from "@/lib/masters";
import type {
  AcademicYearMaster,
  ClassSubjectLink,
  Department,
  Designation,
  StaffRecord,
  Subject,
} from "@/lib/foundationMasters";
import { normalizeStaffRecord, normalizeSubject } from "@/lib/foundationMasters";
import type { RbacRole, RbacState, UserRoleAssignment } from "@/lib/rbac";
import { defaultRbacState } from "@/lib/rbac";
import { REGISTRY_MODULES, type ModuleRegistryState } from "@/lib/moduleRegistry";
import type { TimetableGrid, TimetableState } from "@/lib/timetable";
import { emptyTimetableState } from "@/lib/timetable";
import type { Household, SisStudent } from "@/lib/sis";
import { normalizeHousehold, normalizeStudent } from "@/lib/sis";
import type { PayrollRun, PayrollState } from "@/lib/payroll";
import { normalizePayrollLine } from "@/lib/payroll";
import type { AutomationRun, AutomationState } from "@/lib/automation";
import {
  buildCertificates,
  buildChargeVouchers,
  buildFeeAdjustments,
  buildOutdoorDuty,
  buildPayrollAudit,
  buildReceipts,
  buildStaffHr,
} from "./growingLists";
import type { CollectionVoucher, ChargeVoucher } from "@/lib/fees";
import type { FeeAdjustment } from "@/lib/feeAdjustments";
import type { StaffHrState } from "@/lib/staffHr";
import type { OutdoorDutySession } from "@/lib/staffAttendance";
import type { CertificatesState } from "@/lib/certificates";

export const E2E_TENANT_SLUG = "bhb-international";
export const AY_CURRENT = "2026-27";
const AY_PREV = "2025-26";
const AY_PREV2 = "2024-25";

const pad = (n: number, w: number) => String(n).padStart(w, "0");

// ── Masters ──────────────────────────────────────────────────────────────

const CLASS_NAMES = [
  "Nursery", "LKG", "UKG", "I", "II", "III", "IV", "V",
  "VI", "VII", "VIII", "IX", "X", "XI", "XII",
] as const;

/**
 * Classes 1–13 (Nursery … X) have one section, A, and every child sits in
 * one of them. XII has an EMPTY section A (no children): the one class with
 * a section that no fee group matches — the built-in 2026-27 groups cover
 * Nursery–X — which student-upgrade.spec moves a child into. XI has none.
 * 14 sections.
 */
const SECTIONED_CLASSES = 13;
const EMPTY_SECTION_CLASS = 15; // XII

export const classId = (k: number) => `e2e_cls_${pad(k, 2)}`;
export const sectionId = (k: number) => `e2e_sec_${pad(k, 2)}a`;

function buildClasses(): { classes: SchoolClass[]; sections: Section[] } {
  const classes = CLASS_NAMES.map((name, i) =>
    normalizeSchoolClass({ id: classId(i + 1), name, sortOrder: i + 1, isActive: true }, i),
  );
  const sections: Section[] = [];
  for (let k = 1; k <= SECTIONED_CLASSES; k++) {
    sections.push({ id: sectionId(k), classId: classId(k), name: "A", isActive: true });
  }
  sections.push({ id: sectionId(EMPTY_SECTION_CLASS), classId: classId(EMPTY_SECTION_CLASS), name: "A", isActive: true });
  return { classes, sections };
}

/** 44 subjects: 22 heads and 22 components (parentId set). */
const SUBJECT_HEADS: [code: string, name: string][] = [
  ["ENG", "English"], ["HIN", "Hindi"], ["SKT", "Sanskrit"], ["MATH", "Mathematics"],
  ["EVS", "Environmental Studies"], ["SCI", "Science"], ["SST", "Social Science"],
  ["COMP", "Computer"], ["GK", "General Knowledge"], ["ART", "Art"], ["MUSIC", "Music"],
  ["PE", "Physical Education"], ["IT", "Information Technology"], ["PHY", "Physics"],
  ["CHEM", "Chemistry"], ["BIO", "Biology"], ["ACC", "Accountancy"], ["BST", "Business Studies"],
  ["ECO", "Economics"], ["CS", "Computer Science"], ["MORAL", "Moral Science"], ["DRAW", "Drawing"],
];
const subjectId = (code: string) => `e2e_sub_${code.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

function buildSubjects(): Subject[] {
  const out: Subject[] = [];
  SUBJECT_HEADS.forEach(([code, nameEn], i) => {
    out.push(normalizeSubject({ id: subjectId(code), code, nameEn, sortOrder: i * 2 + 1 }));
    out.push(
      normalizeSubject({
        id: subjectId(`${code}-PRACT`),
        code: `${code}-PRACT`,
        nameEn: `${nameEn} — Practical`,
        parentId: subjectId(code),
        sortOrder: i * 2 + 2,
      }),
    );
  });
  return out;
}

/** Which subject heads each class studies. */
function subjectCodesForClass(k: number): string[] {
  if (k <= 3) return ["ENG", "HIN", "MATH", "EVS", "ART", "MUSIC", "PE"];
  if (k <= 8) return ["ENG", "HIN", "MATH", "EVS", "COMP", "GK", "ART", "PE", "MORAL"];
  if (k <= 11) return ["ENG", "HIN", "SKT", "MATH", "SCI", "SST", "COMP", "ART", "PE"];
  if (k <= 13) return ["ENG", "HIN", "MATH", "SCI", "SST", "IT", "PE"];
  return ["ENG", "PHY", "CHEM", "BIO", "MATH", "ACC", "BST", "ECO", "CS", "PE"];
}

function buildClassSubjects(): ClassSubjectLink[] {
  const out: ClassSubjectLink[] = [];
  for (let k = 1; k <= CLASS_NAMES.length; k++) {
    for (const code of subjectCodesForClass(k)) {
      out.push({
        id: `e2e_cs_${pad(k, 2)}_${code.toLowerCase()}`,
        classId: classId(k),
        subjectId: subjectId(code),
        periodsPerWeek: 5,
        isActive: true,
        // As every link the app writes has it (masters_desk_class_subjects.is_optional
        // is NOT NULL); a slice row without it fails the row sync of the next save.
        isOptional: false,
      });
    }
  }
  return out;
}

function buildAcademicYears(): AcademicYearMaster[] {
  return [
    { id: "e2e_ay_2627", code: AY_CURRENT, label: AY_CURRENT, startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current", isActive: true },
    { id: "e2e_ay_2526", code: AY_PREV, label: AY_PREV, startsOn: "2025-04-01", endsOn: "2026-03-31", status: "closed", isActive: true },
    { id: "e2e_ay_2425", code: AY_PREV2, label: AY_PREV2, startsOn: "2024-04-01", endsOn: "2025-03-31", status: "closed", isActive: true },
  ];
}

// ── Staff ────────────────────────────────────────────────────────────────

const DEPARTMENTS: Department[] = [
  { id: "e2e_dep_teaching", code: "E2E-TCH", name: "Teaching", isActive: true },
  { id: "e2e_dep_admin", code: "E2E-ADM", name: "Administration", isActive: true },
  { id: "e2e_dep_support", code: "E2E-SUP", name: "Support", isActive: true },
];

const DESIGNATIONS: Designation[] = [
  { id: "e2e_des_principal", code: "E2E-PRIN", name: "Principal", departmentId: "e2e_dep_admin", isActive: true },
  { id: "e2e_des_office", code: "E2E-OFF", name: "Office Assistant", departmentId: "e2e_dep_admin", isActive: true },
  { id: "e2e_des_accounts", code: "E2E-ACC", name: "Accountant", departmentId: "e2e_dep_admin", isActive: true },
  { id: "e2e_des_prt", code: "E2E-PRT", name: "PRT Teacher", departmentId: "e2e_dep_teaching", isActive: true },
  { id: "e2e_des_tgt", code: "E2E-TGT", name: "TGT Teacher", departmentId: "e2e_dep_teaching", isActive: true },
  { id: "e2e_des_pgt", code: "E2E-PGT", name: "PGT Teacher", departmentId: "e2e_dep_teaching", isActive: true },
  { id: "e2e_des_driver", code: "E2E-DRV", name: "Driver", departmentId: "e2e_dep_support", isActive: true },
  { id: "e2e_des_peon", code: "E2E-PEON", name: "Peon", departmentId: "e2e_dep_support", isActive: true },
];

export const staffId = (n: number) => `e2e_stf_${pad(n, 2)}`;

/** The people the tests sign in as. */
export const PRINCIPAL_STAFF = 1;
export const OFFICE_STAFF = 2;
export const TIMETABLE_TEACHER = 3;
/** Class teacher of Nursery-A (section 1), nothing else. */
export const CLASS_TEACHER = 4;
/**
 * A certificates clerk (a school-made role, by assignment): Students (view,
 * edit — the whole roster) and Certificates (issue) — and NO Masters, Fees or
 * Transport grant. Masters answers the teaching subset (fee structure
 * withheld) and the fees / transport desks are not read, so this tab's own
 * copy holds no dues at all. The TC / no-dues gate spec signs in as this
 * person (a peon on the roster, so no designation-inferred role either).
 */
export const CERT_CLERK_STAFF = 31;
/** The sections the timetable-only teacher has periods in: III-A and V-A. */
export const TIMETABLE_TEACHER_SECTIONS = [6, 8] as const;

const STAFF_FIRST = [
  "Prakriti", "Omkar", "Tara", "Asha", "Bina", "Chitra", "Deepa", "Esha", "Farah", "Gita",
  "Hema", "Indu", "Jaya", "Kavya", "Lata", "Mohan", "Naveen", "Ojas", "Pavan", "Rohit",
  "Sunil", "Tarun", "Uday", "Varun", "Yash", "Zoya", "Amit", "Bharat", "Chetan", "Dinesh",
  "Ekta", "Faisal", "Gopal", "Harish", "Ira",
];
const FAKE_SURNAMES = [
  "Testwal", "Fixturekar", "Sampleton", "Dummysingh", "Mockverma",
  "Stubbs", "Placeholderi", "Seedwala", "Fakhruddin-Test", "Exemplar",
];

function staffRecord(n: number): StaffRecord {
  const fullName = `${STAFF_FIRST[n - 1]} ${FAKE_SURNAMES[n % FAKE_SURNAMES.length]}`;
  // Two placeholder mobiles, as production has.
  const mobile = n === 31 || n === 33 ? "0000000000" : `90000000${pad(n, 2)}`;
  const base = {
    id: staffId(n),
    empCode: `E2E-${pad(n, 3)}`,
    fullName,
    mobile,
    campusId: null,
    status: "active" as const,
    gender: (n === TIMETABLE_TEACHER || (n >= 4 && n <= 16) ? "F" : "M") as "F" | "M",
  };
  if (n === PRINCIPAL_STAFF) {
    return normalizeStaffRecord({ ...base, stream: "non_teaching", departmentId: "e2e_dep_admin", designationId: "e2e_des_principal" });
  }
  if (n === OFFICE_STAFF) {
    return normalizeStaffRecord({ ...base, stream: "non_teaching", departmentId: "e2e_dep_admin", designationId: "e2e_des_office" });
  }
  if (n === TIMETABLE_TEACHER) {
    // No class-teacher link, no subject link: the timetable is her only tie.
    return normalizeStaffRecord({ ...base, stream: "teaching", departmentId: "e2e_dep_teaching", designationId: "e2e_des_prt" });
  }
  if (n >= 4 && n <= 16) {
    // Class teacher of section n-3 (1 … 13), and a subject in it.
    const k = n - 3;
    return normalizeStaffRecord({
      ...base,
      stream: "teaching",
      departmentId: "e2e_dep_teaching",
      designationId: k <= 8 ? "e2e_des_prt" : "e2e_des_tgt",
      classTeacherLinks: [
        { id: `e2e_ctl_${pad(n, 2)}`, classId: classId(k), sectionId: sectionId(k), academicYearCode: AY_CURRENT, isPrimary: true },
      ],
      subjectTeachingLinks: [
        { id: `e2e_stl_${pad(n, 2)}`, classId: classId(k), sectionId: sectionId(k), subjectId: subjectId("ENG"), academicYearCode: AY_CURRENT, periodsPerWeek: 5 },
      ],
    });
  }
  if (n >= 17 && n <= 26) {
    // Subject teachers: one subject in two sections each.
    const subject = ["MATH", "HIN", "SCI", "SST", "COMP", "PE", "ART", "SKT", "IT", "EVS"][n - 17]!;
    const a = ((n - 17) % SECTIONED_CLASSES) + 1;
    const b = ((n - 17 + 5) % SECTIONED_CLASSES) + 1;
    return normalizeStaffRecord({
      ...base,
      stream: "teaching",
      departmentId: "e2e_dep_teaching",
      designationId: n <= 22 ? "e2e_des_tgt" : "e2e_des_pgt",
      subjectTeachingLinks: [a, b].map((k, j) => ({
        id: `e2e_stl_${pad(n, 2)}_${j}`,
        classId: classId(k),
        sectionId: sectionId(k),
        subjectId: subjectId(subject),
        academicYearCode: AY_CURRENT,
        periodsPerWeek: 5,
      })),
    });
  }
  if (n === 27) {
    return normalizeStaffRecord({ ...base, stream: "non_teaching", departmentId: "e2e_dep_admin", designationId: "e2e_des_accounts" });
  }
  if (n >= 28 && n <= 30) {
    return normalizeStaffRecord({ ...base, stream: "non_teaching", departmentId: "e2e_dep_support", designationId: "e2e_des_driver" });
  }
  if (n >= 31 && n <= 34) {
    return normalizeStaffRecord({ ...base, stream: "non_teaching", departmentId: "e2e_dep_support", designationId: "e2e_des_peon" });
  }
  // n === 35: a teacher who has left.
  return normalizeStaffRecord({
    ...base,
    status: "inactive",
    stream: "teaching",
    departmentId: "e2e_dep_teaching",
    designationId: "e2e_des_prt",
  });
}

// ── RBAC, module registry, timetable ─────────────────────────────────────

function buildRbac(): RbacState {
  const state = defaultRbacState();
  const office = state.roles.find((r) => r.code === "office");
  if (!office) throw new Error("fixture: built-in office role missing");
  const assignment: UserRoleAssignment = {
    id: "e2e_asg_office",
    staffId: staffId(OFFICE_STAFF),
    roleId: office.id,
    isPrimary: true,
    scope: { campusIds: [], classIds: [], departmentIds: [] },
    expiresOn: "",
    note: "e2e fixture: office by assignment",
  };
  const clerkRole: RbacRole = {
    id: "e2e_role_cert_clerk",
    code: "e2e_cert_clerk",
    name: "Certificates clerk",
    isBuiltIn: false,
    isActive: true,
    makerChecker: false,
    permissions: [
      { module: "home", actions: ["view"] },
      { module: "students", actions: ["view", "edit"] },
      { module: "certificates", actions: ["view", "create", "edit", "export"] },
    ],
    note: "e2e fixture: issues certificates, no Masters / Fees / Transport grant",
  };
  const clerk: UserRoleAssignment = {
    id: "e2e_asg_cert_clerk",
    staffId: staffId(CERT_CLERK_STAFF),
    roleId: clerkRole.id,
    isPrimary: true,
    scope: { campusIds: [], classIds: [], departmentIds: [] },
    expiresOn: "",
    note: "e2e fixture: certificates clerk by assignment",
  };
  return { ...state, roles: [...state.roles, clerkRole], assignments: [assignment, clerk] };
}

function buildModuleRegistry(): ModuleRegistryState {
  return {
    version: 1,
    enabled: Object.fromEntries(REGISTRY_MODULES.map((m) => [m.id, m.defaultEnabled])),
  };
}

function buildTimetable(): TimetableState {
  const state = emptyTimetableState();
  const teachingPeriods = state.bellTemplate.filter((p) => p.kind === "teaching").map((p) => p.no);
  const published: TimetableGrid[] = TIMETABLE_TEACHER_SECTIONS.map((k) => ({
    id: `e2e_grid_${pad(k, 2)}`,
    academicYearCode: AY_CURRENT,
    classId: classId(k),
    sectionId: sectionId(k),
    slots: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      periodNo: teachingPeriods[0] ?? 1,
      subjectId: subjectId("GK"),
      teacherId: staffId(TIMETABLE_TEACHER),
      roomId: "",
    })),
    updatedAt: "2026-07-01T00:00:00.000Z",
  }));
  return {
    ...state,
    grids: published,
    publishedGrids: published,
    meta: {
      status: "published",
      publishedAt: "2026-07-01T00:00:00.000Z",
      publishedBy: "e2e fixture",
      generatedAt: "2026-07-01T00:00:00.000Z",
      solverStats: null,
    },
  };
}

// ── Students and households ──────────────────────────────────────────────

export const CURRENT_CHILDREN = 250;

/**
 * The one child with a fee group, and that group (class II, Promoted,
 * 2026-27): the Students → Upgrade test moves this child to the next class,
 * for which no group matches, and the child must keep this group
 * (e2e/specs/student-upgrade). Class II, not LKG: the school's built-in
 * Foundation structure (lib/feeStructureFoundation202627 — "Promoted ·
 * Foundation (Nur–UKG)") matches every move inside Nursery–UKG, so an LKG
 * child moving to UKG always finds a group (CI, 15–20 Oct 2026).
 * Child 239 sits in class II (sectionOfChild: (239-1) % 13 + 1 = 5) and has
 * no earlier-year rows (239 % 10 = 9). The group is INACTIVE (see feeGroups
 * below) so no other child is matched to it.
 */
export const UPGRADE_CHILD_INDEX = 239;
export const UPGRADE_FEE_GROUP = {
  id: "e2e_fg_ii_promote",
  code: "E2E-II-P",
  name: "E2E II Promoted",
  classKey: 5,
} as const;

const CHILD_FIRST = [
  "Aarav", "Bhavya", "Chirag", "Diya", "Eshan", "Fatima", "Gaurav", "Hiral", "Ishaan", "Jiya",
  "Kabir", "Lavanya", "Manan", "Nisha", "Om", "Pari", "Qasim", "Riya", "Shaurya", "Tanvi",
  "Utkarsh", "Vanya", "Wasim", "Yamini", "Zubin", "Anvi", "Bodhi", "Charvi", "Dhruv", "Elina",
  "Faiz", "Gauri", "Hridaan", "Inaya", "Jai", "Kiara", "Laksh", "Mira", "Neel", "Ojasvi",
];

const studentId = (i: number) => `e2e_stu_${pad(i, 4)}`;
const householdId = (h: number) => `e2e_hh_${pad(h, 3)}`;
/** Child i's current section index, 1 … 13. */
const sectionOfChild = (i: number) => ((i - 1) % SECTIONED_CLASSES) + 1;
/** 30 % of children: i % 10 in {0, 3, 6}. They carry 1–3 extra rows. */
const extraRowsOf = (i: number) => (i % 10 === 0 || i % 10 === 3 || i % 10 === 6 ? 1 + (i % 3) : 0);

/** Household sizes cycle 1,2,1,1,3,1,2,1 — about 1.5 children each. */
function householdPlan(): number[] {
  const sizes = [1, 2, 1, 1, 3, 1, 2, 1];
  const of: number[] = [];
  let h = 0;
  let s = 0;
  while (of.length < CURRENT_CHILDREN) {
    h += 1;
    const size = sizes[s++ % sizes.length]!;
    for (let j = 0; j < size && of.length < CURRENT_CHILDREN; j++) of.push(h);
  }
  return of; // of[i-1] = household of child i
}

function buildSis(): { households: Household[]; students: SisStudent[] } {
  const hhOf = householdPlan();
  const lastHh = hhOf[hhOf.length - 1]!;
  const households: Household[] = [];
  for (let h = 1; h <= lastHh; h++) {
    const surname = FAKE_SURNAMES[h % FAKE_SURNAMES.length]!;
    // Placeholder mobiles on four families, as production has.
    const mobile = h % 37 === 0 ? "0000000000" : `91${pad(h, 8)}`;
    households.push(
      normalizeHousehold({
        id: householdId(h),
        code: `E2E-HH-${pad(h, 3)}`,
        guardianName: `Guardian ${surname}`,
        mobile,
        whatsappMobile: mobile,
        city: "Testpur",
        state: "Uttar Pradesh",
      }),
    );
  }

  const students: SisStudent[] = [];
  const child = (i: number, over: Partial<SisStudent> & { id: string }): SisStudent =>
    normalizeStudent({
      admissionNo: `E2E-${pad(i, 4)}`,
      fullName: `${CHILD_FIRST[(i - 1) % CHILD_FIRST.length]} ${FAKE_SURNAMES[Math.floor((i - 1) / CHILD_FIRST.length) % FAKE_SURNAMES.length]}`,
      gender: i % 2 === 0 ? "F" : "M",
      status: "active",
      householdId: householdId(hhOf[i - 1]!),
      fatherName: `Father ${i}`,
      motherName: `Mother ${i}`,
      // Placeholder father's mobile on every 23rd child.
      fatherMobile: i % 23 === 0 ? "0000000000" : `92${pad(i, 8)}`,
      studentType: "PROMOTE",
      ...over,
    });

  for (let i = 1; i <= CURRENT_CHILDREN; i++) {
    const k = sectionOfChild(i);
    students.push(
      child(i, {
        id: studentId(i),
        classId: classId(k),
        sectionId: sectionId(k),
        academicYearCode: AY_CURRENT,
        rollNo: String(Math.ceil(i / SECTIONED_CLASSES)),
        ...(i === UPGRADE_CHILD_INDEX ? { feeGroupId: UPGRADE_FEE_GROUP.id } : {}),
      }),
    );
    // Earlier years' rows: a class lower per year; the third extra row is an
    // old record with no academic year at all.
    const extra = extraRowsOf(i);
    for (let j = 1; j <= extra; j++) {
      const kk = Math.max(1, k - j);
      students.push(
        child(i, {
          id: `${studentId(i)}_p${j}`,
          classId: classId(kk),
          sectionId: sectionId(kk),
          academicYearCode: j === 1 ? AY_PREV : j === 2 ? AY_PREV2 : "",
        }),
      );
    }
  }

  // A household the school has made inactive: both children inactive.
  households.push(
    normalizeHousehold({ id: "e2e_hh_inactive", code: "E2E-HH-INACTIVE", guardianName: "Guardian Inactivekar", mobile: "0000000000", whatsappMobile: "0000000000" }),
  );
  for (const [n, k] of [[9001, 4], [9002, 7]] as const) {
    students.push(
      child(n, {
        id: studentId(n),
        fullName: `Inactive Child ${n - 9000} Inactivekar`,
        status: "inactive",
        householdId: "e2e_hh_inactive",
        classId: classId(k),
        sectionId: sectionId(k),
        academicYearCode: AY_CURRENT,
      }),
    );
  }

  // A different child under child 101's admission number, a year earlier.
  // (101 has no earlier rows of its own: same number, same year would break
  // the unique index production also has.)
  households.push(
    normalizeHousehold({ id: "e2e_hh_dupadm", code: "E2E-HH-DUPADM", guardianName: "Guardian Duplicatewala", mobile: "9300000001", whatsappMobile: "9300000001" }),
  );
  students.push(
    child(101, {
      id: "e2e_stu_dupadm",
      fullName: "Someone Else Duplicatewala",
      householdId: "e2e_hh_dupadm",
      classId: classId(5),
      sectionId: sectionId(5),
      academicYearCode: AY_PREV,
    }),
  );

  return { households, students };
}


// ── Growing lists (month-grouped screens) ────────────────────────────────

/**
 * Payroll runs over three payroll months, two of them paid in parts, so
 * Payroll → Payroll runs shows month groups: October open, September and
 * August folded. Every run's net total is different, so a test (or an
 * export) can tell the rows apart by it.
 */
function buildPayrollRuns(staff: StaffRecord[]): PayrollState {
  const runs: PayrollRun[] = [
    { id: "e2e_pr_1", month: "2026-10", kind: "bulk", net: [21000, 18500] },
    { id: "e2e_pr_2", month: "2026-10", kind: "individual", net: [9100] },
    { id: "e2e_pr_3", month: "2026-09", kind: "bulk", net: [20500, 18000] },
    { id: "e2e_pr_4", month: "2026-09", kind: "individual", net: [9050] },
    { id: "e2e_pr_5", month: "2026-08", kind: "bulk", net: [20400, 17900, 9000] },
  ].map((r, i) => ({
    id: r.id,
    academicYearCode: AY_CURRENT,
    month: r.month,
    dayCount: 30,
    kind: r.kind as PayrollRun["kind"],
    status: "draft",
    lines: r.net.map((net, j) => {
      const s = staff[j]!;
      return normalizePayrollLine({ staffId: s.id, empCode: s.empCode, fullName: s.fullName, gross: net, netPay: net });
    }),
    createdBy: "E2E seed",
    createdAt: `${r.month}-2${i}T05:00:00.000Z`,
    submittedBy: "",
    submittedAt: "",
    approvedBy: "",
    approvedAt: "",
    postedBy: "",
    postedAt: "",
    paidBy: "",
    paidAt: "",
    remark: "",
    submissionNote: "",
    rejectionNote: "",
    rejectedBy: "",
    rejectedAt: "",
    lockVersion: 0,
  }));
  return { version: 2, runs, audit: [] };
}

/**
 * Automation runs (Masters → Automation → Recent runs), newest first like
 * the store keeps them. One sits on the IST month boundary: 20:00Z on 30 Sep
 * is 01:30 on 1 Oct in India, so it is an OCTOBER run.
 */
function buildAutomationRuns(): AutomationState {
  const at = [
    "2026-10-12T04:30:00.000Z",
    "2026-10-05T04:30:00.000Z",
    "2026-09-30T20:00:00.000Z",
    "2026-09-20T04:30:00.000Z",
    "2026-09-10T04:30:00.000Z",
    "2026-08-15T04:30:00.000Z",
  ];
  const runs: AutomationRun[] = at.map((t, i) => ({
    id: `e2e_ar_${i + 1}`,
    ruleId: "e2e_rule_fee_reminder",
    status: "completed",
    scheduledFor: t,
    startedAt: t,
    finishedAt: t,
    approvalId: "",
    stats: { proposed: 10 + i, approved: 10 + i, dispatched: 10 + i, failed: 0 },
    error: "",
  }));
  return { version: 1, rules: [], approvals: [], runs, lastTickAt: "" };
}

function withAudit(p: PayrollState): PayrollState {
  return { ...p, audit: buildPayrollAudit(p.runs) };
}

function buildGrowing(students: SisStudent[], staff: StaffRecord[]): E2eFixture["growing"] {
  // Active children of this session, one per household, in roster order.
  const seen = new Set<string>();
  const children = students
    .filter((s) => s.academicYearCode === AY_CURRENT && s.status === "active")
    .filter((s) => (seen.has(s.householdId) ? false : (seen.add(s.householdId), true)))
    .slice(0, 6)
    .map((s) => ({ id: s.id, fullName: s.fullName, householdId: s.householdId, admissionNo: s.admissionNo }));
  const { vouchers, searchChild } = buildReceipts(children);
  return {
    receipts: vouchers,
    receiptSearchChild: searchChild,
    chargeVouchers: buildChargeVouchers(children),
    feeAdjustments: buildFeeAdjustments(children),
    staffHr: buildStaffHr(staff),
    outdoorDuty: buildOutdoorDuty(staff),
    certificates: buildCertificates(children),
  };
}

// ── The whole school, and what a test should see ─────────────────────────

export type E2eFixture = {
  masters: MastersState;
  staff: { departments: Department[]; designations: Designation[]; staff: StaffRecord[] };
  rbac: RbacState;
  moduleRegistry: ModuleRegistryState;
  timetable: TimetableState;
  sis: { households: Household[]; students: SisStudent[] };
  /** Payroll runs over three months (Payroll → Payroll runs). */
  payroll: PayrollState;
  /** Automation runs over three IST months (Masters → Automation). */
  automation: AutomationState;
  /** Rows for the other month-grouped screens (e2e/growingLists.ts). */
  growing: {
    receipts: CollectionVoucher[];
    /** The child whose only receipt is in August — the receipts search test. */
    receiptSearchChild: { id: string; fullName: string; householdId: string; admissionNo: string };
    chargeVouchers: ChargeVoucher[];
    feeAdjustments: FeeAdjustment[];
    staffHr: StaffHrState;
    outdoorDuty: OutdoorDutySession[];
    certificates: CertificatesState;
  };
  /**
   * office — Office role by Masters → Roles assignment (Masters: view only);
   * principal — the Principal (built-in principal role: may edit Masters; the
   * propagation specs make their Masters changes as her);
   * teacher — class teacher of Nursery-A; timetableTeacher — timetable-only.
   */
  sessions: {
    office: DemoSession;
    principal: DemoSession;
    teacher: DemoSession;
    timetableTeacher: DemoSession;
    certClerk: DemoSession;
  };
  expected: {
    classes: number;
    sections: number;
    subjects: number;
    classSubjects: number;
    staff: number;
    activeStaff: number;
    households: number;
    studentRows: number;
    currentYearActiveChildren: number;
    rowsWithBlankYear: number;
    childrenWithExtraRows: number;
    /** Student rows in the class teacher's one section (all years). */
    classTeacherRows: number;
    /** Student rows in the timetable-only teacher's two sections (all years). */
    timetableTeacherRows: number;
  };
};

export function buildFixture(): E2eFixture {
  const { classes, sections } = buildClasses();
  const subjects = buildSubjects();
  const classSubjects = buildClassSubjects();
  const staff = Array.from({ length: 35 }, (_, i) => staffRecord(i + 1));
  const sis = buildSis();

  const shell = emptyMastersShell();
  const masters: MastersState = {
    ...shell,
    campuses: [{ id: "e2e_cam_main", code: "MAIN", name: "Main Campus", isPrimary: true, isActive: true }],
    academicYears: buildAcademicYears(),
    academicTerms: [],
    classes,
    sections,
    subjects,
    classSubjects,
    feeGroups: [
      {
        id: UPGRADE_FEE_GROUP.id,
        code: UPGRADE_FEE_GROUP.code,
        name: UPGRADE_FEE_GROUP.name,
        academicYearCode: AY_CURRENT,
        studentType: "PROMOTE",
        classIds: [classId(UPGRADE_FEE_GROUP.classKey)],
        // Inactive: held by child 239 only. An active group for class II would
        // be resolved for every other Promoted class II child too (lib/masters
        // resolveFeeGroupId) — it has no structure lines, so their checkout
        // answered 503 (parent-web-dues spec, 20 Oct 2026). A retired group a
        // child still holds is also the realistic case for "keep current".
        isActive: false,
        structurePublishedAt: null,
        structurePublishedBy: "",
      },
    ],
    // The Staff module owns these; they are seeded through its own write path.
    staff: [],
    departments: [],
    designations: [],
  };

  const inSections = (keys: readonly number[]) => {
    const want = new Set(keys.map((k) => `${classId(k)}|${sectionId(k)}`));
    return sis.students.filter((s) => want.has(`${s.classId}|${s.sectionId}`)).length;
  };

  const session = (n: number, roleCode: string): DemoSession => {
    const s = staff[n - 1]!;
    return {
      persona: "staff",
      fullName: s.fullName,
      roleCode,
      staffId: s.id,
      tenantSlug: E2E_TENANT_SLUG,
      academicYearCode: AY_CURRENT,
    };
  };

  return {
    masters,
    staff: { departments: DEPARTMENTS, designations: DESIGNATIONS, staff },
    rbac: buildRbac(),
    moduleRegistry: buildModuleRegistry(),
    timetable: buildTimetable(),
    sis,
    payroll: withAudit(buildPayrollRuns(staff)),
    automation: buildAutomationRuns(),
    growing: buildGrowing(sis.students, staff),
    sessions: {
      office: session(OFFICE_STAFF, "office"),
      principal: session(PRINCIPAL_STAFF, "principal"),
      teacher: session(CLASS_TEACHER, "teacher"),
      timetableTeacher: session(TIMETABLE_TEACHER, "teacher"),
      certClerk: session(CERT_CLERK_STAFF, "staff"),
    },
    expected: {
      classes: classes.length,
      sections: sections.length,
      subjects: subjects.length,
      classSubjects: classSubjects.length,
      staff: staff.length,
      activeStaff: staff.filter((s) => s.status === "active").length,
      households: sis.households.length,
      studentRows: sis.students.length,
      currentYearActiveChildren: sis.students.filter(
        (s) => s.academicYearCode === AY_CURRENT && s.status === "active",
      ).length,
      rowsWithBlankYear: sis.students.filter((s) => !s.academicYearCode).length,
      childrenWithExtraRows: Array.from({ length: CURRENT_CHILDREN }, (_, i) => extraRowsOf(i + 1)).filter((e) => e > 0).length,
      classTeacherRows: inSections([CLASS_TEACHER - 3]),
      timetableTeacherRows: inSections(TIMETABLE_TEACHER_SECTIONS),
    },
  };
}
