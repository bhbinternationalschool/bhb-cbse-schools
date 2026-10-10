/**
 * PDF reports on command — the pure half.
 *
 * "defaulters report pdf", "aaj ka collection pdf", "5A attendance
 * register kal ka", "class 5 student list", "admissions report this week":
 * the command desk recognises a report word plus a report kind, resolves the
 * class, date or period the way it does for every other command, checks the
 * asker's rights for THAT kind, renders a PDF on the server and hands it over
 * — as a WhatsApp document on WhatsApp, as a download link in the app.
 *
 * Every kind names the RBAC module and action it needs, because one command
 * covers several modules: a teacher may pull their own section's register
 * and not the school's defaulters. Rows are rendered by pure formatters from
 * typed inputs so the layout is testable without data.
 *
 * A PDF is easy to forward, so every page carries who requested it and when.
 */

import { formatInr } from "@/lib/masters";
import type { RbacAction, RbacModule } from "@/lib/rbac";

export type ErpReportKind = "defaulters" | "collection" | "attendance_register" | "class_list" | "admissions";

export type ErpReportKindDef = {
  id: ErpReportKind;
  title: string;
  module: RbacModule;
  action: RbacAction;
  /** Needs a class/section: required, optional (school when absent), or never. */
  section: "required" | "optional" | "none";
  /** Takes a date (register, collection) or a period (collection, admissions). */
  when: "date" | "period" | "none";
  /** Teachers are limited to their own sections for this kind. */
  ownSectionsForTeachers: boolean;
  examples: string[];
};

export const ERP_REPORT_KINDS: ErpReportKindDef[] = [
  { id: "defaulters", title: "Fee defaulters", module: "fees", action: "view", section: "optional", when: "none", ownSectionsForTeachers: true, examples: ["defaulters report pdf", "class 5 defaulters list", "bakayedar list pdf"] },
  { id: "collection", title: "Fee collection", module: "fees", action: "view", section: "none", when: "period", ownSectionsForTeachers: false, examples: ["aaj ka collection pdf", "collection sheet this week", "pichle mahine ka collection pdf"] },
  { id: "attendance_register", title: "Attendance register", module: "attendance", action: "view", section: "required", when: "date", ownSectionsForTeachers: true, examples: ["5A attendance register pdf", "class 3 B ki attendance sheet kal ki"] },
  { id: "class_list", title: "Student list", module: "students", action: "view", section: "optional", when: "none", ownSectionsForTeachers: true, examples: ["class 5 student list pdf", "5A students list", "roll list 4B"] },
  { id: "admissions", title: "Admissions", module: "admissions", action: "view", section: "none", when: "period", ownSectionsForTeachers: false, examples: ["admissions report pdf", "is hafte ki enquiry list pdf", "admission pdf this month"] },
];

export function reportKindDef(id: ErpReportKind): ErpReportKindDef {
  return ERP_REPORT_KINDS.find((k) => k.id === id)!;
}

/* ── parsing ─────────────────────────────────────────────────────── */

/**
 * Words that ask for a DOCUMENT. "report" is deliberately not one of them:
 * "attendance report", "admissions report" and "collection report" are the
 * desk's existing readings (attendance_summary, admissions_week,
 * collection_today) and keep their names. A PDF is asked for with pdf /
 * print / sheet, a register (attendance), or a list (defaulters, students).
 */
const DOC_WORDS = /(?<![\p{L}\p{M}])(pdf|print|printout|sheet|register|list|सूची)(?![\p{L}\p{M}])/iu;
const DOC_WORDS_PLAIN = /(?<![\p{L}\p{M}])(pdf|print|printout|sheet)(?![\p{L}\p{M}])/iu;
const DOC_WORDS_REGISTER = /(?<![\p{L}\p{M}])(pdf|print|printout|sheet|register)(?![\p{L}\p{M}])/iu;
const DOC_WORDS_LIST = /(?<![\p{L}\p{M}])(pdf|print|printout|sheet|list|सूची)(?![\p{L}\p{M}])/iu;

const KIND_HINTS: [ErpReportKind, RegExp][] = [
  ["defaulters", /(?<![\p{L}\p{M}])(defaulter|defaulters|bakayedar|bakaayedar|बकायेदार|dues|due\s+list|baaki\s+wale|overdue|outstanding)(?![\p{L}\p{M}])/iu],
  ["collection", /(?<![\p{L}\p{M}])(collection|collections|कलेक्शन|vasooli|vasuli|वसूली|receipts?|day\s*close|cash\s+book|daybook|day\s+book)(?![\p{L}\p{M}])/iu],
  // "register" alone is not an attendance word: "register kholo" is a sentence.
  ["attendance_register", /(?<![\p{L}\p{M}])(attendance|hazri|haziri|hazir|हाज़िरी|उपस्थिति|upasthiti)(?![\p{L}\p{M}])/iu],
  ["admissions", /(?<![\p{L}\p{M}])(admission|admissions|enquiry|enquiries|inquiry|leads?|प्रवेश|dakhila|दाखिला)(?![\p{L}\p{M}])/iu],
  ["class_list", /(?<![\p{L}\p{M}])(student|students|roll|strength|class\s+list|बच्चे|छात्र|bachch[eo]n?)(?![\p{L}\p{M}])/iu],
];

export type ReportQuery = { kind: ErpReportKind; rest: string };

/**
 * A report request: a report word AND a kind word. "attendance register"
 * has both in one phrase (register is a report word), which is why a bare
 * "register" alone is not enough — it needs the attendance word too. The
 * rest of the text is left for the desk's own class/date resolution.
 */
export function parseReportQuery(text: string): ReportQuery | null {
  const t = (text || "").trim();
  if (t.length < 5 || t.length > 200) return null;
  if (!DOC_WORDS.test(t)) return null;
  // "list" and "register" appear in ordinary sentences; a kind word is
  // required as well, so "make a list" and "register kholo" stay sentences.
  const hit = KIND_HINTS.find(([, re]) => re.test(t));
  if (!hit) return null;
  const [kind] = hit;
  const ok =
    kind === "attendance_register" ? DOC_WORDS_REGISTER.test(t)
    : kind === "defaulters" || kind === "class_list" ? DOC_WORDS_LIST.test(t)
    : DOC_WORDS_PLAIN.test(t);
  return ok ? { kind, rest: t } : null;
}

/* ── layout ──────────────────────────────────────────────────────── */

export type ReportColumn = { key: string; label: string; align?: "left" | "right"; width?: number };

export type ReportTable = {
  kind: ErpReportKind;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: Record<string, string>[];
  /** One or two lines under the table — totals, counts. */
  footer: string[];
  filename: string;
  /** A one-line summary for the WhatsApp caption / app reply. */
  summary: string;
};

export function reportFilename(kind: ErpReportKind, scope: string, when: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return [kind.replace("_", "-"), clean(scope), clean(when)].filter(Boolean).join("_") + ".pdf";
}

export type DefaulterRowInput = { name: string; admissionNo: string; classLabel: string; overdueDays: number; overdueAmountPaise: number; earliestDueOn: string; planCode?: string | null; mobileMasked: string };

export function defaultersTable(input: { scopeLabel: string; todayIso: string; rows: DefaulterRowInput[] }): Omit<ReportTable, "kind" | "filename"> & { kind: "defaulters"; filename: string } {
  const rows = [...input.rows].sort((a, b) => b.overdueAmountPaise - a.overdueAmountPaise);
  const total = rows.reduce((s, r) => s + r.overdueAmountPaise, 0);
  return {
    kind: "defaulters",
    title: "Fee defaulters",
    subtitle: `${input.scopeLabel} · as on ${input.todayIso}`,
    columns: [
      { key: "n", label: "#", width: 8, align: "right" },
      { key: "name", label: "Student", width: 52 },
      { key: "adm", label: "Adm no", width: 30 },
      { key: "cls", label: "Class", width: 24 },
      { key: "amount", label: "Overdue", width: 26, align: "right" },
      { key: "days", label: "Days", width: 14, align: "right" },
      { key: "since", label: "Oldest due", width: 26 },
      { key: "plan", label: "Plan", width: 18 },
      { key: "mobile", label: "Mobile", width: 26 },
    ],
    rows: rows.map((r, i) => ({ n: String(i + 1), name: r.name, adm: r.admissionNo, cls: r.classLabel, amount: formatInr(r.overdueAmountPaise), days: String(r.overdueDays), since: r.earliestDueOn, plan: r.planCode || "—", mobile: r.mobileMasked })),
    footer: [`${rows.length} student${rows.length === 1 ? "" : "s"} · total overdue ${formatInr(total)}`],
    filename: reportFilename("defaulters", input.scopeLabel, input.todayIso),
    summary: `${rows.length} defaulters · ${formatInr(total)} overdue (${input.scopeLabel})`,
  };
}

export type CollectionRowInput = { receiptNo: string; date: string; student: string; classLabel: string; mode: string; amountPaise: number; cashier: string };

export function collectionTable(input: { rangeLabel: string; from: string; to: string; rows: CollectionRowInput[] }): ReportTable {
  const rows = [...input.rows].sort((a, b) => (a.date === b.date ? a.receiptNo.localeCompare(b.receiptNo) : a.date.localeCompare(b.date)));
  const total = rows.reduce((s, r) => s + r.amountPaise, 0);
  const byMode = new Map<string, number>();
  for (const r of rows) byMode.set(r.mode, (byMode.get(r.mode) ?? 0) + r.amountPaise);
  return {
    kind: "collection",
    title: "Fee collection",
    subtitle: `${input.rangeLabel} · ${input.from === input.to ? input.from : `${input.from} to ${input.to}`}`,
    columns: [
      { key: "n", label: "#", width: 8, align: "right" },
      { key: "receipt", label: "Receipt", width: 26 },
      { key: "date", label: "Date", width: 24 },
      { key: "student", label: "Student", width: 56 },
      { key: "cls", label: "Class", width: 24 },
      { key: "mode", label: "Mode", width: 26 },
      { key: "amount", label: "Amount", width: 26, align: "right" },
      { key: "cashier", label: "Received by", width: 34 },
    ],
    rows: rows.map((r, i) => ({ n: String(i + 1), receipt: r.receiptNo, date: r.date, student: r.student, cls: r.classLabel, mode: r.mode, amount: formatInr(r.amountPaise), cashier: r.cashier })),
    footer: [
      `${rows.length} receipt${rows.length === 1 ? "" : "s"} · total ${formatInr(total)}`,
      [...byMode.entries()].sort((a, b) => b[1] - a[1]).map(([m, p]) => `${m} ${formatInr(p)}`).join(" · "),
    ].filter(Boolean),
    filename: reportFilename("collection", "", input.from === input.to ? input.from : `${input.from}_${input.to}`),
    summary: `${rows.length} receipts · ${formatInr(total)} (${input.rangeLabel})`,
  };
}

export const ATTENDANCE_STATUS_LABEL: Record<string, string> = { P: "Present", A: "Absent", L: "Late", HD: "Half day", LE: "Leave" };

export type RegisterRowInput = { rollNo: string; name: string; status: string | null; note: string };

export function attendanceRegisterTable(input: { sectionLabel: string; date: string; markedBy: string; rows: RegisterRowInput[] }): ReportTable {
  const rows = [...input.rows].sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999) || a.name.localeCompare(b.name));
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const unmarked = rows.filter((r) => !r.status).length;
  return {
    kind: "attendance_register",
    title: "Attendance register",
    subtitle: `${input.sectionLabel} · ${input.date}${input.markedBy ? ` · marked by ${input.markedBy}` : " · not marked"}`,
    columns: [
      { key: "roll", label: "Roll", width: 14, align: "right" },
      { key: "name", label: "Student", width: 80 },
      { key: "status", label: "Status", width: 30 },
      { key: "note", label: "Note", width: 60 },
    ],
    rows: rows.map((r) => ({ roll: r.rollNo || "—", name: r.name, status: r.status ? ATTENDANCE_STATUS_LABEL[r.status] ?? r.status : "—", note: r.note || "" })),
    footer: [
      `${rows.length} students · present ${count("P")} · absent ${count("A")} · late ${count("L")} · half day ${count("HD")} · leave ${count("LE")}${unmarked ? ` · not marked ${unmarked}` : ""}`,
    ],
    filename: reportFilename("attendance_register", input.sectionLabel, input.date),
    summary: `${input.sectionLabel} · ${input.date}: present ${count("P")}, absent ${count("A")}${unmarked ? `, not marked ${unmarked}` : ""}`,
  };
}

export type ClassListRowInput = { rollNo: string; name: string; admissionNo: string; classLabel: string; fatherName: string; mobileMasked: string };

export function classListTable(input: { scopeLabel: string; rows: ClassListRowInput[] }): ReportTable {
  const rows = [...input.rows].sort((a, b) => a.classLabel.localeCompare(b.classLabel, "en", { numeric: true }) || (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999) || a.name.localeCompare(b.name));
  return {
    kind: "class_list",
    title: "Student list",
    subtitle: input.scopeLabel,
    columns: [
      { key: "n", label: "#", width: 8, align: "right" },
      { key: "cls", label: "Class", width: 24 },
      { key: "roll", label: "Roll", width: 12, align: "right" },
      { key: "name", label: "Student", width: 56 },
      { key: "adm", label: "Adm no", width: 32 },
      { key: "father", label: "Father / guardian", width: 50 },
      { key: "mobile", label: "Mobile", width: 26 },
    ],
    rows: rows.map((r, i) => ({ n: String(i + 1), cls: r.classLabel, roll: r.rollNo || "—", name: r.name, adm: r.admissionNo, father: r.fatherName, mobile: r.mobileMasked })),
    footer: [`${rows.length} active student${rows.length === 1 ? "" : "s"}`],
    filename: reportFilename("class_list", input.scopeLabel, ""),
    summary: `${rows.length} students (${input.scopeLabel})`,
  };
}

export type AdmissionRowInput = { enquiryNo: string; date: string; childName: string; classSought: string; guardianName: string; mobileMasked: string; source: string; stage: string };

export function admissionsTable(input: { rangeLabel: string; from: string; to: string; rows: AdmissionRowInput[] }): ReportTable {
  const rows = [...input.rows].sort((a, b) => a.date.localeCompare(b.date));
  const byStage = new Map<string, number>();
  for (const r of rows) byStage.set(r.stage, (byStage.get(r.stage) ?? 0) + 1);
  return {
    kind: "admissions",
    title: "Admissions enquiries",
    subtitle: `${input.rangeLabel} · ${input.from} to ${input.to}`,
    columns: [
      { key: "n", label: "#", width: 8, align: "right" },
      { key: "enq", label: "Enquiry", width: 24 },
      { key: "date", label: "Date", width: 24 },
      { key: "child", label: "Child", width: 46 },
      { key: "cls", label: "Class sought", width: 26 },
      { key: "guardian", label: "Guardian", width: 44 },
      { key: "mobile", label: "Mobile", width: 26 },
      { key: "source", label: "Source", width: 24 },
      { key: "stage", label: "Stage", width: 24 },
    ],
    rows: rows.map((r, i) => ({ n: String(i + 1), enq: r.enquiryNo, date: r.date, child: r.childName, cls: r.classSought, guardian: r.guardianName, mobile: r.mobileMasked, source: r.source, stage: r.stage })),
    footer: [`${rows.length} enquir${rows.length === 1 ? "y" : "ies"}`, [...byStage.entries()].map(([s, n]) => `${s} ${n}`).join(" · ")].filter(Boolean),
    filename: reportFilename("admissions", "", `${input.from}_${input.to}`),
    summary: `${rows.length} enquiries (${input.rangeLabel})`,
  };
}

/** Last four digits only — a report that leaves the office should not carry every parent's number. */
export function maskMobile(m: string): string {
  const d = (m || "").replace(/\D/g, "");
  return d.length >= 4 ? `••••••${d.slice(-4)}` : "—";
}
