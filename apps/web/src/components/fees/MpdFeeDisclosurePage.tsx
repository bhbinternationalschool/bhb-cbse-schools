"use client";

import { useEffect, useState } from "react";
import {
  buildMpdFeeDisclosure,
  formatInr,
  type MpdFeeGroupRow,
} from "@/lib/feeFinance";
import {
  currentAcademicYearCode,
  loadMasters,
} from "@/lib/masters";
import { TENANT } from "@/lib/types";

/**
 * Mandatory Public Disclosure — fee structure (CBSE / state MPD style).
 * Public route; reads Masters from localStorage when opened on the same origin.
 */
export function MpdFeeDisclosurePage() {
  const [rows, setRows] = useState<MpdFeeGroupRow[]>([]);
  const [ay, setAy] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const m = loadMasters();
    setAy(currentAcademicYearCode(m));
    setRows(buildMpdFeeDisclosure(m));
    setReady(true);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--creamColor,#F8F8F0)] text-[var(--brand-deep,#203050)]">
      <header className="border-b border-[rgba(32,48,80,0.12)] bg-white px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
            Mandatory public disclosure · Fee structure
          </p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
            {TENANT.nameDisplay}
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {TENANT.schoolAddress} · Affiliation {TENANT.affiliationNo} · School
            code {TENANT.schoolCode}
            {ay ? ` · Academic year ${ay}` : ""}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
        {!ready ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-6 text-sm text-[var(--muted)]">
            Fee groups are not published yet. Configure Fee Groups and Fee
            Structure in the school ERP, then refresh this page on the same
            browser.
          </p>
        ) : (
          <div className="space-y-6">
            {rows.map((g) => (
              <section
                key={g.groupCode}
                className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold">
                    {g.groupName}{" "}
                    <span className="text-sm font-normal text-[var(--muted)]">
                      ({g.groupCode})
                    </span>
                  </h2>
                  <div className="text-sm font-semibold">
                    Annual total {formatInr(g.annualTotalPaise)}
                  </div>
                </div>
                {g.classNames.length > 0 ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Classes: {g.classNames.join(", ")}
                  </p>
                ) : null}
                <table className="mt-4 w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[rgba(32,48,80,0.1)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
                      <th className="py-2 pr-2 font-medium">Head</th>
                      <th className="py-2 pr-2 font-medium">Installment</th>
                      <th className="py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.heads.map((h, i) => (
                      <tr
                        key={`${h.headName}-${h.installmentLabel}-${i}`}
                        className="border-b border-[rgba(32,48,80,0.06)]"
                      >
                        <td className="py-2 pr-2">{h.headName}</td>
                        <td className="py-2 pr-2 text-[var(--muted)]">
                          {h.installmentLabel}
                        </td>
                        <td className="py-2 text-right font-medium">
                          {formatInr(h.amountPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        )}
        <p className="mt-10 text-center text-[11px] text-[var(--muted)]">
          Published for parent / public disclosure. Amounts follow the school’s
          approved fee structure for the session shown.
        </p>
      </main>
    </div>
  );
}
