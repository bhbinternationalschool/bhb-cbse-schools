"use client";

import { useState } from "react";
import {
  ADMISSION_SOURCES,
  ADMISSION_STAGES,
  LEADS_IMPORT_SAMPLE_CSV,
  importLeads,
  loadAdmissions,
  normalizeAdmissionsState,
  parseLeadsCsv,
  saveAdmissions,
  type AdmissionSource,
  type AdmissionStage,
  type AdmissionsState,
  type ImportLeadRow,
} from "@/lib/admissions";
import {
  detectLeadWorkbookKind,
  mapEnquirySurveyRows,
  mapFieldLeadsRows,
} from "@/lib/admissionsExcelImport";
import { GoogleLeadWebhookPanel } from "@/components/admissions/GoogleLeadWebhookPanel";

export function AdmissionImportPanel({
  state,
  academicYears,
  classes,
  by,
  onImported,
}: {
  state: AdmissionsState;
  academicYears: { code: string; label: string }[];
  classes: { id: string; name: string }[];
  by: string;
  onImported: (next: AdmissionsState, msg: string) => void;
}) {
  const [source, setSource] = useState<AdmissionSource>("field_survey");
  const [stage, setStage] = useState<AdmissionStage>("enquiry");
  const [ay, setAy] = useState(
    academicYears[0]?.code || new Date().getFullYear() + "-26",
  );
  const [leadDate, setLeadDate] = useState("");
  const [raw, setRaw] = useState("");
  const [pendingRows, setPendingRows] = useState<ImportLeadRow[] | null>(null);
  const [fileHint, setFileHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resolveClassId(name: string) {
    const n = name.trim().toLowerCase();
    return classes.find((c) => c.name.toLowerCase() === n)?.id;
  }

  function runRows(rows: ImportLeadRow[], label: string) {
    if (!rows.length) {
      setError("No usable lead rows found.");
      return;
    }
    const r = importLeads(
      state,
      rows,
      {
        source,
        stage,
        academicYearCode: ay,
        leadDate: leadDate || undefined,
      },
      by,
      resolveClassId,
    );
    const detail =
      r.errors.length > 0 ? ` · ${r.errors.slice(0, 3).join("; ")}` : "";
    onImported(
      r.state,
      `${label}: imported ${r.imported} lead(s)${r.skipped ? `, skipped ${r.skipped}` : ""}${detail}`,
    );
    if (r.imported > 0) {
      setRaw("");
      setPendingRows(null);
      setFileHint(null);
    }
  }

  function runImport() {
    setError(null);
    if (pendingRows?.length) {
      runRows(pendingRows, fileHint || "Excel");
      return;
    }
    const rows = parseLeadsCsv(raw);
    if (!rows.length) {
      setError(
        "Paste CSV or choose an Excel/CSV file (child, guardian, mobile…).",
      );
      return;
    }
    runRows(rows, "CSV");
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    setPendingRows(null);
    setFileHint(null);
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      try {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array", cellDates: true });
        const sheetName = wb.SheetNames[0] || "Sheet1";
        const sheet = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: "",
          raw: true,
        });
        const headers = json[0] ? Object.keys(json[0]) : [];
        const kind = detectLeadWorkbookKind(sheetName, headers);
        let rows: ImportLeadRow[] = [];
        if (kind === "field_leads") {
          rows = mapFieldLeadsRows(json);
          setSource("field_survey");
          setFileHint(`Field Leads Excel (${rows.length} rows)`);
        } else if (kind === "enquiry_survey") {
          rows = mapEnquirySurveyRows(json);
          setSource("field_survey");
          setFileHint(`Enquiry Survey Excel (${rows.length} rows)`);
        } else {
          const csv = XLSX.utils.sheet_to_csv(sheet);
          setRaw(csv);
          setFileHint(`Excel → CSV (${json.length} rows)`);
          return;
        }
        setPendingRows(rows);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not read Excel workbook",
        );
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setRaw(String(reader.result || ""));
      setFileHint(file.name);
    };
    reader.readAsText(file);
  }

  async function loadServerExcelSeed() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/school-data/mirror");
      if (!res.ok) {
        setError("Could not load server lead seed (sign in required).");
        return;
      }
      const body = (await res.json()) as {
        admissions?: Partial<AdmissionsState> | null;
      };
      if (!body.admissions || !Array.isArray(body.admissions.leads)) {
        setError("No Excel seed on server yet. Run import script first.");
        return;
      }
      const remote = normalizeAdmissionsState(body.admissions);
      const local = loadAdmissions();
      if (remote.leads.length <= local.leads.length) {
        onImported(
          local,
          `Server seed already applied (${local.leads.length} leads in CRM).`,
        );
        return;
      }
      saveAdmissions(remote);
      onImported(
        remote,
        `Loaded Excel seed from server · ${remote.leads.length} leads · ${remote.households.length} households`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Seed load failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <GoogleLeadWebhookPanel />
      <p className="text-[12px] text-[var(--muted)]">
        Upload older / offline leads (CSV or Excel). Field_Leads.xlsx and
        BHB_School_Enquiry_Survey.xlsx are mapped automatically. Choose default
        tags — rows can override source/stage/date in CSV columns.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Default source tag
          <select
            className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
            value={source}
            onChange={(e) => setSource(e.target.value as AdmissionSource)}
          >
            {ADMISSION_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Default status tag
          <select
            className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
            value={stage}
            onChange={(e) => setStage(e.target.value as AdmissionStage)}
          >
            {ADMISSION_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Capture session (AY)
          <select
            className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
            value={ay}
            onChange={(e) => setAy(e.target.value)}
          >
            {academicYears.map((y) => (
              <option key={y.code} value={y.code}>
                {y.label || y.code}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Default lead date (optional)
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
            value={leadDate}
            onChange={(e) => setLeadDate(e.target.value)}
          />
        </label>
      </div>
      <label className="block text-[11px] font-semibold text-[var(--muted)]">
        CSV / Excel file
        <input
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="mt-1 block w-full text-[12px]"
          onChange={(e) => void onFile(e.target.files?.[0] || null)}
        />
      </label>
      {fileHint ? (
        <p className="text-[11px] font-medium text-[var(--brand-deep)]">
          Ready: {fileHint}
          {pendingRows ? " — click Upload leads" : ""}
        </p>
      ) : null}
      <textarea
        className="min-h-[120px] w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 font-mono text-[11px]"
        placeholder="Paste CSV here (optional if Excel selected)…"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setPendingRows(null);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={runImport}
          className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white"
        >
          Upload leads
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void loadServerExcelSeed()}
          className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-50"
        >
          {busy ? "Loading…" : "Load Field + Survey Excel seed"}
        </button>
        <button
          type="button"
          onClick={() => setRaw(LEADS_IMPORT_SAMPLE_CSV)}
          className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-deep)]"
        >
          Load sample CSV
        </button>
      </div>
      {error ? (
        <p className="text-sm font-medium text-[#b42318]">{error}</p>
      ) : null}
    </div>
  );
}
