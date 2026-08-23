"use client";

import { useMemo, useState } from "react";
import { formatInr } from "@/lib/fees";
import type { MastersState } from "@/lib/masters";
import type { SisState } from "@/lib/sis";
import { serviceModeLabel, type TransportState } from "@/lib/transport";
import {
  buildClassTransportRows,
  buildStudentTransportProfiles,
} from "@/lib/transportPlanner";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";

/**
 * Who rides, by class and section.
 *
 * The same riders as riders-by-bus, read along the other axis. A class
 * teacher asking "who in my section goes by bus" cannot answer that from a
 * per-vehicle list without reading all five of them, and the office needs
 * this shape whenever a class trip, an early dismissal or a section merge
 * changes who has to be transported.
 *
 * Non-riders are counted rather than hidden. "18 of 24 ride" is the sentence
 * that helps; six names on their own do not say whether the other eighteen
 * walk or whether nobody got round to assigning them.
 */
export function ClassTransportPanel({
  state,
  masters,
  sis,
  academicYearCode,
}: {
  state: TransportState;
  masters: MastersState | null;
  sis: SisState | null;
  academicYearCode: string;
}) {
  const [showEmpty, setShowEmpty] = useState(false);

  const rows = useMemo(() => {
    if (!sis || !masters) return null;
    const profiles = buildStudentTransportProfiles(
      sis,
      masters,
      state,
      academicYearCode,
    );
    return buildClassTransportRows(profiles, state);
  }, [state, masters, sis, academicYearCode]);

  // A cold browser used to render confident zeros against fully assigned
  // classes. Not knowing and nobody riding look identical on screen.
  if (!rows) {
    return (
      <p className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--brand-mid)_45%,transparent)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
        <strong className="text-[var(--brand-deep)]">
          Student roster has not loaded yet.
        </strong>{" "}
        Class lists cannot be shown until it does — they would read as empty,
        which is not the same as a class where nobody rides.
      </p>
    );
  }

  const shown = showEmpty ? rows : rows.filter((r) => r.riders.length > 0);
  const totalRiders = rows.reduce((n, r) => n + r.riders.length, 0);
  const totalStudents = rows.reduce((n, r) => n + r.totalStudents, 0);
  const monthly = rows.reduce((n, r) => n + r.monthlyTotalPaise, 0);
  const classesWithNone = rows.filter((r) => r.riders.length === 0).length;

  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Riders by class &amp; section
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {totalRiders} of {totalStudents} active students ride ·{" "}
              {formatInr(monthly)} per month · {rows.length} section
              {rows.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            {classesWithNone > 0 ? (
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-sunken)]"
                onClick={() => setShowEmpty((v) => !v)}
              >
                {showEmpty
                  ? "Hide sections with no riders"
                  : `Show ${classesWithNone} section${classesWithNone === 1 ? "" : "s"} with no riders`}
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-sunken)]"
              onClick={() => window.print()}
            >
              Print
            </button>
          </div>
        </div>
      </section>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
          No section has a rider yet.
        </p>
      ) : null}

      {shown.map((row) => (
        <section
          key={`${row.classId}::${row.sectionId}`}
          className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] print:break-inside-avoid"
        >
          <div className="flex flex-wrap items-baseline gap-2 p-4">
            <h3 className="font-bold text-[var(--brand-deep)]">
              {row.classLabel}
              {row.sectionLabel ? ` — ${row.sectionLabel}` : ""}
            </h3>
            {!row.sectionLabel ? (
              <span className="text-[11px] text-[var(--muted)]">
                (no section set)
              </span>
            ) : null}
            <span className="text-[11px] text-[var(--ink)]">
              <strong>{row.riders.length}</strong> of {row.totalStudents} ride
            </span>
            <span className="text-[11px] text-[var(--muted)]">
              · {row.nonRiderCount} do not ·{" "}
              {formatInr(row.monthlyTotalPaise)}/month
            </span>
          </div>

          {row.riders.length === 0 ? (
            <p className="border-t border-[var(--border)] px-4 py-3 text-[11px] text-[var(--muted)]">
              Nobody in this section is on a bus.
            </p>
          ) : (
            <div className="overflow-x-auto border-t border-[var(--border)]">
              <ErpTable minWidth="min-w-[38rem]">
                <ErpTableHead>
                  <tr>
                    <th className="px-3 py-2 text-left font-bold">Student</th>
                    <th className="px-3 py-2 text-left font-bold">Adm no</th>
                    <th className="px-3 py-2 text-left font-bold">Bus</th>
                    <th className="px-3 py-2 text-left font-bold">Stop</th>
                    <th className="px-3 py-2 text-right font-bold">
                      Per month
                    </th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {row.riders.map((r) => (
                    <tr
                      key={r.studentId}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="px-3 py-1.5 font-semibold text-[var(--brand-deep)]">
                        {r.fullName}
                        {r.serviceMode !== "both" ? (
                          <span className="ml-1 rounded bg-[var(--surface-sunken)] px-1 text-[9px] font-bold uppercase text-[var(--muted)]">
                            {serviceModeLabel(r.serviceMode)}
                          </span>
                        ) : null}
                        {r.boardingSuspended ? (
                          <span className="ml-1 font-bold text-[var(--danger)]">
                            suspended
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5 text-[var(--muted)]">
                        {r.admissionNo}
                      </td>
                      <td className="px-3 py-1.5">{r.routeLabel}</td>
                      <td className="px-3 py-1.5">
                        {r.stopLinkBroken ? (
                          <span
                            className="font-semibold text-[var(--warning)]"
                            title="Points at a stop that no longer exists — repair it from Riders by bus"
                          >
                            ⚠ link broken
                          </span>
                        ) : (
                          r.stopName || "—"
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.monthlyFeePaise > 0 ? (
                          formatInr(r.monthlyFeePaise)
                        ) : (
                          <span className="font-semibold text-[var(--danger)]">
                            nil
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
