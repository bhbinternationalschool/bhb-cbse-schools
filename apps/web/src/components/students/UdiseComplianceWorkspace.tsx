"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadMasters, type MastersState } from "@/lib/masters";
import { displayAadhaar, loadSis, saveSis, type SisState } from "@/lib/sis";
import { openWaMe } from "@/lib/waMe";
import {
  composeUdiseComplianceWhatsApp,
  listUdiseComplianceRows,
  listUdisePortalSearchRows,
  listUdiseRegisteredStudents,
  listUdiseUnregisteredStudents,
  loadUdiseComplianceSettings,
  markUdiseComplianceReminded,
  saveUdiseComplianceSettings,
  UIDAI_LINKS,
  udiseComplianceSummary,
  udiseEntryStatusLabel,
  udiseRegisteredSummary,
  udiseUnregisteredSummary,
  type UdiseComplianceRow,
  type UdiseComplianceSettings,
  type UdiseGapCode,
  type UdisePortalSearchRow,
  type UdiseRegisteredRow,
  type UdiseUnregisteredRow,
} from "@/lib/udiseCompliance";
import { UdisePenApaarImportPanel } from "@/components/students/UdisePenApaarImportPanel";
import {
  UdiseStudentListModal,
  type UdiseListRow,
} from "@/components/students/UdiseStudentListModal";
import type { ReportColumn } from "@/lib/reportExport";
import { runSisReport } from "@/lib/sisReportCatalog";
import { useDemoSession } from "@/components/shell/SessionContext";
import { currentAcademicYearCode } from "@/lib/masters";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";

type FilterGap = "all" | UdiseGapCode | "due" | "call" | "unregistered";
type ViewMode = "worklist" | "call" | "unregistered";

const GAP_COLUMNS: ReportColumn[] = [
  { key: "student", header: "Student", width: 2 },
  { key: "admissionNo", header: "Adm no", width: 1.2 },
  { key: "classLabel", header: "Class", width: 1 },
  { key: "entryStatus", header: "Entry status", width: 1.6 },
  { key: "missing", header: "Missing", width: 2.4 },
  { key: "pen", header: "PEN", width: 1.2 },
  { key: "apaar", header: "APAAR", width: 1.2 },
  { key: "aadhaar", header: "Aadhaar", width: 1.4 },
  { key: "mobile", header: "Mobile", width: 1.2 },
];

const REGISTERED_COLUMNS: ReportColumn[] = [
  { key: "student", header: "Student", width: 2 },
  { key: "admissionNo", header: "Adm no", width: 1.2 },
  { key: "classLabel", header: "Class", width: 1 },
  { key: "entryStatus", header: "Entry status", width: 1.6 },
  { key: "pen", header: "PEN", width: 1.4 },
  { key: "apaar", header: "APAAR", width: 1.4 },
  { key: "aadhaar", header: "Aadhaar", width: 1.4 },
  { key: "verified", header: "Aadhaar verified", width: 1.2 },
  { key: "compliant", header: "Fully compliant", width: 1.2 },
];

const UNREGISTERED_COLUMNS: ReportColumn[] = [
  { key: "student", header: "Student", width: 2 },
  { key: "admissionNo", header: "Adm no", width: 1.2 },
  { key: "classLabel", header: "Class", width: 1 },
  { key: "entryStatus", header: "Entry status", width: 1.6 },
  { key: "aadhaar", header: "Aadhaar", width: 1.8 },
  { key: "reason", header: "Reason", width: 2 },
  { key: "father", header: "Father", width: 1.6 },
  { key: "mother", header: "Mother", width: 1.6 },
  { key: "mobile", header: "Mobile", width: 1.2 },
];

const PORTAL_SEARCH_COLUMNS: ReportColumn[] = [
  { key: "student", header: "Student name", width: 2 },
  { key: "admissionNo", header: "Adm no", width: 1.2 },
  { key: "classLabel", header: "Class", width: 1 },
  { key: "onPortal", header: "On portal", width: 1 },
  { key: "pen", header: "PEN", width: 1.4 },
  { key: "aadhaarLast4", header: "Aadhaar (L4)", width: 1.1 },
  { key: "dob", header: "DOB (DD/MM/YYYY)", width: 1.4 },
  { key: "father", header: "Father name", width: 1.8 },
  { key: "mother", header: "Mother name", width: 1.8 },
];

const PORTAL_SEARCH_COPY_KEYS = [
  { key: "student", label: "Name" },
  { key: "pen", label: "PEN" },
  { key: "aadhaarLast4", label: "Aadhaar" },
  { key: "dob", label: "DOB" },
  { key: "father", label: "Father" },
  { key: "mother", label: "Mother" },
];

function portalSearchRowsToList(rows: UdisePortalSearchRow[]): UdiseListRow[] {
  return rows.map((r) => ({
    _studentId: r.student.id,
    student: r.student.fullName,
    admissionNo: r.student.admissionNo,
    classLabel: r.classLabel,
    onPortal: r.onPortal ? "Yes" : "No",
    pen: r.pen || "—",
    aadhaarLast4: r.aadhaarLast4 || "—",
    dob: r.dob || "—",
    father: r.student.fatherName || "—",
    mother: r.student.motherName || "—",
  }));
}

function matchesUdiseQuery(
  s: {
    fullName: string;
    admissionNo: string;
    pen: string;
    apaarId: string;
    aadhaarNumber?: string;
    aadhaarLast4?: string;
    fatherName: string;
    motherName: string;
  },
  q: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    s.fullName,
    s.admissionNo,
    s.pen,
    s.apaarId,
    s.aadhaarNumber || "",
    s.aadhaarLast4 || "",
    s.fatherName,
    s.motherName,
  ]
    .join(" ")
    .toLowerCase();
  return needle.split(/\s+/).every((tok) => hay.includes(tok));
}

function gapRowsToList(rows: UdiseComplianceRow[]): UdiseListRow[] {
  return rows.map((r) => ({
    _studentId: r.student.id,
    student: r.student.fullName,
    admissionNo: r.student.admissionNo,
    classLabel: r.classLabel,
    entryStatus: udiseEntryStatusLabel(r.student),
    missing: r.missingLabels.join("; "),
    pen: r.student.pen || "—",
    apaar: r.student.apaarId || "—",
    aadhaar: r.aadhaarDisplay,
    mobile: r.primaryCallMobile || "—",
  }));
}

function registeredRowsToList(rows: UdiseRegisteredRow[]): UdiseListRow[] {
  return rows.map((r) => ({
    _studentId: r.student.id,
    student: r.student.fullName,
    admissionNo: r.student.admissionNo,
    classLabel: r.classLabel,
    entryStatus: udiseEntryStatusLabel(r.student),
    pen: r.pen || "—",
    apaar: r.apaarId || "—",
    aadhaar: r.aadhaarDisplay,
    verified: r.aadhaarVerified ? "Yes" : "No",
    compliant: r.compliant ? "Yes" : "No",
  }));
}

/** Not-on-portal student that already has an Aadhaar on file (ready to register). */
function unregHasAadhaar(r: UdiseUnregisteredRow): boolean {
  if ((r.student.aadhaarLast4 || "").trim()) return true;
  const num = (r.student.aadhaarNumber || "").replace(/\D/g, "");
  return num.length >= 4;
}

function unregisteredRowsToList(rows: UdiseUnregisteredRow[]): UdiseListRow[] {
  return rows.map((r) => ({
    _studentId: r.student.id,
    student: r.student.fullName,
    admissionNo: r.student.admissionNo,
    classLabel: r.classLabel,
    entryStatus: udiseEntryStatusLabel(r.student),
    aadhaar: displayAadhaar({
      number: r.student.aadhaarNumber,
      last4: r.student.aadhaarLast4,
      verification: r.student.aadhaarVerification,
    }),
    reason: r.reason,
    father: r.student.fatherName || "—",
    mother: r.student.motherName || "—",
    mobile: r.primaryCallMobile || "—",
  }));
}

export function UdiseComplianceWorkspace({
  tick = 0,
  onChanged,
}: {
  tick?: number;
  onChanged?: (sis: SisState, message?: string) => void;
}) {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [settings, setSettings] = useState<UdiseComplianceSettings>(
    loadUdiseComplianceSettings,
  );
  const ay =
    session.academicYearCode ||
    (masters ? currentAcademicYearCode(masters) : "");
  const [filter, setFilter] = useState<FilterGap>("all");
  const [view, setView] = useState<ViewMode>("worklist");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
    setSettings(loadUdiseComplianceSettings());
  }

  useEffect(() => {
    refresh();
  }, [tick]);

  const rows = useMemo(() => {
    if (!sis || !masters) return [] as UdiseComplianceRow[];
    return listUdiseComplianceRows(sis, masters, settings, ay);
  }, [sis, masters, settings, ay]);

  const unregistered = useMemo(() => {
    if (!sis || !masters) return [] as UdiseUnregisteredRow[];
    return listUdiseUnregisteredStudents(sis, masters, ay);
  }, [sis, masters, ay]);

  const registered = useMemo(() => {
    if (!sis || !masters) return [] as UdiseRegisteredRow[];
    return listUdiseRegisteredStudents(sis, masters, ay, settings);
  }, [sis, masters, ay, settings]);

  const summary = useMemo(() => udiseComplianceSummary(rows), [rows]);
  const unregSummary = useMemo(
    () => udiseUnregisteredSummary(unregistered),
    [unregistered],
  );
  const unregWithAadhaar = useMemo(
    () => unregistered.filter(unregHasAadhaar),
    [unregistered],
  );
  const regSummary = useMemo(
    () => udiseRegisteredSummary(registered),
    [registered],
  );

  const [kpiModal, setKpiModal] = useState<{
    title: string;
    subtitle?: string;
    columns: ReportColumn[];
    rows: UdiseListRow[];
    fileBaseName: string;
    copyKeys?: { key: string; label: string }[];
  } | null>(null);

  const visible = useMemo(() => {
    let list: UdiseComplianceRow[];
    if (filter === "all" || filter === "call") list = rows;
    else if (filter === "unregistered") list = [];
    else if (filter === "due") list = rows.filter((r) => r.dueForReminder);
    else list = rows.filter((r) => r.missing.includes(filter));
    return list.filter((r) => matchesUdiseQuery(r.student, query));
  }, [rows, filter, query]);

  const callList = useMemo(() => {
    const base =
      filter === "due"
        ? rows.filter((r) => r.dueForReminder)
        : filter !== "all" && filter !== "call" && filter !== "unregistered"
          ? rows.filter((r) => r.missing.includes(filter))
          : rows;
    return base
      .filter((r) => r.primaryCallMobile)
      .filter((r) => matchesUdiseQuery(r.student, query));
  }, [rows, filter, query]);

  const visibleUnregistered = useMemo(
    () => unregistered.filter((r) => matchesUdiseQuery(r.student, query)),
    [unregistered, query],
  );

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function exportUnregisteredCsv() {
    if (!unregistered.length) {
      setError("All active SIS students already have a UDISE+ PEN");
      return;
    }
    const header = [
      "Adm no",
      "Student",
      "Class",
      "Aadhaar",
      "Reason",
      "PEN status",
      "Father",
      "Mother",
      "Primary mobile",
      "All numbers",
    ];
    const lines = unregistered.map((r) => {
      const primary = r.callContacts[0];
      const cells = [
        r.student.admissionNo,
        r.student.fullName,
        r.classLabel,
        displayAadhaar({
          number: r.student.aadhaarNumber,
          last4: r.student.aadhaarLast4,
          verification: r.student.aadhaarVerification,
        }),
        r.reason,
        r.student.penStatus || "",
        r.student.fatherName,
        r.student.motherName,
        primary?.mobile ?? "",
        r.callContacts.map((c) => `${c.label}:${c.mobile}`).join(" | "),
      ];
      return cells
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",");
    });
    const blob = new Blob(
      [["\uFEFF" + header.join(","), ...lines].join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sis_not_on_udise_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    flash(`Not on UDISE+ list exported · ${unregistered.length} student(s)`);
  }

  function exportCallListCsv() {
    if (view === "unregistered") {
      exportUnregisteredCsv();
      return;
    }
    const list =
      view === "call"
        ? callList
        : visible.filter((r) => r.primaryCallMobile);
    if (!list.length) {
      setError("No incomplete students with a phone number to export");
      return;
    }
    const header = [
      "Adm no",
      "Student",
      "Class",
      "Gaps",
      "Primary mobile",
      "Primary label",
      "All numbers",
      "Father",
      "Mother",
    ];
    const lines = list.map((r) => {
      const primary = r.callContacts[0];
      const cells = [
        r.student.admissionNo,
        r.student.fullName,
        r.classLabel,
        r.missingLabels.join("; "),
        primary?.mobile ?? "",
        primary?.label ?? "",
        r.callContacts.map((c) => `${c.label}:${c.mobile}`).join(" | "),
        r.student.fatherName,
        r.student.motherName,
      ];
      return cells
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",");
    });
    const blob = new Blob(
      [["\uFEFF" + header.join(","), ...lines].join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `udise_incomplete_call_list_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    flash(`Call list exported · ${list.length} row(s)`);
  }

  function sendReminder(row: UdiseComplianceRow) {
    if (!row.whatsappMobile) {
      setError(`No WhatsApp mobile for ${row.student.fullName}`);
      return;
    }
    const msg = composeUdiseComplianceWhatsApp({
      student: row.student,
      household: row.household,
      missing: row.missing,
      settings,
    });
    openWaMe(row.whatsappMobile, msg);
    const next = markUdiseComplianceReminded([row.student.id]);
    setSis(next);
    onChanged?.(next, `Reminder sent · ${row.student.fullName}`);
    flash(`WhatsApp opened · ${row.student.fullName}`);
  }

  function sendDueBatch() {
    const due = rows.filter((r) => r.dueForReminder && r.whatsappMobile);
    if (!due.length) {
      setError("No due reminders with WhatsApp number");
      return;
    }
    const ids: string[] = [];
    for (const row of due.slice(0, 12)) {
      const msg = composeUdiseComplianceWhatsApp({
        student: row.student,
        household: row.household,
        missing: row.missing,
        settings,
      });
      openWaMe(row.whatsappMobile, msg);
      ids.push(row.student.id);
    }
    const next = markUdiseComplianceReminded(ids);
    setSis(next);
    onChanged?.(
      next,
      `Opened ${ids.length} WhatsApp reminder(s) (max 12 per click)`,
    );
    flash(`Opened ${ids.length} WhatsApp reminder(s)`);
  }

  function saveSettings() {
    const next = saveUdiseComplianceSettings(settings);
    setSettings(next);
    flash(
      `Settings saved · remind every ${next.reminderIntervalDays} day(s)`,
    );
  }

  if (!sis || !masters) {
    return (
      <p className="mt-4 text-sm text-[var(--muted)]">Loading UDISE+…</p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-[rgba(180,35,24,0.25)] bg-[rgba(180,35,24,0.06)] px-4 py-3">
        <p className="text-sm font-semibold text-[#8b1a12]">
          High priority — UDISE+ compliance
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Track missing Student Aadhaar, PEN, APAAR, and Parent Aadhaar (required
          for APAAR). Verifying student Aadhaar alone does not create APAAR —
          parent Aadhaar must also be on UDISE+, then generate APAAR and re-sync.
          Fully compliant students leave this worklist. Remind parents on
          WhatsApp every {settings.reminderIntervalDays} day(s). Full Aadhaar
          stays visible until verified on UDISE+; then only last 4. PEN locks
          when verified + PEN present; APAAR locks only once APAAR ID is filled.
        </p>
      </div>

      {notice ? (
        <p className="rounded-lg bg-[rgba(15,122,76,0.1)] px-3 py-2 text-sm text-[#0f7a4c]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[rgba(180,35,24,0.08)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            view === "worklist"
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "border border-[var(--border)] bg-[var(--card)] text-[var(--brand-deep)]"
          }`}
          onClick={() => {
            setView("worklist");
            if (filter === "call" || filter === "unregistered") setFilter("all");
          }}
        >
          Worklist
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            view === "unregistered"
              ? "bg-[#8a5a10] text-white"
              : "border border-[var(--border)] bg-[var(--card)] text-[var(--brand-deep)]"
          }`}
          onClick={() => {
            setView("unregistered");
            setFilter("unregistered");
          }}
        >
          Not on UDISE+ ({unregSummary.total})
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            view === "call"
              ? "bg-[#0f7a4c] text-white"
              : "border border-[var(--border)] bg-[var(--card)] text-[var(--brand-deep)]"
          }`}
          onClick={() => {
            setView("call");
            setFilter("call");
          }}
        >
          Incomplete call list ({summary.withCallNumber})
        </button>
        <button
          type="button"
          className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)]"
          onClick={() => {
            const r = runSisReport("udise_compliance", {
              format: "excel",
              status: "active",
              masters: masters ?? undefined,
              sis: sis ?? undefined,
            });
            if (!r.ok) setError(r.error);
            else flash(r.message);
          }}
        >
          Download Excel (full register)
        </button>
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]"
          onClick={() => {
            const r = runSisReport("udise_compliance", {
              format: "pdf",
              status: "active",
              masters: masters ?? undefined,
              sis: sis ?? undefined,
            });
            if (!r.ok) setError(r.error);
            else flash(r.message);
          }}
        >
          Print / PDF (full register)
        </button>
        <button
          type="button"
          className="rounded-lg border border-[#0f7a4c] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[#0f7a4c]"
          onClick={exportCallListCsv}
        >
          {view === "unregistered"
            ? "Export not-on-UDISE CSV"
            : "Export call list CSV"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-[#8a5a10] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[#8a5a10]"
          onClick={() =>
            setKpiModal({
              title: "UDISE+ Global Search sheet — not on portal",
              subtitle:
                "Search each on UDISE+ Global Student Search by PEN, or Name + Aadhaar (L4), or Name + DOB + Father + Mother",
              columns: PORTAL_SEARCH_COLUMNS,
              rows: portalSearchRowsToList(
                listUdisePortalSearchRows(sis, masters, ay, "not_on_portal"),
              ),
              fileBaseName: "udise_portal_search_not_on_portal",
              copyKeys: PORTAL_SEARCH_COPY_KEYS,
            })
          }
        >
          UDISE+ search sheet (not on portal)
        </button>
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]"
          onClick={() =>
            setKpiModal({
              title: "UDISE+ Global Search sheet — all active students",
              subtitle:
                "Search each on UDISE+ Global Student Search by PEN, or Name + Aadhaar (L4), or Name + DOB + Father + Mother",
              columns: PORTAL_SEARCH_COLUMNS,
              rows: portalSearchRowsToList(
                listUdisePortalSearchRows(sis, masters, ay, "all"),
              ),
              fileBaseName: "udise_portal_search_all",
              copyKeys: PORTAL_SEARCH_COPY_KEYS,
            })
          }
        >
          UDISE+ search sheet (all)
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search UDISE+ students — name, adm no, PEN, APAAR, Aadhaar, parent…"
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 pr-8 text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-[var(--muted)] hover:text-[var(--brand-deep)]"
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>
        {query.trim() ? (
          <span className="text-xs text-[var(--muted)]">
            {view === "unregistered"
              ? `${visibleUnregistered.length} match`
              : view === "call"
                ? `${callList.length} match`
                : `${visible.length} match`}
            {(view === "unregistered"
              ? visibleUnregistered.length
              : view === "call"
                ? callList.length
                : visible.length) === 1
              ? ""
              : "es"}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
        {(
          [
            {
              label: "Open gaps",
              n: summary.totalOpen,
              tone: "brand",
              build: () => ({
                title: "Open UDISE+ gaps",
                columns: GAP_COLUMNS,
                rows: gapRowsToList(rows),
                fileBaseName: "udise_open_gaps",
              }),
            },
            {
              label: "On UDISE+",
              n: regSummary.total,
              tone: "green",
              build: () => ({
                title: "Already on UDISE+ portal (have PEN)",
                subtitle: `${regSummary.verified} Aadhaar verified · ${regSummary.withApaar} with APAAR · ${regSummary.compliant} fully compliant`,
                columns: REGISTERED_COLUMNS,
                rows: registeredRowsToList(registered),
                fileBaseName: "udise_on_portal",
              }),
            },
            {
              label: "Not on UDISE+",
              n: unregSummary.total,
              tone: "amber",
              build: () => ({
                title: "Not registered on UDISE+ (no PEN)",
                columns: UNREGISTERED_COLUMNS,
                rows: unregisteredRowsToList(unregistered),
                fileBaseName: "udise_not_on_portal",
              }),
            },
            {
              label: "Not on UDISE+ · Aadhaar ready",
              n: unregWithAadhaar.length,
              tone: "amber",
              build: () => ({
                title: "Not on UDISE+ but Aadhaar available (ready to register)",
                subtitle: `${unregWithAadhaar.length} of ${unregSummary.total} not-on-portal students have an Aadhaar on file — eligible to push to UDISE+`,
                columns: UNREGISTERED_COLUMNS,
                rows: unregisteredRowsToList(unregWithAadhaar),
                fileBaseName: "udise_not_on_portal_aadhaar_ready",
              }),
            },
            {
              label: "Callable",
              n: summary.withCallNumber,
              tone: "brand",
              build: () => ({
                title: "Incomplete students with a phone number",
                columns: GAP_COLUMNS,
                rows: gapRowsToList(rows.filter((r) => r.primaryCallMobile)),
                fileBaseName: "udise_callable",
              }),
            },
            {
              label: "No Aadhaar",
              n: summary.missingAadhaar,
              tone: "brand",
              build: () => ({
                title: "Missing student Aadhaar",
                columns: GAP_COLUMNS,
                rows: gapRowsToList(
                  rows.filter((r) => r.missing.includes("student_aadhaar")),
                ),
                fileBaseName: "udise_no_aadhaar",
              }),
            },
            {
              label: "No APAAR",
              n: summary.missingApaar,
              tone: "brand",
              build: () => ({
                title: "Missing APAAR ID",
                columns: GAP_COLUMNS,
                rows: gapRowsToList(
                  rows.filter((r) => r.missing.includes("apaar")),
                ),
                fileBaseName: "udise_no_apaar",
              }),
            },
            {
              label: "Due reminders",
              n: summary.dueReminders,
              tone: "brand",
              build: () => ({
                title: "Reminders due",
                columns: GAP_COLUMNS,
                rows: gapRowsToList(rows.filter((r) => r.dueForReminder)),
                fileBaseName: "udise_due_reminders",
              }),
            },
          ] as const
        ).map((kpi) => (
          <button
            key={kpi.label}
            type="button"
            onClick={() => setKpiModal(kpi.build())}
            className={`rounded-xl border px-3 py-2 text-left transition hover:shadow-sm ${
              kpi.tone === "amber"
                ? "border-[rgba(138,90,16,0.35)] bg-[rgba(138,90,16,0.08)]"
                : kpi.tone === "green"
                  ? "border-[rgba(15,122,76,0.3)] bg-[rgba(15,122,76,0.06)]"
                  : "border-[var(--border)] bg-[var(--card)]"
            }`}
          >
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              {kpi.label}
            </p>
            <p
              className={`text-xl font-semibold ${
                kpi.tone === "amber"
                  ? "text-[#8a5a10]"
                  : kpi.tone === "green"
                    ? "text-[#0f7a4c]"
                    : "text-[var(--brand-deep)]"
              }`}
            >
              {kpi.n}
            </p>
            <p className="text-[9px] text-[var(--muted)]">Click for list</p>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
          Reminder settings
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--muted)]">
            Interval (days)
            <input
              type="number"
              min={1}
              max={90}
              className="mt-0.5 block w-24 rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
              value={settings.reminderIntervalDays}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  reminderIntervalDays: Number(e.target.value) || 7,
                }))
              }
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            School / area for nearest Aadhaar centre
            <input
              className="mt-0.5 block min-w-[220px] rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
              value={settings.schoolAreaHint}
              onChange={(e) =>
                setSettings((s) => ({ ...s, schoolAreaHint: e.target.value }))
              }
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
            <input
              type="checkbox"
              checked={settings.parentAadhaarRequiredForApaar}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  parentAadhaarRequiredForApaar: e.target.checked,
                }))
              }
            />
            Track parent Aadhaar for APAAR
          </label>
          <button
            type="button"
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-foreground)]"
            onClick={saveSettings}
          >
            Save settings
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm"
            onClick={sendDueBatch}
          >
            WhatsApp all due ({summary.dueReminders})
          </button>
        </div>
        <label className="mt-3 block text-xs text-[var(--muted)]">
          Extra line on WhatsApp
          <input
            className="mt-0.5 block w-full max-w-xl rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
            value={settings.customNote}
            onChange={(e) =>
              setSettings((s) => ({ ...s, customNote: e.target.value }))
            }
            placeholder="e.g. Submit copies at office by Friday"
          />
        </label>
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          UIDAI:{" "}
          <a
            className="underline"
            href={UIDAI_LINKS.findCentre}
            target="_blank"
            rel="noreferrer"
          >
            Find enrolment centre
          </a>
          {" · "}
          <a
            className="underline"
            href={UIDAI_LINKS.myAadhaar}
            target="_blank"
            rel="noreferrer"
          >
            myAadhaar
          </a>
        </p>
      </div>

      <UdisePenApaarImportPanel
        masters={masters}
        sis={sis}
        academicYearCode={ay}
        onApplied={(next, message) => {
          saveSis(next);
          setSis(next);
          onChanged?.(next, message);
          flash(message);
        }}
      />

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All gaps"],
            ["unregistered", "Not on UDISE+"],
            ["call", "Call list"],
            ["due", "Due reminders"],
            ["inbound_transfer", "Drop Box / release"],
            ["mbu_age_below_class", "MBU age alert"],
            ["student_aadhaar", "No student Aadhaar"],
            ["pen", "No PEN"],
            ["apaar", "No APAAR"],
            ["parent_aadhaar", "No parent Aadhaar"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${
              filter === id ||
              (id === "call" && view === "call") ||
              (id === "unregistered" && view === "unregistered")
                ? id === "mbu_age_below_class"
                  ? "bg-[var(--danger)] text-white"
                  : id === "call"
                    ? "bg-[#0f7a4c] text-white"
                    : id === "unregistered"
                      ? "bg-[#8a5a10] text-white"
                      : "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "border border-[var(--border)] bg-[var(--card)] text-[var(--brand-deep)]"
            }`}
            onClick={() => {
              setFilter(id);
              setView(
                id === "call"
                  ? "call"
                  : id === "unregistered"
                    ? "unregistered"
                    : "worklist",
              );
            }}
          >
            {label}
            {id === "unregistered" ? ` (${unregSummary.total})` : ""}
          </button>
        ))}
      </div>

      {view === "unregistered" ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-[rgba(138,90,16,0.35)] bg-[rgba(138,90,16,0.08)] px-4 py-3">
            <p className="text-sm font-semibold text-[#8a5a10]">
              Not registered on UDISE+ — {unregSummary.total} active student
              {unregSummary.total === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              SIS students with no Student PEN. Register them on UDISE+ / SDMS,
              then re-import Students_Details and Apply to fill PEN. Callable:{" "}
              {unregSummary.withCallNumber} · No phone:{" "}
              {unregSummary.noCallNumber}.
            </p>
          </div>
          {visibleUnregistered.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              {query.trim()
                ? `No "Not on UDISE+" student matches “${query.trim()}”.`
                : "All active SIS students have a UDISE+ PEN — none pending registration."}
            </p>
          ) : (
            <ErpTableShell className="overflow-x-auto">
              <ErpTable minWidth="min-w-[900px]" className="border-collapse">
                <ErpTableHead>
                  <tr>
                    <th className="px-2 py-2 font-medium">#</th>
                    <th className="px-2 py-2 font-medium">Student</th>
                    <th className="px-2 py-2 font-medium">Class</th>
                    <th className="px-2 py-2 font-medium">Aadhaar</th>
                    <th className="px-2 py-2 font-medium">Reason</th>
                    <th className="px-2 py-2 font-medium">Parents</th>
                    <th className="px-2 py-2 font-medium">Call</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody hoverable>
                  {visibleUnregistered.map((row, i) => (
                    <tr key={row.student.id} className="align-top">
                      <td className="px-2 py-2 text-[var(--muted)]">{i + 1}</td>
                      <td className="px-2 py-2">
                        <Link
                          href={`/students/${row.student.id}/edit?tab=ids`}
                          className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                        >
                          {row.student.fullName}
                        </Link>
                        <span className="block text-[var(--muted)]">
                          {row.student.admissionNo}
                        </span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {row.classLabel}
                      </td>
                      <td className="px-2 py-2 font-mono text-[11px] whitespace-nowrap">
                        {displayAadhaar({
                          number: row.student.aadhaarNumber,
                          last4: row.student.aadhaarLast4,
                          verification: row.student.aadhaarVerification,
                        })}
                      </td>
                      <td className="px-2 py-2 text-[#8a5a10]">{row.reason}</td>
                      <td className="px-2 py-2 text-[11px]">
                        <div>F: {row.student.fatherName || "—"}</div>
                        <div>M: {row.student.motherName || "—"}</div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex min-w-[110px] flex-col gap-1">
                          {row.primaryCallTelHref ? (
                            <a
                              href={row.primaryCallTelHref}
                              className="rounded-lg bg-[#0f7a4c] px-2 py-1 text-center text-[11px] font-semibold text-white"
                            >
                              Call {row.callContacts[0]?.label ?? ""}
                            </a>
                          ) : (
                            <span className="text-[10px] text-[#8b1a12]">
                              No phone
                            </span>
                          )}
                          {row.callContacts.length > 1
                            ? row.callContacts.slice(1).map((c) => (
                                <a
                                  key={`${c.label}-${c.mobile}`}
                                  href={c.telHref}
                                  className="text-[10px] text-[var(--brand-deep)] underline"
                                >
                                  Call {c.label} · {c.mobile}
                                </a>
                              ))
                            : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable>
            </ErpTableShell>
          )}
        </div>
      ) : view === "call" ? (
        <div className="space-y-3">
          <p className="text-xs text-[var(--muted)]">
            Incomplete UDISE+ students with a phone — tap{" "}
            <strong className="font-semibold text-[var(--brand-deep)]">
              Call
            </strong>{" "}
            for direct dial ({callList.length} callable
            {summary.noCallNumber
              ? ` · ${summary.noCallNumber} missing number`
              : ""}
            ).
          </p>
          {callList.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              No incomplete students with a call number in this filter.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {callList.map((row) => {
                const mbuAlert = row.missing.includes("mbu_age_below_class");
                const primary = row.callContacts[0];
                return (
                  <li
                    key={row.student.id}
                    className={`rounded-xl border p-3 ${
                      mbuAlert
                        ? "border-[var(--danger)] bg-[var(--danger-soft)]"
                        : "border-[var(--border)] bg-[var(--card)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/students/${row.student.id}/edit`}
                          className={`font-semibold underline-offset-2 hover:underline ${
                            mbuAlert
                              ? "text-[var(--danger)]"
                              : "text-[var(--brand-deep)]"
                          }`}
                        >
                          {row.student.fullName}
                        </Link>
                        <p className="text-[11px] text-[var(--muted)]">
                          {row.student.admissionNo} · {row.classLabel}
                        </p>
                      </div>
                      {primary?.telHref ? (
                        <a
                          href={primary.telHref}
                          className="shrink-0 rounded-lg bg-[#0f7a4c] px-3 py-1.5 text-[12px] font-semibold text-white"
                        >
                          Call
                        </a>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] font-medium text-[var(--brand-deep)]">
                      {primary?.label}: {primary?.mobile}
                    </p>
                    <ul className="mt-1 list-disc pl-3 text-[10px] text-[#8b1a12]">
                      {row.missingLabels.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                    {row.callContacts.length > 1 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {row.callContacts.slice(1).map((c) => (
                          <a
                            key={`${c.label}-${c.mobile}`}
                            href={c.telHref}
                            className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 text-[10px] font-medium text-[var(--brand-deep)]"
                          >
                            Call {c.label}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] font-medium text-[var(--brand-deep)] disabled:opacity-40"
                        disabled={!row.whatsappMobile}
                        onClick={() => sendReminder(row)}
                      >
                        WhatsApp
                      </button>
                      <a
                        className="text-[10px] text-[var(--brand-deep)] underline"
                        href={row.nearestCenterMapsUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Aadhaar centre
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
      <ErpTableShell className="overflow-x-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">
            No open UDISE+ gaps in this filter — good.
          </p>
        ) : (
          <ErpTable minWidth="min-w-[1000px]" className="border-collapse">
            <ErpTableHead>
              <tr>
                <th className="px-2 py-2 font-medium">Priority</th>
                <th className="px-2 py-2 font-medium">Student</th>
                <th className="px-2 py-2 font-medium">Class / UDISE+</th>
                <th className="px-2 py-2 font-medium">Missing</th>
                <th className="px-2 py-2 font-medium">Aadhaar / validation</th>
                <th className="px-2 py-2 font-medium">Parents</th>
                <th className="px-2 py-2 font-medium">PEN / APAAR</th>
                <th className="px-2 py-2 font-medium">Call / Remind</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {visible.map((row) => {
                const mbuAlert = row.missing.includes("mbu_age_below_class");
                return (
                <tr
                  key={row.student.id}
                  className={`align-top ${mbuAlert ? "bg-[rgba(180,35,24,0.12)]" : ""}`}
                >
                  <td className="px-2 py-2">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        mbuAlert || row.priority >= 90
                          ? "bg-[var(--danger)] text-white"
                          : row.priority >= 60
                            ? "bg-[rgba(180,120,24,0.15)] text-[#8a5a10]"
                            : "bg-[var(--surface-sunken)] text-[var(--muted)]"
                      }`}
                    >
                      {mbuAlert
                        ? "MBU AGE"
                        : row.priority >= 90
                          ? "HIGH"
                          : row.priority >= 60
                            ? "MED"
                            : "LOW"}
                    </span>
                    {row.dueForReminder ? (
                      <span className="mt-1 block text-[10px] font-semibold text-[#8b1a12]">
                        Reminder due
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <Link
                      href={`/students/${row.student.id}/edit`}
                      className={`font-semibold underline-offset-2 hover:underline ${
                        mbuAlert ? "text-[var(--danger)]" : "text-[var(--brand-deep)]"
                      }`}
                    >
                      {row.student.fullName}
                    </Link>
                    <span className="block text-[var(--muted)]">
                      {row.student.admissionNo}
                    </span>
                    {mbuAlert ? (
                      <span className="mt-1 block text-[10px] font-bold text-[var(--danger)]">
                        Notify: age below for class ·{" "}
                        {row.student.udiseMbuStatus || "MBU Pending"}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <div>SIS: {row.classLabel}</div>
                    {row.student.udisePortalClassHint ? (
                      <div
                        className={`text-[10px] ${
                          row.student.udisePortalClassHint !== row.classLabel
                            ? "font-semibold text-[#8a5a10]"
                            : "text-[var(--muted)]"
                        }`}
                      >
                        UDISE+: {row.student.udisePortalClassHint}
                        {row.student.udisePortalClassHint !== row.classLabel
                          ? " (may be wrong)"
                          : ""}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <ul className="list-disc pl-3 text-[11px] text-[#8b1a12]">
                      {row.missingLabels.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-2 py-2 font-mono text-[11px]">
                    {row.aadhaarDisplay}
                    <span className="block font-sans text-[10px] text-[var(--muted)]">
                      {row.student.aadhaarVerification === "verified_udise"
                        ? "UDISE verified (masked)"
                        : row.student.aadhaarVerification === "received"
                          ? "Received — pending UDISE verify"
                          : "Missing"}
                    </span>
                    {row.student.udiseAadhaarValidationStatus ? (
                      <span className="mt-0.5 block font-sans text-[10px]">
                        Portal: {row.student.udiseAadhaarValidationStatus}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-[11px]">
                    <div>F: {row.fatherAadhaarDisplay}</div>
                    <div>M: {row.motherAadhaarDisplay}</div>
                  </td>
                  <td className="px-2 py-2 text-[11px]">
                    <div>PEN: {row.student.pen || "—"}</div>
                    <div>APAAR: {row.student.apaarId || "—"}</div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex min-w-[120px] flex-col gap-1">
                      {row.primaryCallTelHref ? (
                        <a
                          href={row.primaryCallTelHref}
                          className="rounded-lg bg-[#0f7a4c] px-2 py-1 text-center text-[11px] font-semibold text-white"
                        >
                          Call {row.callContacts[0]?.label ?? ""}
                        </a>
                      ) : (
                        <span className="text-[10px] text-[#8b1a12]">
                          No phone on file
                        </span>
                      )}
                      <button
                        type="button"
                        className="rounded-lg bg-[var(--primary)] px-2 py-1 text-[11px] font-medium text-[var(--primary-foreground)] disabled:opacity-40"
                        disabled={!row.whatsappMobile}
                        onClick={() => sendReminder(row)}
                      >
                        WhatsApp
                      </button>
                      <a
                        className="text-[10px] text-[var(--brand-deep)] underline"
                        href={row.nearestCenterMapsUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Nearest Aadhaar centre
                      </a>
                      {row.lastReminded ? (
                        <span className="text-[10px] text-[var(--muted)]">
                          Last: {row.lastReminded.slice(0, 10)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
        )}
      </ErpTableShell>
      )}

      {kpiModal ? (
        <UdiseStudentListModal
          title={kpiModal.title}
          subtitle={kpiModal.subtitle}
          columns={kpiModal.columns}
          rows={kpiModal.rows}
          fileBaseName={kpiModal.fileBaseName}
          copyKeys={kpiModal.copyKeys}
          onClose={() => setKpiModal(null)}
        />
      ) : null}
    </div>
  );
// Re-read when the server copy of this module lands (login/refresh hydration).
useModuleStateHydration("udise_compliance", () => { setSettings(loadUdiseComplianceSettings()); });
}
