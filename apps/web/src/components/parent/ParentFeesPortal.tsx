"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import {
  formatConcessionDetailLine,
  formatInr,
  groupDuesByMonth,
  openFeeDues,
  type CollectionVoucher,
  type FeeDueLine,
} from "@/lib/fees";
import { formatParentDueHint, parentOpenDueTotals } from "@/lib/parentPortal";
import {
  ErpQueryError,
  ErpQueryProvider,
  useErpQuery,
} from "@/lib/data/client/hooks";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { FilterExportButtons } from "@/components/reports/FilterExportButtons";
import { describeFilters } from "@/lib/reportExport";
import { TENANT } from "@/lib/types";

type Tab = "dues" | "receipts";

/** The page as GET /api/payments/parent-dues sends it (lib/parentFeeCheckout.server.ts). */
type ParentFeesChild = {
  id: string;
  fullName: string;
  admissionNo: string;
  classLabel: string;
  photoUrl: string | null;
};
type ParentFeesView = {
  householdId: string;
  guardianName: string;
  academicYearCode: string;
  children: { student: ParentFeesChild; dues: FeeDueLine[] }[];
  receipts: CollectionVoucher[];
  /** Owing up to the running month — the pay link's / app's "due now". */
  dueNowKeys: string[];
  dueNowPaise: number;
  restOfYearPaise: number;
};

export const PARENT_FEES_PATH = "/api/payments/parent-dues";

/** A body that is not the page is a failed read, never an empty family (R6). */
function parseParentFees(data: unknown): ParentFeesView {
  const v = data as Partial<ParentFeesView> | null;
  if (
    !v ||
    typeof v.householdId !== "string" ||
    !Array.isArray(v.children) ||
    !Array.isArray(v.receipts) ||
    !Array.isArray(v.dueNowKeys) ||
    typeof v.dueNowPaise !== "number" ||
    typeof v.restOfYearPaise !== "number" ||
    v.children.some((c) => !c?.student?.id || !Array.isArray(c.dues))
  ) {
    throw new ErpQueryError(502, "The fee page came back incomplete");
  }
  return v as ParentFeesView;
}

/**
 * The parent's fees and receipts. Everything on it is computed on the server
 * for the signed-in parent's own household (GET /api/payments/parent-dues);
 * nothing here reads the office's desks, which refuse a parent session —
 * reading them is what showed every real parent "No household linked" and no
 * dues at all until 15 Oct 2026.
 */
export function ParentFeesPortal(props: {
  guardianDisplayName: string;
  /** From the signed-in session; the server scopes to it on its own. */
  householdId?: string;
  onSignOut: () => void;
}) {
  // The parent layout has no AppShell (staff only), so the query client is
  // provided here. No query on this page reads a desk, so it starts no poll.
  return (
    <ErpQueryProvider>
      <ParentFeesPage {...props} />
    </ErpQueryProvider>
  );
}

function ParentFeesPage({
  guardianDisplayName,
  householdId,
  onSignOut,
}: {
  guardianDisplayName: string;
  householdId?: string;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("dues");
  const query = useErpQuery<ParentFeesView>(
    ["parent-fees", householdId ?? ""],
    PARENT_FEES_PATH,
    { parse: parseParentFees },
  );
  const view = query.data ?? null;
  const bundle = useMemo(() => view?.children ?? [], [view]);
  const receipts = view?.receipts ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2800);
  }

  const activeRow = useMemo(
    () => bundle.find((r) => r.student.id === activeStudentId) ?? bundle[0],
    [bundle, activeStudentId],
  );

  // "Due now" is the server's list (the pay link's definition); an open line
  // not on it is the rest of the year: shown apart, never selectable, never
  // in the amount to pay.
  const dueNowSet = useMemo(() => new Set(view?.dueNowKeys ?? []), [view]);
  const isRest = (d: FeeDueLine) =>
    d.balancePaise > 0 && !dueNowSet.has(d.dueKey);

  const allOpen = useMemo(
    () =>
      bundle
        .flatMap((r) => openFeeDues(r.dues))
        .filter((d) => d.balancePaise > 0 && dueNowSet.has(d.dueKey)),
    [bundle, dueNowSet],
  );

  const householdTotals = useMemo(
    () => parentOpenDueTotals(allOpen),
    [allOpen],
  );

  const monthGroups = useMemo(() => {
    if (!activeRow) return [];
    return groupDuesByMonth(
      activeRow.dues.filter(
        (d) => !(d.balancePaise > 0 && !dueNowSet.has(d.dueKey)),
      ),
    );
  }, [activeRow, dueNowSet]);

  const restGroups = useMemo(() => {
    if (!activeRow) return [];
    return groupDuesByMonth(
      activeRow.dues.filter(
        (d) => d.balancePaise > 0 && !dueNowSet.has(d.dueKey),
      ),
    );
  }, [activeRow, dueNowSet]);

  const selectedTotal = useMemo(() => {
    let t = 0;
    for (const d of allOpen) {
      if (selected.has(d.dueKey)) t += d.balancePaise;
    }
    return t;
  }, [allOpen, selected]);

  function toggleDue(d: FeeDueLine) {
    if (d.balancePaise <= 0 || !dueNowSet.has(d.dueKey)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(d.dueKey)) next.delete(d.dueKey);
      else next.add(d.dueKey);
      return next;
    });
  }

  function selectOpenForStudent(studentId: string) {
    const row = bundle.find((r) => r.student.id === studentId);
    if (!row) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of openFeeDues(row.dues)) {
        if (d.balancePaise > 0 && dueNowSet.has(d.dueKey)) next.add(d.dueKey);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  /**
   * Only due keys travel: the server recomputes the dues, makes the pay-link
   * and attaches the gateway checkout (POST /api/payments/parent-checkout —
   * the same flow the parent app uses); the webhook settles it like any
   * link. With no gateway configured the parent lands on the link's own pay
   * page. Nothing is ever marked paid from this browser.
   */
  async function paySelected() {
    if (!view || paying) return;
    const dueKeys = allOpen
      .filter((d) => selected.has(d.dueKey))
      .map((d) => d.dueKey);
    if (dueKeys.length === 0) {
      flash("Select at least one open fee");
      return;
    }
    setPaying(true);
    try {
      const res = await fetch("/api/payments/parent-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueKeys, studentId: activeRow?.student.id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        checkoutUrl?: string | null;
        shareUrl?: string;
        error?: string;
      };
      if (res.ok && json.ok && (json.checkoutUrl || json.shareUrl)) {
        window.location.href = json.checkoutUrl || json.shareUrl!;
        return;
      }
      flash(json.error || "Could not start payment — try again");
    } catch {
      flash("Could not start payment — check connection and try again");
    } finally {
      setPaying(false);
    }
  }

  function renderGroups(groups: ReturnType<typeof groupDuesByMonth>) {
    return (
      <>
        {groups.map((g) => (
          <section
            key={g.monthKey}
            className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.1)] bg-white"
          >
            <div className="flex items-center justify-between border-b border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.04)] px-3 py-2">
              <span className="text-xs font-bold text-[var(--brand-deep)]">
                {g.monthLabel}
              </span>
              <span className="text-[11px] font-semibold tabular-nums text-[var(--muted)]">
                {formatInr(g.totalPaise)} open
              </span>
            </div>
            <ul className="divide-y divide-[rgba(32,48,80,0.06)]">
              {g.dues.map((d) => {
                const paid = d.balancePaise <= 0 && d.paidPaise > 0;
                const later = isRest(d);
                const checked = selected.has(d.dueKey);
                return (
                  <li
                    key={d.dueKey}
                    data-due-kind={d.kind}
                    data-due-month={g.monthKey}
                    data-paid={paid ? "1" : "0"}
                    data-due-now={!paid && !later ? "1" : "0"}
                  >
                    <label
                      className={`flex cursor-pointer items-start gap-2.5 px-3 py-2.5 ${
                        paid ? "bg-[rgba(15,122,76,0.05)]" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={paid || later}
                        checked={checked && !paid && !later}
                        onChange={() => toggleDue(d)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--brand-deep)]">
                          {d.feeHeadName || d.label}
                          {paid ? (
                            <span className="ml-1.5 text-[10px] font-semibold uppercase text-[var(--success)]">
                              Paid
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-[10px] text-[var(--muted)]">
                          {formatParentDueHint(d)}
                        </div>
                        {d.concessionDetails?.length ? (
                          <ul className="mt-1 space-y-0.5 text-[10px] text-[var(--success)]">
                            {d.concessionDetails.map((c) => (
                              <li key={`${d.dueKey}-${c.grantId}`}>
                                Discount · {formatConcessionDetailLine(c)}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                      <div
                        className={`shrink-0 text-sm font-bold tabular-nums ${
                          paid
                            ? "text-[var(--success)]"
                            : "text-[var(--brand-deep)]"
                        }`}
                      >
                        {formatInr(paid ? 0 : d.balancePaise)}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </>
    );
  }

  if (query.isPending) {
    return (
      <div
        className="mx-auto max-w-lg px-4 py-12 text-center md:max-w-2xl lg:max-w-3xl"
        role="status"
      >
        <p className="text-sm text-[var(--muted)]">Loading your fees…</p>
      </div>
    );
  }

  if (!view) {
    // A failed read. Never "no household" and never ₹0: the family's dues are
    // unknown, so the page says so and offers to ask again.
    return (
      <div
        className="mx-auto max-w-lg px-4 py-12 text-center md:max-w-2xl lg:max-w-3xl"
        role="alert"
        data-testid="parent-fees-error"
      >
        <p className="text-base font-semibold text-[var(--brand-deep)]">
          Could not load your fees
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {query.error?.message || "Please check your connection."}
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            className="btn-accent rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? "Trying…" : "Try again"}
          </button>
          <button
            type="button"
            className="text-sm underline"
            onClick={onSignOut}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const household = { guardianName: view.guardianName || guardianDisplayName };

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col pb-28 md:max-w-2xl lg:max-w-3xl">
      <header className="sticky top-0 z-20 border-b border-[rgba(32,48,80,0.1)] bg-[rgba(246,245,239,0.92)] px-4 py-3 backdrop-blur-md">
        <div className="flex items-start gap-3">
          <Image
            src={TENANT.logoCrestUrl}
            alt=""
            width={44}
            height={46}
            className="logo-mark object-contain"
            priority
          />
          <div className="min-w-0 flex-1">
            <p className="font-brand-name text-[15px] leading-tight text-[var(--brand-deep)]">
              {TENANT.nameDisplay}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Parent fees · {household.guardianName}
            </p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="shrink-0 rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
          >
            Sign out
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-3 py-2.5 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              Due now
            </div>
            <div
              className="text-sm font-extrabold tabular-nums text-[var(--brand-deep)]"
              data-testid="parent-due-now"
            >
              {formatInr(view.dueNowPaise)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              Rest of the year
            </div>
            <div
              className="text-sm font-bold tabular-nums text-[var(--muted)]"
              data-testid="parent-rest-of-year"
            >
              {formatInr(view.restOfYearPaise)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              Discount
            </div>
            <div className="text-sm font-bold tabular-nums text-[var(--success)]">
              {householdTotals.concessionPaise > 0
                ? `−${formatInr(householdTotals.concessionPaise)}`
                : "—"}
            </div>
          </div>
        </div>

        <ModuleTabs
          aria-label="Parent fees"
          className="!mt-3"
          value={tab}
          onChange={(id) => setTab(id as "dues" | "receipts")}
          items={[
            { id: "dues", label: "Fees due", tone: "coral" },
            { id: "receipts", label: "Receipts", tone: "green" },
          ]}
        />
      </header>

      {notice ? (
        <p className="mx-4 mt-3 rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-xs font-medium text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <main className="flex-1 px-4 pt-4">
        {tab === "dues" ? (
          <>
            {bundle.length > 1 ? (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {bundle.map((row) => {
                  const on = row.student.id === activeRow?.student.id;
                  const due = parentOpenDueTotals(
                    row.dues.filter(
                      (d) => d.balancePaise > 0 && dueNowSet.has(d.dueKey),
                    ),
                  ).balancePaise;
                  return (
                    <button
                      key={row.student.id}
                      type="button"
                      data-student-id={row.student.id}
                      aria-pressed={on}
                      onClick={() => setActiveStudentId(row.student.id)}
                      className={`shrink-0 rounded-xl border px-3 py-2 text-left ${
                        on
                          ? "border-[rgba(197,160,40,0.55)] bg-white"
                          : "border-[rgba(32,48,80,0.1)] bg-white/70"
                      }`}
                    >
                      <div className="text-xs font-semibold text-[var(--brand-deep)]">
                        {row.student.fullName.split(" ")[0]}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {formatInr(due)}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="mb-3 flex justify-end">
              <FilterExportButtons
                title="Parent fees due"
                subtitle={`${TENANT.shortName} · ${household.guardianName}`}
                filterNote={describeFilters([
                  activeRow
                    ? `${activeRow.student.fullName} · ${activeRow.student.classLabel}`
                    : "Household",
                  "Open + paid lines on card",
                ])}
                fileBaseName="parent_fees"
                columns={[
                  { key: "student", header: "Student", width: 1.2 },
                  { key: "head", header: "Particulars", width: 1.5 },
                  { key: "dueOn", header: "Due", width: 0.9 },
                  {
                    key: "billed",
                    header: "Billed",
                    width: 0.9,
                    align: "right",
                  },
                  {
                    key: "discount",
                    header: "Discount",
                    width: 0.9,
                    align: "right",
                  },
                  {
                    key: "balance",
                    header: "To pay",
                    width: 0.9,
                    align: "right",
                  },
                ]}
                rows={(activeRow?.dues ?? []).map((d) => ({
                  student: activeRow?.student.fullName ?? "",
                  head: d.feeHeadName || d.label,
                  dueOn: d.dueOn,
                  billed: formatInr(d.billedPaise),
                  discount:
                    d.concessionPaise > 0
                      ? `−${formatInr(d.concessionPaise)}`
                      : "—",
                  balance: formatInr(d.balancePaise),
                }))}
                onMessage={flash}
              />
            </div>

            {activeRow ? (
              <section className="mb-3 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h2 className="text-base font-semibold text-[var(--brand-deep)]">
                        {activeRow.student.fullName}
                      </h2>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {activeRow.student.classLabel} · Adm{" "}
                      {activeRow.student.admissionNo || "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[var(--brand-mid)]"
                    onClick={() => selectOpenForStudent(activeRow.student.id)}
                  >
                    Select all due now
                  </button>
                </div>
              </section>
            ) : null}

            {monthGroups.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[rgba(32,48,80,0.2)] bg-white px-4 py-10 text-center text-sm text-[var(--muted)]">
                No fee lines for this student yet.
              </p>
            ) : (
              <div className="space-y-3">{renderGroups(monthGroups)}</div>
            )}

            {restGroups.length > 0 ? (
              <section className="mt-6" data-testid="parent-rest-of-year-list">
                <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                  Rest of the year
                </h3>
                <p className="mb-2 text-[11px] text-[var(--muted)]">
                  Not due yet — not part of the amount to pay now.
                </p>
                <div className="space-y-3 opacity-80">
                  {renderGroups(restGroups)}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <div className="space-y-2">
            {receipts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[rgba(32,48,80,0.2)] bg-white px-4 py-10 text-center text-sm text-[var(--muted)]">
                No receipts yet.
              </p>
            ) : (
              receipts.map((v) => (
                <article
                  key={v.id}
                  className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-[var(--brand-deep)]">
                        {v.receiptNo}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {v.collectionDate} · {v.cashierName}
                      </div>
                    </div>
                    <div className="text-sm font-bold tabular-nums text-[var(--brand-deep)]">
                      {formatInr(v.totalPaise)}
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1 border-t border-[rgba(32,48,80,0.06)] pt-2 text-[11px] text-[var(--muted)]">
                    {v.lines.slice(0, 6).map((l) => (
                      <li
                        key={`${v.id}-${l.dueKey}`}
                        className="flex justify-between gap-2"
                      >
                        <span className="min-w-0 truncate">
                          {l.studentName}: {l.label}
                        </span>
                        <span className="shrink-0 tabular-nums font-semibold text-[var(--brand-deep)]">
                          {formatInr(l.amountPaise)}
                        </span>
                      </li>
                    ))}
                    {v.lines.length > 6 ? (
                      <li>+{v.lines.length - 6} more</li>
                    ) : null}
                    {v.lines.some((l) => (l.concessionPaise ?? 0) > 0) ? (
                      <li className="font-medium text-[var(--success)]">
                        Includes approved discounts on collected heads
                      </li>
                    ) : null}
                  </ul>
                </article>
              ))
            )}
          </div>
        )}
      </main>

      {tab === "dues" ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[rgba(32,48,80,0.12)] bg-[rgba(246,245,239,0.96)] px-4 py-3 backdrop-blur-md">
          <div className="mx-auto flex max-w-lg items-center gap-3 md:max-w-2xl lg:max-w-3xl">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                Selected
              </div>
              <div className="text-lg font-extrabold tabular-nums text-[var(--brand-deep)]">
                {formatInr(selectedTotal)}
              </div>
            </div>
            {selected.size > 0 ? (
              <button
                type="button"
                className="text-[11px] font-semibold text-[var(--muted)]"
                onClick={clearSelection}
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              disabled={selectedTotal <= 0 || paying}
              onClick={() => void paySelected()}
              className="btn-accent rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
            >
              {paying ? "Opening GPay / UPI…" : "Pay with GPay / UPI"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
