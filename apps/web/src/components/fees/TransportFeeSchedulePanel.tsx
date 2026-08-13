"use client";

import { useMemo } from "react";
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

export function TransportFeeSchedulePanel({
  studentId,
  academicYearCode,
  dues,
}: Props) {
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

  const transportDues = dues.filter((d) => d.kind === "transport");
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
        status:
          dueLine && isFeeDuePaid(dueLine)
            ? "paid"
            : balance > 0
              ? "due"
              : "—",
      };
    });
  }, [studentId, ay, transport, transportDues]);

  if (!assignment && transportDues.length === 0) return null;

  const route = transport.routes.find((r) => r.id === assignment?.routeId);
  const stop = route?.stops.find((s) => s.id === assignment?.stopId);

  const fromMonth = assignment?.effectiveFrom?.slice(0, 7) ?? "";
  const busNo = detail?.busNo || route?.busNo;
  const routeCode = detail?.routeCode || route?.code;

  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-[rgba(15,118,110,0.25)] bg-[rgba(15,118,110,0.06)]">
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start">
        <TransportBusBadge busNo={busNo} routeCode={routeCode} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#0f766e]">
            Transport assignment
          </p>
          <p className="font-semibold text-[var(--brand-deep)]">
            {detail?.routeCode || route?.code} · {detail?.routeName || route?.name}
          </p>
          <p className="text-xs text-[var(--muted)]">
            {detail?.busNo || route?.busNo}
            {(detail?.vehicleReg || route?.vehicleReg)
              ? ` (${detail?.vehicleReg || route?.vehicleReg})`
              : ""}
            · Stop {stop?.name || detail?.stopName || "—"}
          </p>
          {fromMonth ? (
            <p className="mt-1 text-xs font-medium text-[var(--ink)]">
              Billing from{" "}
              <strong>{formatMonthLabel(fromMonth)}</strong> — upcoming months below
            </p>
          ) : null}
        </div>
      </div>

      {scheduleRows.length > 0 ? (
        <div className="border-t border-[rgba(15,118,110,0.15)] bg-white/80 px-3 py-2">
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="py-1 font-semibold">Month</th>
                <th className="py-1 text-right font-semibold">Fee</th>
                <th className="py-1 text-right font-semibold">Paid</th>
                <th className="py-1 text-right font-semibold">Balance</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {scheduleRows
                .filter((r) => !fromMonth || r.periodKey >= fromMonth)
                .map((r) => (
                  <tr
                    key={r.periodKey}
                    className={r.status === "paid" ? "text-[var(--success)]" : ""}
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
      ) : null}
    </section>
  );
}

function formatMonthLabel(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}
