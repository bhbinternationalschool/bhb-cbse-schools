/**
 * Certificates reports — issue register, TC register.
 * lib/certificates.ts tracks every issued certificate (TC, bonafide,
 * character, fee clearance, fees-paid) but nothing exportable came out of
 * it — no register an office could hand to CBSE inspection or file for
 * audit.
 */

import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";
import { formatInr } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import {
  CERTIFICATE_KINDS,
  loadCertificates,
  type CertificateIssue,
  type CertificateKind,
  type CertificatesState,
} from "@/lib/certificates";

export type CertificatesReportFormat = "excel" | "pdf";

export type CertificatesReportId = "issue_register" | "tc_register";

export type CertificatesReportCategory = "registers";

export type CertificatesReportDef = {
  id: CertificatesReportId;
  category: CertificatesReportCategory;
  label: string;
  hint?: string;
};

export const CERTIFICATES_REPORT_CATEGORIES: {
  id: CertificatesReportCategory;
  title: string;
  headerClass: string;
}[] = [{ id: "registers", title: "Registers", headerClass: "bg-[#0f766e]" }];

export const CERTIFICATES_REPORTS: CertificatesReportDef[] = [
  {
    id: "issue_register",
    category: "registers",
    label: "Certificate issue register",
    hint: "Every certificate issued, any kind, over a date range",
  },
  {
    id: "tc_register",
    category: "registers",
    label: "TC register",
    hint: "Transfer certificates with leaving date, reason, last class",
  },
];

export type CertificatesReportFilters = {
  kind?: CertificateKind;
  fromDate?: string;
  toDate?: string;
  includeVoided?: boolean;
  format: CertificatesReportFormat;
  state?: CertificatesState;
};

function kindLabel(kind: CertificateKind): string {
  return CERTIFICATE_KINDS.find((k) => k.kind === kind)?.short ?? kind;
}

function inScope(
  issues: CertificateIssue[],
  filters: CertificatesReportFilters,
): CertificateIssue[] {
  return issues.filter((c) => {
    if (!filters.includeVoided && c.voidedAt) return false;
    if (filters.kind && c.kind !== filters.kind) return false;
    if (filters.fromDate && c.issuedOn < filters.fromDate) return false;
    if (filters.toDate && c.issuedOn > filters.toDate) return false;
    return true;
  });
}

function runIssueRegister(issues: CertificateIssue[]) {
  return {
    columns: [
      { key: "certNo", header: "Cert no", width: 1 },
      { key: "kind", header: "Kind", width: 0.8 },
      { key: "admissionNo", header: "Adm no", width: 1 },
      { key: "studentName", header: "Student", width: 1.4 },
      { key: "classLabel", header: "Class", width: 0.7 },
      { key: "issuedOn", header: "Issued on", width: 0.9 },
      { key: "issuedBy", header: "Issued by", width: 1.1 },
      { key: "status", header: "Status", width: 0.7 },
    ],
    rows: issues
      .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))
      .map((c) => ({
        certNo: c.certNo,
        kind: kindLabel(c.kind),
        admissionNo: c.admissionNo,
        studentName: c.studentName,
        classLabel: c.classLabel,
        issuedOn: c.issuedOn,
        issuedBy: c.issuedBy,
        status: c.voidedAt ? "Voided" : "Active",
      })),
  };
}

function runTcRegister(issues: CertificateIssue[]) {
  const tcRows = issues.filter((c) => c.kind === "tc");
  return {
    columns: [
      { key: "certNo", header: "TC no", width: 1 },
      { key: "admissionNo", header: "Adm no", width: 1 },
      { key: "studentName", header: "Student", width: 1.4 },
      { key: "fatherName", header: "Father", width: 1.2 },
      { key: "classLabel", header: "Class", width: 0.7 },
      { key: "admissionDate", header: "Admitted", width: 0.9 },
      { key: "leavingDate", header: "Leaving date", width: 0.9 },
      { key: "lastClassStudied", header: "Last class", width: 0.8 },
      { key: "promotedTo", header: "Promoted to", width: 0.9 },
      { key: "reasonForLeaving", header: "Reason", width: 1.4 },
      { key: "conduct", header: "Conduct", width: 0.8 },
      { key: "duesCleared", header: "Dues cleared", width: 0.8 },
      { key: "openBalance", header: "Open balance", width: 0.9, align: "right" as const },
      { key: "issuedOn", header: "Issued on", width: 0.9 },
      { key: "status", header: "Status", width: 0.7 },
    ],
    rows: tcRows
      .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))
      .map((c) => ({
        certNo: c.certNo,
        admissionNo: c.admissionNo,
        studentName: c.studentName,
        fatherName: c.fatherName,
        classLabel: c.classLabel,
        admissionDate: c.admissionDate,
        leavingDate: c.leavingDate,
        lastClassStudied: c.lastClassStudied,
        promotedTo: c.promotedTo,
        reasonForLeaving: c.reasonForLeaving,
        conduct: c.conduct,
        duesCleared: c.duesCleared ? "Yes" : "No",
        openBalance: formatInr(c.openBalancePaise),
        issuedOn: c.issuedOn,
        status: c.voidedAt ? "Voided" : "Active",
      })),
  };
}

export function runCertificatesReport(
  id: CertificatesReportId,
  filters: CertificatesReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
  const state = filters.state ?? loadCertificates();
  const scoped = inScope(state.issues, filters);
  const def = CERTIFICATES_REPORTS.find((r) => r.id === id);
  const title = def?.label ?? id;

  const note = describeFilters([
    filters.kind ? `Kind ${kindLabel(filters.kind)}` : "",
    filters.fromDate ? `From ${filters.fromDate}` : "",
    filters.toDate ? `To ${filters.toDate}` : "",
    filters.includeVoided ? "Including voided" : "",
  ]);

  let built: { columns: ReportColumn[]; rows: Record<string, string | number>[] };
  switch (id) {
    case "issue_register":
      built = runIssueRegister(scoped);
      break;
    case "tc_register":
      built = runTcRegister(scoped);
      break;
    default:
      return { ok: false, error: "Unknown report" };
  }

  if (!built.rows.length) {
    return { ok: false, error: "No certificates match these filters" };
  }

  const result = exportFilterReport(
    {
      title,
      subtitle: `${TENANT.shortName} · Certificates`,
      filterNote: note,
      columns: built.columns,
      rows: built.rows,
      fileBaseName: `certificates_${id}`,
    },
    filters.format,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    message: `${title} · ${filters.format.toUpperCase()} · ${built.rows.length} row(s)`,
  };
}
