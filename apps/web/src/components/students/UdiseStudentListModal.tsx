"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  downloadExcelCsv,
  downloadPdfReport,
  type ReportColumn,
} from "@/lib/reportExport";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";

export type UdiseListRow = Record<string, string | number | null | undefined> & {
  /** When present, the first column value links to the student's edit page. */
  _studentId?: string;
};

export function UdiseStudentListModal({
  title,
  subtitle,
  columns,
  rows,
  fileBaseName,
  onClose,
  copyKeys,
}: {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: UdiseListRow[];
  fileBaseName: string;
  onClose: () => void;
  /** Optional per-row copy buttons (for pasting into external portal search). */
  copyKeys?: { key: string; label: string }[];
}) {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy(text: string, tag: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      window.setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1200);
    } catch {
      setCopied(null);
    }
  }

  const exportRows = rows.map((r) => {
    const { _studentId, ...rest } = r;
    void _studentId;
    return rest;
  });

  const firstKey = columns[0]?.key;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl border border-[rgba(32,48,80,0.12)] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[rgba(32,48,80,0.1)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--brand-deep)]">
              {title}
            </h2>
            <p className="text-xs text-[var(--muted)]">
              {rows.length} student{rows.length === 1 ? "" : "s"}
              {subtitle ? ` · ${subtitle}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              disabled={!rows.length}
              onClick={() =>
                downloadExcelCsv({
                  title,
                  subtitle,
                  columns,
                  rows: exportRows,
                  fileBaseName,
                })
              }
            >
              Excel
            </button>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)] disabled:opacity-40"
              disabled={!rows.length}
              onClick={() =>
                downloadPdfReport({
                  title,
                  subtitle,
                  columns,
                  rows: exportRows,
                  fileBaseName,
                })
              }
            >
              PDF
            </button>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--muted)]"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-auto px-5 py-4">
          {rows.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-[var(--muted)]">
              No students in this list.
            </p>
          ) : (
            <ErpTable className="border-collapse">
              <ErpTableHead>
                <tr>
                  <th className="px-2 py-2 font-medium">#</th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={`px-2 py-2 font-medium ${
                        c.align === "right" ? "text-right" : ""
                      }`}
                    >
                      {c.header}
                    </th>
                  ))}
                  {copyKeys?.length ? (
                    <th className="px-2 py-2 font-medium">Copy</th>
                  ) : null}
                </tr>
              </ErpTableHead>
              <ErpTableBody hoverable>
                {rows.map((row, i) => (
                  <tr key={row._studentId ?? i} className="align-top">
                    <td className="px-2 py-2 text-[var(--muted)]">{i + 1}</td>
                    {columns.map((c) => {
                      const value = row[c.key];
                      const text = value == null ? "" : String(value);
                      const isNameCol = c.key === firstKey && row._studentId;
                      return (
                        <td
                          key={c.key}
                          className={`px-2 py-2 ${
                            c.align === "right" ? "text-right" : ""
                          }`}
                        >
                          {isNameCol ? (
                            <Link
                              href={`/students/${row._studentId}/edit`}
                              className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                            >
                              {text}
                            </Link>
                          ) : (
                            text
                          )}
                        </td>
                      );
                    })}
                    {copyKeys?.length ? (
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {copyKeys.map((ck) => {
                            const raw = row[ck.key];
                            const text = raw == null ? "" : String(raw);
                            if (!text || text === "—") return null;
                            const tag = `${i}-${ck.key}`;
                            return (
                              <button
                                key={ck.key}
                                type="button"
                                onClick={() => copy(text, tag)}
                                title={`Copy ${ck.label}: ${text}`}
                                className="rounded border border-[rgba(32,48,80,0.2)] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.04)]"
                              >
                                {copied === tag ? "Copied ✓" : ck.label}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          )}
        </div>
      </div>
    </div>
  );
}
