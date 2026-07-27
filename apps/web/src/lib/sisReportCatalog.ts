/**
 * SIS student reports — custom download + predefined registers.
 * Filters: class, section, date range, month, status.
 */

import {
  currentAcademicYearCode,
  loadMasters,
  STUDENT_TYPES,
  type MastersState,
} from "@/lib/masters";
import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";
import {
  DOC_LABELS,
  countDocsWithFiles,
  displayAadhaar,
  docHasFile,
  householdOf,
  loadSis,
  studentTypeShort,
  type SisState,
  type SisStudent,
  type StudentDocKey,
} from "@/lib/sis";
import {
  STUDENT_REGISTER_EXPORT_COLUMNS,
  studentToRegisterExportRow,
} from "@/lib/studentRegisterExport";
import { tagLabelsForStudent } from "@/lib/studentTags";
import { TENANT } from "@/lib/types";
import {
  computeStudentUdiseGaps,
  gapLabel,
  isUdiseFullyCompliant,
  loadUdiseComplianceSettings,
} from "@/lib/udiseCompliance";

export type SisReportFormat = "excel" | "pdf";

export type SisReportId =
  | "custom_download"
  | "predefined_download"
  | "rte_ews"
  | "student_age"
  | "document_report"
  | "monthly_admission"
  | "student_promoted"
  | "student_strength"
  | "admission_register"
  | "category_wise"
  | "students_notes"
  | "student_tags"
  | "udise_compliance";

export type SisReportCategory = "downloads" | "registers" | "analytics";

export type SisReportDef = {
  id: SisReportId;
  category: SisReportCategory;
  label: string;
  hint?: string;
};

export const SIS_REPORT_CATEGORIES: {
  id: SisReportCategory;
  title: string;
  headerClass: string;
}[] = [
  { id: "downloads", title: "Downloads", headerClass: "bg-[#43a047]" },
  { id: "registers", title: "Registers", headerClass: "bg-[#1565c0]" },
  { id: "analytics", title: "Analytics", headerClass: "bg-[#ef6c00]" },
];

export const SIS_REPORTS: SisReportDef[] = [
  {
    id: "custom_download",
    category: "downloads",
    label: "Custom download",
    hint: "Pick columns, then Excel / PDF",
  },
  {
    id: "predefined_download",
    category: "downloads",
    label: "Predefined download",
    hint: "Full student register (all form fields)",
  },
  {
    id: "rte_ews",
    category: "registers",
    label: "RTE / EWS",
    hint: "RTE type + EWS category",
  },
  {
    id: "student_age",
    category: "registers",
    label: "Student age report",
  },
  {
    id: "document_report",
    category: "registers",
    label: "Document report",
  },
  {
    id: "monthly_admission",
    category: "registers",
    label: "Monthly admission report",
  },
  {
    id: "student_promoted",
    category: "registers",
    label: "Student promoted report",
  },
  {
    id: "admission_register",
    category: "registers",
    label: "Student admission register (SRN)",
    hint: "SRN register maintain",
  },
  {
    id: "category_wise",
    category: "registers",
    label: "Category-wise student details",
  },
  {
    id: "students_notes",
    category: "registers",
    label: "Students notes report",
  },
  {
    id: "student_tags",
    category: "registers",
    label: "Student tags report",
  },
  {
    id: "udise_compliance",
    category: "registers",
    label: "UDISE+ PEN / APAAR / Aadhaar register",
    hint: "Full compliance printout · Excel or PDF",
  },
  {
    id: "student_strength",
    category: "analytics",
    label: "Student strength report",
  },
];

export type SisReportFilters = {
  academicYearCode?: string;
  classId?: string;
  sectionId?: string;
  status?: "all" | "active" | "inactive";
  fromDate?: string;
  toDate?: string;
  /** YYYY-MM for monthly admission */
  month?: string;
  /** Column keys for custom_download */
  customColumns?: string[];
  masters?: MastersState;
  sis?: SisState;
  format: SisReportFormat;
};

function genderLabel(g: SisStudent["gender"]): string {
  if (g === "M") return "Male";
  if (g === "F") return "Female";
  if (g === "O") return "Other";
  return "";
}

function ageOn(dob: string, asOf = new Date()): string {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return "";
  const d = new Date(dob.slice(0, 10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  let years = asOf.getFullYear() - d.getFullYear();
  let months = asOf.getMonth() - d.getMonth();
  if (asOf.getDate() < d.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return `${years}y ${months}m`;
}

function ageYears(dob: string, asOf = new Date()): number | "" {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return "";
  const d = new Date(dob.slice(0, 10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  let years = asOf.getFullYear() - d.getFullYear();
  const m = asOf.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < d.getDate())) years -= 1;
  return years;
}

function classSection(
  s: SisStudent,
  masters: MastersState,
): { className: string; section: string } {
  return {
    className: masters.classes.find((c) => c.id === s.classId)?.name ?? "",
    section: masters.sections.find((x) => x.id === s.sectionId)?.name ?? "",
  };
}

export function filterSisStudents(
  sis: SisState,
  masters: MastersState,
  filters: Omit<SisReportFilters, "format" | "customColumns" | "masters" | "sis">,
): SisStudent[] {
  const status = filters.status ?? "active";
  let rows = sis.students.slice();

  if (filters.academicYearCode) {
    rows = rows.filter(
      (s) => s.academicYearCode === filters.academicYearCode,
    );
  }
  if (status !== "all") {
    rows = rows.filter((s) => s.status === status);
  }
  if (filters.classId) {
    rows = rows.filter((s) => {
      if (s.classId === filters.classId) return true;
      const sec = masters.sections.find((x) => x.id === s.sectionId);
      return sec?.classId === filters.classId;
    });
  }
  if (filters.sectionId) {
    rows = rows.filter((s) => s.sectionId === filters.sectionId);
  }
  if (filters.fromDate) {
    rows = rows.filter(
      (s) => s.joinedOn && s.joinedOn.slice(0, 10) >= filters.fromDate!,
    );
  }
  if (filters.toDate) {
    rows = rows.filter(
      (s) => s.joinedOn && s.joinedOn.slice(0, 10) <= filters.toDate!,
    );
  }
  if (filters.month) {
    const m = filters.month.slice(0, 7);
    rows = rows.filter((s) => s.joinedOn && s.joinedOn.slice(0, 7) === m);
  }

  return rows.sort((a, b) => {
    const ca = classSection(a, masters).className;
    const cb = classSection(b, masters).className;
    if (ca !== cb) return ca.localeCompare(cb);
    const sa = classSection(a, masters).section;
    const sb = classSection(b, masters).section;
    if (sa !== sb) return sa.localeCompare(sb);
    return a.fullName.localeCompare(b.fullName);
  });
}

function filterNote(filters: SisReportFilters, masters: MastersState): string {
  const cls = filters.classId
    ? masters.classes.find((c) => c.id === filters.classId)?.name
    : "";
  const sec = filters.sectionId
    ? masters.sections.find((s) => s.id === filters.sectionId)?.name
    : "";
  return describeFilters([
    filters.academicYearCode
      ? `Session ${filters.academicYearCode}`
      : "",
    cls ? `Class ${cls}` : "",
    sec ? `Sec ${sec}` : "",
    filters.status && filters.status !== "all"
      ? filters.status
      : filters.status === "all"
        ? "All status"
        : "",
    filters.fromDate ? `From ${filters.fromDate}` : "",
    filters.toDate ? `To ${filters.toDate}` : "",
    filters.month ? `Month ${filters.month}` : "",
  ]);
}

const BASE_COLS: ReportColumn[] = [
  { key: "admissionNo", header: "Adm no", width: 1.1 },
  { key: "srn", header: "SRN", width: 0.9 },
  { key: "fullName", header: "Student", width: 1.5 },
  { key: "tags", header: "Tags", width: 1 },
  { key: "className", header: "Class", width: 0.7 },
  { key: "section", header: "Sec", width: 0.5 },
  { key: "rollNo", header: "Roll", width: 0.5 },
  { key: "gender", header: "Gender", width: 0.6 },
];

function baseRow(
  s: SisStudent,
  sis: SisState,
  masters: MastersState,
): Record<string, string | number> {
  const { className, section } = classSection(s, masters);
  return {
    admissionNo: s.admissionNo,
    srn: s.srn,
    fullName: s.fullName,
    tags: tagLabelsForStudent(s, sis),
    className,
    section,
    rollNo: s.rollNo,
    gender: genderLabel(s.gender),
    studentType: studentTypeShort(s.studentType).label,
    category: s.category || "",
    status: s.status,
    joinedOn: s.joinedOn,
    dob: s.dob,
    fatherName: s.fatherName,
    motherName: s.motherName,
    notes: s.notes,
  };
}

export const CUSTOM_DOWNLOAD_COLUMNS: ReportColumn[] =
  STUDENT_REGISTER_EXPORT_COLUMNS;

function runCustom(
  students: SisStudent[],
  sis: SisState,
  masters: MastersState,
  filters: SisReportFilters,
): { columns: ReportColumn[]; rows: Record<string, string | number>[] } {
  const keys =
    filters.customColumns?.length ?
      filters.customColumns
    : [
        "admissionNo",
        "fullName",
        "tags",
        "className",
        "section",
        "rollNo",
        "gender",
        "dob",
        "category",
        "studentType",
        "srn",
        "joinedOn",
      ];
  const colMap = new Map(CUSTOM_DOWNLOAD_COLUMNS.map((c) => [c.key, c]));
  const columns = keys
    .map((k) => colMap.get(k))
    .filter((c): c is ReportColumn => !!c);
  const rows = students.map((s) => {
    const full = studentToRegisterExportRow(s, sis, masters);
    return {
      ...full,
      tags: tagLabelsForStudent(s, sis),
    };
  });
  return { columns, rows };
}

function runPredefined(
  students: SisStudent[],
  sis: SisState,
  masters: MastersState,
) {
  return {
    columns: CUSTOM_DOWNLOAD_COLUMNS,
    rows: students.map((s) => ({
      ...studentToRegisterExportRow(s, sis, masters),
      tags: tagLabelsForStudent(s, sis),
    })),
  };
}

function runRteEws(
  students: SisStudent[],
  sis: SisState,
  masters: MastersState,
) {
  const rows = students.filter(
    (s) =>
      s.studentType === "RTE" ||
      s.category === "EWS" ||
      (s.tagIds ?? []).some((id) => {
        const t = (sis.tags ?? []).find((x) => x.id === id);
        return t?.code === "RTE";
      }),
  );
  return {
    columns: [
      ...BASE_COLS,
      { key: "studentType", header: "Type", width: 1 },
      { key: "category", header: "Category", width: 0.8 },
      { key: "fatherName", header: "Father", width: 1.2 },
      { key: "joinedOn", header: "Joined", width: 0.9 },
      { key: "incomeCert", header: "Income cert", width: 0.9 },
    ],
    rows: rows.map((s) => ({
      ...baseRow(s, sis, masters),
      incomeCert: s.docs.incomeCert.status,
    })),
  };
}

function runAge(
  students: SisStudent[],
  sis: SisState,
  masters: MastersState,
) {
  const asOf = new Date();
  return {
    columns: [
      ...BASE_COLS,
      { key: "dob", header: "DOB", width: 0.9 },
      { key: "ageYears", header: "Age (y)", width: 0.7, align: "right" as const },
      { key: "ageDetail", header: "Age", width: 0.9 },
      { key: "category", header: "Category", width: 0.7 },
    ],
    rows: students.map((s) => ({
      ...baseRow(s, sis, masters),
      ageYears: ageYears(s.dob, asOf),
      ageDetail: ageOn(s.dob, asOf),
    })),
  };
}

function runDocuments(
  students: SisStudent[],
  sis: SisState,
  masters: MastersState,
) {
  const docCols: ReportColumn[] = DOC_LABELS.map((d) => ({
    key: d.key,
    header: d.label,
    width: 0.85,
  }));
  return {
    columns: [
      ...BASE_COLS.slice(0, 6),
      { key: "docsUploaded", header: "Uploaded", width: 0.7, align: "right" as const },
      ...docCols,
    ],
    rows: students.map((s) => {
      const docCells: Record<string, string> = {};
      for (const { key } of DOC_LABELS) {
        const doc = s.docs[key as StudentDocKey];
        docCells[key] = docHasFile(doc)
          ? doc.status === "verified"
            ? "Verified"
            : "Yes"
          : doc.status === "missing"
            ? "Missing"
            : doc.status;
      }
      return {
        ...baseRow(s, sis, masters),
        docsUploaded: `${countDocsWithFiles(s.docs)}/${DOC_LABELS.length}`,
        ...docCells,
      };
    }),
  };
}

function runMonthlyAdmission(
  students: SisStudent[],
  sis: SisState,
  masters: MastersState,
) {
  return {
    columns: [
      ...BASE_COLS,
      { key: "joinedOn", header: "Admission date", width: 1 },
      { key: "studentType", header: "Type", width: 1 },
      { key: "fatherName", header: "Father", width: 1.2 },
      { key: "fatherMobile", header: "Mobile", width: 1 },
      { key: "category", header: "Category", width: 0.7 },
    ],
    rows: students
      .filter((s) => !!s.joinedOn)
      .map((s) => ({
        ...baseRow(s, sis, masters),
        fatherMobile: s.fatherMobile,
      })),
  };
}

function runPromoted(
  students: SisStudent[],
  sis: SisState,
  masters: MastersState,
) {
  const rows = students.filter((s) => s.studentType === "PROMOTE");
  return {
    columns: [
      ...BASE_COLS,
      { key: "studentType", header: "Type", width: 1 },
      { key: "academicYear", header: "Session", width: 0.8 },
      { key: "previousSchool", header: "Prev school", width: 1.2 },
      { key: "joinedOn", header: "Joined", width: 0.9 },
    ],
    rows: rows.map((s) => ({
      ...baseRow(s, sis, masters),
      academicYear: s.academicYearCode,
      previousSchool: s.previousSchool,
    })),
  };
}

function runStrength(
  students: SisStudent[],
  masters: MastersState,
) {
  const map = new Map<
    string,
    { className: string; section: string; boys: number; girls: number; other: number; total: number }
  >();
  for (const s of students) {
    const { className, section } = classSection(s, masters);
    const key = `${s.classId}|${s.sectionId}`;
    const cur = map.get(key) ?? {
      className,
      section,
      boys: 0,
      girls: 0,
      other: 0,
      total: 0,
    };
    if (s.gender === "M") cur.boys += 1;
    else if (s.gender === "F") cur.girls += 1;
    else cur.other += 1;
    cur.total += 1;
    map.set(key, cur);
  }
  const rows = [...map.values()].sort((a, b) =>
    `${a.className}-${a.section}`.localeCompare(`${b.className}-${b.section}`),
  );
  const totals = rows.reduce(
    (acc, r) => ({
      boys: acc.boys + r.boys,
      girls: acc.girls + r.girls,
      other: acc.other + r.other,
      total: acc.total + r.total,
    }),
    { boys: 0, girls: 0, other: 0, total: 0 },
  );
  return {
    columns: [
      { key: "className", header: "Class", width: 1 },
      { key: "section", header: "Section", width: 0.8 },
      { key: "boys", header: "Boys", width: 0.7, align: "right" as const },
      { key: "girls", header: "Girls", width: 0.7, align: "right" as const },
      { key: "other", header: "Other", width: 0.7, align: "right" as const },
      { key: "total", header: "Total", width: 0.7, align: "right" as const },
    ],
    rows: [
      ...rows,
      {
        className: "TOTAL",
        section: "",
        boys: totals.boys,
        girls: totals.girls,
        other: totals.other,
        total: totals.total,
      },
    ],
  };
}

function runAdmissionRegister(
  students: SisStudent[],
  sis: SisState,
  masters: MastersState,
) {
  return {
    columns: [
      { key: "srn", header: "SRN", width: 1 },
      { key: "admissionNo", header: "Adm no", width: 1.1 },
      { key: "fullName", header: "Student", width: 1.5 },
      { key: "tags", header: "Tags", width: 0.9 },
      { key: "fatherName", header: "Father", width: 1.2 },
      { key: "motherName", header: "Mother", width: 1.2 },
      { key: "dob", header: "DOB", width: 0.9 },
      { key: "className", header: "Class", width: 0.7 },
      { key: "section", header: "Sec", width: 0.5 },
      { key: "category", header: "Category", width: 0.7 },
      { key: "joinedOn", header: "Admission date", width: 1 },
      { key: "pen", header: "PEN", width: 1 },
      { key: "apaarId", header: "APAAR", width: 1 },
      { key: "address", header: "Address", width: 1.5 },
    ],
    rows: students.map((s) => {
      const hh = householdOf(sis, s.householdId);
      return {
        ...baseRow(s, sis, masters),
        pen: s.pen,
        apaarId: s.apaarId,
        address: hh?.address ?? "",
      };
    }),
  };
}

function runCategoryWise(
  students: SisStudent[],
  sis: SisState,
  masters: MastersState,
) {
  return {
    columns: [
      { key: "category", header: "Category", width: 0.8 },
      ...BASE_COLS.filter((c) => c.key !== "tags"),
      { key: "tags", header: "Tags", width: 1 },
      { key: "religion", header: "Religion", width: 0.9 },
      { key: "studentType", header: "Type", width: 1 },
      { key: "joinedOn", header: "Joined", width: 0.9 },
    ],
    rows: [...students]
      .sort((a, b) => (a.category || "ZZZ").localeCompare(b.category || "ZZZ"))
      .map((s) => ({
        ...baseRow(s, sis, masters),
        religion: s.religion,
      })),
  };
}

function runNotes(
  students: SisStudent[],
  sis: SisState,
  masters: MastersState,
) {
  const rows = students.filter((s) => (s.notes || "").trim());
  return {
    columns: [
      ...BASE_COLS,
      { key: "notes", header: "Notes", width: 2.2 },
    ],
    rows: rows.map((s) => baseRow(s, sis, masters)),
  };
}

function runTagsReport(
  students: SisStudent[],
  sis: SisState,
  masters: MastersState,
) {
  const rows = students.filter((s) => (s.tagIds ?? []).length > 0);
  return {
    columns: [
      ...BASE_COLS,
      { key: "tagNames", header: "Tag names", width: 1.4 },
      { key: "studentType", header: "Type", width: 1 },
      { key: "status", header: "Status", width: 0.7 },
    ],
    rows: rows.map((s) => {
      const tags = (sis.tags ?? []).filter((t) =>
        (s.tagIds ?? []).includes(t.id),
      );
      return {
        ...baseRow(s, sis, masters),
        tagNames: tags.map((t) => t.name).join(", "),
      };
    }),
  };
}

function runUdiseCompliance(
  students: SisStudent[],
  _sis: SisState,
  masters: MastersState,
) {
  const cfg = loadUdiseComplianceSettings();
  const columns: ReportColumn[] = [
    { key: "admissionNo", header: "Adm no", width: 1 },
    { key: "fullName", header: "Student", width: 1.4 },
    { key: "className", header: "SIS class", width: 0.7 },
    { key: "section", header: "Sec", width: 0.45 },
    { key: "rollNo", header: "Roll", width: 0.45 },
    { key: "fatherName", header: "Father", width: 1.1 },
    { key: "motherName", header: "Mother", width: 1.1 },
    { key: "studentAadhaar", header: "Student Aadhaar", width: 1.1 },
    { key: "aadhaarVerification", header: "Aadhaar SIS status", width: 1 },
    {
      key: "udiseAadhaarValidation",
      header: "Aadhaar validation (UDISE+)",
      width: 1.1,
    },
    { key: "fatherAadhaar", header: "Father Aadhaar", width: 1 },
    { key: "motherAadhaar", header: "Mother Aadhaar", width: 1 },
    { key: "pen", header: "PEN", width: 1 },
    { key: "apaarId", header: "APAAR", width: 1 },
    { key: "mbuStatus", header: "MBU status", width: 1.1 },
    { key: "ageBelowAlert", header: "Age below class", width: 0.8 },
    { key: "udisePortalClass", header: "UDISE+ class (ref)", width: 0.9 },
    { key: "classMismatch", header: "UDISE class wrong?", width: 0.8 },
    { key: "gaps", header: "Open gaps", width: 1.6 },
    { key: "ready", header: "UDISE ready", width: 0.7 },
  ];

  const rows = students.map((s) => {
    const { className, section } = classSection(s, masters);
    const gaps = computeStudentUdiseGaps(s, cfg);
    const ready = isUdiseFullyCompliant(s, cfg);
    const portal = (s.udisePortalClassHint || "").trim();
    const sisLabel = section ? `${className}-${section}` : className;
    const classMismatch =
      !!portal &&
      !!sisLabel &&
      portal.replace(/\s+/g, "").toLowerCase() !==
        sisLabel.replace(/\s+/g, "").toLowerCase() &&
      !portal.toLowerCase().includes(className.toLowerCase());

    return {
      admissionNo: s.admissionNo,
      fullName: s.fullName,
      className,
      section,
      rollNo: s.rollNo,
      fatherName: s.fatherName,
      motherName: s.motherName,
      studentAadhaar: displayAadhaar({
        number: s.aadhaarNumber,
        last4: s.aadhaarLast4,
        verification: s.aadhaarVerification,
      }),
      aadhaarVerification: s.aadhaarVerification || "missing",
      udiseAadhaarValidation: s.udiseAadhaarValidationStatus || "",
      fatherAadhaar: displayAadhaar({
        number: s.fatherAadhaarNumber,
        last4: s.fatherAadhaarLast4,
        verification: s.fatherAadhaarVerification,
      }),
      motherAadhaar: displayAadhaar({
        number: s.motherAadhaarNumber,
        last4: s.motherAadhaarLast4,
        verification: s.motherAadhaarVerification,
      }),
      pen: s.pen || "",
      apaarId: s.apaarId || "",
      mbuStatus: s.udiseMbuStatus || "",
      ageBelowAlert: s.udiseAgeBelowClassAlert ? "YES — notify school" : "",
      udisePortalClass: portal,
      classMismatch: classMismatch ? "Check UDISE+ class" : "",
      gaps: gaps.length ? gaps.map(gapLabel).join("; ") : "",
      ready: ready ? "Yes" : "No",
    };
  });

  return { columns, rows };
}

export function runSisReport(
  id: SisReportId,
  filters: SisReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
  const masters = filters.masters ?? loadMasters();
  const sis = filters.sis ?? loadSis();
  const students = filterSisStudents(sis, masters, filters);
  const note = filterNote(filters, masters);
  const ay = filters.academicYearCode || currentAcademicYearCode(masters);
  const def = SIS_REPORTS.find((r) => r.id === id);
  const title = def?.label ?? id;

  let built: {
    columns: ReportColumn[];
    rows: Record<string, string | number>[];
  };

  switch (id) {
    case "custom_download":
      built = runCustom(students, sis, masters, filters);
      break;
    case "predefined_download":
      built = runPredefined(students, sis, masters);
      break;
    case "rte_ews":
      built = runRteEws(students, sis, masters);
      break;
    case "student_age":
      built = runAge(students, sis, masters);
      break;
    case "document_report":
      built = runDocuments(students, sis, masters);
      break;
    case "monthly_admission":
      built = runMonthlyAdmission(students, sis, masters);
      break;
    case "student_promoted":
      built = runPromoted(students, sis, masters);
      break;
    case "student_strength":
      built = runStrength(students, masters);
      break;
    case "admission_register":
      built = runAdmissionRegister(students, sis, masters);
      break;
    case "category_wise":
      built = runCategoryWise(students, sis, masters);
      break;
    case "students_notes":
      built = runNotes(students, sis, masters);
      break;
    case "student_tags":
      built = runTagsReport(students, sis, masters);
      break;
    case "udise_compliance":
      built = runUdiseCompliance(students, sis, masters);
      break;
    default:
      return { ok: false, error: "Unknown report" };
  }

  if (!built.columns.length) {
    return { ok: false, error: "No columns selected" };
  }
  if (!built.rows.length && id !== "student_strength") {
    return { ok: false, error: "No students match filters" };
  }

  const result = exportFilterReport(
    {
      title,
      subtitle: `${TENANT.shortName} · ${ay}`,
      filterNote: note,
      columns: built.columns,
      rows: built.rows,
      fileBaseName: `sis_${id}`,
    },
    filters.format,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    message: `${title} · ${filters.format.toUpperCase()} · ${built.rows.length} row(s)`,
  };
}

/** Unused import guard for STUDENT_TYPES — keep available for UI filters */
export const SIS_STUDENT_TYPE_OPTIONS = STUDENT_TYPES;
