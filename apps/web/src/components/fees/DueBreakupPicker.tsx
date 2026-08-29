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
function lineDiscountPaise(
  due: FeeDueLine,
  lineDiscountRupees: Record<string, string>,
): number {
  const raw = lineDiscountRupees[due.dueKey];
  if (!raw?.trim()) return 0;
  const n = Math.round((Number(raw) || 0) * 100);
  if (n <= 0) return 0;
  return Math.min(n, due.balancePaise);
}

export function DueBreakupPicker({
  dues,
  selectedKeys,
  today,
  onToggle,
  onToggleMonth,
  lineDiscountRupees,
  onLineDiscount,
  recurringEligible,
  recurringChosen,
  onToggleRecurring,
  discountOnlyKeys,
  onToggleDiscountOnly,
}: {
  dues: FeeDueLine[];
  selectedKeys: Set<string>;
  today: string;
  onToggle: (due: FeeDueLine) => void;
  onToggleMonth: (monthDues: FeeDueLine[], select: boolean) => void;
  /** Per dueKey counter discount (₹) — only on selected heads */
  lineDiscountRupees?: Record<string, string>;
  onLineDiscount?: (dueKey: string, rupees: string) => void;
  /** Dues whose head repeats monthly, so a discount on it could recur. */
  recurringEligible?: Set<string>;
  /** Dues the clerk has chosen to make recurring. */
  recurringChosen?: Set<string>;
  onToggleRecurring?: (dueKey: string, on: boolean) => void;
  /** Lines discounted but not collected today. */
  discountOnlyKeys?: Set<string>;
  onToggleDiscountOnly?: (dueKey: string, on: boolean) => void;
}) {
  const groups = useMemo(() => groupDuesByMonth(dues), [dues]);
  const currentMonthKey = today.slice(0, 7);
  // Which lines take their discount as a percentage; the % typed per line.
  // The pipeline stays rupees-only — % just computes them from the balance.
  const [pctMode, setPctMode] = useState<Set<string>>(new Set());
  const [pctValue, setPctValue] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([currentMonthKey]),
  );

  if (dues.length === 0) {
    return (
      <p className="mt-2 text-sm text-[var(--muted)] sm:text-base">
        No fee lines for this student
      </p>
    );
  }

  return (
    <div className="fee-collect-ui mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
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
          (s, d) =>
            s +
            Math.max(
              0,
              d.balancePaise -
                lineDiscountPaise(d, lineDiscountRupees ?? {}),
            ),
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
                  className="text-sm text-[var(--muted)]"
                  aria-hidden
                >
                  {isCollapsed ? "▸" : "▾"}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm font-bold sm:text-base ${
                      monthAllPaid
                        ? "text-[#15803d]"
                        : "text-[var(--brand-deep)]"
                    }`}
                  >
                    {g.monthLabel}
                    {monthAllPaid ? (
                      <span className="ml-1.5 text-sm font-bold uppercase tracking-wide">
                        Paid
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={`block text-sm sm:text-sm ${
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
                    className={`block text-sm font-bold sm:text-base ${
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
                    <span className="block text-sm font-semibold text-[#16a34a]">
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
                          : d.kind === "voucher"
                            ? d.label
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
                            <div className="text-sm font-medium text-[#15803d] sm:text-base">
                              {headTitle}
                              <span className="ml-1.5 rounded bg-[#16a34a]/15 px-1.5 py-0.5 text-sm font-bold uppercase tracking-wide text-[#15803d]">
                                Paid
                              </span>
                              {d.kind === "special" ? (
                                <span className="ml-1.5 text-sm font-semibold uppercase tracking-wide text-[#15803d]/80">
                                  Special
                                </span>
                              ) : null}
                              {d.kind === "voucher" ? (
                                <span className="ml-1.5 text-sm font-semibold uppercase tracking-wide text-[#15803d]/80">
                                  Voucher
                                </span>
                              ) : null}
                              {d.kind === "plan" ? (
                                <span className="ml-1.5 text-sm font-semibold uppercase tracking-wide text-[#15803d]/80">
                                  Plan
                                </span>
                              ) : null}
                              {d.kind === "store" ? (
                                <span className="ml-1.5 text-sm font-semibold uppercase tracking-wide text-[#15803d]/80">
                                  Store
                                </span>
                              ) : null}
                              {d.kind === "transport" ? (
                                <span className="ml-1.5 text-sm font-semibold uppercase tracking-wide text-[#15803d]/80">
                                  Bus
                                </span>
                              ) : null}
                            </div>
                            {d.kind === "store" && d.storeItems.length > 0 ? (
                              <ul className="mt-1 space-y-0.5 text-sm text-[#15803d]/90">
                                {d.storeItems.map((it, idx) => (
                                  <li key={`${d.dueKey}-p-${idx}`}>
                                    {it.name}
                                    {it.sizeLabel ? ` ${it.sizeLabel}` : ""} ×
                                    {it.qty} · {formatInr(it.linePaise)}
                                  </li>
                                ))}
                              </ul>
                            ) : d.kind === "transport" && d.transport ? (
                              <div className="text-sm font-semibold text-[#15803d] sm:text-sm">
                                {d.transport.routeCode} · {d.transport.busNo} ·{" "}
                                {d.transport.stopName} · paid{" "}
                                {formatInr(d.paidPaise)}
                              </div>
                            ) : (
                              <div className="text-sm font-semibold text-[#15803d] sm:text-sm">
                                Paid {formatInr(d.paidPaise)}
                                {d.concessionPaise
                                  ? ` · −${formatInr(d.concessionPaise)} concession`
                                  : ""}
                                {` · due was ${d.dueOn}`}
                              </div>
                            )}
                            {d.concessionDetails?.length ? (
                              <ul className="mt-1 space-y-0.5 text-sm font-medium text-[#15803d]/85">
                                {d.concessionDetails.map((c) => (
                                  <li key={`${d.dueKey}-paid-${c.grantId}`}>
                                    Discount · {formatConcessionDetailLine(c)}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                          <div className="shrink-0 text-sm font-bold text-[#15803d] sm:text-base">
                            {formatInr(0)}
                          </div>
                        </div>
                      </li>
                    );
                  }

                  const discountPaise = lineDiscountRupees
                    ? lineDiscountPaise(d, lineDiscountRupees)
                    : 0;
                  const netPaise = Math.max(0, d.balancePaise - discountPaise);

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
                          <div className="text-sm font-medium text-[var(--brand-deep)] sm:text-base">
                            {headTitle}
                            {d.kind === "special" ? (
                              <span className="ml-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                                Special
                              </span>
                            ) : null}
                            {d.kind === "plan" ? (
                              <span className="ml-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--brand-mid)]">
                                Plan EMI
                              </span>
                            ) : null}
                            {d.kind === "store" ? (
                              <span className="ml-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--brand-mid)]">
                                Books / store
                              </span>
                            ) : null}
                            {d.kind === "transport" ? (
                              <span className="ml-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--brand-mid)]">
                                Transport
                              </span>
                            ) : null}
                          </div>
                          {d.kind === "store" && d.storeItems.length > 0 ? (
                            <ul className="mt-1 space-y-0.5 text-sm text-[var(--muted)] sm:text-sm">
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
                              className={`text-sm sm:text-sm ${
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
                              className={`text-sm sm:text-sm ${
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
                            <ul className="mt-1 space-y-0.5 text-sm text-[var(--muted)]">
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
                        <div className="shrink-0 text-right">
                          {discountPaise > 0 ? (
                            <>
                              <div className="text-sm font-medium text-[var(--muted)] line-through sm:text-base">
                                {formatInr(d.balancePaise)}
                              </div>
                              <div
                                className={`text-sm font-bold sm:text-base ${
                                  checked ? "text-[#16a34a]" : "text-[var(--brand-deep)]"
                                }`}
                              >
                                {formatInr(netPaise)}
                              </div>
                            </>
                          ) : (
                            <div
                              className={`text-sm font-bold sm:text-base ${
                                checked
                                  ? "text-[#16a34a]"
                                  : overdue
                                    ? "text-[#dc2626]"
                                    : "text-[var(--brand-deep)]"
                              }`}
                            >
                              {formatInr(d.balancePaise)}
                            </div>
                          )}
                        </div>
                      </label>
                      {checked && onLineDiscount ? (
                        <div className="flex flex-wrap items-center gap-2 border-t border-[rgba(32,48,80,0.06)] bg-[rgba(197,160,40,0.06)] px-2.5 py-2 pl-12">
                          <span className="text-sm font-semibold text-[var(--brand-deep)]">
                            Discount on {headTitle}
                          </span>
                          <div className="flex overflow-hidden rounded-lg border border-[rgba(32,48,80,0.18)]">
                            <button
                              type="button"
                              className={`px-2 py-1 text-xs font-bold ${
                                !pctMode.has(d.dueKey)
                                  ? "bg-[var(--brand-deep)] text-white"
                                  : "bg-[var(--card)] text-[var(--muted)]"
                              }`}
                              onClick={() =>
                                setPctMode((prev) => {
                                  const next = new Set(prev);
                                  next.delete(d.dueKey);
                                  return next;
                                })
                              }
                            >
                              ₹
                            </button>
                            <button
                              type="button"
                              className={`px-2 py-1 text-xs font-bold ${
                                pctMode.has(d.dueKey)
                                  ? "bg-[var(--brand-deep)] text-white"
                                  : "bg-[var(--card)] text-[var(--muted)]"
                              }`}
                              onClick={() =>
                                setPctMode((prev) => new Set(prev).add(d.dueKey))
                              }
                            >
                              %
                            </button>
                          </div>
                          {pctMode.has(d.dueKey) ? (
                            <div className="flex items-center gap-1">
                              <input
                                inputMode="decimal"
                                className="field w-20 !py-1.5 !text-base !font-semibold"
                                value={pctValue[d.dueKey] ?? ""}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/[^\d.]/g, "");
                                  const pct = Math.min(100, Number(raw) || 0);
                                  setPctValue((prev) => ({ ...prev, [d.dueKey]: raw }));
                                  // The books always record rupees — % is an
                                  // input convenience computed off this line.
                                  const rupees =
                                    raw.trim() === ""
                                      ? ""
                                      : String(
                                          Math.round((d.balancePaise * pct) / 100) / 100,
                                        );
                                  onLineDiscount(d.dueKey, rupees);
                                }}
                                placeholder="0"
                                aria-label={`Discount percent on ${headTitle}`}
                              />
                              <span className="text-sm font-bold text-[var(--muted)]">%</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className="text-sm font-bold text-[var(--muted)]">₹</span>
                              <input
                                inputMode="decimal"
                                className="field w-28 !py-1.5 !text-base !font-semibold"
                                value={lineDiscountRupees?.[d.dueKey] ?? ""}
                                onChange={(e) =>
                                  onLineDiscount(
                                    d.dueKey,
                                    e.target.value.replace(/[^\d.]/g, ""),
                                  )
                                }
                                placeholder="0"
                                aria-label={`Discount on ${headTitle}`}
                              />
                            </div>
                          )}
                          {discountPaise > 0 ? (
                            <span className="text-sm font-semibold text-[#16a34a]">
                              −{formatInr(discountPaise)}
                              {pctMode.has(d.dueKey) && pctValue[d.dueKey]
                                ? ` (${pctValue[d.dueKey]}%)`
                                : ""}{" "}
                              · collect {formatInr(netPaise)}
                            </span>
                          ) : null}
                          {/* The decision that used to be made for the clerk.
                              A counter discount was silently saved as a
                              standing Masters rule — the modal after collect
                              arrived pre-ticked — so one month's discount
                              quietly became every month's. It is asked here
                              now, before the money is taken, and it starts
                              OFF: a discount is for the month in hand unless
                              someone says otherwise. */}
                          {/* Discount this head without taking money for it
                              today — ₹100 off transport while only tuition is
                              collected. The line keeps its discount and stays
                              off the receipt and out of the amount due. */}
                          {discountPaise > 0 && onToggleDiscountOnly ? (
                            <label className="flex items-center gap-1.5 text-sm text-[var(--brand-deep)]">
                              <input
                                type="checkbox"
                                checked={discountOnlyKeys?.has(d.dueKey) ?? false}
                                onChange={(e) =>
                                  onToggleDiscountOnly(d.dueKey, e.target.checked)
                                }
                              />
                              {discountOnlyKeys?.has(d.dueKey)
                                ? "Discount only — not collecting this today"
                                : "Collecting this today"}
                            </label>
                          ) : null}
                          {discountPaise > 0 &&
                          recurringEligible?.has(d.dueKey) &&
                          onToggleRecurring ? (
                            <label className="flex items-center gap-1.5 text-sm text-[var(--brand-deep)]">
                              <input
                                type="checkbox"
                                checked={recurringChosen?.has(d.dueKey) ?? false}
                                onChange={(e) =>
                                  onToggleRecurring(d.dueKey, e.target.checked)
                                }
                              />
                              {recurringChosen?.has(d.dueKey)
                                ? "Every remaining month — saved to Masters"
                                : "This month only"}
                            </label>
                          ) : null}
                        </div>
                      ) : null}
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
