"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  computeHouseholdDues,
  formatConcessionDetailLine,
  formatInr,
  groupDuesByMonth,
  loadFees,
  openFeeDues,
  type CollectionVoucher,
  type FeeDueLine,
} from "@/lib/fees";
import {
  DEFAULT_AY,
  currentAcademicYearCode,
  loadMasters,
} from "@/lib/masters";
import {
  classLabelForStudent,
  formatParentDueHint,
  householdReceipts,
  parentOpenDueTotals,
  resolveParentHousehold,
} from "@/lib/parentPortal";
import {
  buildEnrichedPaymentSharePayload,
  buildPaymentShareUrl,
  createPaymentLink,
} from "@/lib/payments";
import { loadSis, type Household, type SisStudent } from "@/lib/sis";
import { getPaymentGatewayConfig } from "@/lib/paymentGateway";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { FilterExportButtons } from "@/components/reports/FilterExportButtons";
import { describeFilters } from "@/lib/reportExport";
import { TENANT } from "@/lib/types";

type Tab = "dues" | "receipts";

export function ParentFeesPortal({
  guardianDisplayName,
  onSignOut,
}: {
  guardianDisplayName: string;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("dues");
  const [household, setHousehold] = useState<Household | null>(null);
  const [bundle, setBundle] = useState<
    { student: SisStudent; dues: FeeDueLine[] }[]
  >([]);
  const [receipts, setReceipts] = useState<CollectionVoucher[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [tick, setTick] = useState(0);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function reload() {
    const sis = loadSis();
    const masters = loadMasters();
    const fees = loadFees();
    const hh = resolveParentHousehold(sis, {
      guardianName: guardianDisplayName,
      mobile: "9876543210",
    });
    setHousehold(hh);
    if (!hh) {
      setBundle([]);
      setReceipts([]);
      return;
    }
    // Scoped to the running session. A promoted child keeps one student
    // row per academic year, all of them still "active", so without this
    // the parent sees each of their children listed once per year they
    // have attended and a family balance several times the real one.
    const rows = computeHouseholdDues(hh.id, sis, masters, fees, {
      includeFuture: true,
      includePaid: true,
      academicYearCode: currentAcademicYearCode(masters),
    });
    setBundle(rows);
    setReceipts(householdReceipts(hh.id, fees));
    setActiveStudentId((prev) => {
      if (prev && rows.some((r) => r.student.id === prev)) return prev;
      return rows[0]?.student.id ?? null;
    });
  }

  useEffect(() => {
    reload();
  }, [guardianDisplayName, tick]);

  const activeRow = useMemo(
    () => bundle.find((r) => r.student.id === activeStudentId) ?? bundle[0],
    [bundle, activeStudentId],
  );

  const allOpen = useMemo(
    () => bundle.flatMap((r) => openFeeDues(r.dues)),
    [bundle],
  );

  const householdTotals = useMemo(
    () => parentOpenDueTotals(allOpen),
    [allOpen],
  );

  const monthGroups = useMemo(() => {
    if (!activeRow) return [];
    return groupDuesByMonth(activeRow.dues);
  }, [activeRow]);

  const selectedTotal = useMemo(() => {
    let t = 0;
    for (const d of allOpen) {
      if (selected.has(d.dueKey)) t += d.balancePaise;
    }
    return t;
  }, [allOpen, selected]);

  function toggleDue(d: FeeDueLine) {
    if (d.balancePaise <= 0) return;
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
      for (const d of openFeeDues(row.dues)) next.add(d.dueKey);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function paySelected() {
    if (!household || paying) return;
    const dues = allOpen.filter((d) => selected.has(d.dueKey));
    if (dues.length === 0) {
      flash("Select at least one open fee");
      return;
    }
    setPaying(true);
    try {
      // Live gateway: the server recomputes the dues, creates the link, and
      // attaches the hosted checkout. The demo instant-settle below must
      // never run when real money is being collected.
      if (getPaymentGatewayConfig().mode !== "demo") {
        try {
          const res = await fetch("/api/payments/parent-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dueKeys: [...selected],
              studentId: activeStudentId,
            }),
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
        }
        return;
      }

      const masters = loadMasters();
      const primary =
        bundle.find((r) => r.student.id === activeStudentId)?.student ??
        bundle[0]?.student;
      if (!primary) {
        flash("No student on this household");
        return;
      }
      const created = createPaymentLink({
        householdId: household.id,
        studentId: primary.id,
        studentName:
          dues.length === 1
            ? dues[0]!.studentId === primary.id
              ? primary.fullName
              : dues[0]!.label
            : `${household.guardianName} · family`,
        classLabel: classLabelForStudent(primary, masters),
        dues,
        createdBy: guardianDisplayName || "Parent",
        note: "Parent portal",
      });
      if (!created.ok) {
        flash(created.error);
        return;
      }
      try {
        const res = await fetch("/api/payments/parent-pay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            linkId: created.link.id,
            code: created.link.code,
            sendWhatsApp: true,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          receiptNo?: string;
        };
        if (res.ok && json.receiptNo) {
          flash(
            `Paid ${formatInr(created.link.amountPaise)} · ${json.receiptNo}`,
          );
          setSelected(new Set());
          setTick((x) => x + 1);
          setTab("receipts");
          return;
        }
      } catch {
        /* fall through */
      }
      const url = buildPaymentShareUrl(
        buildEnrichedPaymentSharePayload(created.link, TENANT.shortName),
      );
      window.location.href = url;
    } finally {
      setPaying(false);
    }
  }

  if (!household) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center md:max-w-2xl lg:max-w-3xl">
        <p className="text-sm text-[var(--muted)]">
          No household linked for this parent demo. Open staff portal and check
          SIS households.
        </p>
        <button
          type="button"
          className="mt-4 text-sm underline"
          onClick={onSignOut}
        >
          Sign out
        </button>
      </div>
    );
  }

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
              Billed
            </div>
            <div className="text-sm font-bold tabular-nums text-[var(--brand-deep)]">
              {formatInr(householdTotals.billedPaise)}
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
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              To pay
            </div>
            <div className="text-sm font-extrabold tabular-nums text-[var(--brand-deep)]">
              {formatInr(householdTotals.balancePaise)}
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
                  const due = parentOpenDueTotals(row.dues).balancePaise;
                  return (
                    <button
                      key={row.student.id}
                      type="button"
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
                    ? `${activeRow.student.fullName} · ${classLabelForStudent(activeRow.student)}`
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
                        <StudentNameLabel student={activeRow.student} />
                      </h2>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {classLabelForStudent(activeRow.student)} · Adm{" "}
                      {activeRow.student.admissionNo || "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[var(--brand-mid)]"
                    onClick={() => selectOpenForStudent(activeRow.student.id)}
                  >
                    Select all open
                  </button>
                </div>
              </section>
            ) : null}

            {monthGroups.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[rgba(32,48,80,0.2)] bg-white px-4 py-10 text-center text-sm text-[var(--muted)]">
                No fee lines for this student yet.
              </p>
            ) : (
              <div className="space-y-3">
                {monthGroups.map((g) => (
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
                        const checked = selected.has(d.dueKey);
                        return (
                          <li key={d.dueKey}>
                            <label
                              className={`flex cursor-pointer items-start gap-2.5 px-3 py-2.5 ${
                                paid ? "bg-[rgba(15,122,76,0.05)]" : ""
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="mt-1"
                                disabled={paid}
                                checked={checked && !paid}
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
                                        Discount ·{" "}
                                        {formatConcessionDetailLine(c)}
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
              </div>
            )}
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
