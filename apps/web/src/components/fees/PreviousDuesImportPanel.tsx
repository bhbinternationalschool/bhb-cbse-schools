"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { formatInr, loadFees, saveFees } from "@/lib/fees";
import {
  applyPreviousDuesImport,
  parseStudentWiseFeeSummaryRows,
  summarizePreviousDueRows,
} from "@/lib/previousDuesExcelImport";
import { loadSis } from "@/lib/sis";
import { useDemoSession } from "@/components/shell/SessionContext";

export function PreviousDuesImportPanel({
  onImported,
}: {
  onImported?: () => void;
}) {
  const session = useDemoSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setLastResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet =
        wb.Sheets["Student Wise Summary"] ?? wb.Sheets[wb.SheetNames[0]!];
      const raw = XLSX.utils.sheet_to_json(sheet, {
        defval: "",
        header: 1,
      }) as unknown[][];
      const rows = parseStudentWiseFeeSummaryRows(raw);
      const summary = summarizePreviousDueRows(rows);

      const sis = loadSis();
      const fees = loadFees();
      const result = applyPreviousDuesImport({
        fees,
        sis,
        rows,
        toAy: session.academicYearCode,
        importedBy: `${session.fullName} · ${file.name}`,
      });

      if (result.errors.length > 0 && result.matched.length === 0) {
        setError(result.errors.slice(0, 5).join(" · "));
        return;
      }

      saveFees(result.fees);
      onImported?.();

      const msg = [
        `Imported ${result.created + result.updated} arrears line(s)`,
        summary.withPending
          ? `from ${summary.withPending} students · ₹${summary.totalPendingRupees} pending`
          : "",
        result.errors.length
          ? `${result.errors.length} unmatched — check admission numbers`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");

      setLastResult(msg);
      if (result.matched.length) {
        setLastResult(
          `${msg}\n${result.matched
            .map(
              (m) =>
                `${m.admissionNo} ${m.studentName}: ${formatInr(m.pendingRupees * 100)}`,
            )
            .join("\n")}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
      <h3 className="text-sm font-bold text-[var(--brand-deep)]">
        Import previous dues (Excel)
      </h3>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Upload <strong>Student Wise Fee Details</strong> export — uses{" "}
        <em>Total Previous Fee Pending</em> (e.g. Previous Due-2025) and posts as
        arrears on Fee Take for session {session.academicYearCode}.
      </p>
      <label className="mt-3 flex cursor-pointer flex-wrap items-center gap-3">
        <span className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-sm font-bold text-white hover:opacity-95">
          {busy ? "Importing…" : "Choose Excel file"}
        </span>
        <input
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            void onFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </label>
      {error ? (
        <p className="mt-2 text-sm font-semibold text-[#dc2626]">{error}</p>
      ) : null}
      {lastResult ? (
        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[rgba(22,163,74,0.08)] px-3 py-2 text-sm text-[#15803d]">
          {lastResult}
        </pre>
      ) : null}
    </div>
  );
}
