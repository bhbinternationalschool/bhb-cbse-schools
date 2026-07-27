"use client";

import { useEffect, useState } from "react";
import { formatInr, hydrateFeesStore, loadFees, saveFees } from "@/lib/fees";
import {
  applyPaymentReportImport,
  formatPaymentImportSummary,
  parsePaymentReportText,
  summarizeParsedReceipts,
} from "@/lib/inventoryPaymentReportImport";
import { summarizeDailyCollection } from "@/lib/dailyCollectionReportImport";
import { loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";
import { useDemoSession } from "@/components/shell/SessionContext";

async function extractPdfText(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/fees/extract-payment-pdf", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `PDF extract failed (${res.status})`);
  }
  const data = (await res.json()) as { text: string };
  return data.text ?? "";
}

async function readReportText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return extractPdfText(file);
  return file.text();
}

export function PaymentReportImportPanel({
  onImported,
}: {
  onImported?: () => void;
}) {
  const session = useDemoSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  useEffect(() => {
    void hydrateFeesStore();
  }, []);

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setLastResult(null);
    try {
      await hydrateFeesStore();
      const text = await readReportText(file);
      const receipts = parsePaymentReportText(text);
      const preview = summarizeParsedReceipts(receipts);
      const daily =
        receipts[0]?.admissionNo != null
          ? summarizeDailyCollection(
              receipts as import("@/lib/dailyCollectionReportImport").DailyCollectionRow[],
            )
          : null;

      const sis = loadSis();
      const masters = loadMasters();
      const fees = loadFees();
      const result = applyPaymentReportImport({
        fees,
        sis,
        masters,
        receipts,
        academicYearCode: session.academicYearCode,
        importedBy: `${session.fullName} · ${file.name}`,
      });

      if (result.imported === 0 && result.skipped === 0) {
        setError("No fee receipts found in file — check format or date range.");
        return;
      }

      saveFees(result.fees);
      onImported?.();

      const msg = [
        formatPaymentImportSummary(result.summary),
        `New vouchers: ${result.imported}`,
        result.relink.relinkedLines
          ? `Posted ${result.relink.relinkedLines} line(s) to student month/arrears dues`
          : "",
        result.relink.stillLegacy
          ? `${result.relink.stillLegacy} line(s) still unlinked — check SIS admission nos + fee groups`
          : "",
        result.skipped ? `Skipped (already imported): ${result.skipped}` : "",
        result.unmatched.length
          ? `${result.unmatched.length} student name(s) not matched in SIS`
          : "",
        `Preview parsed ${preview.feeReceipts} fee receipts · ₹${preview.totalRupees.toLocaleString("en-IN")}`,
        daily
          ? `Scopes: ${daily.byScope.monthly} monthly · ${daily.byScope.arrears} arrears · ${daily.byScope.mixed} mixed · concession ₹${daily.totalConcessionRupees.toLocaleString("en-IN")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      setLastResult(msg);

      if (result.summary.concessions.length > 0) {
        const structConc = result.summary.concessions.filter(
          (c) => c.concessionRupees > 0,
        );
        if (structConc.length) {
          setLastResult(
            `${msg}\n\nStructure concessions (first 10):\n${structConc
              .slice(0, 10)
              .map(
                (c) =>
                  `#${c.legacyReceiptNo} ${c.studentName}: ${c.headLabel} paid ${formatInr(c.collectedRupees * 100)} vs ${formatInr(c.expectedRupees * 100)} (−${formatInr(c.concessionRupees * 100)})`,
              )
              .join("\n")}`,
          );
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed";
      if (/quota/i.test(msg)) {
        setError(
          "Browser storage is full. Fees were saved to IndexedDB — refresh the page and retry if receipts look missing.",
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
      <h3 className="text-sm font-bold text-[var(--brand-deep)]">
        Import fee collections (Payment Report PDF)
      </h3>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Upload <strong>Inventory Payment Report</strong> or{" "}
        <strong>Daily Collection</strong> export. Daily collection includes
        admission no., receipt note (month / previous due), per-head break-up,
        and concession column — matched to SIS students for session{" "}
        {session.academicYearCode}.
      </p>
      <label className="mt-3 flex cursor-pointer flex-wrap items-center gap-3">
        <span className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-sm font-bold text-white hover:opacity-95">
          {busy ? "Importing…" : "Choose PDF or text file"}
        </span>
        <input
          type="file"
          accept=".pdf,.txt"
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
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgba(22,163,74,0.08)] px-3 py-2 text-sm text-[#15803d]">
          {lastResult}
        </pre>
      ) : null}
    </div>
  );
}
