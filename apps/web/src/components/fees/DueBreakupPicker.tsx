"use client";

import { useMemo, useState } from "react";
import {
  formatConcessionDetailLine,
  formatInr,
  groupDuesByMonth,
  isFeeDuePaid,
  openFeeDues,
  type FeeDueLine,
} from "@/lib/fees";

/**
 * Month → fee-head break-up for Collect / Manual book.
 * Open heads are selectable; fully paid heads stay visible in green (not selectable).
 */
export function DueBreakupPicker({
  dues,
  selectedKeys,
  today,
  onToggle,
  onToggleMonth,
}: {
  dues: FeeDueLine[];
  selectedKeys: Set<string>;
  today: string;
  onToggle: (due: FeeDueLine) => void;
  onToggleMonth: (monthDues: FeeDueLine[], select: boolean) => void;
}) {
  const groups = useMemo(() => groupDuesByMonth(dues), [dues]);
  const currentMonthKey = today.slice(0, 7);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([currentMonthKey]),
  );

  if (dues.length === 0) {
    return (
      <p className="mt-2 text-xs text-[var(--muted)]">
        No fee lines for this student
      </p>
    );
  }

  return (
    <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
      {groups.map((g) => {
        const openInMonth = openFeeDues(g.dues);
        const paidInMonth = g.dues.filter(isFeeDuePaid);
        const overdueCount = openInMonth.filter((d) => d.dueOn <= today).length;
        const selectedInMonth = openInMonth.filter((d) =>
          selectedKeys.has(d.dueKey),
        );
        const allOn =
          openInMonth.length > 0 &&
          selectedInMonth.length === openInMonth.length;
        const someOn = !allOn && selectedInMonth.length > 0;
        const selectedPaise = selectedInMonth.reduce(
          (s, d) => s + d.balancePaise,
          0,
        );
        const isCollapsed = !expanded.has(g.monthKey);
        const monthOverdue = overdueCount > 0;
        const monthAllPaid =
          openInMonth.length === 0 && paidInMonth.length > 0;

        return (
          <div
            key={g.monthKey}
            className={`overflow-hidden rounded-lg border bg-white ${
              monthAllPaid
                ? "border-[rgba(22,163,74,0.35)]"
                : "border-[rgba(32,48,80,0.12)]"
            }`}
          >
            <div
              className={`flex items-center gap-2 border-b border-[rgba(32,48,80,0.08)] px-2.5 py-2 ${
                monthAllPaid
                  ? "bg-[rgba(22,163,74,0.08)]"
                  : monthOverdue
                    ? "bg-[rgba(220,38,38,0.06)]"
                    : "bg-[rgba(32,48,80,0.03)]"
              }`}
            >
              <input
                type="checkbox"
                className="shrink-0"
                checked={allOn}
                disabled={openInMonth.length === 0}
                ref={(el) => {
                  if (el) el.indeterminate = someOn;
                }}
                onChange={() => onToggleMonth(openInMonth, !allOn)}
                title={
                  openInMonth.length === 0
                    ? `${g.monthLabel} fully paid`
                    : allOn
                      ? `Unselect all open ${g.monthLabel} heads`
                      : `Select all open ${g.monthLabel} heads`
                }
                aria-label={`${allOn ? "Unselect" : "Select"} open heads for ${g.monthLabel}`}
              />
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.monthKey)) next.delete(g.monthKey);
                    else next.add(g.monthKey);
                    return next;
                  })
                }
              >
                <span
                  className="text-[10px] text-[var(--muted)]"
                  aria-hidden
                >
                  {isCollapsed ? "▸" : "▾"}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-xs font-bold sm:text-sm ${
                      monthAllPaid
                        ? "text-[#15803d]"
                        : "text-[var(--brand-deep)]"
                    }`}
                  >
                    {g.monthLabel}
                    {monthAllPaid ? (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide">
                        Paid
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={`block text-[10px] sm:text-[11px] ${
                      monthAllPaid
                        ? "font-semibold text-[#15803d]"
                        : monthOverdue
                          ? "font-semibold text-[#dc2626]"
                          : "text-[var(--muted)]"
                    }`}
                  >
                    {openInMonth.length > 0
                      ? `${openInMonth.length} open`
                      : "No open"}
                    {paidInMonth.length > 0
                      ? ` · ${paidInMonth.length} paid`
                      : ""}
                    {monthOverdue
                      ? ` · ${overdueCount} overdue`
                      : openInMonth.length > 0
                        ? ` · due ${g.earliestDueOn}`
                        : ""}
                    {someOn || allOn
                      ? ` · ${selectedInMonth.length} selected`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={`block text-xs font-bold sm:text-sm ${
                      monthAllPaid
                        ? "text-[#15803d]"
                        : monthOverdue
                          ? "text-[#dc2626]"
                          : "text-[var(--brand-deep)]"
                    }`}
                  >
                    {monthAllPaid
                      ? formatInr(
                          paidInMonth.reduce((s, d) => s + d.paidPaise, 0),
                        )
                      : formatInr(g.totalPaise)}
                  </span>
                  {selectedPaise > 0 ? (
                    <span className="block text-[10px] font-semibold text-[#16a34a]">
                      {formatInr(selectedPaise)}
                    </span>
                  ) : null}
                </span>
              </button>
            </div>

            {!isCollapsed ? (
              <ul className="divide-y divide-[rgba(32,48,80,0.06)]">
                {g.dues.map((d) => {
                  const paid = isFeeDuePaid(d);
                  const overdue = !paid && d.dueOn <= today;
                  const checked = !paid && selectedKeys.has(d.dueKey);
                  const headTitle =
                    d.kind === "store"
                      ? `Store · ${d.storeIssueNo || "Issue"}`
                      : d.kind === "transport"
                        ? `Transport · ${d.transport?.periodLabel ?? d.installmentLabel}`
                        : d.kind === "special"
                          ? d.label.replace(/\s·\sSpecial$/, "") || d.feeHeadName
                          : d.kind === "plan"
                            ? d.label
                            : d.feeHeadName;

                  if (paid) {
                    return (
                      <li key={d.dueKey}>
                        <div className="flex items-start gap-2 bg-[rgba(22,163,74,0.06)] px-2.5 py-2 pl-8">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked
                            disabled
                            readOnly
                            aria-label={`${headTitle} paid`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-[#15803d] sm:text-sm">
                              {headTitle}
                              <span className="ml-1.5 rounded bg-[#16a34a]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#15803d]">
                                Paid
                              </span>
                              {d.kind === "special" ? (
                                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#15803d]/80">
                                  Special
                                </span>
                              ) : null}
                              {d.kind === "plan" ? (
                                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#15803d]/80">
                                  Plan
                                </span>
                              ) : null}
                              {d.kind === "store" ? (
                                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#15803d]/80">
                                  Store
                                </span>
                              ) : null}
                              {d.kind === "transport" ? (
                                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#15803d]/80">
                                  Bus
                                </span>
                              ) : null}
                            </div>
                            {d.kind === "store" && d.storeItems.length > 0 ? (
                              <ul className="mt-1 space-y-0.5 text-[10px] text-[#15803d]/90">
                                {d.storeItems.map((it, idx) => (
                                  <li key={`${d.dueKey}-p-${idx}`}>
                                    {it.name}
                                    {it.sizeLabel ? ` ${it.sizeLabel}` : ""} ×
                                    {it.qty} · {formatInr(it.linePaise)}
                                  </li>
                                ))}
                              </ul>
                            ) : d.kind === "transport" && d.transport ? (
                              <div className="text-[10px] font-semibold text-[#15803d] sm:text-[11px]">
                                {d.transport.routeCode} · {d.transport.busNo} ·{" "}
                                {d.transport.stopName} · paid{" "}
                                {formatInr(d.paidPaise)}
                              </div>
                            ) : (
                              <div className="text-[10px] font-semibold text-[#15803d] sm:text-[11px]">
                                Paid {formatInr(d.paidPaise)}
                                {d.concessionPaise
                                  ? ` · −${formatInr(d.concessionPaise)} concession`
                                  : ""}
                                {` · due was ${d.dueOn}`}
                              </div>
                            )}
                            {d.concessionDetails?.length ? (
                              <ul className="mt-1 space-y-0.5 text-[10px] font-medium text-[#15803d]/85">
                                {d.concessionDetails.map((c) => (
                                  <li key={`${d.dueKey}-paid-${c.grantId}`}>
                                    Discount · {formatConcessionDetailLine(c)}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                          <div className="shrink-0 text-xs font-bold text-[#15803d] sm:text-sm">
                            {formatInr(0)}
                          </div>
                        </div>
                      </li>
                    );
                  }

                  return (
                    <li key={d.dueKey}>
                      <label className="flex cursor-pointer items-start gap-2 px-2.5 py-2 pl-8 hover:bg-[rgba(32,48,80,0.03)]">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={checked}
                          onChange={() => onToggle(d)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-[var(--brand-deep)] sm:text-sm">
                            {headTitle}
                            {d.kind === "special" ? (
                              <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                                Special
                              </span>
                            ) : null}
                            {d.kind === "plan" ? (
                              <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-mid)]">
                                Plan EMI
                              </span>
                            ) : null}
                            {d.kind === "store" ? (
                              <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-mid)]">
                                Books / store
                              </span>
                            ) : null}
                            {d.kind === "transport" ? (
                              <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-mid)]">
                                Transport
                              </span>
                            ) : null}
                          </div>
                          {d.kind === "store" && d.storeItems.length > 0 ? (
                            <ul className="mt-1 space-y-0.5 text-[10px] text-[var(--muted)] sm:text-[11px]">
                              {d.storeItems.map((it, idx) => (
                                <li key={`${d.dueKey}-${idx}`}>
                                  {it.sku} · {it.name}
                                  {it.sizeLabel ? ` (${it.sizeLabel})` : ""} ×
                                  {it.qty} @{" "}
                                  {formatInr(it.unitPricePaise)} ={" "}
                                  {formatInr(it.linePaise)}
                                </li>
                              ))}
                              <li className={overdue ? "font-semibold text-[#dc2626]" : ""}>
                                Issued {d.dueOn}
                                {overdue ? " · overdue" : ""}
                              </li>
                            </ul>
                          ) : d.kind === "transport" && d.transport ? (
                            <div
                              className={`text-[10px] sm:text-[11px] ${
                                overdue
                                  ? "font-semibold text-[#dc2626]"
                                  : "text-[var(--muted)]"
                              }`}
                            >
                              {d.transport.routeCode} · {d.transport.routeName} ·{" "}
                              {d.transport.busNo}
                              {d.transport.vehicleReg
                                ? ` (${d.transport.vehicleReg})`
                                : ""}
                              {" · Stop "}
                              {d.transport.stopName}
                              {" · due "}
                              {d.dueOn}
                              {overdue ? " · overdue" : ""}
                              {d.paidPaise > 0
                                ? ` · ${formatInr(d.paidPaise)} paid earlier`
                                : ""}
                            </div>
                          ) : (
                            <div
                              className={`text-[10px] sm:text-[11px] ${
                                overdue
                                  ? "font-semibold text-[#dc2626]"
                                  : "text-[var(--muted)]"
                              }`}
                            >
                              Due {d.dueOn}
                              {overdue ? " · overdue" : ""}
                              {d.concessionPaise
                                ? ` · −${formatInr(d.concessionPaise)} discount`
                                : ""}
                              {d.paidPaise > 0
                                ? ` · ${formatInr(d.paidPaise)} paid earlier`
                                : ""}
                            </div>
                          )}
                          {d.concessionDetails?.length ? (
                            <ul className="mt-1 space-y-0.5 text-[10px] text-[var(--muted)]">
                              {d.concessionDetails.map((c) => (
                                <li key={`${d.dueKey}-${c.grantId}`}>
                                  Discount · {formatConcessionDetailLine(c)}
                                  {c.code ? (
                                    <span className="text-[var(--muted)]">
                                      {" "}
                                      ({c.code})
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                              {d.billedPaise > 0 ? (
                                <li className="font-medium text-[var(--brand-deep)]/80">
                                  Billed {formatInr(d.billedPaise)}
                                  {d.concessionPaise
                                    ? ` − ${formatInr(d.concessionPaise)} = ${formatInr(d.billedPaise - d.concessionPaise)}`
                                    : ""}
                                </li>
                              ) : null}
                            </ul>
                          ) : null}
                        </div>
                        <div
                          className={`shrink-0 text-xs font-bold sm:text-sm ${
                            checked
                              ? "text-[#16a34a]"
                              : overdue
                                ? "text-[#dc2626]"
                                : "text-[var(--brand-deep)]"
                          }`}
                        >
                          {formatInr(d.balancePaise)}
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
