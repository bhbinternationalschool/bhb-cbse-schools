"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccessData } from "@/components/shell/useAccessData";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { pushToast } from "@/components/shell/Toast";
import { isVisitingStaff } from "@/lib/visitingPay";
import { currentAcademicYearCode, type MastersState } from "@/lib/masters";
import { QueryError } from "@/components/data/QueryError";
import { useScreenMasters } from "@/components/data/useScreenMasters";
import type { StaffRecord } from "@/lib/foundationMasters";
import { UpiPayButton, type UpiPaid } from "@/components/payments/UpiPayButton";
import { recordUpiProof, useRecordedUpiProofs } from "@/lib/upiProofsClient";
import { PayoutButton } from "@/components/payments/PayoutButton";
import { StaffCashgramButton } from "@/components/payments/StaffCashgramButton";
import { useStaffCashgrams, type CashgramRefundView } from "@/lib/cashgramClient";
import { cashgramIsDead } from "@/lib/cashgram";
import { PayoutSwitchPanel } from "@/components/payments/PayoutSwitchPanel";
import {
  loadSalarySetup,
  normalizeSalarySettings,
} from "@/lib/salarySetup";
import { buildSalaryRegister, salaryRegisterTitle } from "@/lib/payrollRegister";
import {
  isOnPayroll,
  notOnPayrollLines,
  type PayrollLeftOutEntry,
} from "@/lib/payrollNotOnPayroll";
import {
  NotOnPayrollBadge,
  NotOnPayrollLeftOut,
  NotOnPayrollRunBanner,
} from "@/components/payroll/NotOnPayrollNotices";
import { downloadPdfReport, downloadXlsxReport } from "@/lib/reportExport";
import { TENANT } from "@/lib/types";
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
  markPayrollLinesPaid,
  unmarkPayrollLinePaid,
  recordPayrollLinePayment,
  payrollRunPaymentDate,
  todayIstDate,
  mergePreservedAdjustments,
  committedStaffInMonth,
  payrollAuditActionLabel,
  payrollStatusLabel,
  payrollTallyCsv,
  paymentModeLabel,
  PAYROLL_PAYMENT_MODES,
  processPayrollDraft,
  publishPayrollToAccounts,
  recallPayrollToDraft,
  payrollRecallBlockedReason,
  previewDraftSetupSync,
  applyDraftSetupSync,
  runSetupWarnings,
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
import { advancePickRowsForStaff, outstandingByStaff } from "@/lib/staffAdvance";
import {
  clampAdvanceDeduct,
  lineAdvancePicks,
  pickedAdvanceTotal,
} from "@/lib/payrollAdvancePick";
import { AdvancePickNote } from "@/components/payroll/AdvancePickNote";
import { DraftDateInput, DraftNumberInput, DraftTextInput } from "@/components/ui/draft-inputs";
import {
  canApprovePayroll,
  canManagePayroll,
  canManageStaffAdvances,
  canViewStaffAdvancesDesk,
  resolveSessionStaff,
} from "@/lib/staffResolve";
import { loadIncrementState } from "@/lib/salaryIncrement";
import { canSeeModuleTab } from "@/lib/rbac";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { filterPickItems, pushRecentPick, readRecentPicks, RECENT_GROUP } from "@/lib/pickerSearch";
import { StepChainGuide, type StepDef } from "@/components/ui/StepTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { MonthGroupedTbody, useMonthGroups } from "@/components/ui/month-grouped-rows";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";
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
import { RowActionMenu } from "@/components/ui/erp-grid";
import { describeBookState, postRunInBook, recallRunInBook } from "@/lib/payrollBookClient";
import { payrollPaidProgress, payrollPaidStatusLabel } from "@/lib/payrollPayGroups";
import { setupSyncTotals, type SetupSyncRow } from "@/lib/payrollSetupSync";

/**
 * One month's salary, in order: make the run, check it, get it approved,
 * then pay and record it. The tabs stay as they are; a guide over them
 * says which step this is and what comes next.
 */
/** Recent-picks key for the individual-run staff checklist (lib/pickerSearch). */
const INDIVIDUAL_RUN_RECENT = "payroll.individualRun.staff";

const PAYROLL_CYCLE_STEPS: StepDef<PayTab>[] = [
  { id: "runs", title: "Runs", what: "Start the month's payroll run (a draft) from the assigned salary structures, attendance and leave." },
  { id: "detail", title: "Run detail", what: "Check every staff line — days, earnings, deductions, advances — then submit the run." },
  { id: "approvals", title: "Approvals", what: "The approver approves the submitted run, or returns it for correction." },
  { id: "payslips", title: "Payslips", what: "Each staff member's payslip for the approved month." },
  { id: "print", title: "Print payslips", what: "Print or share the payslips in bulk." },
  { id: "bank", title: "Bank file", what: "Make the bank upload file (NEFT) for the net salaries." },
  { id: "tally", title: "Tally sync", what: "Send the month's salary entries to Tally." },
];

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
  // The server's Masters (statutory setup) + the access copy's full staff
  // records (salary links, bank, PF/ESI) — useScreenMasters. A Masters or
  // roster change reaches the open screen without a 'bhb-masters-updated'
  // listener.
  const { masters, error: mastersError, retry: retryMasters } = useScreenMasters();
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
  const [processStaffIds, setProcessStaffIds] = useState<string[]>([]);
  const [staffFilter, setStaffFilter] = useState("");
  // Staff this browser last processed individually — listed first. masters
  // is null on the server render, so the list is empty there either way.
  const [recentRunStaff, setRecentRunStaff] = useState<string[]>(() =>
    readRecentPicks(INDIVIDUAL_RUN_RECENT),
  );
  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null);
  // Runs whose server book did not take the last change (run id → what the
  // book said). Cleared when the book agrees again.
  const [bookIssues, setBookIssues] = useState<Record<string, string>>({});
  // Lines whose hand-typed head amounts the next setup rebuild resets.
  const [setupReset, setSetupReset] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    // Newest month first. The store is insertion-ordered (and a server
    // reload has no ORDER BY), so the list read in whatever order runs were
    // created or fetched (director, 8 Oct 2026: dated lists in date order).
    setRuns([...loadPayroll().runs].sort((a, b) => b.month.localeCompare(a.month) || (b.createdAt || "").localeCompare(a.createdAt || "")));
  }, [tick]);

  // Runs of this session, folded by payroll month (a month can hold several
  // runs since staff are paid in parts). The run's own month decides the
  // group, never the day it was created.
  const yearRuns = useMemo(() => runs.filter((r) => r.academicYearCode === ay), [runs, ay]);
  const runMonths = useMonthGroups({
    rows: yearRuns,
    dateOf: (r) => r.month,
    storageKey: "payroll.runs",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const [
        { ensurePayrollHydrated },
        { ensureStaffAttendanceHydrated },
        { ensureStaffHrHydrated },
        { ensureStaffAdvancesHydrated },
        { ensureStatutoryHydrated },
        { ensureSalarySetupHydrated },
        { withHydrationSlot },
      ] = await Promise.all([
        import("@/lib/payrollPersistence"),
        import("@/lib/staffAttendancePersistence"),
        import("@/lib/staffHrPersistence"),
        import("@/lib/staffAdvancesPersistence"),
        import("@/lib/statutoryPersistence"),
        import("@/lib/salarySetupPersistence"),
        import("@/lib/deskHydrateGuard"),
      ]);
      await Promise.all([
        withHydrationSlot(() => ensurePayrollHydrated()),
        withHydrationSlot(() => ensureStaffAttendanceHydrated()),
        withHydrationSlot(() => ensureStaffHrHydrated()),
        withHydrationSlot(() => ensureStaffAdvancesHydrated()),
        withHydrationSlot(() => ensureStatutoryHydrated()),
        // Salary structures/assignments — payroll runs are computed from them.
        withHydrationSlot(() => ensureSalarySetupHydrated()),
      ]);
      setTick((t) => t + 1);
    })();
  }, []);

  const allowed = useMemo(() => {
    if (!masters) return false;
    return canManagePayroll(session, masters);
  }, [masters, session]);

  const advancesDesk = useMemo(() => {
    if (!masters) return false;
    return canViewStaffAdvancesDesk(session, masters);
  }, [masters, session]);

  // Read-only payroll tabs a Payroll FUNCTION opens (Masters → Roles →
  // "Payroll runs & payslips", "Payroll audit log") for someone without the
  // whole module. Runs,
  // approvals, holds and increments write payroll and stay with the module.
  const access = useAccessData();
  const fnTabs = useMemo(() => {
    if (allowed || !access.ready) return [] as PayTab[];
    return (["payslips", "print", "reports", "audit"] as PayTab[]).filter((t) =>
      canSeeModuleTab(session, access.masters, "payroll", t, access.rbac ?? undefined),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- access.version tracks the copies
  }, [allowed, session, access.ready, access.version]);
  const seesTab = (t: PayTab) => allowed || fnTabs.includes(t);

  const advancesEdit = useMemo(() => {
    if (!masters) return false;
    return canManageStaffAdvances(session, masters);
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

  // Each line against salary setup / attendance / joining date now. This
  // rebuilds every line of the run, so it runs only on the run-detail tab and
  // only when the run, masters or the reset ticks change — it used to run on
  // EVERY render of this screen, i.e. on every keystroke in the adjust table.
  const setupRows = useMemo(
    () =>
      tab === "detail" && masters && selected
        ? previewDraftSetupSync(selected, masters, undefined, setupReset).rows
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick tracks salary setup / attendance hydration
    [tab, masters, selected, setupReset, tick],
  );

  /** Put a run a draft edit returned on screen without re-reading every store. */
  function showEditedRun(run: PayrollRun) {
    setRuns((cur) => cur.map((r) => (r.id === run.id ? run : r)));
  }

  /** The last process's "Left out" list (not on payroll / joined after the month). */
  const [leftOut, setLeftOut] = useState<PayrollLeftOutEntry[]>([]);
  // Marked not on payroll in Masters → Salary setup: shown greyed with the
  // reason, never selectable — payroll leaves them out.
  const notOnPayrollById = useMemo(() => {
    const links = loadSalarySetup().staffLinks;
    return new Map(
      links.filter((l) => !isOnPayroll(l)).map((l) => [l.staffId, l.notOnPayrollReason || ""]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick tracks salary setup hydration
  }, [tick]);

  const processStaffOptions = useMemo(
    () =>
      (masters?.staff ?? [])
        // Visiting staff are paid from their work sheet, never from payroll.
        .filter((s) => s.status === "active" && !isVisitingStaff(s))
        .sort((a, b) => a.empCode.localeCompare(b.empCode)),
    [masters],
  );

  // A refusal stays on screen until closed, in a toast wherever the page is
  // scrolled: a 3-second note at the top of the page let a refused action
  // look done (13 Oct 2026). Success notes still fade.
  // Who already has this month's salary approved / posted / paid — shown
  // ticked-off in the picker and left out of any new draft.
  const committedInMonth = useMemo(
    () => committedStaffInMonth(month, ay),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick tracks payroll writes
    [month, ay, tick],
  );
  // Every word typed must match the name, emp code or designation; the list
  // reads A→Z by name with recently processed staff on top (director,
  // 14 Oct 2026: "make easier to pick name"). Same helper as the advances
  // and account pickers — lib/pickerSearch.
  const { pickableStaff, recentShown } = useMemo(() => {
    const desig = new Map((masters?.designations ?? []).map((d) => [d.id, d.name]));
    const byId = new Map(processStaffOptions.map((st) => [st.id, st]));
    const rows = filterPickItems(
      processStaffOptions.map((st) => {
        const designation = (st.designationId && desig.get(st.designationId)) || "";
        return { id: st.id, label: st.fullName || st.empCode, sub: st.empCode, keywords: [designation] };
      }),
      staffFilter,
      recentRunStaff,
    );
    return {
      pickableStaff: rows.map((r) => byId.get(r.id)!),
      recentShown: new Set(rows.filter((r) => r.group === RECENT_GROUP).map((r) => r.id)),
    };
  }, [processStaffOptions, staffFilter, recentRunStaff, masters]);

  function flash(msg: string, isErr = false) {
    if (isErr) {
      setError(msg);
      setNotice(null);
      pushToast({ kind: "error", message: msg, durationMs: 0 });
      return;
    }
    setNotice(msg);
    setError(null);
    pushToast({ kind: "success", message: msg });
    window.setTimeout(() => setNotice(null), 3200);
  }

  function refresh() {
    setTick((n) => n + 1);
  }

  /**
   * Payroll reads attendance from this browser's copy, and a day with no
   * mark now counts as ABSENT — so a stale or failed copy would dock
   * everyone. Re-read the staff register and leave from the server before
   * every build, and refuse to build on a failed read (unknown is not
   * "absent"). Anything the office marked before this moment counts.
   */
  async function freshAttendanceForPayroll(): Promise<boolean> {
    try {
      const [att, hr, guard] = await Promise.all([
        import("@/lib/staffAttendancePersistence"),
        import("@/lib/staffHrPersistence"),
        import("@/lib/deskHydrateGuard"),
      ]);
      guard.resetDeskHydrated("staff_attendance");
      guard.resetDeskHydrated("staff_hr");
      await Promise.all([att.ensureStaffAttendanceHydrated(), hr.ensureStaffHrHydrated()]);
      if (!guard.isDeskHydrated("staff_attendance") || !guard.isDeskHydrated("staff_hr")) {
        flash(
          "Could not load the latest staff attendance / leave — payroll was NOT calculated. Check the connection and try again.",
          true,
        );
        return false;
      }
      return true;
    } catch {
      flash("Could not load the latest staff attendance — payroll was NOT calculated.", true);
      return false;
    }
  }

  function processBulk(replace = false) {
    void (async () => {
      if (await freshAttendanceForPayroll()) processBulkNow(replace);
    })();
  }

  function processBulkNow(replace = false) {
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
          processBulkNow(true);
        }
        return;
      }
      flash(r.error, true);
      return;
    }
    setLeftOut(r.leftOut);
    setSelectedId(r.run.id);
    setTab("detail");
    flash(
      `Bulk draft ${month}: ${r.run.lines.length} staff — not in accounts until published${r.skipped.length
        ? ` · skipped ${r.skipped.length} already paid/approved for ${month}: ${r.skipped.slice(0, 4).join(", ")}${r.skipped.length > 4 ? "…" : ""}`
        : ""}${r.leftOut.length
        ? ` · left out ${r.leftOut.length}: ${r.leftOut.slice(0, 4).map((e) => e.fullName).join(", ")}${r.leftOut.length > 4 ? "…" : ""} (list below)`
        : ""}`,
    );
    refresh();
  }

  function processIndividual() {
    void (async () => {
      if (await freshAttendanceForPayroll()) processIndividualNow();
    })();
  }

  function processIndividualNow() {
    if (!masters || !allowed) return;
    if (processStaffIds.length === 0) {
      flash("Select at least one staff member — nothing was created.", true);
      return;
    }
    const r = processPayrollDraft({
      masters,
      month,
      academicYearCode: ay,
      createdBy: session.fullName,
      mode: "individual",
      staffIds: processStaffIds,
    });
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    setLeftOut(r.leftOut);
    setSelectedId(r.run.id);
    setTab("detail");
    flash(
      `${
        r.merged
          ? `Added to the open ${month} draft (now ${r.run.lines.length} staff) — still editable, not in accounts`
          : `Draft for ${month}: ${r.run.lines.length} staff — edit freely until publish`
      }${r.skipped.length
        ? ` · skipped ${r.skipped.length} already paid/approved for ${month}: ${r.skipped.slice(0, 4).join(", ")}${r.skipped.length > 4 ? "…" : ""}`
        : ""}${r.leftOut.length
        ? ` · left out ${r.leftOut.length}: ${r.leftOut.slice(0, 4).map((e) => e.fullName).join(", ")}${r.leftOut.length > 4 ? "…" : ""} (list below)`
        : ""}`,
    );
    setProcessStaffIds([]);
    refresh();
  }

  /**
   * Lines with no salary setup, or not as salary setup / attendance / joining
   * dates give them now, are confirmed by name before the run moves on — never
   * a silent pass (director, 14 Oct 2026).
   */
  function confirmSetupWarnings(step: string): boolean {
    if (!selected || !masters) return true;
    const warn = runSetupWarnings(selected, masters);
    if (!warn.length) return true;
    return window.confirm(
      `${step} with ${warn.length} line(s) that differ from salary setup?\n\n${warn.slice(0, 15).join("\n")}${warn.length > 15 ? `\n… and ${warn.length - 15} more` : ""}\n\nCancel to fix them first (Run detail → Review salary setup).`,
    );
  }

  function onApplySetup(staffIds: string[], resetIds: string[] = []) {
    if (!selected || !masters) return;
    const r = applyDraftSetupSync(selected.id, staffIds, masters, session.fullName, resetIds);
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash(
      `Salary setup applied — ${r.rebuilt} line(s) rebuilt${r.removed ? ` · removed: ${r.removedWho.join("; ")}` : ""}`,
      false,
    );
    setSelectedId(r.run.id);
    refresh();
  }

  function onSubmit(note?: string) {
    if (!selected) return;
    if (!confirmSetupWarnings("Submit for approval")) return;
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
    if (!confirmSetupWarnings("Approve")) return;
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
    if (!confirmSetupWarnings("Publish to the salary account")) return;
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
    reportBook(r.run.id, "Published to salary account");
  }

  /**
   * Ask the server book what it now holds for a run (after publishing or
   * marking staff paid) and say it — the desk save's own book step is silent
   * when it fails (14 Oct 2026).
   */
  function reportBook(runId: string, lead: string) {
    void postRunInBook(runId).then((b) => {
      const said = describeBookState(b);
      flash(`${lead} · ${said}`, !b.ok);
      // The desk save's own book step swallows a refusal (a locked period,
      // say): the desk and the book then disagree until someone acts. That
      // stays on the run, not in a toast that is gone in seconds.
      const outOfStep = !b.ok || (b.payments ?? []).some((p) => p.skipped) || Boolean(b.accrual?.skipped);
      setBookIssues((m) => {
        const next = { ...m };
        if (outOfStep) next[runId] = said;
        else delete next[runId];
        return next;
      });
    });
  }

  async function onRecall() {
    if (!selected) return;
    const blocked = payrollRecallBlockedReason(selected);
    if (blocked) {
      flash(blocked, true);
      return;
    }
    if (
      !window.confirm(
        selected.status === "posted"
          ? "Recall posted run to draft? Its salary entries are reversed in the books."
          : "Recall to draft for further edits?",
      )
    ) {
      return;
    }
    // The book first: a run back in draft with its salary still in the
    // server book is what happened to July 2026. No reversal, no recall.
    let book: { reversed: { voucherNo: string; reversalNo: string }[] } | undefined;
    if (selected.status === "posted") {
      const b = await recallRunInBook(selected.id);
      if (!b.ok) {
        flash(`Not recalled — the books could not be reversed: ${b.error}. Nothing was changed.`, true);
        return;
      }
      book = { reversed: b.reversed };
    }
    const r = recallPayrollToDraft(selected.id, session.fullName, book);
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash(
      selected.status === "posted"
        ? `Recalled to draft — ${
            book?.reversed.length
              ? `reversed in the book: ${book.reversed.map((x) => `${x.voucherNo} → ${x.reversalNo}`).join(", ")}`
              : "nothing of it was in the server book"
          }; salary-account entries voided`
        : "Recalled to draft — nothing had reached the accounts",
    );
    setSelectedId(r.run.id);
    refresh();
  }

  function onPaid(paidOn: string, mode?: PayrollPaymentMode) {
    if (!selected) return;
    const r = markPayrollPaid(selected.id, session.fullName, paidOn, mode);
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash(`Marked as paid on ${paidOn}`);
    setSelectedId(r.run.id);
    refresh();
    reportBook(r.run.id, `Marked as paid on ${paidOn}`);
  }

  /** Many staff paid on one day by one means (director, 14 Oct 2026). */
  function onMarkLinesPaid(staffIds: string[], paid: { date: string; mode?: PayrollPaymentMode; ref?: string }) {
    if (!selected) return false;
    const r = markPayrollLinesPaid(selected.id, staffIds, paid, session.fullName);
    if (!r.ok) {
      flash(r.error, true);
      return false;
    }
    const lead = `${r.marked} staff marked paid on ${paid.date}${r.run.status === "paid" ? " — everyone is paid, run marked paid" : ""}`;
    flash(lead);
    setSelectedId(r.run.id);
    refresh();
    reportBook(r.run.id, lead);
    return true;
  }

  function onUnmarkLinePaid(staffId: string) {
    if (!selected) return;
    const line = selected.lines.find((l) => l.staffId === staffId);
    if (
      !window.confirm(
        `Un-mark ${line?.fullName || "this person"} as paid on ${line?.paidOn || "?"}? The book reverses that day's payment voucher and books it again for the others paid that day.`,
      )
    ) {
      return;
    }
    const r = unmarkPayrollLinePaid(selected.id, staffId, session.fullName);
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    setSelectedId(r.run.id);
    refresh();
    reportBook(r.run.id, `${line?.fullName || "Line"} un-marked`);
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

  /** One row per staff, heads as columns, totals — Excel or PDF. */
  async function onExportRegister(format: "xlsx" | "pdf") {
    if (!selected) return;
    const reg = buildSalaryRegister(selected);
    const input = {
      title: salaryRegisterTitle(selected),
      subtitle: `${TENANT.nameDisplay} · ${selected.lines.length} staff${selected.status === "draft" || selected.status === "pending_approval" ? " · DRAFT — not posted to accounts" : ""}`,
      columns: reg.columns,
      rows: [...reg.rows, reg.totals],
      fileBaseName: `salary_register_${selected.month}_${selected.status}`,
    };
    try {
      if (format === "pdf") await downloadPdfReport(input);
      else await downloadXlsxReport(input);
      flash(`Salary register ${format.toUpperCase()} downloaded`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Export failed", true);
    }
  }

  /** Tally-style ledger: one row per head per staff — for accounts import only. */
  function onExport() {
    if (!selected) return;
    const salary = loadSalarySetup();
    const label =
      normalizeSalarySettings(salary.settings).salaryAccountLabel ||
      "Salary account";
    const csv = payrollTallyCsv(selected, label);
    downloadTextFile(`payroll_ledger_${selected.month}_${selected.status}.csv`, csv);
    flash(
      selected.status === "posted" || selected.status === "paid"
        ? "Tally ledger CSV downloaded"
        : "Tally ledger CSV (draft — not posted to accounts)",
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
    void (async () => {
      if (await freshAttendanceForPayroll()) rebuildDraftNow();
    })();
  }

  function rebuildDraftNow() {
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

  /** Remove every line of the draft whose staff are not on payroll. */
  function onRemoveLines(staffIds: string[]) {
    if (!selected) return;
    // Each line on its own: one refusal does not stop the rest.
    const failed: string[] = [];
    let removed = 0;
    for (const id of staffIds) {
      const r = removeDraftStaffLine(selected.id, id, session.fullName);
      if (r.ok) removed += 1;
      else {
        const name = selected.lines.find((l) => l.staffId === id)?.fullName || id;
        failed.push(`${name}: ${r.error}`);
      }
    }
    if (failed.length) {
      flash(
        `${removed} not-on-payroll ${removed === 1 ? "line" : "lines"} removed · NOT removed: ${failed.join("; ")}`,
        true,
      );
    } else {
      flash(`${removed} not-on-payroll ${removed === 1 ? "line" : "lines"} removed from draft`);
    }
    refresh();
  }

  // `runId`: the run the edited box belongs to. A box saves after a pause or
  // when it goes away, which may be after another run was opened — so the
  // edit names its run rather than trusting whichever is selected now.
  function onEditComponent(
    staffId: string,
    headCode: string,
    amount: number,
    runId = selected?.id,
  ) {
    if (!runId) return;
    const r = updateDraftLineComponent(
      runId,
      staffId,
      headCode,
      amount,
      session.fullName,
    );
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    showEditedRun(r.run);
  }

  function onEditAdjustments(
    staffId: string,
    patch: Parameters<typeof updateDraftLineAdjustments>[2],
    runId = selected?.id,
  ) {
    if (!runId) return;
    const r = updateDraftLineAdjustments(
      runId,
      staffId,
      patch,
      session.fullName,
    );
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    showEditedRun(r.run);
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
          { id: "govt", label: "EPF/ESIC Compliance", tone: "slate" },
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
          ...(fnTabs.includes("payslips")
            ? [{ id: "payslips" as const, label: "Payslips", tone: "amber" as const }]
            : []),
          ...(fnTabs.includes("print")
            ? [{ id: "print" as const, label: "Print payslips", tone: "navy" as const }]
            : []),
          ...(fnTabs.includes("reports")
            ? [{ id: "reports" as const, label: "Reports", tone: "slate" as const }]
            : []),
          ...(fnTabs.includes("audit")
            ? [{ id: "audit" as const, label: "Audit", tone: "coral" as const }]
            : []),
          ...(advancesDesk
            ? [
                { id: "advances" as const, label: "Staff advances", tone: "teal" as const },
                { id: "myAdvances" as const, label: "My advances", tone: "teal" as const },
              ]
            : [
                { id: "mine" as const, label: "My payslip", tone: "violet" as const },
                { id: "myAdvances" as const, label: "My advances", tone: "teal" as const },
              ]),
        ];

  useEffect(() => {
    // Who may see which tab is decided from Masters (the roster): while it
    // is unknown, decide nothing — "not allowed yet" is not "not allowed".
    if (!masters) return;
    if (allowed) return;
    if (fnTabs.includes(tab)) return;
    if (fnTabs.length > 0 && tab === "dashboard") {
      setTab(fnTabs[0]!);
      return;
    }
    if (advancesDesk && tab !== "advances" && tab !== "myAdvances") {
      setTab("advances");
      return;
    }
    if (!advancesDesk && tab !== "mine" && tab !== "myAdvances") setTab("mine");
  }, [masters, allowed, advancesDesk, fnTabs, tab]);

  // A failed Masters read is a failure on screen (R6) — never "My salary" for
  // an office user because the roster could not be read.
  if (mastersError || !masters) {
    return (
      <ErpWorkspaceShell title="Payroll" icon={<Wallet className="size-6" aria-hidden />}>
        {mastersError ? (
          <QueryError what="the staff roster and statutory setup" error={mastersError} retry={retryMasters} />
        ) : (
          <p className="text-sm text-[var(--muted)]">Loading payroll…</p>
        )}
      </ErpWorkspaceShell>
    );
  }

  return (
    <ErpWorkspaceShell
      title={
        allowed ? "Payroll" : advancesDesk ? "Staff advances" : "My salary"
      }
      subtitle={
        allowed ? (
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
        ) : advancesDesk ? (
          <>
            Record staff salary advances (cash / UPI / bank) — no access to
            salary runs, bank file, or payroll publish.
          </>
        ) : (
          <>
            View and print your payslips · Check advance balance and salary
            recoveries
          </>
        )
      }
      icon={<Wallet className="size-6" aria-hidden />}
      notice={notice}
      error={error}
      actions={
        pendingCount > 0 && allowed ? (
          <div className="rounded-lg border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.12)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)]">
            {pendingCount} item(s) pending approval
          </div>
        ) : null
      }
    >
      {!allowed && !advancesDesk ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--muted)]">
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
      <StepChainGuide
        chains={[{ label: "Monthly payroll", steps: PAYROLL_CYCLE_STEPS }]}
        value={tab}
        onChange={setTab}
        visible={tabs.map((t) => t.id)}
      />

      {tab === "dashboard" && allowed ? (
        <ModuleDashboardHost
          moduleId="payroll"
          // The payroll desk loads in this screen (the hydrate effect above
          // bumps tick); the host itself never loads payroll. Until 2.1e the
          // dashboard happened to redraw on a later 'bhb-masters-updated';
          // now that this screen waits for Masters before drawing, the run
          // counts would stay at 0 without this.
          refreshKey={tick}
          onNavigateTab={(t) => setTab(t as PayTab)}
        />
      ) : null}

      {tab === "runs" && allowed ? (
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-xs text-[var(--muted)]">
            Process salary as <strong>draft</strong> — everyone at once, or
            the staff you tick. Edit freely until you{" "}
            <strong>publish to salary account</strong>; a draft never changes
            accounts. A month can be paid in parts: staff already paid for it
            are left out, so nobody is paid twice.
          </p>
          {committedInMonth.size > 0 ? (
            <p className="mt-2 rounded-lg bg-[rgba(32,48,80,0.05)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--brand-deep)]">
              {committedInMonth.size} staff already have {month} salary
              approved, posted or paid — they are skipped.{" "}
              {processStaffOptions.filter((st) => !committedInMonth.has(st.id) && !notOnPayrollById.has(st.id)).length}{" "}
              still to process.
            </p>
          ) : null}
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
                className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)]"
                onClick={() => processBulk(false)}
              >
                Process all due staff
              </button>
            </div>
            <div className="space-y-2 border-t border-[var(--border)] pt-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold text-[var(--muted)]">
                  Selected staff ({processStaffIds.length})
                </span>
                <input
                  type="search"
                  className="field !py-1.5 text-xs"
                  placeholder="Name, code or designation…"
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                />
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                  onClick={() =>
                    setProcessStaffIds(
                      pickableStaff
                        .filter((st) => !committedInMonth.has(st.id) && !notOnPayrollById.has(st.id))
                        .map((st) => st.id),
                    )
                  }
                >
                  Tick all shown
                </button>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[var(--muted)] underline-offset-2 hover:underline"
                  onClick={() => setProcessStaffIds([])}
                >
                  Clear
                </button>
              </div>
              <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2 sm:grid-cols-2 lg:grid-cols-3">
                {pickableStaff.map((st) => {
                  const done = committedInMonth.get(st.id);
                  const notOn = notOnPayrollById.get(st.id);
                  const off = !!done || notOn !== undefined;
                  return (
                    <label
                      key={st.id}
                      className={`flex items-center gap-2 text-xs ${off ? "text-[var(--muted)]" : "text-[var(--brand-deep)]"}`}
                      title={
                        done
                          ? `${month} salary already approved / posted / paid`
                          : notOn !== undefined
                            ? `Not on payroll${notOn ? ` — ${notOn}` : ""} (Masters → Salary setup)`
                            : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        disabled={off}
                        checked={!off && processStaffIds.includes(st.id)}
                        onChange={() =>
                          setProcessStaffIds((prev) =>
                            prev.includes(st.id)
                              ? prev.filter((x) => x !== st.id)
                              : [...prev, st.id],
                          )
                        }
                      />
                      <span className="min-w-0 break-words">
                        {st.fullName} — {st.empCode}
                      </span>
                      {recentShown.has(st.id) ? (
                        <span className="text-[10px] text-[var(--muted)]">· recent</span>
                      ) : null}
                      {done ? <span className="text-[10px]">· paid</span> : null}
                      {!done && notOn !== undefined ? (
                        <span className="text-[10px]">· not on payroll{notOn ? ` (${notOn})` : ""}</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-50"
                disabled={processStaffIds.length === 0}
                onClick={() => {
                  // Remember who was processed so they lead the list next time.
                  let next = recentRunStaff;
                  for (const id of [...processStaffIds].reverse()) {
                    next = pushRecentPick(INDIVIDUAL_RUN_RECENT, id, 12);
                  }
                  setRecentRunStaff(next);
                  processIndividual();
                }}
              >
                Process selected ({processStaffIds.length})
              </button>
            </div>
          </div>
          <NotOnPayrollLeftOut month={month} rows={leftOut} onClose={() => setLeftOut([])} />
          <ErpTableShell exportAs="payroll_runs" exportTitle="Payroll runs">
            <div className="overflow-x-auto">
            <ErpTable>
              <ErpTableHead>
                <tr className="text-[11px] text-[var(--muted)]">
                  <th className="px-4 py-2.5 font-medium">Month</th>
                  <th className="px-4 py-2.5 font-medium">Kind</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Staff</th>
                  <th className="px-4 py-2.5 font-medium">Net total</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </ErpTableHead>
              <MonthGroupedTbody
                month={runMonths}
                colSpan={6}
                rowKey={(r) => r.id}
                countLabel={(n) => `${n} ${n === 1 ? "run" : "runs"}`}
                summary={(rs) =>
                  `Net ${formatInr(rs.reduce((s, r) => s + r.lines.reduce((t, l) => t + l.netPay, 0), 0))}`
                }
                renderRow={(r) => {
                  const net = r.lines.reduce((s, l) => s + l.netPay, 0);
                  return (
                    <tr key={r.id}>
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
                        <RowActionMenu
                          row={r}
                          label={`Actions for run ${r.month}`}
                          actions={[
                            {
                              id: "open",
                              label: "Open run",
                              onSelect: (x) => {
                                setSelectedId(x.id);
                                setTab("detail");
                              },
                            },
                            {
                              id: "book",
                              label: "See it in the server book",
                              onSelect: () => {
                                window.location.href = "/accounts?tab=book";
                              },
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                }}
                empty={
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-sm text-[var(--muted)]"
                    >
                      No payroll drafts yet — process bulk or individual for the
                      month.
                    </td>
                  </tr>
                }
              />
            </ErpTable>
            </div>
          </ErpTableShell>
        </div>
      ) : null}

      {tab === "detail" && allowed && selected?.month === month ? (
        <NotOnPayrollLeftOut month={month} rows={leftOut} onClose={() => setLeftOut([])} />
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
            onMarkLinesPaid={onMarkLinesPaid}
            bookIssue={bookIssues[selected.id] || ""}
            setupRows={setupRows}
            setupReset={setupReset}
            setSetupReset={setSetupReset}
            onApplySetup={(ids) => {
              onApplySetup(ids, [...setupReset].filter((id) => ids.includes(id)));
              setSetupReset(new Set());
            }}
            onCheckBook={() => reportBook(selected.id, "Book checked")}
            onUnmarkLinePaid={onUnmarkLinePaid}
            onDelete={onDelete}
            onExport={onExport}
            onExportRegister={onExportRegister}
            onExportAccount={onExportAccountLedger}
            onRebuild={rebuildDraft}
            onRemoveLine={onRemoveLine}
            onRemoveLines={onRemoveLines}
            onEditComponent={onEditComponent}
            onEditAdjustments={onEditAdjustments}
            onLinePaid={(staffId, p) => {
              const r = recordPayrollLinePayment(selected.id, staffId, { mode: "upi", date: p.paidOn, ref: p.utr }, session.fullName);
              if (!r.ok) {
                flash(r.error, true);
                return;
              }
              const line = selected.lines.find((x) => x.staffId === staffId);
              // A Cashfree payout's UTR is recorded by the server already.
              if (!p.viaPayout) void recordUpiProof({
                utr: p.utr,
                amountPaise: Math.round(((line?.amountPayable ?? line?.netPay) || 0) * 100),
                paidOn: p.paidOn,
                payeeName: line?.fullName || "",
                payeeVpa: p.payeeVpa,
                targetKind: "payroll_line",
                targetId: `${selected.id}|${staffId}`,
                targetLabel: `Salary ${selected.month} — ${line?.fullName || staffId}`,
              }).then((rec) => {
                if (!rec.ok) flash(`UTR saved on the line, but: ${rec.error}`, true);
              });
              flash(`UTR ${p.utr} recorded`);
              refresh();
              reportBook(selected.id, `UTR ${p.utr} recorded`);
            }}
            staffById={(id) => masters?.staff.find((x) => x.id === id)}
            roleOf={(id) => {
              const st = masters?.staff.find((x) => x.id === id);
              return masters?.designations.find((d) => d.id === st?.designationId)?.name || "";
            }}
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

      {tab === "payslips" && seesTab("payslips") ? (
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

      {tab === "print" && seesTab("print") ? (
        <PrintPayslipsPanel academicYearCode={ay} />
      ) : null}

      {tab === "reports" && seesTab("reports") ? (
        <PayrollReportsPanel academicYearCode={ay} />
      ) : null}

      {tab === "bank" && allowed ? (
        <div className="space-y-4">
          {/* Salary by bank file, or one by one from the Cashfree wallet when
              the owner has switched it on (director, 7 Oct 2026). */}
          <PayoutSwitchPanel />
          <BankFileExportPanel academicYearCode={ay} />
        </div>
      ) : null}

      {tab === "tally" && allowed ? (
        <TallySyncPanel academicYearCode={ay} />
      ) : null}

      {tab === "audit" && seesTab("audit") ? <PayrollAuditPanel deskTick={tick} /> : null}

      {tab === "holds" && allowed ? <JuneHoldPanel /> : null}

      {tab === "govt" && allowed ? <StatutoryRemitPanel /> : null}

      {tab === "increment" && allowed ? (
        <IncrementPanel mode="full" />
      ) : null}

      {tab === "advances" && advancesDesk ? (
        <AdvancesPanel readOnly={readOnly || !advancesEdit} />
      ) : null}

      {tab === "mine" ? (
        <StaffMyPayslips staffId={selfStaff?.id || ""} />
      ) : null}

      {tab === "myAdvances" ? (
        <StaffMyAdvances staffId={selfStaff?.id || ""} />
      ) : null}
    </ErpWorkspaceShell>
  );
}

/**
 * A callback whose identity never changes but which always runs the latest
 * function — so a memoised row is not re-rendered just because its parent
 * made a new closure.
 */
function useLatestCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
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
  onMarkLinesPaid,
  onUnmarkLinePaid,
  bookIssue,
  onCheckBook,
  setupRows,
  setupReset,
  setSetupReset,
  onApplySetup,
  onDelete,
  onExport,
  onExportRegister,
  onExportAccount,
  onRebuild,
  onRemoveLine,
  onRemoveLines,
  onEditComponent,
  onEditAdjustments,
  onLinePaid,
  staffById,
  roleOf,
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
  onPaid: (paidOn: string, mode?: PayrollPaymentMode) => void;
  onMarkLinesPaid: (staffIds: string[], paid: { date: string; mode?: PayrollPaymentMode; ref?: string }) => boolean;
  onUnmarkLinePaid: (staffId: string) => void;
  /** The server book disagrees with this run ("" = in step / not checked). */
  bookIssue: string;
  onCheckBook: () => void;
  /** Each line against salary setup / attendance / joining date now. */
  setupRows: SetupSyncRow[];
  setupReset: Set<string>;
  setSetupReset: (s: Set<string>) => void;
  onApplySetup: (staffIds: string[]) => void;
  onDelete: () => void;
  onExport: () => void;
  onExportRegister: (format: "xlsx" | "pdf") => void;
  onExportAccount: () => void;
  onRebuild: () => void;
  onRemoveLine: (staffId: string) => void;
  onRemoveLines: (staffIds: string[]) => void;
  onEditComponent: (staffId: string, headCode: string, amount: number, runId: string) => void;
  onEditAdjustments: (
    staffId: string,
    patch: Parameters<typeof updateDraftLineAdjustments>[2],
    runId: string,
  ) => void;
  onLinePaid: (staffId: string, paid: UpiPaid) => void;
  staffById: (id: string) => StaffRecord | undefined;
  /** Designation name, for finding a person in the lines. */
  roleOf: (staffId: string) => string;
  readOnly?: boolean;
}) {
  const [workflowNote, setWorkflowNote] = useState("");
  // UTRs recorded for this run's salary lines — from the Pay UPI button or a
  // screenshot confirmed on WhatsApp (api/payments/upi-proofs).
  const upiPaid = useRecordedUpiProofs(
    "payroll_line",
    run.status === "posted" || run.status === "paid" ? run.lines.map((l) => `${run.id}|${l.staffId}`) : [],
    run.lockVersion || 0,
  );
  // Cashgram pay links for the same lines (director, 10 Oct 2026). A live one
  // — open or collected — stands in for every other way of paying the line.
  const [linkTick, setLinkTick] = useState(0);
  const staffLinks = useStaffCashgrams(
    run.status === "posted" || run.status === "paid" ? run.lines.map((l) => `${run.id}|${l.staffId}`) : [],
    (run.lockVersion || 0) * 1000 + linkTick,
  );
  // The day the salary was paid; empty = the lines' own date, else today.
  const [paidOnDraft, setPaidOnDraft] = useState("");
  // "" = each line's own (planned) mode.
  const [paidModeDraft, setPaidModeDraft] = useState<PayrollPaymentMode | "">("");
  // Staff ticked to mark paid together, and how (director, 14 Oct 2026:
  // "I have to pay on different dates for every staff").
  const [payPick, setPayPick] = useState<Set<string>>(() => new Set());
  const [payDate, setPayDate] = useState("");
  const [payMode, setPayMode] = useState<PayrollPaymentMode | "">("");
  const [payRef, setPayRef] = useState("");
  // Find a person in a long run by name, emp code, structure or designation.
  const [lineQuery, setLineQuery] = useState("");
  const paidProgress = payrollPaidProgress(run.lines);
  const setupById = new Map(setupRows.map((r) => [r.staffId, r]));
  const setupDiffering = setupRows.filter((r) => r.action !== "none");
  const noSetupCount = setupRows.filter((r) => r.noSetup).length;
  // The "Review salary setup" panel: which differing lines are ticked.
  const [setupOpen, setSetupOpen] = useState<Set<string> | null>(null);
  const partlyPaid = payrollPaidStatusLabel(run.status, run.lines);
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
  // Lines for staff since marked not on payroll — drafts only; a posted or
  // paid run is never touched.
  // Re-read when salary setup lands or changes (hydration finishes after
  // the run may already be on screen).
  const [setupVersion, setSetupVersion] = useState(0);
  useEffect(() => {
    const onSetup = () => setSetupVersion((v) => v + 1);
    window.addEventListener("bhb-salary-setup-updated", onSetup);
    return () => window.removeEventListener("bhb-salary-setup-updated", onSetup);
  }, []);
  const notOnPayroll = useMemo(
    () => (run.status === "draft" ? notOnPayrollLines(run.lines, loadSalarySetup().staffLinks) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setupVersion tracks salary setup writes
    [run, setupVersion],
  );
  const notOnPayrollById = new Map(notOnPayroll.map((x) => [x.staffId, x]));

  // Every line's locked "advance outstanding" from one read of the register
  // (it was read once per row on every render).
  const outstandingNow = useMemo(
    () => outstandingByStaff(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read whenever the run changes (each commit)
    [run],
  );
  // A save re-reads the whole store, so every line arrives as a new object
  // even when only one changed. Keep the previous object for an unchanged
  // line, so its memoised row does not re-render.
  const lineCache = useRef(new Map<string, { json: string; line: PayrollStaffLine }>());
  const stableLines = useMemo(() => {
    const next = new Map<string, { json: string; line: PayrollStaffLine }>();
    const out = run.lines.map((l) => {
      const json = JSON.stringify(l);
      const prev = lineCache.current.get(l.staffId);
      const keep = prev && prev.json === json ? prev.line : l;
      next.set(l.staffId, { json, line: keep });
      return keep;
    });
    lineCache.current = next;
    return out;
  }, [run.lines]);
  // Stable callbacks for the memoised rows.
  const stableEditAdjustments = useLatestCallback(onEditAdjustments);
  const stableEditComponent = useLatestCallback(onEditComponent);
  const stableRemoveLine = useLatestCallback(onRemoveLine);
  const stableUnmarkLinePaid = useLatestCallback(onUnmarkLinePaid);
  const stableLinePaid = useLatestCallback(onLinePaid);
  const onToggleOpen = useLatestCallback((staffId: string) =>
    setExpandedStaffId(expandedStaffId === staffId ? null : staffId),
  );
  const onTogglePick = useCallback((staffId: string, on: boolean) => {
    setPayPick((cur) => {
      const next = new Set(cur);
      if (on) next.add(staffId);
      else next.delete(staffId);
      return next;
    });
  }, []);
  const onOpenSetup = useCallback((staffId: string) => setSetupOpen(new Set([staffId])), []);
  const onLinkChanged = useCallback(() => setLinkTick((t) => t + 1), []);

  // Attendance renders as "22/1/0/0"; sorting that string is meaningless, so
  // the column yields days present. Gross and net sort on paise.
  const lineSort = useTableSort(
    stableLines,
    {
      staff: (l) => l.fullName,
      present: (l) => l.daysPresent,
      gross: (l) => l.gross,
      net: (l) => l.netPay,
    },
    "staff",
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--brand-deep)]">
            {run.month} · {payrollStatusLabel(run.status)}
            {partlyPaid ? ` · ${partlyPaid}` : ""}
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
            {noSetupCount ? ` · ${noSetupCount} without salary setup (no PF/ESI)` : ""}
            {run.postedBy
              ? ` · Posted by ${run.postedBy} (${run.postedAt.slice(0, 10)})`
              : ""}
            {run.paidBy
              ? ` · Paid by ${run.paidBy} (${(run.paidAt || "").slice(0, 10)})`
              : ""}
          </p>
          {run.rejectionNote ? (
            <p className="mt-2 rounded-lg bg-[var(--danger-soft)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--danger)]">
              Last rejection
              {run.rejectedBy ? ` by ${run.rejectedBy}` : ""}:{" "}
              {run.rejectionNote}
            </p>
          ) : null}
          {run.submissionNote && run.status === "pending_approval" ? (
            <p className="mt-2 rounded-lg bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[11px] text-[var(--brand-deep)]">
              Submission note: {run.submissionNote}
            </p>
          ) : null}
          {isPayrollLocked(run) ? (
            <p className="mt-2 rounded-lg bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--brand-deep)]">
              Locked — line amounts cannot change. Recall to draft to edit
              (posted runs void account entries).
            </p>
          ) : null}
          {editable ? (
            <NotOnPayrollRunBanner
              rows={notOnPayroll}
              onRemoveAll={() => onRemoveLines(notOnPayroll.map((x) => x.staffId))}
            />
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
                className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold"
                onClick={onRebuild}
              >
                Rebuild
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--primary-foreground)]"
                onClick={() => onSubmit(workflowNote)}
              >
                Submit for approval
              </button>
              {canApprove ? (
                <button
                  type="button"
                  className="rounded-lg bg-[var(--tone-green-solid)] px-2.5 py-1.5 text-[11px] font-semibold text-white"
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
                    className="rounded-lg bg-[var(--tone-green-solid)] px-2.5 py-1.5 text-[11px] font-semibold text-white"
                    onClick={() => onApprove(workflowNote)}
                  >
                    Principal approve
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--danger)]/40 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--danger)]"
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
                className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold"
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
                className="rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                disabled={readOnly}
                onClick={onPublish}
              >
                {readOnly ? "Read-only session" : "Publish to salary account"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold"
                onClick={onRecall}
              >
                Recall to draft
              </button>
            </>
          ) : null}
          {run.status === "posted" ? (
            <>
              {/* The day the salary was actually paid — the books date the
                  payment on it (not the day this button is pressed). */}
              <label className="flex items-center gap-1 text-[11px] font-semibold">
                Paid on
                <DraftDateInput
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-1.5 py-1 text-[11px]"
                  value={paidOnDraft || payrollRunPaymentDate(run) || todayIstDate()}
                  min={`${run.month}-01`}
                  max={todayIstDate()}
                  onCommit={setPaidOnDraft}
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] font-semibold">
                By
                <select
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-1.5 py-1 text-[11px]"
                  value={paidModeDraft}
                  onChange={(e) => setPaidModeDraft(e.target.value as PayrollPaymentMode | "")}
                >
                  <option value="">each line&apos;s own mode</option>
                  {PAYROLL_PAYMENT_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--primary-foreground)]"
                title="Everyone not yet marked paid, on this day. Staff paid on other days: tick them below and mark them paid on their own day."
                onClick={() => onPaid(paidOnDraft || payrollRunPaymentDate(run) || todayIstDate(), paidModeDraft || undefined)}
              >
                {paidProgress.paid ? `Mark the other ${paidProgress.payable - paidProgress.paid} paid` : "Mark all paid"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold"
                onClick={onRecall}
              >
                Recall (void account)
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-2.5 py-1.5 text-[11px] font-semibold text-white"
            onClick={() => onExportRegister("xlsx")}
            title="One row per staff, every head as a column, totals"
          >
            Register Excel
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold"
            onClick={() => onExportRegister("pdf")}
          >
            Register PDF
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--muted)]"
            onClick={onExport}
            title="One row per head per staff — for Tally / accounts import"
          >
            Tally ledger CSV
          </button>
          {inAccounts ? (
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold"
              onClick={onExportAccount}
            >
              Account ledger CSV
            </button>
          ) : null}
          {run.status === "draft" || run.status === "pending_approval" ? (
            <button
              type="button"
              className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[var(--danger)]"
              onClick={onDelete}
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>

      {setupDiffering.length || noSetupCount ? (
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-[var(--brand-deep)]">
              {setupDiffering.length
                ? `${setupDiffering.length} line(s) differ from salary setup`
                : "Salary setup"}
              {noSetupCount ? ` · ${noSetupCount} without salary setup (PF/ESI not applied — set it up in Masters → Salary setup)` : ""}
            </span>
            {editable && setupDiffering.length ? (
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 font-semibold"
                onClick={() => setSetupOpen(setupOpen ? null : new Set(setupDiffering.map((r) => r.staffId)))}
              >
                {setupOpen ? "Close" : "Review salary setup"}
              </button>
            ) : null}
            {!editable && setupDiffering.length ? (
              <span className="text-[var(--muted)]">Recall to draft to rebuild these lines.</span>
            ) : null}
          </div>
          {setupOpen && editable ? (
            <SetupSyncPanel
              rows={setupDiffering}
              all={setupRows}
              picked={setupOpen}
              setPicked={setSetupOpen}
              reset={setupReset}
              setReset={setSetupReset}
              onApply={(ids) => {
                const chosen = setupDiffering.filter((r) => ids.includes(r.staffId));
                const t = setupSyncTotals(chosen, setupRows.map((r) => r.before));
                if (
                  !window.confirm(
                    `Rebuild ${chosen.filter((r) => r.action === "rebuild").length} line(s) from salary setup${chosen.some((r) => r.action === "remove") ? ` and remove ${chosen.filter((r) => r.action === "remove").length} not in ${run.month}` : ""}?\n\nRun net ${formatInr(t.before.net)} → ${formatInr(t.after.net)} · employer cost ${formatInr(t.before.employer)} → ${formatInr(t.after.employer)}.\nBonus, special deductions, advances and payment details on these lines are kept.`,
                  )
                ) {
                  return;
                }
                onApplySetup(ids);
                setSetupOpen(null);
              }}
            />
          ) : null}
        </div>
      ) : null}

      {inAccounts && bookIssue ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-[11px] font-medium text-[var(--danger)]">
          <span className="font-bold">Book out of step with this run.</span>
          <span className="min-w-0 flex-1">{bookIssue}</span>
          <button
            type="button"
            className="rounded-lg border border-[var(--danger)]/40 px-2.5 py-1 font-semibold"
            onClick={onCheckBook}
          >
            Check the book again
          </button>
        </div>
      ) : inAccounts && !readOnly ? (
        <button
          type="button"
          className="self-start text-[11px] font-semibold text-[var(--brand-deep)] underline"
          onClick={onCheckBook}
        >
          Check this run in the book
        </button>
      ) : null}

      {inAccounts && !readOnly ? (
        <PayLinesBar
          run={run}
          picked={payPick}
          setPicked={setPayPick}
          date={payDate}
          setDate={setPayDate}
          mode={payMode}
          setMode={setPayMode}
          payRef={payRef}
          setPayRef={setPayRef}
          onMark={(ids, paid) => {
            if (onMarkLinesPaid(ids, paid)) {
              setPayPick(new Set());
              setPayRef("");
            }
          }}
        />
      ) : null}

      <label className="flex max-w-sm items-center gap-2 text-[11px] font-semibold text-[var(--muted)]">
        Find staff
        <input
          type="search"
          className="field !py-1 !text-xs"
          placeholder="Name, emp code, designation…"
          value={lineQuery}
          onChange={(e) => setLineQuery(e.target.value)}
        />
      </label>

      <ErpTableShell exportAs="payroll_run_lines" exportTitle="Payroll run lines">
        <div className="overflow-x-auto">
        <ErpTable minWidth="min-w-[880px]">
          <ErpTableHead>
            <tr>
              {inAccounts && !readOnly ? (
                <th className="px-2 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Tick everyone not yet paid"
                    checked={(() => {
                      const unpaid = run.lines.filter((l) => !l.paidOn);
                      return unpaid.length > 0 && unpaid.every((l) => payPick.has(l.staffId));
                    })()}
                    onChange={(e) =>
                      setPayPick(
                        e.target.checked
                          ? new Set(run.lines.filter((l) => !l.paidOn).map((l) => l.staffId))
                          : new Set(),
                      )
                    }
                  />
                </th>
              ) : null}
              <ErpSortTh sort={lineSort} field="staff">Staff</ErpSortTh>
              <ErpSortTh sort={lineSort} field="present">P / A / HD / LWP</ErpSortTh>
              <ErpSortTh sort={lineSort} field="gross">Gross</ErpSortTh>
              <ErpSortTh sort={lineSort} field="net">Net</ErpSortTh>
              <th className="px-4 py-2.5 font-bold">Payable</th>
              <th className="px-4 py-2.5 font-bold">Govt PF/ESIC</th>
              <th className="px-4 py-2.5 font-bold">Hold</th>
              <th className="px-4 py-2.5 font-bold">Paid</th>
              <th className="px-4 py-2.5 font-bold" />
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {lineSort.rows.filter((l) => lineMatches(l, lineQuery, roleOf)).map((l) => {
              const lockedDue = editable
                ? outstandingNow.get(l.staffId) || 0
                : l.advanceTaken || 0;
              return (
                <RunLineRow
                  key={l.staffId}
                  line={l}
                  runId={run.id}
                  runMonth={run.month}
                  runStatus={run.status}
                  runPaidAt={run.paidAt || ""}
                  editable={editable}
                  inAccounts={inAccounts}
                  readOnly={readOnly}
                  open={expandedStaffId === l.staffId}
                  picked={payPick.has(l.staffId)}
                  lockedDue={lockedDue}
                  setupAction={setupById.get(l.staffId)?.action}
                  setupNoSetup={Boolean(setupById.get(l.staffId)?.noSetup)}
                  setupReasons={(setupById.get(l.staffId)?.reasons || []).join("; ")}
                  notOnPayroll={notOnPayrollById.has(l.staffId)}
                  notOnPayrollReason={notOnPayrollById.get(l.staffId)?.reason || ""}
                  staff={staffById(l.staffId)}
                  upiProof={upiPaid.get(`${run.id}|${l.staffId}`)}
                  link={staffLinks.get(`${run.id}|${l.staffId}`)}
                  colSpan={inAccounts && !readOnly ? 10 : 9}
                  onTogglePick={onTogglePick}
                  onToggleOpen={onToggleOpen}
                  onOpenSetup={onOpenSetup}
                  onRemoveLine={stableRemoveLine}
                  onUnmarkLinePaid={stableUnmarkLinePaid}
                  onLinePaid={stableLinePaid}
                  onLinkChanged={onLinkChanged}
                  onEditAdjustments={stableEditAdjustments}
                  onEditComponent={stableEditComponent}
                />
              );
            })}
          </ErpTableBody>
        </ErpTable>
        </div>
      </ErpTableShell>
    </div>
  );
}

/**
 * One line of a run, and its Adjust / pay panel. Memoised: an edit to one
 * line re-renders that line, not every row of the run (director, 14 Oct
 * 2026: typing in the adjust table lagged). Every callback it gets is
 * stable (RunDetail wraps them), and every input keeps its own draft until
 * blur / Enter (components/ui/draft-inputs).
 */
const RunLineRow = memo(function RunLineRow({
  line: l,
  runId,
  runMonth,
  runStatus,
  runPaidAt,
  editable,
  inAccounts,
  readOnly,
  open,
  picked,
  lockedDue,
  setupAction,
  setupNoSetup,
  setupReasons,
  notOnPayroll,
  notOnPayrollReason,
  staff,
  upiProof,
  link,
  colSpan,
  onTogglePick,
  onToggleOpen,
  onOpenSetup,
  onRemoveLine,
  onUnmarkLinePaid,
  onLinePaid,
  onLinkChanged,
  onEditAdjustments: editAdjustmentsIn,
  onEditComponent: editComponentIn,
}: {
  line: PayrollStaffLine;
  runId: string;
  runMonth: string;
  runStatus: PayrollRun["status"];
  runPaidAt: string;
  editable: boolean;
  inAccounts: boolean;
  readOnly: boolean;
  open: boolean;
  picked: boolean;
  lockedDue: number;
  /** Against salary setup now (undefined = not checked). */
  setupAction: SetupSyncRow["action"] | undefined;
  setupNoSetup: boolean;
  setupReasons: string;
  notOnPayroll: boolean;
  notOnPayrollReason: string;
  staff: StaffRecord | undefined;
  upiProof: { utr: string; paidOn: string } | undefined;
  link: CashgramRefundView | undefined;
  colSpan: number;
  onTogglePick: (staffId: string, on: boolean) => void;
  onToggleOpen: (staffId: string) => void;
  onOpenSetup: (staffId: string) => void;
  onRemoveLine: (staffId: string) => void;
  onUnmarkLinePaid: (staffId: string) => void;
  onLinePaid: (staffId: string, paid: UpiPaid) => void;
  onLinkChanged: () => void;
  onEditAdjustments: (
    staffId: string,
    patch: Parameters<typeof updateDraftLineAdjustments>[2],
    runId: string,
  ) => void;
  onEditComponent: (staffId: string, headCode: string, amount: number, runId: string) => void;
}) {
  // Every edit names this row's run (see onEditAdjustments in the workspace).
  const onEditAdjustments = (
    staffId: string,
    patch: Parameters<typeof updateDraftLineAdjustments>[2],
  ) => editAdjustmentsIn(staffId, patch, runId);
  const onEditComponent = (staffId: string, headCode: string, amount: number) =>
    editComponentIn(staffId, headCode, amount, runId);
  // Advances ticked for this month's recovery (on the Advance recovery head).
  const picks = useMemo(() => lineAdvancePicks(l.components), [l.components]);
  // The most the deduction may be: the ticked advances' balance, else the
  // whole outstanding. Read from the register only when something is ticked
  // on a draft (a posted run's own recovery is already in the register).
  const deductMax = useMemo(
    () => (editable && picks.length ? Math.min(pickedTotalNow(l.staffId, picks), lockedDue) : lockedDue),
    [editable, picks, l.staffId, lockedDue],
  );
  // Why a typed deduction was changed (clamped), until the next edit.
  const [deductMsg, setDeductMsg] = useState("");
  return (
    <>
                  <tr className="border-b border-[var(--border)]">
                    {inAccounts && !readOnly ? (
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Tick ${l.fullName}`}
                          checked={picked}
                          onChange={(e) => onTogglePick(l.staffId, e.target.checked)}
                        />
                      </td>
                    ) : null}
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
                      {notOnPayroll ? (
                        <NotOnPayrollBadge
                          reason={notOnPayrollReason}
                          onRemove={editable ? () => onRemoveLine(l.staffId) : undefined}
                        />
                      ) : null}
                      {(() => {
                        // Not on payroll: its own badge and one-click remove.
                        if (notOnPayroll) return null;
                        if (!setupAction || (!setupNoSetup && setupAction === "none")) return null;
                        const label = setupAction === "remove"
                          ? "Not in this month"
                          : setupNoSetup
                            ? "No salary setup"
                            : "Differs from salary setup";
                        return (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <span
                              className="rounded bg-[var(--danger-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--danger)]"
                              title={setupReasons || "PF/ESI not applied; set it up in Masters → Salary setup"}
                            >
                              {label}
                            </span>
                            {editable && setupAction !== "none" ? (
                              <button
                                type="button"
                                className="text-[10px] font-semibold text-[var(--brand-deep)] underline"
                                onClick={() => onOpenSetup(l.staffId)}
                              >
                                {setupAction === "remove" ? "Remove from this month" : "Rebuild from setup"}
                              </button>
                            ) : null}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[var(--muted)]">
                      {l.daysPresent}/{l.daysAbsent}/{l.daysHalf}/{l.daysLwp}
                    </td>
                    <td className="px-3 py-2">{formatInr(l.gross)}</td>
                    <td className="px-3 py-2">{formatInr(l.netPay)}</td>
                    <td className="px-3 py-2 font-semibold">
                      {editable ? (
                        <DraftNumberInput
                          className="field w-24 !py-1 !text-xs"
                          aria-label={`Payable for ${l.fullName}`}
                          value={
                            l.amountPayable ?? (l.juneHold ? 0 : l.netPay)
                          }
                          onCommit={(n) =>
                            onEditAdjustments(l.staffId, {
                              amountPayable: n,
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
                    <td className="px-3 py-2 text-[11px]">
                      {/* Each person's own paid day and means (14 Oct 2026). */}
                      {l.paidOn ? (
                        <span className="inline-flex flex-wrap items-center gap-1">
                          <span className="font-semibold text-[var(--tone-green)]">
                            ✓ {l.paidOn}
                          </span>
                          <span className="text-[var(--muted)]">
                            {paymentModeLabel(l.paymentMode)}
                            {l.paymentRef ? ` · ${l.paymentRef}` : ""}
                          </span>
                          {inAccounts && !readOnly ? (
                            <button
                              type="button"
                              className="text-[10px] font-semibold text-[var(--danger)]"
                              onClick={() => onUnmarkLinePaid(l.staffId)}
                            >
                              Un-mark
                            </button>
                          ) : null}
                        </span>
                      ) : runStatus === "paid" ? (
                        <span className="text-[var(--muted)]">
                          with the run · {(runPaidAt || "").slice(0, 10)}
                        </span>
                      ) : (
                        <span className="text-[var(--muted)]">
                          {l.paymentDate ? `planned ${l.paymentDate} · ` : ""}
                          {inAccounts ? "not paid" : "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-1">
                        {/* Pay this salary by UPI and record its UTR from the
                            app's screenshot (director, 7 Oct 2026). */}
                        {(runStatus === "posted" || runStatus === "paid") && !readOnly ? (
                          (() => {
                            const st = staff;
                            const amt = l.amountPayable ?? (l.juneHold ? 0 : l.netPay);
                            const lineKey = `${runId}|${l.staffId}`;
                            const linkLive = Boolean(link && !cashgramIsDead(link.status));
                            const linePaid = Boolean(upiProof) || /UTR \d{12}/.test(l.note || "") || linkLive;
                            return amt > 0 ? (
                              <>
                              {/* A salary paid by link shows only the link. */}
                              {linkLive ? null : (
                              <UpiPayButton
                                label={
                                  upiProof
                                    ? `Paid ✓ ${upiProof.utr.slice(-4)}`
                                    : /UTR \d{12}/.test(l.note || "")
                                      ? "Paid ✓ UPI"
                                      : "Pay UPI"
                                }
                                payeeName={l.fullName}
                                payeeVpa={st?.upiId || ""}
                                payeeMobile={st?.mobile || ""}
                                amountPaise={Math.round(amt * 100)}
                                note={`Salary ${runMonth} · ${l.empCode || l.fullName}`}
                                earliest={`${runMonth}-01`}
                                onPaid={(p) => onLinePaid(l.staffId, p)}
                              />
                              )}
                              {/* Or straight from the Cashfree wallet when the
                                  owner's switch is on (director, 7 Oct 2026). */}
                              <PayoutButton
                                paid={linePaid}
                                payee={{
                                  name: l.fullName,
                                  vpa: st?.upiId || "",
                                  accountNumber: st?.bankAccountNo || "",
                                  ifsc: st?.bankIfsc || "",
                                  phone: st?.mobile || "",
                                }}
                                amountPaise={Math.round(amt * 100)}
                                note={`Salary ${runMonth}`}
                                target={{ kind: "payroll_line", id: lineKey, label: `Salary ${runMonth} — ${l.fullName}` }}
                                subjectId={l.staffId}
                                period={runId}
                                onPaid={(p) => onLinePaid(l.staffId, p)}
                              />
                              {/* Or a Cashgram link to their phone — for staff
                                  with no UPI ID or bank on file. */}
                              <StaffCashgramButton
                                link={link}
                                runId={runId}
                                staffId={l.staffId}
                                name={l.fullName}
                                phone={st?.mobile || ""}
                                amountPaise={Math.round(amt * 100)}
                                paid={Boolean(upiProof) || /UTR \d{12}/.test(l.note || "")}
                                onChanged={onLinkChanged}
                              />
                              </>
                            ) : null;
                          })()
                        ) : null}
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[var(--brand-deep)]"
                          aria-expanded={open}
                          onClick={() => onToggleOpen(l.staffId)}
                        >
                          {editable ? "Adjust / pay" : "Details"}
                        </button>
                        <RowActionMenu
                          row={l}
                          label={`Actions for ${l.fullName}`}
                          actions={[
                            {
                              id: "details",
                              label: editable ? "Adjust / pay" : "Details",
                              onSelect: (x) => onToggleOpen(x.staffId),
                            },
                            {
                              id: "staff",
                              label: "Open staff record",
                              onSelect: (x) => {
                                window.location.href = `/staff/${encodeURIComponent(x.staffId)}/edit`;
                              },
                            },
                            {
                              id: "remove",
                              label: "Remove from this run",
                              tone: "danger",
                              separatorAbove: true,
                              hidden: () => !editable,
                              onSelect: (x) => onRemoveLine(x.staffId),
                            },
                          ]}
                        />
                      </span>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-sunken)]">
                      <td colSpan={colSpan} className="px-3 py-3">
                        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <label className="text-[10px] font-semibold text-[var(--muted)]">
                            Bonus (this month)
                            {editable ? (
                              <DraftNumberInput
                                min={0}
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.bonus || 0}
                                onCommit={(n) =>
                                  onEditAdjustments(l.staffId, {
                                    bonus: n,
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
                              <DraftNumberInput
                                min={0}
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.specialDeduction || 0}
                                onCommit={(n) =>
                                  onEditAdjustments(l.staffId, {
                                    specialDeduction: n,
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
                              <DraftTextInput
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.specialDeductionLabel || ""}
                                placeholder="e.g. Uniform, fine, lost property"
                                onCommit={(text) =>
                                  onEditAdjustments(l.staffId, {
                                    specialDeductionLabel: text,
                                  })
                                }
                              />
                            ) : (
                              <span className="mt-0.5 block text-xs text-[var(--brand-deep)]">
                                {l.specialDeductionLabel || "—"}
                              </span>
                            )}
                          </label>
                          <div className="text-[10px] font-semibold text-[var(--muted)]">
                            Advance outstanding (locked)
                            {/* Tap for the advances behind the total; tick
                                the ones this month recovers (14 Oct 2026). */}
                            <AdvancePickNote
                              staffId={l.staffId}
                              staffName={l.fullName}
                              runId={runId}
                              lockedDue={lockedDue}
                              editable={editable}
                              picks={picks}
                              onPick={(next) => {
                                setDeductMsg("");
                                onEditAdjustments(l.staffId, { advancePicks: next });
                              }}
                            />
                            <span className="mt-0.5 block text-[10px] font-normal">
                              {picks.length
                                ? `${picks.length} advance${picks.length === 1 ? "" : "s"} ticked · tap to change`
                                : "Total due from Advances ledger · tap to choose advances"}
                            </span>
                          </div>
                          <label className="text-[10px] font-semibold text-[var(--muted)]">
                            Advance deduct this month
                            {editable ? (
                              <DraftNumberInput
                                min={0}
                                max={deductMax}
                                className="field mt-0.5 !py-1 !text-xs"
                                aria-describedby={`adv-max-${l.staffId}`}
                                value={l.advanceDeduct || 0}
                                onCommit={(n) => {
                                  // 0 … the ticked advances' balance (or the
                                  // whole outstanding when none are ticked).
                                  const max = picks.length
                                    ? Math.min(pickedTotalNow(l.staffId, picks), lockedDue)
                                    : lockedDue;
                                  const c = clampAdvanceDeduct(n, max);
                                  setDeductMsg(
                                    c.clamped
                                      ? n < 0
                                        ? "Cannot be below ₹0 — set to ₹0."
                                        : `Cannot be more than ${formatInr(max)}${picks.length ? " (the ticked advances' balance)" : " (outstanding)"} — set to ${formatInr(c.value)}.`
                                      : "",
                                  );
                                  if (c.value !== (l.advanceDeduct || 0)) {
                                    onEditAdjustments(l.staffId, { advanceDeduct: c.value });
                                  }
                                }}
                              />
                            ) : (
                              <span className="mt-0.5 block text-xs text-[var(--brand-deep)]">
                                {formatInr(l.advanceDeduct || 0)}
                              </span>
                            )}
                            <span id={`adv-max-${l.staffId}`} className="mt-0.5 block text-[10px] font-normal">
                              Max {formatInr(deductMax)}
                              {picks.length ? " · ticked advances" : ""}
                            </span>
                            {deductMsg ? (
                              <span role="status" className="mt-0.5 block text-[10px] font-semibold text-[var(--danger)]">
                                {deductMsg}
                              </span>
                            ) : null}
                          </label>
                          <label className="text-[10px] font-semibold text-[var(--muted)]">
                            New advance with salary
                            {editable ? (
                              <DraftNumberInput
                                min={0}
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.advanceNewWithSalary || 0}
                                onCommit={(n) =>
                                  onEditAdjustments(l.staffId, {
                                    advanceNewWithSalary: n,
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
                              <DraftDateInput
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.paymentDate || ""}
                                onCommit={(iso) =>
                                  onEditAdjustments(l.staffId, {
                                    paymentDate: iso,
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
                              <DraftTextInput
                                className="field mt-0.5 !py-1 !text-xs"
                                value={l.note || ""}
                                placeholder="Any note for this staff / month"
                                onCommit={(text) =>
                                  onEditAdjustments(l.staffId, {
                                    note: text,
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
                                <DraftNumberInput
                                  className="field mt-0.5 !py-1 !text-xs"
                                  value={c.amount}
                                  onCommit={(n) =>
                                    onEditComponent(l.staffId, c.headCode, n)
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
    </>
  );
});

/** Balance of the ticked advances as the register stands now. */
function pickedTotalNow(staffId: string, picks: string[]): number {
  return pickedAdvanceTotal(advancePickRowsForStaff(staffId), picks);
}

/**
 * Before → after for each line that differs from salary setup, with run
 * totals; the office ticks what to apply (director, 14 Oct 2026).
 */
function SetupSyncPanel({
  rows,
  all,
  picked,
  setPicked,
  reset,
  setReset,
  onApply,
}: {
  rows: SetupSyncRow[];
  all: SetupSyncRow[];
  picked: Set<string>;
  setPicked: (s: Set<string>) => void;
  reset: Set<string>;
  setReset: (s: Set<string>) => void;
  onApply: (staffIds: string[]) => void;
}) {
  const chosen = rows.filter((r) => picked.has(r.staffId));
  const t = setupSyncTotals(chosen, all.map((r) => r.before));
  const fig = (f: SetupSyncRow["before"] | null) =>
    f ? `${formatInr(f.gross)} / ${formatInr(f.totalDeductions)} / ${formatInr(f.netPay)} / ${formatInr(f.employerCost)} · ${f.daysPresent}P ${f.daysAbsent}A ${f.daysLwp}LWP · ${f.statutoryCover}` : "removed";
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <ErpTable minWidth="min-w-[640px]" className="text-[11px]">
          <ErpTableHead>
            <tr className="text-left text-[var(--muted)]">
              <th className="px-2 py-1" />
              <th className="px-2 py-1">Staff</th>
              <th className="px-2 py-1">Why</th>
              <th className="px-2 py-1">Before — gross / deductions / net / employer · days · cover</th>
              <th className="px-2 py-1">After</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {rows.map((r) => (
              <tr key={r.staffId} className="border-t border-[var(--border)] align-top">
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    aria-label={`Apply salary setup to ${r.fullName}`}
                    checked={picked.has(r.staffId)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(r.staffId);
                      else next.delete(r.staffId);
                      setPicked(next);
                    }}
                  />
                </td>
                <td className="px-2 py-1 font-semibold">
                  {r.fullName}
                  <div className="font-normal text-[var(--muted)]">{r.empCode}</div>
                </td>
                <td className="px-2 py-1">
                  {r.reasons.join("; ")}
                  {r.headChanges.length ? (
                    <div className="mt-0.5 text-[var(--muted)]">Heads: {r.headChanges.join(", ")}</div>
                  ) : null}
                  {r.kept.length ? (
                    <div className="mt-0.5 font-semibold text-[var(--brand-deep)]">Your edits kept: {r.kept.join(", ")}</div>
                  ) : null}
                  {r.reset.length ? (
                    <div className="mt-0.5 font-semibold text-[var(--danger)]">Reset to setup: {r.reset.join(", ")}</div>
                  ) : null}
                  {r.kept.length || r.reset.length ? (
                    <label className="mt-0.5 flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={reset.has(r.staffId)}
                        onChange={(e) => {
                          const next = new Set(reset);
                          if (e.target.checked) next.add(r.staffId);
                          else next.delete(r.staffId);
                          setReset(next);
                        }}
                      />
                      Reset my edits to salary setup
                    </label>
                  ) : null}
                </td>
                <td className="px-2 py-1">{fig(r.before)}</td>
                <td className="px-2 py-1 font-semibold text-[var(--brand-deep)]">
                  {r.action === "remove" ? "Remove from this month" : fig(r.after)}
                </td>
              </tr>
            ))}
          </ErpTableBody>
        </ErpTable>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[var(--muted)]">
          Run net {formatInr(t.before.net)} → {formatInr(t.after.net)} · employer cost {formatInr(t.before.employer)} → {formatInr(t.after.employer)}
        </span>
        <button
          type="button"
          className="rounded-lg bg-[var(--primary)] px-2.5 py-1 font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          disabled={!chosen.length}
          onClick={() => onApply(chosen.map((r) => r.staffId))}
        >
          {chosen.length === rows.length ? "Apply to all differing lines" : `Apply to ${chosen.length} line(s)`}
        </button>
      </div>
    </div>
  );
}

/** Every typed word found in the line's name, emp code, structure or role. */
function lineMatches(
  l: PayrollStaffLine,
  query: string,
  roleOf: (staffId: string) => string,
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [l.fullName, l.empCode, l.structureName, l.stream, roleOf(l.staffId)]
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * Mark the ticked staff paid on one day by one means — many at once, or one
 * by one on their own days (director, 14 Oct 2026). The book posts one
 * payment voucher per day and money account.
 */
function PayLinesBar({
  run,
  picked,
  setPicked,
  date,
  setDate,
  mode,
  setMode,
  payRef,
  setPayRef,
  onMark,
}: {
  run: PayrollRun;
  picked: Set<string>;
  setPicked: (s: Set<string>) => void;
  date: string;
  setDate: (d: string) => void;
  mode: PayrollPaymentMode | "";
  setMode: (m: PayrollPaymentMode | "") => void;
  payRef: string;
  setPayRef: (r: string) => void;
  onMark: (staffIds: string[], paid: { date: string; mode?: PayrollPaymentMode; ref?: string }) => void;
}) {
  const progress = payrollPaidProgress(run.lines);
  const pickedLines = run.lines.filter((l) => picked.has(l.staffId));
  const total = pickedLines.reduce((n, l) => n + (l.amountPayable ?? (l.juneHold ? 0 : l.netPay)), 0);
  // The planned day the ticked lines agree on, else today.
  const planned = [...new Set(pickedLines.map((l) => l.paymentDate).filter(Boolean))];
  const day = date || (planned.length === 1 ? planned[0]! : "") || todayIstDate();
  const paidWhole = run.status === "paid" && !run.lines.some((l) => l.paidOn);
  if (paidWhole) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-[11px]">
      <div className="min-w-[10rem] flex-1">
        <div className="font-bold text-[var(--brand-deep)]">
          Paid {progress.paid} of {progress.payable}
        </div>
        <div className="text-[var(--muted)]">
          {picked.size
            ? `${picked.size} ticked · ${formatInr(total)}`
            : "Tick the staff paid on the same day by the same means"}
        </div>
      </div>
      <label className="flex flex-col font-semibold">
        Paid on
        {/* Own draft while typing: the box used to fall back to the
            planned day / today the moment it was half-typed (value ""),
            wiping the day and month before the year went in. */}
        <DraftDateInput
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-1.5 py-1"
          value={day}
          min={`${run.month}-01`}
          max={todayIstDate()}
          onCommit={setDate}
        />
      </label>
      <label className="flex flex-col font-semibold">
        By
        <select
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-1.5 py-1"
          value={mode}
          onChange={(e) => setMode(e.target.value as PayrollPaymentMode | "")}
        >
          <option value="">each line&apos;s own mode</option>
          {PAYROLL_PAYMENT_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col font-semibold">
        UTR / cheque no.
        <input
          className="w-36 rounded-lg border border-[var(--border)] bg-[var(--card)] px-1.5 py-1"
          value={payRef}
          placeholder="optional"
          onChange={(e) => setPayRef(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="rounded-lg bg-[var(--primary)] px-2.5 py-1.5 font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        disabled={!picked.size}
        onClick={() => onMark([...picked], { date: day, mode: mode || undefined, ref: payRef.trim() || undefined })}
      >
        Mark {picked.size || ""} paid
      </button>
      {picked.size ? (
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 font-semibold"
          onClick={() => setPicked(new Set())}
        >
          Clear
        </button>
      ) : null}
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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
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
                  className="flex justify-between text-[var(--danger)]"
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

/**
 * `deskTick`: the workspace's — it moves once the payroll desk (and the
 * others the workspace loads) has landed, so a panel opened first re-reads
 * the log then (data-layer 2.3a: screens no longer wait behind the old gate).
 */
function PayrollAuditPanel({ deskTick }: { deskTick: number }) {
  const [rows, setRows] = useState<PayrollAuditEntry[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setRows(listPayrollAudit(100));
  }, [tick, deskTick]);
  // Folded by the IST month the event happened in, newest open.
  const auditMonths = useMonthGroups({
    rows,
    dateOf: (e) => e.at,
    storageKey: "payroll.audit",
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
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
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
          onClick={() => setTick((n) => n + 1)}
        >
          Refresh
        </button>
      </div>
      <ErpTableShell className="overflow-x-auto" exportAs="payroll_audit_trail" exportTitle="Payroll audit trail">
        <ErpTable minWidth="min-w-full" className="text-xs">
          <ErpTableHead>
            <tr className="text-[var(--muted)]">
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">Who</th>
              <th className="px-3 py-2 font-semibold">Action</th>
              <th className="px-3 py-2 font-semibold">Month</th>
              <th className="px-3 py-2 font-semibold">Detail</th>
            </tr>
          </ErpTableHead>
          <MonthGroupedTbody
            month={auditMonths}
            colSpan={5}
            rowKey={(e) => e.id}
            countLabel={(n) => `${n} ${n === 1 ? "event" : "events"}`}
            renderRow={(e) => (
              <tr>
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
            )}
            empty={
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-sm text-[var(--muted)]"
                >
                  No audit events yet — process or publish a payroll run.
                </td>
              </tr>
            }
          />
        </ErpTable>
      </ErpTableShell>
    </div>
  );
}
