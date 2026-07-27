"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { loadMasters, currentAcademicYearCode, type MastersState } from "@/lib/masters";
import {
  loadSalarySetup,
  normalizeSalarySettings,
} from "@/lib/salarySetup";
import {
  approvePayrollRun,
  auditDraftRebuilt,
  buildPayrollDraft,
  currentMonthIso,
  deletePayrollRun,
  downloadTextFile,
  formatInr,
  isPayrollEditable,
  isPayrollLocked,
  listPayrollAudit,
  loadPayroll,
  markPayrollPaid,
  mergePreservedAdjustments,
  monthHasCommittedRun,
  payrollAuditActionLabel,
  payrollStatusLabel,
  payrollTallyCsv,
  paymentModeLabel,
  PAYROLL_PAYMENT_MODES,
  processPayrollDraft,
  publishPayrollToAccounts,
  recallPayrollToDraft,
  rejectPayrollRun,
  removeDraftStaffLine,
  submitPayrollForApproval,
  updateDraftLineAdjustments,
  updateDraftLineComponent,
  upsertPayrollRun,
  type PayrollAuditEntry,
  type PayrollPaymentMode,
  type PayrollRun,
  type PayrollStaffLine,
} from "@/lib/payroll";
import {
  liveEntriesForRun,
  salaryAccountCsv,
} from "@/lib/salaryAccount";
import { outstandingForStaff } from "@/lib/staffAdvance";
import {
  canApprovePayroll,
  canManagePayroll,
  resolveSessionStaff,
} from "@/lib/staffResolve";
import { loadIncrementState } from "@/lib/salaryIncrement";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { JuneHoldPanel } from "@/components/payroll/JuneHoldPanel";
import { StatutoryRemitPanel } from "@/components/payroll/StatutoryRemitPanel";
import { IncrementPanel } from "@/components/payroll/IncrementPanel";
import { AdvancesPanel } from "@/components/payroll/AdvancesPanel";
import { PrintPayslipsPanel } from "@/components/payroll/PrintPayslipsPanel";
import { PayrollReportsPanel } from "@/components/payroll/PayrollReportsPanel";
import { BankFileExportPanel } from "@/components/payroll/BankFileExportPanel";
import { TallySyncPanel } from "@/components/payroll/TallySyncPanel";
import { ApprovalsInboxPanel } from "@/components/payroll/ApprovalsInboxPanel";
import {
  StaffMyAdvances,
  StaffMyPayslips,
} from "@/components/payroll/StaffSelfService";

type PayTab =
  | "dashboard"
  | "runs"
  | "detail"
  | "payslips"
  | "print"
  | "reports"
  | "bank"
  | "tally"
  | "approvals"
  | "audit"
  | "holds"
  | "govt"
  | "increment"
  | "advances"
  | "mine"
  | "myAdvances";

export function PayrollWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const ay = session.academicYearCode || currentAcademicYearCode();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [tab, setTab] = useState<PayTab>("dashboard");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: PayTab[] = [
      "dashboard",
      "runs",
      "detail",
      "payslips",
      "print",
      "reports",
      "bank",
      "tally",
      "approvals",
      "audit",
      "holds",
      "govt",
      "increment",
      "advances",
      "mine",
      "myAdvances",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as PayTab);
  }, []);
  const [month, setMonth] = useState(currentMonthIso);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [slipStaffId, setSlipStaffId] = useState("");
  const [processStaffId, setProcessStaffId] = useState("");
  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null);

  useEffect(() => {
    setMasters(loadMasters());
    setRuns(loadPayroll().runs);
  }, [tick]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const [
        { ensurePayrollHydrated },
        { ensureStaffAttendanceHydrated },
        { ensureStaffHrHydrated },
        { ensureStaffAdvancesHydrated },
      ] = await Promise.all([
        import("@/lib/payrollPersistence"),
        import("@/lib/staffAttendancePersistence"),
        import("@/lib/staffHrPersistence"),
        import("@/lib/staffAdvancesPersistence"),
      ]);
      await Promise.all([
        ensurePayrollHydrated(),
        ensureStaffAttendanceHydrated(),
        ensureStaffHrHydrated(),
        ensureStaffAdvancesHydrated(),
      ]);
      setTick((t) => t + 1);
    })();
  }, []);

  const allowed = useMemo(() => {
    if (!masters) return false;
    return canManagePayroll(session, masters);
  }, [masters, session]);

  const isApprover = useMemo(() => {
    if (!masters) return false;
    return canApprovePayroll(session, masters);
  }, [masters, session]);

  const selfStaff = useMemo(() => {
    if (!masters) return null;
    return resolveSessionStaff(session, masters);
  }, [masters, session]);

  const selected = runs.find((r) => r.id === selectedId) ?? null;

  const processStaffOptions = useMemo(
    () =>
      (masters?.staff ?? [])
        .filter((s) => s.status === "active")
        .sort((a, b) => a.empCode.localeCompare(b.empCode)),
    [masters],
  );

  function flash(msg: string, isErr = false) {
    if (isErr) {
      setError(msg);
      setNotice(null);
    } else {
      setNotice(msg);
      setError(null);
    }
    window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, 3200);
  }

  function refresh() {
    setTick((n) => n + 1);
  }

  function processBulk(replace = false) {
    if (!masters || !allowed) return;
    const r = processPayrollDraft({
      masters,
      month,
      academicYearCode: ay,
      createdBy: session.fullName,
      mode: "bulk",
      replaceExistingDraft: replace,
    });
    if (!r.ok) {
      if (r.error.includes("confirm replace")) {
        if (
          window.confirm(
            "Replace the existing draft for this month with a fresh bulk calculation?",
          )
        ) {
          processBulk(true);
        }
        return;
      }
      flash(r.error, true);
      return;
    }
    setSelectedId(r.run.id);
    setTab("detail");
    flash(
      `Bulk draft ${month}: ${r.run.lines.length} staff — not in accounts until published`,
    );
    refresh();
  }

  function processIndividual() {
    if (!masters || !allowed) return;
    if (!processStaffId) {
      flash("Select a staff member", true);
      return;
    }
    const r = processPayrollDraft({
      masters,
      month,
      academicYearCode: ay,
      createdBy: session.fullName,
      mode: "individual",
      staffIds: [processStaffId],
    });
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    setSelectedId(r.run.id);
    setTab("detail");
    flash(
      r.merged
        ? `Merged staff into draft — still editable, not in accounts`
        : `Individual draft for ${month} — edit freely until publish`,
    );
    refresh();
  }

  function onSubmit(note?: string) {
    if (!selected) return;
    const r = submitPayrollForApproval(
      selected.id,
      session.fullName,
      note || "",
    );
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash("Submitted for Principal approval");
    setSelectedId(r.run.id);
    setTab("approvals");
    refresh();
  }

  function onApprove(note?: string) {
    if (!selected) return;
    if (!isApprover) {
      flash("Only Principal / Admin can approve", true);
      return;
    }
    const r = approvePayrollRun(selected.id, session.fullName, note || "");
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash("Approved — still not in accounts until you publish");
    setSelectedId(r.run.id);
    refresh();
  }

  function onReject(reason: string) {
    if (!selected) return;
    if (!isApprover) {
      flash("Only Principal / Admin can reject", true);
      return;
    }
    const r = rejectPayrollRun(selected.id, session.fullName, reason);
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash("Rejected — returned to draft");
    setSelectedId(r.run.id);
    refresh();
  }

  function onPublish() {
    if (!selected) return;
    if (
      !window.confirm(
        "Publish to salary account? This posts payables, PF/ESIC remittance, and June holds. Draft edits will lock.",
      )
    ) {
      return;
    }
    const r = publishPayrollToAccounts(
      selected.id,
      session.fullName,
      selected.lockVersion || 0,
    );
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash("Published to salary account");
    setSelectedId(r.run.id);
    refresh();
  }

  function onRecall() {
    if (!selected) return;
    if (
      !window.confirm(
        selected.status === "posted"
          ? "Recall posted run to draft? Salary account entries for this run will be voided."
          : "Recall to draft for further edits?",
      )
    ) {
      return;
    }
    const r = recallPayrollToDraft(selected.id, session.fullName);
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash("Recalled to draft — accounts unchanged / voided for this run");
    setSelectedId(r.run.id);
    refresh();
  }

  function onPaid() {
    if (!selected) return;
    const r = markPayrollPaid(selected.id, session.fullName);
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash("Marked as paid");
    setSelectedId(r.run.id);
    refresh();
  }

  function onDelete() {
    if (!selected) return;
    if (!deletePayrollRun(selected.id, session.fullName)) {
      flash("Only draft / pending runs can be deleted", true);
      return;
    }
    flash("Run deleted");
    setSelectedId(null);
    setTab("runs");
    refresh();
  }

  function onExport() {
    if (!selected) return;
    const salary = loadSalarySetup();
    const label =
      normalizeSalarySettings(salary.settings).salaryAccountLabel ||
      "Salary account";
    const csv = payrollTallyCsv(selected, label);
    downloadTextFile(`payroll_${selected.month}_${selected.status}.csv`, csv);
    flash(
      selected.status === "posted" || selected.status === "paid"
        ? "Account CSV downloaded"
        : "Preview CSV (draft — not posted to accounts)",
    );
  }

  function onExportAccountLedger() {
    if (!selected) return;
    if (selected.status !== "posted" && selected.status !== "paid") {
      flash("Publish to salary account first", true);
      return;
    }
    const entries = liveEntriesForRun(selected.id);
    downloadTextFile(
      `salary_account_${selected.month}.csv`,
      salaryAccountCsv(entries),
    );
    flash("Salary account ledger CSV downloaded");
  }

  function rebuildDraft() {
    if (!masters || !selected || selected.status !== "draft") return;
    const prevByStaff = new Map(
      selected.lines.map((l) => [l.staffId, l] as const),
    );
    const run = buildPayrollDraft({
      masters,
      month: selected.month,
      academicYearCode: selected.academicYearCode,
      createdBy: session.fullName,
      dayCountOverride: selected.dayCount,
      staffIds:
        selected.kind === "individual"
          ? selected.lines.map((l) => l.staffId)
          : undefined,
      kind: selected.kind,
    });
    const lines = run.lines.map((l) =>
      mergePreservedAdjustments(l, prevByStaff.get(l.staffId)),
    );
    const next = {
      ...run,
      id: selected.id,
      createdBy: selected.createdBy,
      createdAt: selected.createdAt,
      remark: selected.remark,
      kind: selected.kind,
      lines,
    };
    upsertPayrollRun(next);
    auditDraftRebuilt(next, session.fullName);
    flash("Draft rebuilt — bonus / advance / payment fields kept");
    refresh();
  }

  function onRemoveLine(staffId: string) {
    if (!selected) return;
    const r = removeDraftStaffLine(selected.id, staffId, session.fullName);
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash("Staff removed from draft");
    refresh();
  }

  function onEditComponent(
    staffId: string,
    headCode: string,
    amount: number,
  ) {
    if (!selected) return;
    const r = updateDraftLineComponent(
      selected.id,
      staffId,
      headCode,
      amount,
      session.fullName,
    );
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    refresh();
  }

  function onEditAdjustments(
    staffId: string,
    patch: Parameters<typeof updateDraftLineAdjustments>[2],
  ) {
    if (!selected) return;
    const r = updateDraftLineAdjustments(
      selected.id,
      staffId,
      patch,
      session.fullName,
    );
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    refresh();
  }

  const pendingCount = useMemo(() => {
    void tick;
    const pay = runs.filter((r) => r.status === "pending_approval").length;
    const inc = loadIncrementState().batches.filter(
      (b) =>
        b.academicYearCode === ay && b.status === "pending_approval",
    ).length;
    return pay + inc;
  }, [runs, ay, tick]);

  const tabs: {
    id: PayTab;
    label: string;
    tone: "navy" | "teal" | "amber" | "violet" | "coral" | "slate" | "green";
  }[] = allowed
      ? [
          { id: "dashboard", label: "Dashboard", tone: "navy" },
          { id: "runs", label: "Runs", tone: "navy" },
          { id: "detail", label: "Run detail", tone: "teal" },
          {
            id: "approvals",
            label:
              pendingCount > 0
                ? `Approvals (${pendingCount})`
                : "Approvals",
            tone: "coral",
          },
          { id: "holds", label: "June holds", tone: "coral" },
          { id: "govt", label: "PF/ESIC govt", tone: "slate" },
          { id: "increment", label: "Increment", tone: "violet" },
          { id: "advances", label: "Advances", tone: "teal" },
          { id: "payslips", label: "Payslips", tone: "amber" },
          { id: "print", label: "Print payslips", tone: "navy" },
          { id: "reports", label: "Reports", tone: "slate" },
          { id: "bank", label: "Bank file", tone: "green" },
          { id: "tally", label: "Tally sync", tone: "slate" },
          { id: "audit", label: "Audit", tone: "coral" },
          { id: "mine", label: "My payslip", tone: "violet" },
          { id: "myAdvances", label: "My advances", tone: "teal" },
        ]
      : [
          { id: "mine", label: "My payslip", tone: "violet" },
          { id: "myAdvances", label: "My advances", tone: "teal" },
        ];

  useEffect(() => {
    if (!allowed && tab !== "mine" && tab !== "myAdvances") setTab("mine");
  }, [allowed, tab]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--brand-deep)]">
            {allowed ? "Payroll" : "My salary"}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {allowed ? (
              <>
                Salary run from attendance, leave & holiday policy · Draft until
                publish (accounts untouched) · Admin / Principal ·{" "}
                <Link
                  href="/masters"
                  className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                >
                  Masters → Salary setup
                </Link>
              </>
            ) : (
              <>
                View and print your payslips · Check advance balance and salary
                recoveries
              </>
            )}
          </p>
        </div>
        {pendingCount > 0 && allowed ? (
          <div className="rounded-lg border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.12)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)]">
            {pendingCount} item(s) pending approval
          </div>
        ) : null}
      </div>

      {notice ? (
        <p className="text-sm font-medium text-[var(--brand-deep)]">{notice}</p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-[#b42318]">{error}</p>
      ) : null}

      {!allowed ? (
        <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3 text-sm text-[var(--muted)]">
          Staff self-service — payslips and advances for{" "}
          <strong className="text-[var(--brand-deep)]">
            {selfStaff?.fullName || "your linked staff profile"}
          </strong>
          . Contact office for corrections.
        </p>
      ) : null}

      <ModuleTabs
        aria-label="Payroll"
        value={tab}
        onChange={(id) => setTab(id as PayTab)}
        items={tabs}
      />

      {tab === "dashboard" && allowed ? (
        <ModuleDashboardHost
          moduleId="payroll"
          onNavigateTab={(t) => setTab(t as PayTab)}
        />
      ) : null}

      {tab === "runs" && allowed ? (
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <p className="text-xs text-[var(--muted)]">
            Process salary as <strong>draft</strong> (bulk or individual). Edit
            freely until you <strong>publish to salary account</strong> — draft
            never changes accounts. Approved/posted months are locked (one
            committed run per month).
          </p>
          {(() => {
            const committed = monthHasCommittedRun(month, ay);
            return committed ? (
              <p className="mt-2 rounded-lg bg-[rgba(180,35,24,0.08)] px-2.5 py-1.5 text-[11px] font-medium text-[#b42318]">
                {month} is already {payrollStatusLabel(committed.status)} —
                recall that run before creating a new draft.
              </p>
            ) : null;
          })()}
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-semibold text-[var(--muted)]">
                Month
                <input
                  type="month"
                  className="field mt-1 !py-2"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
                onClick={() => processBulk(false)}
              >
                Process bulk draft
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-3 border-t border-[rgba(32,48,80,0.08)] pt-3">
              <label className="text-xs font-semibold text-[var(--muted)]">
                Individual staff
                <select
                  className="field mt-1 min-w-[220px] !py-2"
                  value={processStaffId}
                  onChange={(e) => setProcessStaffId(e.target.value)}
                >
                  <option value="">Select staff…</option>
                  {processStaffOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.empCode} — {s.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] bg-white px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
                onClick={processIndividual}
              >
                Process individual draft
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[rgba(32,48,80,0.1)] text-[11px] text-[var(--muted)]">
                  <th className="px-4 py-2.5 font-medium">Month</th>
                  <th className="px-4 py-2.5 font-medium">Kind</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Staff</th>
                  <th className="px-4 py-2.5 font-medium">Net total</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {runs
                  .filter((r) => r.academicYearCode === ay)
                  .map((r) => {
                    const net = r.lines.reduce((s, l) => s + l.netPay, 0);
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-[rgba(32,48,80,0.06)]"
                      >
                        <td className="px-4 py-2.5 font-semibold text-[var(--brand-deep)]">
                          {r.month}
                        </td>
                        <td className="px-4 py-2.5 capitalize text-[var(--muted)]">
                          {r.kind || "bulk"}
                        </td>
                        <td className="px-4 py-2.5">
                          {payrollStatusLabel(r.status)}
                        </td>
                        <td className="px-4 py-2.5">{r.lines.length}</td>
                        <td className="px-4 py-2.5">{formatInr(net)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            className="text-[11px] font-semibold"
                            onClick={() => {
                              setSelectedId(r.id);
                              setTab("detail");
                            }}
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                {runs.filter((r) => r.academicYearCode === ay).length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-sm text-[var(--muted)]"
                    >
                      No payroll drafts yet — process bulk or individual for the
                      month.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "detail" && allowed ? (
        selected ? (
          <RunDetail
            run={selected}
            editable={isPayrollEditable(selected) && !readOnly}
            expandedStaffId={expandedStaffId}
            setExpandedStaffId={setExpandedStaffId}
            onSubmit={onSubmit}
            onApprove={onApprove}
            onReject={onReject}
            canApprove={isApprover && !readOnly}
            onPublish={onPublish}
            onRecall={onRecall}
            onPaid={onPaid}
            onDelete={onDelete}
            onExport={onExport}
            onExportAccount={onExportAccountLedger}
            onRebuild={rebuildDraft}
            onRemoveLine={onRemoveLine}
            onEditComponent={onEditComponent}
            onEditAdjustments={onEditAdjustments}
            readOnly={readOnly}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Select a run from the Runs tab.
          </p>
        )
      ) : null}

      {tab === "approvals" && allowed ? (
        <ApprovalsInboxPanel
          academicYearCode={ay}
          onOpenPayrollRun={(id) => {
            setSelectedId(id);
            setTab("detail");
          }}
        />
      ) : null}

      {tab === "payslips" && allowed ? (
        <PayslipsAdmin
          runs={runs.filter(
            (r) =>
              r.academicYearCode === ay &&
              (r.status === "approved" ||
                r.status === "posted" ||
                r.status === "paid"),
          )}
          masters={masters}
          slipStaffId={slipStaffId}
          setSlipStaffId={setSlipStaffId}
        />
      ) : null}

      {tab === "print" && allowed ? (
        <PrintPayslipsPanel academicYearCode={ay} />
      ) : null}

      {tab === "reports" && allowed ? (
        <PayrollReportsPanel academicYearCode={ay} />
      ) : null}

      {tab === "bank" && allowed ? (
        <BankFileExportPanel academicYearCode={ay} />
      ) : null}

      {tab === "tally" && allowed ? (
        <TallySyncPanel academicYearCode={ay} />
      ) : null}

      {tab === "audit" && allowed ? <PayrollAuditPanel /> : null}

      {tab === "holds" && allowed ? <JuneHoldPanel /> : null}

      {tab === "govt" && allowed ? <StatutoryRemitPanel /> : null}

      {tab === "increment" && allowed ? (
        <IncrementPanel mode="full" />
      ) : null}

      {tab === "advances" && allowed ? <AdvancesPanel /> : null}

      {tab === "mine" ? (
        <StaffMyPayslips staffId={selfStaff?.id || ""} />
      ) : null}

      {tab === "myAdvances" ? (
        <StaffMyAdvances staffId={selfStaff?.id || ""} />
      ) : null}
    </div>
  );
}

function RunDetail({
  run,
  editable,
  expandedStaffId,
  setExpandedStaffId,
  onSubmit,
  onApprove,
  onReject,
  canApprove,
  onPublish,
  onRecall,
  onPaid,
  onDelete,
  onExport,
  onExportAccount,
  onRebuild,
  onRemoveLine,
  onEditComponent,
  onEditAdjustments,
  readOnly = false,
}: {
  run: PayrollRun;
  editable: boolean;
  expandedStaffId: string | null;
  setExpandedStaffId: (id: string | null) => void;
  onSubmit: (note?: string) => void;
  onApprove: (note?: string) => void;
  onReject: (reason: string) => void;
  canApprove: boolean;
  onPublish: () => void;
  onRecall: () => void;
  onPaid: () => void;
  onDelete: () => void;
  onExport: () => void;
  onExportAccount: () => void;
  onRebuild: () => void;
  onRemoveLine: (staffId: string) => void;
  onEditComponent: (staffId: string, headCode: string, amount: number) => void;
  onEditAdjustments: (
    staffId: string,
    patch: Parameters<typeof updateDraftLineAdjustments>[2],
  ) => void;
  readOnly?: boolean;
}) {
  const [workflowNote, setWorkflowNote] = useState("");
  const net = run.lines.reduce((s, l) => s + l.netPay, 0);
  const payable = run.lines.reduce(
    (s, l) => s + (l.amountPayable ?? (l.juneHold ? 0 : l.netPay)),
    0,
  );
  const held = run.lines.reduce(
    (s, l) => s + (l.juneHold ? l.netPay : 0),
    0,
  );
  const govtPf = run.lines.reduce((s, l) => s + (l.pfGovtDeposit || 0), 0);
  const govtEsic = run.lines.reduce((s, l) => s + (l.esicGovtDeposit || 0), 0);
  const gross = run.lines.reduce((s, l) => s + l.gross, 0);
  const inAccounts = run.status === "posted" || run.status === "paid";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--brand-deep)]">
            {run.month} · {payrollStatusLabel(run.status)}
          </h2>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            {run.kind === "individual" ? "Individual" : "Bulk"} · Day count{" "}
            {run.dayCount} · lock v{run.lockVersion || 0} · Gross{" "}
            {formatInr(gross)} · Computed net {formatInr(net)} · Payable now{" "}
            {formatInr(payable)}
            {held > 0 ? ` · Held ${formatInr(held)}` : ""}
            {govtPf + govtEsic > 0
              ? ` · Govt deposit PF ${formatInr(govtPf)} + ESIC ${formatInr(govtEsic)}`
              : ""}{" "}
            · {run.lines.length} staff
            {run.submittedBy
              ? ` · Submitted by ${run.submittedBy}`
              : ""}
            {run.approvedBy ? ` · Approved by ${run.approvedBy}` : ""}
            {run.postedBy
              ? ` · Posted by ${run.postedBy} (${run.postedAt.slice(0, 10)})`
              : ""}
            {run.paidBy
              ? ` · Paid by ${run.paidBy} (${(run.paidAt || "").slice(0, 10)})`
              : ""}
          </p>
          {run.rejectionNote ? (
            <p className="mt-2 rounded-lg bg-[rgba(180,35,24,0.1)] px-2.5 py-1.5 text-[11px] font-medium text-[#b42318]">
              Last rejection
              {run.rejectedBy ? ` by ${run.rejectedBy}` : ""}:{" "}
              {run.rejectionNote}
            </p>
          ) : null}
          {run.submissionNote && run.status === "pending_approval" ? (
            <p className="mt-2 rounded-lg bg-[rgba(32,48,80,0.06)] px-2.5 py-1.5 text-[11px] text-[var(--brand-deep)]">
              Submission note: {run.submissionNote}
            </p>
          ) : null}
          {isPayrollLocked(run) ? (
            <p className="mt-2 rounded-lg bg-[rgba(32,48,80,0.06)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--brand-deep)]">
              Locked — line amounts cannot change. Recall to draft to edit
              (posted runs void account entries).
            </p>
          ) : null}
          {!inAccounts ? (
            <p className="mt-2 rounded-lg bg-[rgba(197,160,40,0.14)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--brand-deep)]">
              Not in salary account yet — edit draft freely. Publish after
              approval to post payables / PF-ESIC / holds.
            </p>
          ) : (
            <p className="mt-2 rounded-lg bg-[rgba(15,118,110,0.12)] px-2.5 py-1.5 text-[11px] font-medium text-teal-900">
              Posted to salary account. Recall to draft voids these entries if
              you need changes.
            </p>
          )}
          {(run.status === "draft" ||
            run.status === "pending_approval") && (
            <label className="mt-3 block text-xs font-semibold text-[var(--muted)]">
              Workflow note
              <textarea
                className="field mt-1 min-h-[52px] w-full max-w-md !py-2 text-xs"
                value={workflowNote}
                onChange={(e) => setWorkflowNote(e.target.value)}
                placeholder={
                  run.status === "draft"
                    ? "Optional note when submitting"
                    : "Approve comment or rejection reason"
                }
              />
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {run.status === "draft" ? (
            <>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-1.5 text-[11px] font-semibold"
                onClick={onRebuild}
              >
                Rebuild
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-2.5 py-1.5 text-[11px] font-semibold text-white"
                onClick={() => onSubmit(workflowNote)}
              >
                Submit for approval
              </button>
              {canApprove ? (
                <button
                  type="button"
                  className="rounded-lg bg-[#15803d] px-2.5 py-1.5 text-[11px] font-semibold text-white"
                  onClick={() => onApprove(workflowNote)}
                >
                  Approve now
                </button>
              ) : null}
            </>
          ) : null}
          {run.status === "pending_approval" ? (
            <>
              {canApprove ? (
                <>
                  <button
                    type="button"
                    className="rounded-lg bg-[#15803d] px-2.5 py-1.5 text-[11px] font-semibold text-white"
                    onClick={() => onApprove(workflowNote)}
                  >
                    Principal approve
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[#b42318]/40] px-2.5 py-1.5 text-[11px] font-semibold text-[#b42318]"
                    onClick={() => {
                      if (!workflowNote.trim()) {
                        window.alert("Enter a rejection reason in the note box");
                        return;
                      }
                      onReject(workflowNote.trim());
                    }}
                  >
                    Reject
                  </button>
                </>
              ) : (
                <span className="rounded-lg bg-[rgba(197,160,40,0.14)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--brand-deep)]">
                  Awaiting Principal / Admin
                </span>
              )}
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-1.5 text-[11px] font-semibold"
                onClick={onRecall}
              >
                Withdraw to draft
              </button>
            </>
          ) : null}
          {run.status === "approved" ? (
            <>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                disabled={readOnly}
                onClick={onPublish}
              >
                {readOnly ? "Read-only session" : "Publish to salary account"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-1.5 text-[11px] font-semibold"
                onClick={onRecall}
              >
                Recall to draft
              </button>
            </>
          ) : null}
          {run.status === "posted" ? (
            <>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-2.5 py-1.5 text-[11px] font-semibold text-white"
                onClick={onPaid}
              >
                Mark paid
              </button>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-1.5 text-[11px] font-semibold"
                onClick={onRecall}
              >
                Recall (void account)
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-1.5 text-[11px] font-semibold"
            onClick={onExport}
          >
            Preview CSV
          </button>
          {inAccounts ? (
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-1.5 text-[11px] font-semibold"
              onClick={onExportAccount}
            >
              Account ledger CSV
            </button>
          ) : null}
          {run.status === "draft" || run.status === "pending_approval" ? (
            <button
              type="button"
              className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[#b42318]"
              onClick={onDelete}
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead>
            <tr className="border-b border-[rgba(32,48,80,0.1)] text-[11px] text-[var(--muted)]">
              <th className="px-3 py-2 font-medium">Staff</th>
              <th className="px-3 py-2 font-medium">P / A / HD / LWP</th>
              <th className="px-3 py-2 font-medium">Gross</th>
              <th className="px-3 py-2 font-medium">Net</th>
              <th className="px-3 py-2 font-medium">Payable</th>
              <th className="px-3 py-2 font-medium">Govt PF/ESIC</th>
              <th className="px-3 py-2 font-medium">Hold</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {run.lines.map((l) => {
              const open = expandedStaffId === l.staffId;
              const lockedDue = editable
                ? outstandingForStaff(l.staffId)
                : l.advanceTaken || 0;
              return (
                <Fragment key={l.staffId}>
                  <tr className="border-b border-[rgba(32,48,80,0.06)]">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-[var(--brand-deep)]">
                        {l.fullName}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {l.empCode} · {l.structureName}
                        {l.stream === "teaching" ? " · teaching" : ""}
                        {lockedDue > 0
                          ? ` · adv due ${formatInr(lockedDue)}`
                          : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[var(--muted)]">
                      {l.daysPresent}/{l.daysAbsent}/{l.daysHalf}/{l.daysLwp}
                    </td>
                    <td className="px-3 py-2">{formatInr(l.gross)}</td>
                    <td className="px-3 py-2">{formatInr(l.netPay)}</td>
                    <td className="px-3 py-2 font-semibold">
                      {editable ? (
                        <input
                          type="number"
                          className="field w-24 !py-1 !text-xs"
                          value={
                            l.amountPayable ?? (l.juneHold ? 0 : l.netPay)
                          }
                          onChange={(e) =>
                            onEditAdjustments(l.staffId, {
                              amountPayable: Number(e.target.value) || 0,
                            })
                          }
                        />
                      ) : (
                        formatInr(
                          l.amountPayable ?? (l.juneHold ? 0 : l.netPay),
                        )
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[var(--muted)]">
                      {(l.pfGovtDeposit || 0) + (l.esicGovtDeposit || 0) > 0
                        ? `${formatInr(l.pfGovtDeposit || 0)} / ${formatInr(l.esicGovtDeposit || 0)}`
                        : "—"}
                      {(l.bonus || 0) > 0 ||
                      (l.specialDeduction || 0) > 0 ||
                      (l.advanceDeduct || 0) > 0 ||
                      (l.advanceNewWithSalary || 0) > 0 ? (
                        <span className="mt-0.5 block text-[10px]">
                          {(l.bonus || 0) > 0
                            ? `+bonus ${formatInr(l.bonus)} `
                            : ""}
                          {(l.specialDeduction || 0) > 0
                            ? `−ded ${formatInr(l.specialDeduction)} `
                            : ""}
                          {(l.advanceDeduct || 0) > 0
                            ? `−adv ${formatInr(l.advanceDeduct)} `
                            : ""}
                          {(l.advanceNewWithSalary || 0) > 0
                            ? `+new adv ${formatInr(l.advanceNewWithSalary)}`
                            : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[var(--muted)]">
                      {l.juneHold
                        ? l.eligibleForJuneDraw === false
                          ? "Held · not drawable"
                          : "Held (June)"
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-[var(--brand-deep)]"
                        onClick={() =>
                          setExpandedStaffId(open ? null : l.staffId)
                        }
                      >
                        {editable ? "Adjust / pay" : "Details"}
                      </button>
                      {editable ? (
                        <button
                          type="button"
                          className="ml-2 text-[11px] font-semibold text-[#b42318]"
                          onClick={() => onRemoveLine(l.staffId)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {open ? (
                    <tr className="border-b border-[rgba(32,48,80,0.06)] bg-[rgba(32,48,80,0.02)]">
                      <td colSpan={8} className="px-3 py-3">
                        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <label className="text-[10px] font-semibold text-[var(--muted)]">
                            Bonus (this month)
                            {editable ? (
                              <input
                                type="number"
                                min={0}
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.bonus || 0}
                                onChange={(e) =>
                                  onEditAdjustments(l.staffId, {
                                    bonus: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            ) : (
                              <span className="mt-0.5 block text-xs text-[var(--brand-deep)]">
                                {formatInr(l.bonus || 0)}
                              </span>
                            )}
                          </label>
                          <label className="text-[10px] font-semibold text-[var(--muted)]">
                            Special deduction
                            {editable ? (
                              <input
                                type="number"
                                min={0}
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.specialDeduction || 0}
                                onChange={(e) =>
                                  onEditAdjustments(l.staffId, {
                                    specialDeduction:
                                      Number(e.target.value) || 0,
                                  })
                                }
                              />
                            ) : (
                              <span className="mt-0.5 block text-xs text-[var(--brand-deep)]">
                                {formatInr(l.specialDeduction || 0)}
                              </span>
                            )}
                          </label>
                          <label className="text-[10px] font-semibold text-[var(--muted)] sm:col-span-2">
                            Deduction reason / label
                            {editable ? (
                              <input
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.specialDeductionLabel || ""}
                                placeholder="e.g. Uniform, fine, lost property"
                                onChange={(e) =>
                                  onEditAdjustments(l.staffId, {
                                    specialDeductionLabel: e.target.value,
                                  })
                                }
                              />
                            ) : (
                              <span className="mt-0.5 block text-xs text-[var(--brand-deep)]">
                                {l.specialDeductionLabel || "—"}
                              </span>
                            )}
                          </label>
                          <label className="text-[10px] font-semibold text-[var(--muted)]">
                            Advance outstanding (locked)
                            <span className="mt-0.5 block rounded border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.04)] px-2 py-1.5 text-xs font-semibold text-[var(--brand-deep)]">
                              {formatInr(lockedDue)}
                            </span>
                            <span className="mt-0.5 block text-[10px] font-normal">
                              Total due from Advances ledger
                            </span>
                          </label>
                          <label className="text-[10px] font-semibold text-[var(--muted)]">
                            Advance deduct this month
                            {editable ? (
                              <input
                                type="number"
                                min={0}
                                max={lockedDue}
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.advanceDeduct || 0}
                                onChange={(e) =>
                                  onEditAdjustments(l.staffId, {
                                    advanceDeduct: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            ) : (
                              <span className="mt-0.5 block text-xs text-[var(--brand-deep)]">
                                {formatInr(l.advanceDeduct || 0)}
                              </span>
                            )}
                            <span className="mt-0.5 block text-[10px] font-normal">
                              Max {formatInr(lockedDue)}
                            </span>
                          </label>
                          <label className="text-[10px] font-semibold text-[var(--muted)]">
                            New advance with salary
                            {editable ? (
                              <input
                                type="number"
                                min={0}
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.advanceNewWithSalary || 0}
                                onChange={(e) =>
                                  onEditAdjustments(l.staffId, {
                                    advanceNewWithSalary:
                                      Number(e.target.value) || 0,
                                  })
                                }
                              />
                            ) : (
                              <span className="mt-0.5 block text-xs text-[var(--brand-deep)]">
                                {formatInr(l.advanceNewWithSalary || 0)}
                              </span>
                            )}
                            <span className="mt-0.5 block text-[10px] font-normal">
                              Extra paid with salary · posts to ledger on publish
                            </span>
                          </label>
                          <label className="text-[10px] font-semibold text-[var(--muted)]">
                            Payment date
                            {editable ? (
                              <input
                                type="date"
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.paymentDate || ""}
                                onChange={(e) =>
                                  onEditAdjustments(l.staffId, {
                                    paymentDate: e.target.value,
                                  })
                                }
                              />
                            ) : (
                              <span className="mt-0.5 block text-xs text-[var(--brand-deep)]">
                                {l.paymentDate || "—"}
                              </span>
                            )}
                          </label>
                          <label className="text-[10px] font-semibold text-[var(--muted)]">
                            Payment mode
                            {editable ? (
                              <select
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.paymentMode || "bank_transfer"}
                                onChange={(e) =>
                                  onEditAdjustments(l.staffId, {
                                    paymentMode: e.target
                                      .value as PayrollPaymentMode,
                                  })
                                }
                              >
                                {PAYROLL_PAYMENT_MODES.map((m) => (
                                  <option key={m.value} value={m.value}>
                                    {m.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="mt-0.5 block text-xs text-[var(--brand-deep)]">
                                {paymentModeLabel(
                                  l.paymentMode || "bank_transfer",
                                )}
                              </span>
                            )}
                          </label>
                          <label className="text-[10px] font-semibold text-[var(--muted)] sm:col-span-2 lg:col-span-4">
                            Notes
                            {editable ? (
                              <input
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.note || ""}
                                placeholder="Any note for this staff / month"
                                onChange={(e) =>
                                  onEditAdjustments(l.staffId, {
                                    note: e.target.value,
                                  })
                                }
                              />
                            ) : (
                              <span className="mt-0.5 block text-xs text-[var(--brand-deep)]">
                                {l.note || "—"}
                              </span>
                            )}
                          </label>
                        </div>
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                          Salary heads
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {l.components.map((c) => (
                            <label
                              key={`${c.headCode}-${c.kind}`}
                              className="text-[10px] font-semibold text-[var(--muted)]"
                            >
                              {c.headName} ({c.kind})
                              {editable &&
                              c.headCode !== "BONUS" &&
                              c.headCode !== "SPECIAL_DED" &&
                              c.headCode !== "ADVANCE" ? (
                                <input
                                  type="number"
                                  className="field mt-0.5 !py-1 !text-xs"
                                  value={c.amount}
                                  onChange={(e) =>
                                    onEditComponent(
                                      l.staffId,
                                      c.headCode,
                                      Number(e.target.value) || 0,
                                    )
                                  }
                                />
                              ) : (
                                <span className="mt-0.5 block text-xs font-medium text-[var(--brand-deep)]">
                                  {formatInr(c.amount)}
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayslipsAdmin({
  runs,
  masters,
  slipStaffId,
  setSlipStaffId,
}: {
  runs: PayrollRun[];
  masters: MastersState | null;
  slipStaffId: string;
  setSlipStaffId: (id: string) => void;
}) {
  const roster = (masters?.staff ?? [])
    .filter((s) => s.status === "active")
    .sort((a, b) => a.empCode.localeCompare(b.empCode));

  const slips =
    slipStaffId && runs.length
      ? runs
          .map((r) => {
            const line = r.lines.find((l) => l.staffId === slipStaffId);
            return line ? { run: r, line } : null;
          })
          .filter(Boolean)
      : [];

  return (
    <div className="space-y-4">
      <label className="block max-w-md text-xs font-semibold text-[var(--muted)]">
        Staff
        <select
          className="field mt-1 !py-2"
          value={slipStaffId}
          onChange={(e) => setSlipStaffId(e.target.value)}
        >
          <option value="">Select staff</option>
          {roster.map((s) => (
            <option key={s.id} value={s.id}>
              {s.empCode} — {s.fullName}
            </option>
          ))}
        </select>
      </label>
      {slips.map((item) =>
        item ? (
          <PayslipCard
            key={`${item.run.id}-${item.line.staffId}`}
            run={item.run}
            line={item.line}
          />
        ) : null,
      )}
      {slipStaffId && slips.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No approved payslips for this staff yet.
        </p>
      ) : null}
    </div>
  );
}

function PayslipCard({
  run,
  line,
}: {
  run: PayrollRun;
  line: PayrollStaffLine;
}) {
  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-[var(--brand-deep)]">
            Payslip · {run.month}
          </h3>
          <p className="text-[11px] text-[var(--muted)]">
            {line.fullName} ({line.empCode}) · {payrollStatusLabel(run.status)}
          </p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-[var(--brand-deep)]">
            {formatInr(line.netPay)}
          </div>
          <div className="text-[10px] text-[var(--muted)]">Net pay</div>
        </div>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-[var(--muted)]">
            Earnings
          </h4>
          <ul className="mt-1 space-y-0.5 text-sm">
            {line.components
              .filter((c) => c.kind === "earning")
              .map((c) => (
                <li key={c.headCode} className="flex justify-between">
                  <span>{c.headName}</span>
                  <span>{formatInr(c.amount)}</span>
                </li>
              ))}
          </ul>
        </div>
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-[var(--muted)]">
            Deductions
          </h4>
          <ul className="mt-1 space-y-0.5 text-sm">
            {line.components
              .filter((c) => c.kind === "deduction")
              .map((c) => (
                <li
                  key={c.headCode}
                  className="flex justify-between text-[#b42318]"
                >
                  <span>{c.headName}</span>
                  <span>−{formatInr(c.amount)}</span>
                </li>
              ))}
          </ul>
          {(line.pfGovtDeposit || 0) + (line.esicGovtDeposit || 0) > 0 ? (
            <p className="mt-2 text-[10px] text-[var(--muted)]">
              PF {formatInr(line.pfGovtDeposit || 0)} + ESIC{" "}
              {formatInr(line.esicGovtDeposit || 0)} (EE+ER) → deposit to
              Government, not paid as salary.
            </p>
          ) : null}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-[var(--muted)]">
        Attendance: P {line.daysPresent} · A {line.daysAbsent} · HD{" "}
        {line.daysHalf} · holiday {line.daysHoliday} · LWP days{" "}
        {line.daysLwp}
        {line.juneHold
          ? ` · June hold — payable now ${formatInr(line.amountPayable ?? 0)}`
          : ""}
      </p>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        Payable {formatInr(line.amountPayable ?? line.netPay)}
        {line.paymentDate
          ? ` · Pay date ${line.paymentDate}`
          : ""}
        {line.paymentMode
          ? ` · ${paymentModeLabel(line.paymentMode)}`
          : ""}
        {(line.advanceTaken || 0) > 0 ||
        (line.advanceDeduct || 0) > 0 ||
        (line.advanceNewWithSalary || 0) > 0
          ? ` · Adv due ${formatInr(line.advanceTaken || 0)}; deduct ${formatInr(line.advanceDeduct || 0)}${(line.advanceNewWithSalary || 0) > 0 ? `; new with salary ${formatInr(line.advanceNewWithSalary)}` : ""}`
          : ""}
        {line.note ? ` · Note: ${line.note}` : ""}
      </p>
    </div>
  );
}

function PayrollAuditPanel() {
  const [rows, setRows] = useState<PayrollAuditEntry[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setRows(listPayrollAudit(100));
  }, [tick]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <div>
          <h2 className="font-display text-lg font-bold text-[var(--brand-deep)]">
            Payroll audit log
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Who created, approved, published, recalled, or paid — locked runs
            cannot be edited without recall.
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-[rgba(32,48,80,0.18)] px-3 py-1.5 text-xs font-semibold"
          onClick={() => setTick((n) => n + 1)}
        >
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[rgba(32,48,80,0.1)] text-[var(--muted)]">
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">Who</th>
              <th className="px-3 py-2 font-semibold">Action</th>
              <th className="px-3 py-2 font-semibold">Month</th>
              <th className="px-3 py-2 font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr
                key={e.id}
                className="border-b border-[rgba(32,48,80,0.06)]"
              >
                <td className="px-3 py-2 whitespace-nowrap">
                  {e.at.replace("T", " ").slice(0, 19)}
                </td>
                <td className="px-3 py-2">{e.by}</td>
                <td className="px-3 py-2 font-semibold text-[var(--brand-deep)]">
                  {payrollAuditActionLabel(e.action)}
                </td>
                <td className="px-3 py-2">{e.month}</td>
                <td className="px-3 py-2 text-[var(--muted)]">{e.detail}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-sm text-[var(--muted)]"
                >
                  No audit events yet — process or publish a payroll run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
