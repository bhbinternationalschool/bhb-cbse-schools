"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatInr,
  isFeeDuePaid,
  type FeeDueLine,
} from "@/lib/fees";
import { DEFAULT_AY } from "@/lib/masters";
import {
  computeTransportPeriodDues,
  listAssignmentsForStudent,
  loadTransport,
} from "@/lib/transport";
import { TransportBusBadge } from "@/components/transport/TransportBusBadge";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";

type Props = {
  studentId: string;
  academicYearCode?: string;
  dues: FeeDueLine[];
};

/**
 * Rider marker for the fee counter — a bus chip beside the child's name.
 *
 * Transport used to render a full month-by-month table inline for every rider,
 * above their dues. At the counter the cashier is collecting from the dues list,
 * so the table pushed the thing they came for below the fold. The chip says who
 * rides which bus at a glance; the schedule is one click away for the parent who
 * asks "which months am I paying for?".
 */
export function TransportRiderChip({
  studentId,
  academicYearCode,
  dues,
}: Props) {
  const [open, setOpen] = useState(false);
  const transport = loadTransport();
  const ay = academicYearCode || DEFAULT_AY;

  const assignment = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return listAssignmentsForStudent(studentId, transport).find(
      (a) =>
        a.academicYearCode === ay &&
        a.effectiveFrom <= today &&
        (!a.effectiveTo || a.effectiveTo >= today),
    );
  }, [studentId, transport, ay]);

  const transportDues = useMemo(
    () => dues.filter((d) => d.kind === "transport"),
    [dues],
  );
  const detail = transportDues[0]?.transport;

  const scheduleRows = useMemo(() => {
    const all = computeTransportPeriodDues(studentId, {
      academicYearCode: ay,
      includeFuture: true,
      state: transport,
    });
    const paidMap = new Map(transportDues.map((d) => [d.dueKey, d]));
    return all.map((td) => {
      const dueLine = paidMap.get(td.dueKey);
      const paid =
        dueLine && isFeeDuePaid(dueLine)
          ? dueLine.billedPaise
          : dueLine
            ? dueLine.paidPaise
            : 0;
      const balance = dueLine?.balancePaise ?? td.amountPaise;
      return {
        periodKey: td.periodKey,
        periodLabel: td.periodLabel,
        amountPaise: td.amountPaise,
        paidPaise: paid,
        balancePaise: balance,
        paid: !!dueLine && isFeeDuePaid(dueLine),
      };
    });
  }, [studentId, ay, transport, transportDues]);

  if (!assignment && transportDues.length === 0) return null;

  const route = transport.routes.find((r) => r.id === assignment?.routeId);
  const stop = route?.stops.find((s) => s.id === assignment?.stopId);
  const fromMonth = assignment?.effectiveFrom?.slice(0, 7) ?? "";
  const busNo = detail?.busNo || route?.busNo || "";
  const routeCode = detail?.routeCode || route?.code || "";
  const stopName = stop?.name || detail?.stopName || "";

  const chipLabel = [busNo || routeCode, stopName].filter(Boolean).join(" · ");
  const openBalance = transportDues.reduce((s, d) => s + d.balancePaise, 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Transport assignment and monthly schedule"
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[var(--success-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--success)] hover:bg-[color-mix(in_srgb,var(--success)_22%,transparent)]"
      >
        <BusGlyph />
        <span className="truncate">{chipLabel || "Transport"}</span>
        {openBalance > 0 ? (
          <span className="shrink-0 tabular-nums opacity-80">
            {formatInr(openBalance)}
          </span>
        ) : null}
      </button>

      {open ? (
        <TransportScheduleDialog
          onClose={() => setOpen(false)}
          busNo={busNo}
          routeCode={routeCode}
          routeName={detail?.routeName || route?.name || ""}
          vehicleReg={detail?.vehicleReg || route?.vehicleReg || ""}
          stopName={stopName}
          fromMonth={fromMonth}
          rows={scheduleRows.filter((r) => !fromMonth || r.periodKey >= fromMonth)}
        />
      ) : null}
    </>
  );
}

function BusGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden
      className="shrink-0"
      fill="currentColor"
    >
      <path d="M3 2h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1v1.5a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5V11H5v1.5a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5V11a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm.5 2v3h9V4h-9Zm.75 5.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm7.5 0a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
    </svg>
  );
}

function TransportScheduleDialog({
  onClose,
  busNo,
  routeCode,
  routeName,
  vehicleReg,
  stopName,
  fromMonth,
  rows,
}: {
  onClose: () => void;
  busNo: string;
  routeCode: string;
  routeName: string;
  vehicleReg: string;
  stopName: string;
  fromMonth: string;
  rows: {
    periodKey: string;
    periodLabel: string;
    amountPaise: number;
    paidPaise: number;
    balancePaise: number;
    paid: boolean;
  }[];
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const totalDue = rows.reduce((s, r) => s + r.balancePaise, 0);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(15,23,42,0.55)] p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transport-schedule-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.14)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3 border-b border-[rgba(32,48,80,0.08)] p-4 sm:p-5">
          <TransportBusBadge busNo={busNo} routeCode={routeCode} size="md" />
          <div className="min-w-0 flex-1">
            <h2
              id="transport-schedule-title"
              className="text-lg font-bold text-[var(--brand-deep)]"
            >
              {[routeCode, routeName].filter(Boolean).join(" · ") || "Transport"}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {busNo}
              {vehicleReg ? ` (${vehicleReg})` : ""}
              {stopName ? ` · Stop ${stopName}` : ""}
            </p>
            {fromMonth ? (
              <p className="mt-1 text-xs font-medium text-[var(--ink)]">
                Billing from <strong>{formatMonthLabel(fromMonth)}</strong>
              </p>
            ) : null}
          </div>
        </div>

        {rows.length > 0 ? (
          <div className="max-h-[55vh] overflow-auto px-4 py-2 sm:px-5">
            <ErpTable minWidth="min-w-0">
              <ErpTableHead>
                <tr>
                  <th className="py-1 font-semibold">Month</th>
                  <th className="py-1 text-right font-semibold">Fee</th>
                  <th className="py-1 text-right font-semibold">Paid</th>
                  <th className="py-1 text-right font-semibold">Balance</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {rows.map((r) => (
                  <tr
                    key={r.periodKey}
                    className={r.paid ? "text-[var(--success)]" : ""}
                  >
                    <td className="py-1.5 font-medium">{r.periodLabel}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatInr(r.amountPaise)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {r.paidPaise > 0 ? formatInr(r.paidPaise) : "—"}
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">
                      {r.balancePaise > 0 ? formatInr(r.balancePaise) : "—"}
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-[var(--muted)] sm:px-5">
            No transport months billed for this session yet.
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-[rgba(32,48,80,0.08)] px-4 py-3 sm:px-5">
          <span className="text-sm text-[var(--muted)]">
            Outstanding{" "}
            <strong className="tabular-nums text-[var(--brand-deep)]">
              {formatInr(totalDue)}
            </strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-sunken)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function formatMonthLabel(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}
