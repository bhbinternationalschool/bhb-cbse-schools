"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IndianRupee } from "lucide-react";
import { PaymentChannelSelect } from "@/components/accounts/PaymentChannelSelect";
import {
  decodeTenderChannel,
  encodeTenderChannel,
  tenderChannelLabel,
} from "@/lib/paymentChannels";
import {
  allocateCollectionToDues,
  collectPayment,
  computeHouseholdDues,
  formatInr,
  householdSiblingIds,
  loadFees,
  chequeStats,
  dayCloseNeedsAttention,
  openFeeDues,
  openChargeVoucherCount,
  isCollectionDateLocked,
  deliverWhatsAppFeeReceipt,
  previewLastSessionTransfer,
  searchFeeStudents,
  tenderModeLabel,
  transferLastSessionDues,
  TENDER_MODES,
  voidVoucher,
  type CollectionVoucher,
  type FeeDueLine,
  type LastSessionTransferPreview,
  type StudentSearchHit,
  type TenderMode,
  type VoucherTender,
} from "@/lib/fees";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  householdWhatsApp,
  isValidMobile,
  loadSis,
  normalizeMobile,
  updateHouseholdWhatsApp,
  type Household,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import { FilterExportButtons } from "@/components/reports/FilterExportButtons";
import { describeFilters } from "@/lib/reportExport";
import { TENANT } from "@/lib/types";
import {
  FeeReceiptSheet,
  printFeeReceipt,
} from "@/components/fees/FeeReceiptSheet";
import { DueBreakupPicker } from "@/components/fees/DueBreakupPicker";
import { FeeAdjustmentsBadge } from "@/components/fees/FeeAdjustmentsPanel";
import {
  buildPerLineDiscountSlices,
  FEE_ADJUST_AUTO_LIMIT_PAISE,
  postCounterDiscountWaivers,
  type CounterDiscountSlice,
} from "@/lib/feeAdjustments";
import { FutureConcessionModal } from "@/components/fees/FutureConcessionModal";
import {
  applyFutureConcessionsFromCounter,
  listFutureConcessionCandidates,
  type FutureConcessionCandidate,
} from "@/lib/counterConcession";
import { lazyNamedTabPanel } from "@/components/ui/lazyTabPanel";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import {
  buildEnrichedPaymentSharePayload,
  buildPaymentShareUrl,
  composeWhatsAppPaymentLinkMessage,
  createPaymentLink,
  openPaymentLinkCount,
  whatsAppPaymentLinkUrl,
} from "@/lib/payments";
import {
  scheduleClientSchoolMirrorSync,
} from "@/lib/schoolDataMirror";
import {
  buildFeeAgreementDoc,
  downloadFeeAgreementPdf,
} from "@/lib/feeAgreementPdf";
import {
  ModuleTabButton,
} from "@/components/ui/ModuleTabs";
import { MODULE_TAB_CONTAINER_CLASS } from "@/components/ui/modern-tab-bar";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ErpPanel, ErpTableShell } from "@/components/ui/erp-roster";

import { ChequesPanel } from "@/components/fees/ChequesPanel";
import { ManualBookPanel } from "@/components/fees/ManualBookPanel";
import { DayClosePanel } from "@/components/fees/DayClosePanel";
import { PayLinksPanel } from "@/components/fees/PayLinksPanel";
import { SisParentWaInbox } from "@/components/fees/SisParentWaInbox";
import { FeeAdjustmentsPanel } from "@/components/fees/FeeAdjustmentsPanel";
import { FeeReportsPanel } from "@/components/fees/FeeFinancePanels";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
const ChargeVouchersPanel = lazyNamedTabPanel(
  () => import("@/components/fees/ChargeVouchersPanel"),
  "ChargeVouchersPanel",
);
const TransportFeeSchedulePanel = lazyNamedTabPanel(
  () => import("@/components/fees/TransportFeeSchedulePanel"),
  "TransportFeeSchedulePanel",
);

function FeeAgreementPdfLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path
        fill="#E53935"
        d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
      />
      <path fill="#FFCDD2" d="M14 2v6h6" />
      <rect x="4.5" y="12.5" width="15" height="6.5" rx="1.2" fill="#B71C1C" />
      <text
        x="12"
        y="17.4"
        textAnchor="middle"
        fill="#fff"
        fontSize="5.2"
        fontWeight="800"
        fontFamily="system-ui,Segoe UI,sans-serif"
      >
        PDF
      </text>
    </svg>
  );
}

type Tab =
  | "collect"
  | "receipts"
  | "cheques"
  | "manual"
  | "paylinks"
  | "wa_sis"
  | "dayclose"
  | "adjustments"
  | "vouchers"
  | "dashboard"
  | "reports";

/** One confirmed payment row on the voucher */
type TenderLine = {
  key: string;
  mode: TenderMode;
  bankAccountId: string;
  amount: string;
  ref: string;
  instrumentDate: string;
  bankName: string;
};

type TenderComposer = {
  channel: string;
  ref: string;
  instrumentDate: string;
  bankName: string;
  amount: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function emptyComposer(channel = ""): TenderComposer {
  return {
    channel,
    ref: "",
    instrumentDate: todayIso(),
    bankName: "",
    amount: "",
  };
}

function newTenderKey() {
  return `t_${Math.random().toString(36).slice(2, 9)}`;
}

export function FeeTakeWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const ay = session.academicYearCode;
  const [tab, setTab] = useState<Tab>("dashboard");
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [hits, setHits] = useState<StudentSearchHit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [includeFuture, setIncludeFuture] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  /** Rupees to collect at counter — defaults to full selected balance; lower for partial pay */
  const [collectAmountRupees, setCollectAmountRupees] = useState("");
  /** Per fee-head counter discount (dueKey → rupees) on selected lines */
  const [lineDiscountRupees, setLineDiscountRupees] = useState<
    Record<string, string>
  >({});
  const [counterDiscountReason, setCounterDiscountReason] = useState("");
  const [futureConcessionPrompt, setFutureConcessionPrompt] = useState<{
    candidates: FutureConcessionCandidate[];
    selected: Set<string>;
  } | null>(null);
  const [tenderLines, setTenderLines] = useState<TenderLine[]>([]);
  const [composer, setComposer] = useState<TenderComposer>(emptyComposer);
  const [collectionDate, setCollectionDate] = useState(todayIso);
  const [schoolReceiptNo, setSchoolReceiptNo] = useState("");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<CollectionVoucher[]>([]);
  const [previewReceiptId, setPreviewReceiptId] = useState<string | null>(
    null,
  );
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);

  function refresh() {
    const m = loadMasters();
    const s = loadSis();
    const f = loadFees();
    setMasters(m);
    setSis(s);
    setHits(
      searchFeeStudents(query, s, m, f, {
        classId,
        sectionId,
        academicYearCode: ay,
        includeFuture,
      }),
    );
    setReceipts(f.vouchers);
    setTick((t) => t + 1);
    void import("@/lib/payments").then(({ loadPayments }) => {
      scheduleClientSchoolMirrorSync({
        sis: s,
        fees: f,
        masters: m,
        payments: loadPayments(),
      });
    });
  }

  useEffect(() => {
    setMounted(true);
    refresh();
    void (async () => {
      const { ensureSisHydrated } = await import("@/lib/sisPersistence");
      const { ensureFeesHydrated } = await import("@/lib/feesPersistence");
      const { hydrateFeesStore } = await import("@/lib/fees");
      const { ensurePaymentsHydrated } = await import(
        "@/lib/paymentsPersistence"
      );
      await Promise.all([
        ensureSisHydrated(),
        ensureFeesHydrated(),
        ensurePaymentsHydrated(),
      ]);
      await hydrateFeesStore();
      const { applyCollectionWipeSignalIfNeeded } = await import(
        "@/lib/feeCollectionWipe"
      );
      const wipe = await applyCollectionWipeSignalIfNeeded();
      if (wipe.wiped) {
        flash(
          `Cleared ${wipe.removedVouchers} local receipt(s) — ready for re-import`,
        );
      }
      const { applyFeeDiscountSeedNow } = await import(
        "@/lib/feeDiscountImportHydrate"
      );
      const discount = applyFeeDiscountSeedNow();
      if (discount.applied > 0) {
        flash(
          `Applied ${discount.applied} student discount grant${discount.applied === 1 ? "" : "s"}`,
        );
      }
      refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ay]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: Tab[] = [
      "collect",
      "receipts",
      "cheques",
      "manual",
      "paylinks",
      "wa_sis",
      "dayclose",
      "adjustments",
      "vouchers",
      "dashboard",
      "reports",
    ];
    if (raw && (allowed as string[]).includes(raw)) {
      setTab(raw as Tab);
    }
  }, []);

  useEffect(() => {
    if (!sis || !masters) return;
    setHits(
      searchFeeStudents(query, sis, masters, loadFees(), {
        classId,
        sectionId,
        academicYearCode: ay,
        includeFuture,
      }),
    );
  }, [query, classId, sectionId, sis, masters, tick, ay, includeFuture]);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    const active = masters.classes.filter((c) => c.isActive !== false);
    return active.length > 0 ? active : masters.classes;
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    const forClass = masters.sections.filter((s) => s.classId === classId);
    const active = forClass.filter((s) => s.isActive !== false);
    return active.length > 0 ? active : forClass;
  }, [masters, classId]);

  useEffect(() => {
    if (!sectionId) return;
    if (!sectionOptions.some((s) => s.id === sectionId)) {
      setSectionId("");
    }
  }, [sectionId, sectionOptions]);

  const selectedStudent = useMemo(() => {
    if (!sis || !selectedId) return null;
    return sis.students.find((s) => s.id === selectedId) ?? null;
  }, [sis, selectedId]);

  const householdBundle = useMemo(() => {
    if (!sis || !masters || !selectedStudent) return [];
    const fees = loadFees();
    const members = householdSiblingIds(sis, selectedStudent);
    return computeHouseholdDues(
      selectedStudent.householdId,
      sis,
      masters,
      fees,
      { includeFuture, includePaid: true },
    ).filter((row) => members.some((m) => m.id === row.student.id));
  }, [sis, masters, selectedStudent, includeFuture, tick]);

  const lastSessionPreviews = useMemo(() => {
    if (!sis || !masters || !selectedStudent) return [];
    const fees = loadFees();
    const members = householdSiblingIds(sis, selectedStudent);
    return members.map((s) => previewLastSessionTransfer(s, masters, fees));
  }, [sis, masters, selectedStudent, tick]);

  const transferablePreviews = lastSessionPreviews.filter((p) => p.canTransfer);
  const transferTotalPaise = transferablePreviews.reduce(
    (s, p) => s + p.totalPaise,
    0,
  );

  const allDues = useMemo(
    () => householdBundle.flatMap((row) => row.dues),
    [householdBundle],
  );

  const selectedDues = useMemo(
    () => allDues.filter((d) => selectedKeys.has(d.dueKey)),
    [allDues, selectedKeys],
  );

  const selectionKey = useMemo(
    () => [...selectedKeys].sort().join("|"),
    [selectedKeys],
  );

  const collectTotal = selectedDues.reduce((s, d) => s + d.balancePaise, 0);

  const discountSlices = useMemo(
    () => buildPerLineDiscountSlices(selectedDues, lineDiscountRupees),
    [selectedDues, lineDiscountRupees],
  );

  const counterDiscountPaise = discountSlices.reduce(
    (s, x) => s + x.amountPaise,
    0,
  );

  const netAfterDiscount = Math.max(0, collectTotal - counterDiscountPaise);

  const lineDiscountsKey = useMemo(
    () =>
      Object.entries(lineDiscountRupees)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join("|"),
    [lineDiscountRupees],
  );

  useEffect(() => {
    setTenderLines([]);
    setComposer(emptyComposer());
    setLineDiscountRupees((prev) => {
      const next: Record<string, string> = {};
      for (const key of selectedKeys) {
        if (prev[key]) next[key] = prev[key];
      }
      return next;
    });
    setCounterDiscountReason("");
    setFutureConcessionPrompt(null);
    if (collectTotal > 0) {
      setCollectAmountRupees(String(collectTotal / 100));
    } else {
      setCollectAmountRupees("");
    }
  }, [selectionKey, collectTotal]);

  useEffect(() => {
    if (collectTotal <= 0) return;
    setCollectAmountRupees(String(netAfterDiscount / 100));
    setTenderLines([]);
    setComposer(emptyComposer());
  }, [lineDiscountsKey]);

  const collectTarget = useMemo(() => {
    if (netAfterDiscount <= 0) return 0;
    const n = Math.round((Number(collectAmountRupees) || 0) * 100);
    if (n <= 0) return 0;
    return Math.min(n, netAfterDiscount);
  }, [collectAmountRupees, netAfterDiscount]);
  const isPartialCollect =
    collectTarget > 0 && collectTarget < netAfterDiscount;
  const tenderSum = tenderLines.reduce(
    (sum, t) => sum + Math.round((Number(t.amount) || 0) * 100),
    0,
  );
  const remainingPaise = Math.max(0, collectTarget - tenderSum);

  const householdReceipts = useMemo(() => {
    if (!selectedStudent) return [];
    const memberIds = new Set(householdBundle.map((r) => r.student.id));
    return receipts
      .filter(
        (v) =>
          v.householdId === selectedStudent.householdId ||
          v.lines.some((l) => memberIds.has(l.studentId)),
      )
      .slice()
      .sort((a, b) => {
        const byDate = b.collectionDate.localeCompare(a.collectionDate);
        if (byDate !== 0) return byDate;
        return b.collectedAt.localeCompare(a.collectedAt);
      });
  }, [receipts, selectedStudent, householdBundle]);

  const previewVoucher =
    receipts.find((v) => v.id === previewReceiptId) ?? null;

  const openChequeCount = useMemo(() => {
    void tick;
    const s = chequeStats();
    return s.receivedCount + s.depositedCount;
  }, [tick]);

  const openPayLinkCount = useMemo(() => {
    void tick;
    return openPaymentLinkCount();
  }, [tick]);

  const dayClosePending = useMemo(() => {
    void tick;
    return dayCloseNeedsAttention();
  }, [tick]);

  const openChargeCount = useMemo(() => {
    void tick;
    return openChargeVoucherCount();
  }, [tick]);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function resetPaymentFields() {
    setTenderLines([]);
    setComposer(emptyComposer());
    setCollectionDate(todayIso());
    setSchoolReceiptNo("");
    setNote("");
    setLineDiscountRupees({});
    setCounterDiscountReason("");
  }

  function freshSelectedDues() {
    if (!sis || !masters || !selectedStudent) return [];
    const fees = loadFees();
    const members = householdSiblingIds(sis, selectedStudent);
    return computeHouseholdDues(
      selectedStudent.householdId,
      sis,
      masters,
      fees,
      { includeFuture, includePaid: true },
    )
      .filter((row) => members.some((m) => m.id === row.student.id))
      .flatMap((b) => b.dues)
      .filter((d) => selectedKeys.has(d.dueKey));
  }

  function pickStudent(hit: StudentSearchHit) {
    setSelectedId(hit.student.id);
    setSelectedKeys(new Set());
    resetPaymentFields();
  }

  function toggleDue(due: FeeDueLine) {
    if (due.balancePaise <= 0) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(due.dueKey)) next.delete(due.dueKey);
      else next.add(due.dueKey);
      return next;
    });
  }

  /** Select or clear every open head in one month group. */
  function toggleMonth(monthDues: FeeDueLine[], select: boolean) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const d of monthDues) {
        if (d.balancePaise <= 0) continue;
        if (select) next.add(d.dueKey);
        else next.delete(d.dueKey);
      }
      return next;
    });
  }

  function selectOverdue() {
    const today = todayIso();
    setSelectedKeys(
      new Set(
        openFeeDues(allDues)
          .filter((d) => d.dueOn <= today)
          .map((d) => d.dueKey),
      ),
    );
  }

  /** All open dues for every sibling currently listed. */
  function selectAllSiblings() {
    setSelectedKeys(new Set(openFeeDues(allDues).map((d) => d.dueKey)));
  }

  function clearSelection() {
    setSelectedKeys(new Set());
  }

  function selectStudentDues(studentId: string) {
    const keys = openFeeDues(allDues)
      .filter((d) => d.studentId === studentId)
      .map((d) => d.dueKey);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }

  function clearStudentDues(studentId: string) {
    const drop = new Set(
      allDues.filter((d) => d.studentId === studentId).map((d) => d.dueKey),
    );
    setSelectedKeys((prev) => {
      const next = new Set<string>();
      for (const k of prev) if (!drop.has(k)) next.add(k);
      return next;
    });
  }

  function toggleStudentAll(studentId: string) {
    const keys = openFeeDues(allDues)
      .filter((d) => d.studentId === studentId)
      .map((d) => d.dueKey);
    if (keys.length === 0) return;
    const allOn = keys.every((k) => selectedKeys.has(k));
    if (allOn) clearStudentDues(studentId);
    else selectStudentDues(studentId);
  }

  function selectStudentOverdue(studentId: string) {
    const today = todayIso();
    const keys = openFeeDues(allDues)
      .filter((d) => d.studentId === studentId && d.dueOn <= today)
      .map((d) => d.dueKey);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }

  // Drop selections that are no longer open (paid / hidden future)
  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev;
      const allowed = new Set(openFeeDues(allDues).map((d) => d.dueKey));
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (allowed.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [allDues]);

  function patchComposer(patch: Partial<TenderComposer>) {
    setComposer((prev) => ({ ...prev, ...patch }));
  }

  function addTenderLine() {
    if (remainingPaise <= 0) {
      flash("Collection amount is already fully covered");
      return;
    }
    if (!composer.channel) {
      flash("Choose payment mode & account first");
      return;
    }
    const { mode, bankId } = decodeTenderChannel(composer.channel);
    const meta = TENDER_MODES.find((m) => m.value === mode);
    const amountPaise = Math.round((Number(composer.amount) || 0) * 100);
    if (amountPaise <= 0) {
      flash("Enter amount");
      return;
    }
    if (meta?.needsRef && !composer.ref.trim()) {
      flash(`Enter ${meta.refLabel.toLowerCase()}`);
      return;
    }
    if (meta?.needsInstrumentDate && !composer.instrumentDate) {
      flash("Enter instrument / txn date");
      return;
    }
    if (meta?.needsBank && !composer.bankName.trim()) {
      flash("Enter bank name");
      return;
    }
    setTenderLines((prev) => [
      ...prev,
      {
        key: newTenderKey(),
        mode,
        bankAccountId: bankId,
        amount: composer.amount,
        ref: composer.ref.trim(),
        instrumentDate: composer.instrumentDate,
        bankName: composer.bankName.trim(),
      },
    ]);
    setComposer(emptyComposer());
  }

  function removeTenderLine(key: string) {
    setTenderLines((prev) => prev.filter((t) => t.key !== key));
  }

  function fillRemainingAmount() {
    if (remainingPaise <= 0) return;
    patchComposer({ amount: String(remainingPaise / 100) });
  }

  function onTransferLastSessionDues() {
    if (!selectedStudent || transferablePreviews.length === 0) return;
    const fromAy = transferablePreviews[0]?.fromAy ?? "last session";
    const toAy = transferablePreviews[0]?.toAy ?? ay;
    const names = transferablePreviews
      .map((p) => `• ${p.studentName}: ${formatInr(p.totalPaise)}`)
      .join("\n");
    const ok = window.confirm(
      `Transfer last-session dues (${fromAy} → ${toAy})?\n\n${names}\n\nTotal ${formatInr(transferTotalPaise)}\n\nThis creates arrears on the current session. Students still on ${fromAy} will be moved to ${toAy}.`,
    );
    if (!ok) return;
    const result = transferLastSessionDues({
      studentIds: transferablePreviews.map((p) => p.studentId),
      transferredBy: session.fullName,
      fromAy,
      toAy,
    });
    if (!result.ok) {
      flash(result.error);
      return;
    }
    setSis(loadSis());
    setSelectedKeys(new Set());
    refresh();
    flash(
      `Transferred ${formatInr(result.totalPaise)} from ${fromAy} for ${result.transferred} student${result.transferred === 1 ? "" : "s"}`,
    );
  }

  function onCollect() {
    if (!selectedStudent || !sis || !masters) return;

    const discountOnly = collectTarget <= 0 && counterDiscountPaise > 0;

    if (collectTarget <= 0 && !discountOnly) {
      flash("Enter a collection amount");
      return;
    }
    if (!discountOnly && tenderSum !== collectTarget) {
      flash(
        isPartialCollect
          ? `Payments must equal partial amount (${formatInr(collectTarget)})`
          : `Payments must equal selected dues (${formatInr(collectTarget)})`,
      );
      return;
    }

    if (counterDiscountPaise > 0) {
      const candidates = listFutureConcessionCandidates(
        discountSlices,
        selectedDues,
        masters,
        householdBundle.map((r) => r.student),
        ay,
      );
      if (candidates.length > 0 && !futureConcessionPrompt) {
        setFutureConcessionPrompt({
          candidates,
          selected: new Set(candidates.map((c) => c.key)),
        });
        return;
      }
    }

    executeCollect(futureConcessionPrompt?.selected ?? new Set());
  }

  function executeCollect(applyFutureKeys: Set<string>) {
    if (!selectedStudent || !sis) return;
    setFutureConcessionPrompt(null);

    let futureConcessionMsg = "";

    if (counterDiscountPaise > 0) {
      const waiverResult = postCounterDiscountWaivers({
        slices: discountSlices,
        reason: counterDiscountReason.trim() || "Counter concession",
        createdBy: session.fullName,
        academicYearCode: ay,
      });
      if (!waiverResult.ok) {
        flash(waiverResult.error);
        return;
      }

      if (applyFutureKeys.size > 0 && masters) {
        const candidates = listFutureConcessionCandidates(
          discountSlices,
          selectedDues,
          masters,
          householdBundle.map((r) => r.student),
          ay,
        );
        const futureResult = applyFutureConcessionsFromCounter({
          candidates,
          applyKeys: applyFutureKeys,
          reason: counterDiscountReason.trim() || "Counter concession",
          academicYearCode: ay,
        });
        if (!futureResult.ok) {
          flash(futureResult.error);
          return;
        }
        const bits: string[] = [];
        if (futureResult.granted > 0) {
          bits.push(
            `${futureResult.granted} future grant${futureResult.granted === 1 ? "" : "s"} approved`,
          );
        }
        if (futureResult.pending > 0) {
          bits.push(
            `${futureResult.pending} pending Principal in Concessions`,
          );
        }
        if (futureResult.skipped > 0) {
          bits.push(`${futureResult.skipped} already on file`);
        }
        if (bits.length > 0) futureConcessionMsg = ` · ${bits.join(" · ")}`;
      }

      refresh();
    }

    if (collectTarget <= 0) {
      if (counterDiscountPaise > 0) {
        setSelectedKeys(new Set());
        setCollectAmountRupees("");
        setLineDiscountRupees({});
        setCounterDiscountReason("");
        resetPaymentFields();
        refresh();
        flash(
          `Counter discount ${formatInr(counterDiscountPaise)} posted — no payment collected${futureConcessionMsg}`,
        );
      }
      return;
    }
    const nameById = new Map(
      sis.students.map((s) => [s.id, s.fullName] as const),
    );
    const duesForCollect = freshSelectedDues();
    const alloc = allocateCollectionToDues(
      duesForCollect,
      tenderSum,
      (id) => nameById.get(id) ?? "Student",
    );
    if (!alloc.ok) {
      flash(alloc.error);
      return;
    }
    const lines = alloc.lines;
    const voucherTenders: VoucherTender[] = tenderLines.map((t) => ({
      mode: t.mode,
      amountPaise: Math.round((Number(t.amount) || 0) * 100),
      ref: t.ref,
      instrumentDate: t.instrumentDate,
      bankName: t.bankName,
      bankAccountId: t.bankAccountId || undefined,
      realisation:
        t.mode === "cheque" ? "subject_to_clearance" : "cleared",
    }));

    const primaryTxn =
      voucherTenders.find((t) => t.ref)?.ref ??
      voucherTenders.find((t) => t.instrumentDate)?.instrumentDate ??
      "";
    const primaryTxnDate =
      voucherTenders.find((t) => t.instrumentDate)?.instrumentDate ||
      collectionDate;

    const discountNote =
      counterDiscountPaise > 0
        ? `Counter discount ${formatInr(counterDiscountPaise)}`
        : "";
    const chequeNote = voucherTenders.some(
      (t) => t.realisation === "subject_to_clearance",
    )
      ? "Cheque realisation subject to clearance"
      : "";

    const result = collectPayment({
      householdId: selectedStudent.householdId,
      lines,
      tenders: voucherTenders,
      cashierName: session.fullName,
      academicYearCode: ay,
      collectionDate,
      transactionDate: primaryTxnDate,
      transactionId: primaryTxn,
      schoolReceiptNo,
      note: [note.trim(), discountNote, chequeNote].filter(Boolean).join(" · "),
    });
    if (!result.ok) {
      flash(result.error);
      return;
    }
    setSelectedKeys(new Set());
    setCollectAmountRupees("");
    resetPaymentFields();
    refresh();
    flash(
      (counterDiscountPaise > 0
        ? isPartialCollect
          ? `Discount ${formatInr(counterDiscountPaise)} · partial ${formatInr(result.voucher.totalPaise)} · ${result.voucher.receiptNo}`
          : `Discount ${formatInr(counterDiscountPaise)} · collected ${result.voucher.receiptNo}`
        : isPartialCollect
          ? `Partial collected ${formatInr(result.voucher.totalPaise)} · ${result.voucher.receiptNo}`
          : `Collected ${result.voucher.receiptNo}`) + futureConcessionMsg,
    );
    setPreviewReceiptId(result.voucher.id);
  }

  function onSendUpiLink() {
    if (!selectedStudent || !sis || !masters) return;
    const selectedDues = householdBundle.flatMap((b) =>
      b.dues.filter((d) => selectedKeys.has(d.dueKey)),
    );
    if (selectedDues.length === 0) {
      flash("Select dues to include on the payment link");
      return;
    }
    const className =
      masters.classes.find((c) => c.id === selectedStudent.classId)?.name ??
      "";
    const sectionName =
      masters.sections.find((s) => s.id === selectedStudent.sectionId)
        ?.name ?? "";
    const classLabel = sectionName
      ? `${className}-${sectionName}`
      : className;

    const created = createPaymentLink({
      householdId: selectedStudent.householdId,
      studentId: selectedStudent.id,
      studentName: selectedStudent.fullName,
      classLabel,
      dues: selectedDues,
      createdBy: session.fullName,
      academicYearCode: selectedStudent.academicYearCode || ay,
      note: note.trim(),
    });
    if (!created.ok) {
      flash(created.error);
      return;
    }

    const payload = buildEnrichedPaymentSharePayload(
      created.link,
      TENANT.nameDisplay,
      masters,
    );
    const url = buildPaymentShareUrl(payload);
    const hh = sis.households.find(
      (h) => h.id === selectedStudent.householdId,
    );
    const mobile = householdWhatsApp(hh);
    if (mobile && isValidMobile(mobile)) {
      const msg = composeWhatsAppPaymentLinkMessage(
        created.link,
        url,
        TENANT.nameDisplay,
      );
      window.open(whatsAppPaymentLinkUrl(mobile, msg), "_blank", "noopener");
      flash(
        `UPI link ${created.link.code} · ${formatInr(created.link.amountPaise)} — WhatsApp opened`,
      );
    } else {
      void navigator.clipboard.writeText(url).then(
        () =>
          flash(
            `UPI link ${created.link.code} copied — set WhatsApp on household to send`,
          ),
        () => flash(`Created ${created.link.code}: ${url}`),
      );
    }
    setSelectedKeys(new Set());
    refresh();
    setTab("paylinks");
  }

  function onVoid(id: string) {
    if (!window.confirm("Void this receipt? Dues will reopen.")) return;
    voidVoucher(id);
    if (previewReceiptId === id) setPreviewReceiptId(null);
    refresh();
    flash("Receipt voided");
  }

  return (
    <ErpWorkspaceShell
      title="Fee Take"
      subtitle="Collect academic + transport + special + store dues · counter or UPI link · dated receipt"
      icon={<IndianRupee className="size-6" aria-hidden />}
      notice={notice}
      toolbar={
        <div className={MODULE_TAB_CONTAINER_CLASS}>
          <ModuleTabButton
            active={tab === "dashboard"}
            onClick={() => setTab("dashboard")}
            tone="navy"
            size="md"
          >
            Dashboard
          </ModuleTabButton>
          <ModuleTabButton
            active={tab === "collect"}
            onClick={() => setTab("collect")}
            tone="green"
            size="md"
          >
            Collect
          </ModuleTabButton>
          <ModuleTabButton
            active={tab === "receipts"}
            onClick={() => setTab("receipts")}
            tone="teal"
            size="md"
          >
            Receipts
          </ModuleTabButton>
          <ModuleTabButton
            active={tab === "cheques"}
            onClick={() => setTab("cheques")}
            tone="amber"
            size="md"
          >
            Cheques
            {mounted && openChequeCount > 0 ? ` (${openChequeCount})` : ""}
          </ModuleTabButton>
          <ModuleTabButton
            active={tab === "manual"}
            onClick={() => setTab("manual")}
            tone="slate"
            size="md"
          >
            Manual book
          </ModuleTabButton>
          <ModuleTabButton
            active={tab === "paylinks"}
            onClick={() => setTab("paylinks")}
            tone="sky"
            size="md"
          >
            Pay links
            {mounted && openPayLinkCount > 0 ? ` (${openPayLinkCount})` : ""}
          </ModuleTabButton>
          <ModuleTabButton
            active={tab === "wa_sis"}
            onClick={() => setTab("wa_sis")}
            tone="teal"
            size="md"
          >
            WA parents
          </ModuleTabButton>
          <ModuleTabButton
            active={tab === "dayclose"}
            onClick={() => setTab("dayclose")}
            tone="coral"
            size="md"
          >
            Day close{mounted && dayClosePending ? " ●" : ""}
          </ModuleTabButton>
          <ModuleTabButton
            active={tab === "adjustments"}
            onClick={() => setTab("adjustments")}
            tone="violet"
            size="md"
          >
            Adjustments
            {mounted ? <FeeAdjustmentsBadge /> : null}
          </ModuleTabButton>
          <ModuleTabButton
            active={tab === "vouchers"}
            onClick={() => setTab("vouchers")}
            tone="rose"
            size="md"
          >
            Vouchers
            {mounted && openChargeCount > 0 ? ` (${openChargeCount})` : ""}
          </ModuleTabButton>
          <ModuleTabButton
            active={tab === "reports"}
            onClick={() => setTab("reports")}
            tone="green"
            size="md"
          >
            Reports
          </ModuleTabButton>
          <Link
            href="/fees/defaulters"
            className="inline-flex items-center rounded-lg bg-[rgba(180,35,24,0.12)] px-3 py-2 text-sm font-bold text-[#b42318] transition hover:bg-[rgba(180,35,24,0.2)]"
          >
            Defaulters
          </Link>
        </div>
      }
    >
      {tab === "collect" ? (
        <div className="mt-6 space-y-5">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)]">
              <label className="block text-sm">
                <span className="mb-1.5 block text-[var(--muted)]">
                  Find student
                </span>
                <input
                  className="field"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, admission no, or mobile…"
                  autoComplete="off"
                  autoFocus={mounted}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block text-[var(--muted)]">Class</span>
                <select
                  className="field"
                  value={classId}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    setSectionId("");
                  }}
                >
                  <option value="">All classes</option>
                  {classOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block text-[var(--muted)]">Section</span>
                <select
                  className="field"
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                  disabled={!classId}
                >
                  <option value="">
                    {classId ? "All sections" : "Pick class first"}
                  </option>
                  {sectionOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-[var(--muted)]">
                PDF / Excel exports the current search &amp; class filter (
                {hits.length} student{hits.length === 1 ? "" : "s"}).
              </p>
              <FilterExportButtons
                title="Fee Take · student search"
                subtitle={`${TENANT.shortName} · ${ay}`}
                filterNote={describeFilters([
                  classOptions.find((c) => c.id === classId)?.name
                    ? `Class ${classOptions.find((c) => c.id === classId)?.name}`
                    : "",
                  sectionOptions.find((s) => s.id === sectionId)?.name
                    ? `Sec ${sectionOptions.find((s) => s.id === sectionId)?.name}`
                    : "",
                  query.trim() ? `Search “${query.trim()}”` : "",
                ])}
                fileBaseName="fee_take_students"
                columns={[
                  { key: "admissionNo", header: "Adm no", width: 1.1 },
                  { key: "fullName", header: "Name", width: 1.6 },
                  { key: "classLabel", header: "Class", width: 0.9 },
                  { key: "type", header: "Type", width: 0.9 },
                  { key: "mobile", header: "Mobile", width: 1 },
                  {
                    key: "balance",
                    header: "Open balance",
                    width: 1,
                    align: "right",
                  },
                ]}
                rows={hits.map((h) => ({
                  admissionNo: h.student.admissionNo,
                  fullName: h.student.fullName,
                  classLabel: h.classLabel,
                  type: h.student.studentType,
                  mobile: h.household?.mobile ?? "",
                  balance: formatInr(h.balancePaise),
                }))}
                onMessage={flash}
              />
            </div>

            {/* Compact match strip — replaces left list */}
            {(query.trim() || classId || sectionId) && !selectedStudent ? (
              <div className="mt-3">
                <p className="mb-2 text-[11px] text-[var(--muted)]">
                  {hits.length} match{hits.length === 1 ? "" : "es"} — pick one
                  to open household
                </p>
                {hits.length === 0 ? (
                  <p className="rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-3 text-sm text-[var(--muted)]">
                    No students match. Check fee group on SIS if balances look
                    empty.
                  </p>
                ) : (
                  <ul className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                    {hits.map((h) => (
                      <li key={h.student.id}>
                        <button
                          type="button"
                          onClick={() => pickStudent(h)}
                          className="rounded-lg border border-[rgba(32,48,80,0.14)] bg-[rgba(32,48,80,0.03)] px-3 py-2 text-left hover:border-[rgba(197,160,40,0.45)] hover:bg-[rgba(197,160,40,0.1)]"
                        >
                          <div className="text-sm font-semibold text-[var(--brand-deep)]">
                            <StudentNameLabel student={h.student} />
                          </div>
                          <div className="text-[11px] text-[var(--muted)]">
                            {h.classLabel} · {formatInr(h.balancePaise)}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {selectedStudent ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[rgba(32,48,80,0.08)] pt-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="text-sm text-[var(--brand-deep)]">
                    <span className="font-semibold">
                      {selectedStudent.fullName}
                    </span>
                    <span className="text-[var(--muted)]">
                      {" "}
                      · {selectedStudent.admissionNo} · household open
                      {householdBundle.length > 1
                        ? ` · ${householdBundle.length} siblings`
                        : ""}
                    </span>
                  </div>
                  <WhatsAppInline
                    household={
                      sis?.households.find(
                        (h) => h.id === selectedStudent.householdId,
                      ) ?? null
                    }
                    onUpdated={() => {
                      refresh();
                      flash("WhatsApp number updated for all communications");
                    }}
                  />
                  <button
                    type="button"
                    title={
                      householdBundle.length > 1
                        ? `Download Fee Agreement PDF (${householdBundle.length} siblings combined)`
                        : "Download Fee Agreement PDF"
                    }
                    aria-label="Download Fee Agreement PDF"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E53935]/35 bg-[#FFF5F5] px-2.5 text-[11px] font-bold text-[#B71C1C] transition hover:border-[#E53935] hover:bg-[#FFEBEE]"
                    onClick={async () => {
                      try {
                        const members =
                          householdBundle.length > 0
                            ? householdBundle.map((b) => b.student)
                            : sis && selectedStudent
                              ? householdSiblingIds(sis, selectedStudent)
                              : [selectedStudent];
                        const docs = members.map((s) =>
                          buildFeeAgreementDoc(s, {
                            masters: masters ?? undefined,
                            sis: sis ?? undefined,
                            fees: loadFees(),
                          }),
                        );
                        await downloadFeeAgreementPdf(docs, {
                          masters: masters ?? undefined,
                        });
                        flash(
                          members.length > 1
                            ? `Fee Agreement PDF · ${members.length} siblings combined`
                            : "Fee Agreement PDF downloaded",
                        );
                      } catch (e) {
                        flash(
                          e instanceof Error
                            ? e.message
                            : "Could not build Fee Agreement",
                        );
                      }
                    }}
                  >
                    <FeeAgreementPdfLogo className="h-5 w-5 shrink-0" />
                    Agreement
                    {householdBundle.length > 1
                      ? ` (${householdBundle.length})`
                      : ""}
                  </button>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-xs font-semibold text-[var(--brand-mid)]"
                  onClick={() => {
                    setSelectedId(null);
                    setSelectedKeys(new Set());
                    resetPaymentFields();
                  }}
                >
                  Change student
                </button>
              </div>
            ) : null}
          </div>

          {!selectedStudent ? (
            <div className="rounded-xl border border-dashed border-[rgba(32,48,80,0.2)] bg-white px-6 py-16 text-center">
              <p className="text-base font-semibold text-[var(--brand-deep)]">
                Search to start Fee Take
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
                Type a name, admission number, or mobile — or filter by class.
                Matches appear as chips above; the household dues panel fills
                this space.
              </p>
            </div>
          ) : (
            <CollectPanel
              student={selectedStudent}
              householdBundle={householdBundle}
              selectedKeys={selectedKeys}
              includeFuture={includeFuture}
              onIncludeFuture={setIncludeFuture}
              onToggle={toggleDue}
              onToggleMonth={toggleMonth}
              onSelectOverdue={selectOverdue}
              onSelectAllSiblings={selectAllSiblings}
              onClear={clearSelection}
              onToggleStudentAll={toggleStudentAll}
              onSelectStudentOverdue={selectStudentOverdue}
              onClearStudent={clearStudentDues}
              collectTotal={collectTotal}
              counterDiscountPaise={counterDiscountPaise}
              discountSlices={discountSlices}
              netAfterDiscount={netAfterDiscount}
              lineDiscountRupees={lineDiscountRupees}
              onLineDiscount={(dueKey, rupees) => {
                setLineDiscountRupees((prev) => {
                  const next = { ...prev };
                  if (!rupees.trim()) delete next[dueKey];
                  else next[dueKey] = rupees;
                  return next;
                });
              }}
              counterDiscountReason={counterDiscountReason}
              onCounterDiscountReason={setCounterDiscountReason}
              collectTarget={collectTarget}
              isPartialCollect={isPartialCollect}
              collectAmountRupees={collectAmountRupees}
              onCollectAmount={(v) => {
                setCollectAmountRupees(v);
                setTenderLines([]);
                setComposer(emptyComposer());
              }}
              onFillFullSelected={() => {
                if (netAfterDiscount > 0) {
                  setCollectAmountRupees(String(netAfterDiscount / 100));
                  setTenderLines([]);
                  setComposer(emptyComposer());
                }
              }}
              tenderLines={tenderLines}
              composer={composer}
              tenderSum={tenderSum}
              remainingPaise={remainingPaise}
              collectionDate={collectionDate}
              schoolReceiptNo={schoolReceiptNo}
              note={note}
              onPatchComposer={patchComposer}
              onAddTender={addTenderLine}
              onRemoveTender={removeTenderLine}
              onFillRemaining={fillRemainingAmount}
              onCollectionDate={setCollectionDate}
              onSchoolReceiptNo={setSchoolReceiptNo}
              onNote={setNote}
              onCollect={onCollect}
              onSendUpiLink={onSendUpiLink}
              masters={masters}
              cashierName={session.fullName}
              priorReceipts={householdReceipts}
              readOnly={readOnly}
              onOpenReceipt={setPreviewReceiptId}
              transferPreviews={lastSessionPreviews}
              onTransferLastSession={onTransferLastSessionDues}
            />
          )}
        </div>
      ) : tab === "receipts" ? (
        <ReceiptsPanel
          receipts={receipts}
          sis={sis}
          masters={masters}
          onVoid={onVoid}
          onPreview={setPreviewReceiptId}
        />
      ) : tab === "cheques" ? (
        <ChequesPanel
          tick={tick}
          sis={sis}
          onChanged={() => {
            refresh();
            flash("Cheque register updated");
          }}
          onOpenReceipt={(voucherId) => {
            setPreviewReceiptId(voucherId);
          }}
        />
      ) : tab === "manual" ? (
        <ManualBookPanel
          tick={tick}
          cashierName={session.fullName}
          academicYearCode={ay}
          onPosted={(voucherId) => {
            refresh();
            setPreviewReceiptId(voucherId);
            flash("Manual receipt posted to ledger");
          }}
          onOpenReceipt={setPreviewReceiptId}
        />
      ) : tab === "paylinks" ? (
        <PayLinksPanel
          tick={tick}
          cashierName={session.fullName}
          onChanged={() => {
            refresh();
          }}
          onOpenReceipt={setPreviewReceiptId}
        />
      ) : tab === "wa_sis" ? (
        <SisParentWaInbox by={session.fullName} canEdit />
      ) : tab === "dayclose" ? (
        <DayClosePanel
          tick={tick}
          cashierName={session.fullName}
          onChanged={() => {
            refresh();
          }}
          onOpenReceipt={setPreviewReceiptId}
        />
      ) : tab === "adjustments" ? (
        <FeeAdjustmentsPanel
          onChanged={() => {
            refresh();
          }}
        />
      ) : tab === "vouchers" ? (
        <ChargeVouchersPanel
          tick={tick}
          onChanged={() => {
            refresh();
            flash("Charge voucher updated — open on Collect");
          }}
        />
      ) : tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="fees"
          refreshKey={tick}
          onNavigateTab={(t) => setTab(t as Tab)}
          onTableRowClick={(row) => {
            const id = row.voucherId ?? row.id;
            if (id) setPreviewReceiptId(String(id));
          }}
        />
      ) : tab === "reports" ? (
        <FeeReportsPanel
          tick={tick}
          onMastersChanged={() => {
            refresh();
          }}
        />
      ) : null}

      {previewVoucher ? (
        <ReceiptPreviewModal
          voucher={previewVoucher}
          sis={sis}
          masters={masters}
          onClose={() => setPreviewReceiptId(null)}
          onSentWhatsApp={() => {
            refresh();
            flash("Fee receipt delivered on WhatsApp (PDF + digital link)");
          }}
        />
      ) : null}

      {futureConcessionPrompt ? (
        <FutureConcessionModal
          candidates={futureConcessionPrompt.candidates}
          selectedKeys={futureConcessionPrompt.selected}
          onToggle={(key) => {
            setFutureConcessionPrompt((prev) => {
              if (!prev) return prev;
              const next = new Set(prev.selected);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return { ...prev, selected: next };
            });
          }}
          onCancel={() => {
            setFutureConcessionPrompt(null);
            executeCollect(new Set());
          }}
          onConfirm={() => {
            executeCollect(futureConcessionPrompt.selected);
          }}
        />
      ) : null}
    </ErpWorkspaceShell>
  );
}

function FeeSummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "paid" | "current" | "total" | "refund" | "voucher";
}) {
  const styles: Record<
    typeof tone,
    { box: string; label: string; value: string }
  > = {
    paid: {
      box: "border-[#86efac] bg-[#f0fdf4]",
      label: "text-[#15803d]",
      value: "text-[#14532d]",
    },
    current: {
      box: "border-[#fcd34d] bg-[#fffbeb]",
      label: "text-[#b45309]",
      value: "text-[#92400e]",
    },
    total: {
      box: "border-[#fca5a5] bg-[#fef2f2]",
      label: "text-[#b91c1c]",
      value: "text-[#7f1d1d]",
    },
    refund: {
      box: "border-[#7dd3fc] bg-[#f0f9ff]",
      label: "text-[#0369a1]",
      value: "text-[#0c4a6e]",
    },
    voucher: {
      box: "border-[#c4b5fd] bg-[#f5f3ff]",
      label: "text-[#6d28d9]",
      value: "text-[#4c1d95]",
    },
  };
  const s = styles[tone];
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${s.box}`}>
      <div className={`text-xs font-bold uppercase tracking-wide sm:text-sm ${s.label}`}>
        {label}
      </div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums sm:text-xl ${s.value}`}>
        {formatInr(value)}
      </div>
    </div>
  );
}

function CollectPanel({
  student,
  householdBundle,
  selectedKeys,
  includeFuture,
  onIncludeFuture,
  onToggle,
  onToggleMonth,
  onSelectOverdue,
  onSelectAllSiblings,
  onClear,
  onToggleStudentAll,
  onSelectStudentOverdue,
  onClearStudent,
  collectTotal,
  counterDiscountPaise,
  discountSlices,
  netAfterDiscount,
  lineDiscountRupees,
  onLineDiscount,
  counterDiscountReason,
  onCounterDiscountReason,
  collectTarget,
  isPartialCollect,
  collectAmountRupees,
  onCollectAmount,
  onFillFullSelected,
  tenderLines,
  composer,
  tenderSum,
  remainingPaise,
  collectionDate,
  schoolReceiptNo,
  note,
  onPatchComposer,
  onAddTender,
  onRemoveTender,
  onFillRemaining,
  onCollectionDate,
  onSchoolReceiptNo,
  onNote,
  onCollect,
  onSendUpiLink,
  masters,
  cashierName,
  priorReceipts,
  onOpenReceipt,
  transferPreviews,
  onTransferLastSession,
  readOnly = false,
}: {
  student: SisStudent;
  householdBundle: { student: SisStudent; dues: FeeDueLine[] }[];
  selectedKeys: Set<string>;
  includeFuture: boolean;
  onIncludeFuture: (v: boolean) => void;
  onToggle: (d: FeeDueLine) => void;
  onToggleMonth: (monthDues: FeeDueLine[], select: boolean) => void;
  onSelectOverdue: () => void;
  onSelectAllSiblings: () => void;
  onClear: () => void;
  onToggleStudentAll: (studentId: string) => void;
  onSelectStudentOverdue: (studentId: string) => void;
  onClearStudent: (studentId: string) => void;
  collectTotal: number;
  counterDiscountPaise: number;
  discountSlices: CounterDiscountSlice[];
  netAfterDiscount: number;
  lineDiscountRupees: Record<string, string>;
  onLineDiscount: (dueKey: string, rupees: string) => void;
  counterDiscountReason: string;
  onCounterDiscountReason: (v: string) => void;
  collectTarget: number;
  isPartialCollect: boolean;
  collectAmountRupees: string;
  onCollectAmount: (v: string) => void;
  onFillFullSelected: () => void;
  tenderLines: TenderLine[];
  composer: TenderComposer;
  tenderSum: number;
  remainingPaise: number;
  collectionDate: string;
  schoolReceiptNo: string;
  note: string;
  onPatchComposer: (patch: Partial<TenderComposer>) => void;
  onAddTender: () => void;
  onRemoveTender: (key: string) => void;
  onFillRemaining: () => void;
  onCollectionDate: (v: string) => void;
  onSchoolReceiptNo: (v: string) => void;
  onNote: (v: string) => void;
  onCollect: () => void;
  onSendUpiLink: () => void;
  masters: MastersState | null;
  cashierName: string;
  priorReceipts: CollectionVoucher[];
  onOpenReceipt: (id: string) => void;
  transferPreviews: LastSessionTransferPreview[];
  onTransferLastSession: () => void;
  readOnly?: boolean;
}) {
  const today = todayIso();
  const composerMode = composer.channel
    ? decodeTenderChannel(composer.channel).mode
    : ("" as TenderMode | "");
  const modeMeta = TENDER_MODES.find((m) => m.value === composerMode);
  const hasUncleared = tenderLines.some((t) => t.mode === "cheque");
  const siblingCount = householdBundle.length;
  const allHouseholdDues = householdBundle.flatMap((r) => r.dues);

  const feeSummary = useMemo(() => {
    let totalPaidPaise = 0;
    let currentDuePaise = 0;
    let totalDuePaise = 0;
    let refundPaise = 0;
    let voucherDuePaise = 0;

    for (const d of allHouseholdDues) {
      totalPaidPaise += d.paidPaise;
      if (d.balancePaise > 0) {
        totalDuePaise += d.balancePaise;
        if (d.dueOn <= today) currentDuePaise += d.balancePaise;
        if (d.kind === "voucher") voucherDuePaise += d.balancePaise;
      }
      const netBill = Math.max(0, d.billedPaise - d.concessionPaise);
      const excess = d.paidPaise - netBill;
      if (excess > 0) refundPaise += excess;
    }

    // Prefer live receipt totals when available (household collections)
    const receiptPaid = priorReceipts
      .filter((v) => !v.voidedAt)
      .reduce((s, v) => s + v.totalPaise, 0);
    if (receiptPaid > totalPaidPaise) totalPaidPaise = receiptPaid;

    return {
      totalPaidPaise,
      currentDuePaise,
      totalDuePaise,
      refundPaise,
      voucherDuePaise,
    };
  }, [allHouseholdDues, priorReceipts, today]);

  const householdDueTotal = feeSummary.totalDuePaise;
  const canTransfer = transferPreviews.filter((p) => p.canTransfer);
  const transferTotal = canTransfer.reduce((s, p) => s + p.totalPaise, 0);
  const transferHint = transferPreviews.find(
    (p) =>
      !p.canTransfer &&
      !!p.reason &&
      (p.alreadyTransferredPaise > 0 ||
        p.reason.includes("fee groups") ||
        p.reason.includes("Set their session")),
  )?.reason;

  const allocationPreview = useMemo(() => {
    if (!isPartialCollect || collectTarget <= 0) {
      return null;
    }
    const nameById = new Map(
      householdBundle.map((r) => [r.student.id, r.student.fullName] as const),
    );
    const selected = allHouseholdDues.filter((d) => selectedKeys.has(d.dueKey));
    const alloc = allocateCollectionToDues(
      selected,
      collectTarget,
      (id) => nameById.get(id) ?? "Student",
    );
    return alloc.ok ? alloc.lines : null;
  }, [
    isPartialCollect,
    collectTarget,
    allHouseholdDues,
    selectedKeys,
    householdBundle,
  ]);

  function classLabel(s: SisStudent) {
    const c = masters?.classes.find((x) => x.id === s.classId)?.name ?? "—";
    const sec = masters?.sections.find((x) => x.id === s.sectionId)?.name ?? "";
    return sec ? `${c}-${sec}` : c;
  }

  function feeGroupLabel(s: SisStudent) {
    if (!s.feeGroupId) return "No fee group";
    return (
      masters?.feeGroups.find((g) => g.id === s.feeGroupId)?.name ?? "Fee group"
    );
  }

  return (
    <div className="fee-collect-ui space-y-4">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--brand-deep)] sm:text-xl">
              Household fees
            </h2>
            <p className="mt-0.5 text-sm text-[var(--muted)] sm:text-base">
              {siblingCount} student{siblingCount === 1 ? "" : "s"}
              {siblingCount > 1 ? " (siblings)" : ""} · open dues{" "}
              <span
                className={`font-semibold ${
                  householdBundle.some((r) =>
                    openFeeDues(r.dues).some((d) => d.dueOn <= today),
                  )
                    ? "text-[#dc2626]"
                    : "text-[var(--brand-deep)]"
                }`}
              >
                {formatInr(householdDueTotal)}
              </span>
              {" · "}
              selected{" "}
              <span
                className={`font-semibold ${
                  collectTarget > 0 ? "text-[#16a34a]" : "text-[var(--muted)]"
                }`}
              >
                {formatInr(collectTarget)}
              </span>
              {isPartialCollect ? (
                <span className="text-[var(--muted)]">
                  {" "}
                  of {formatInr(netAfterDiscount)} after discount
                </span>
              ) : counterDiscountPaise > 0 ? (
                <span className="text-[var(--muted)]">
                  {" "}
                  ({formatInr(collectTotal)} − {formatInr(counterDiscountPaise)}{" "}
                  discount)
                </span>
              ) : null}
              <span className="mt-0.5 block font-normal text-sm leading-snug">
                Grouped by month — tick a month or only the heads to clear
              </span>
            </p>
          </div>
          <label className="flex max-w-[14rem] items-start gap-2 text-sm text-[var(--muted)] sm:text-base">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeFuture}
              onChange={(e) => onIncludeFuture(e.target.checked)}
            />
            <span>
              Include future months
              <span className="mt-0.5 block font-normal text-sm leading-snug">
                Off = only through this month
              </span>
            </span>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <FeeSummaryChip
            label="Total Paids"
            value={feeSummary.totalPaidPaise}
            tone="paid"
          />
          <FeeSummaryChip
            label="Current Due"
            value={feeSummary.currentDuePaise}
            tone="current"
          />
          <FeeSummaryChip
            label="Total Due"
            value={feeSummary.totalDuePaise}
            tone="total"
          />
          <FeeSummaryChip
            label="Refund Amount"
            value={feeSummary.refundPaise}
            tone="refund"
          />
          <FeeSummaryChip
            label="Voucher Due"
            value={feeSummary.voucherDuePaise}
            tone="voucher"
          />
        </div>

        {canTransfer.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[rgba(220,38,38,0.25)] bg-[rgba(220,38,38,0.06)] px-3 py-2.5 text-xs text-[var(--brand-deep)]">
            <div>
              <strong>Last session dues:</strong>{" "}
              {canTransfer.length === 1
                ? canTransfer[0]!.studentName
                : `${canTransfer.length} students`}{" "}
              · {canTransfer[0]?.fromAy} → {canTransfer[0]?.toAy} ·{" "}
              <strong>{formatInr(transferTotal)}</strong>
              <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                Bring unpaid {canTransfer[0]?.fromAy} balances into this session
                as arrears
              </span>
            </div>
            <button
              type="button"
              className="rounded-lg border border-[rgba(220,38,38,0.35)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#b91c1c]"
              onClick={onTransferLastSession}
            >
              Transfer to current session
            </button>
          </div>
        ) : transferHint ? (
          <p className="mt-3 text-[11px] leading-snug text-[var(--muted)]">
            Last session transfer: {transferHint}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {siblingCount > 1 ? (
            <MiniBtn onClick={onSelectAllSiblings}>
              Select all siblings
            </MiniBtn>
          ) : (
            <MiniBtn onClick={onSelectAllSiblings}>Select all dues</MiniBtn>
          )}
          <MiniBtn onClick={onSelectOverdue}>Select all overdue</MiniBtn>
          <MiniBtn onClick={onClear}>Clear all</MiniBtn>
        </div>

        <div
          className={`mt-4 grid max-h-[min(70vh,40rem)] gap-3 overflow-auto ${
            siblingCount > 1
              ? "sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(17rem,1fr))]"
              : "grid-cols-1"
          }`}
        >
          {householdBundle.every((r) => openFeeDues(r.dues).length === 0) &&
          householdBundle.every((r) => r.dues.length === 0) ? (
            <p className="text-sm text-[var(--muted)] sm:col-span-full">
              No open dues
              {!student.feeGroupId
                ? " — assign a fee group on the student profile"
                : ""}
              .
            </p>
          ) : (
            householdBundle.map((row) => {
              const openDues = openFeeDues(row.dues);
              const dueKeys = openDues.map((d) => d.dueKey);
              const selectedForStudent = openDues.filter((d) =>
                selectedKeys.has(d.dueKey),
              );
              const allSelected =
                dueKeys.length > 0 &&
                dueKeys.every((k) => selectedKeys.has(k));
              const someSelected =
                !allSelected && selectedForStudent.length > 0;
              const rowTotal = openDues.reduce(
                (s, d) => s + d.balancePaise,
                0,
              );
              const rowSelected = selectedForStudent.reduce(
                (s, d) => s + d.balancePaise,
                0,
              );
              const hasOverdue = openDues.some((d) => d.dueOn <= today);
              const isFocus = row.student.id === student.id;
              const isSibling = !isFocus && siblingCount > 1;

              return (
                <div
                  key={row.student.id}
                  className={`flex min-h-0 flex-col rounded-xl border p-3 ${
                    isFocus
                      ? "border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.06)]"
                      : "border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.02)]"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <label className="flex min-w-0 cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        className="mt-1.5"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected;
                        }}
                        onChange={() => onToggleStudentAll(row.student.id)}
                        disabled={openDues.length === 0}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[var(--brand-deep)]">
                          <StudentNameLabel student={row.student} />
                          {isSibling ? (
                            <span className="ml-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                              Sibling
                            </span>
                          ) : siblingCount > 1 ? (
                            <span className="ml-2 text-sm font-semibold uppercase tracking-wide text-[var(--brand-gold)]">
                              Opened
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-sm text-[var(--muted)] sm:text-base">
                          {row.student.admissionNo} · {classLabel(row.student)}
                        </div>
                        <div className="text-sm text-[var(--muted)]">
                          {feeGroupLabel(row.student)}
                        </div>
                      </div>
                    </label>
                    <div className="text-right">
                      <div
                        className={`text-base font-bold sm:text-lg ${
                          hasOverdue
                            ? "text-[#dc2626]"
                            : rowTotal === 0 && row.dues.length > 0
                              ? "text-[#15803d]"
                              : "text-[var(--brand-deep)]"
                        }`}
                      >
                        {formatInr(rowTotal)}
                      </div>
                      <div
                        className={`text-sm font-semibold sm:text-base ${
                          rowSelected > 0
                            ? "text-[#16a34a]"
                            : "text-[var(--muted)]"
                        }`}
                      >
                        {selectedForStudent.length}/{openDues.length} open ·{" "}
                        {formatInr(rowSelected)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <MiniBtn
                      onClick={() => onToggleStudentAll(row.student.id)}
                    >
                      {allSelected ? "Unselect" : "Select child"}
                    </MiniBtn>
                    <MiniBtn
                      onClick={() => onSelectStudentOverdue(row.student.id)}
                    >
                      Overdue
                    </MiniBtn>
                    {someSelected || allSelected ? (
                      <MiniBtn onClick={() => onClearStudent(row.student.id)}>
                        Clear
                      </MiniBtn>
                    ) : null}
                  </div>

                  {row.dues.length === 0 ? (
                    <p className="mt-2 text-sm text-[var(--muted)] sm:text-base">
                      No fee lines for this student
                    </p>
                  ) : (
                    <>
                      <TransportFeeSchedulePanel
                        studentId={row.student.id}
                        academicYearCode={row.student.academicYearCode}
                        dues={row.dues}
                      />
                      <DueBreakupPicker
                      dues={row.dues}
                      selectedKeys={selectedKeys}
                      today={today}
                      onToggle={onToggle}
                      onToggleMonth={onToggleMonth}
                      lineDiscountRupees={lineDiscountRupees}
                      onLineDiscount={onLineDiscount}
                    />
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div
        className="relative overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.14)] shadow-[0_12px_40px_rgba(32,48,80,0.1)]"
        style={{
          background:
            "linear-gradient(165deg, #203050 0%, #2a3d66 42%, #1a2740 100%)",
        }}
      >
        <div
          className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-[rgba(197,160,40,0.18)] blur-2xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-16 left-10 h-44 w-44 rounded-full bg-[rgba(197,160,40,0.12)] blur-3xl"
          aria-hidden
        />
        <div className="relative p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#f0d878] sm:text-base">
                Counter collection
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-4xl font-extrabold tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)] sm:text-5xl">
                  {formatInr(collectTarget)}
                </span>
                {isPartialCollect ? (
                  <span className="text-base font-semibold text-[#f0d878] sm:text-lg">
                    partial · {formatInr(netAfterDiscount)} net
                  </span>
                ) : counterDiscountPaise > 0 ? (
                  <span className="text-base font-semibold text-[#f0d878] sm:text-lg">
                    after {formatInr(counterDiscountPaise)} discount
                  </span>
                ) : siblingCount > 1 ? (
                  <span className="rounded-full bg-[#c5a028] px-2.5 py-0.5 text-xs font-bold text-[#1a2740] sm:text-sm">
                    Household · {siblingCount} students
                  </span>
                ) : (
                  <span className="text-base font-semibold text-[#f0d878] sm:text-lg">
                    to collect
                  </span>
                )}
              </div>
            </div>
            <label className="block text-base">
              <span className="mb-1 block text-sm font-medium text-white/75">
                Collection date
              </span>
              <input
                className="field !border-white/20 !bg-white/95 !py-2 !text-base !text-[var(--brand-deep)] sm:!text-lg"
                type="date"
                value={collectionDate}
                onChange={(e) => onCollectionDate(e.target.value)}
                required
              />
              {isCollectionDateLocked(collectionDate) ? (
                <span className="mt-1 block text-sm font-semibold leading-snug text-[#fca5a5]">
                  This date is day-closed — pick another date or reject handover
                </span>
              ) : null}
            </label>
            <label className="block min-w-[10rem] text-base sm:min-w-[12rem]">
              <span className="mb-1 block text-sm font-medium text-white/75">
                School receipt no.
              </span>
              <input
                className="field !border-white/20 !bg-white/95 !py-2 !text-base !text-[var(--brand-deep)] sm:!text-lg"
                value={schoolReceiptNo}
                onChange={(e) => onSchoolReceiptNo(e.target.value)}
                placeholder="Optional · e.g. FEE-BOOK-A/4521"
                autoComplete="off"
              />
              <span className="mt-1 block text-sm leading-snug text-white/65">
                Same pool as Manual book leaves — duplicates blocked. Prefer
                Manual book tab for full paper postings.
              </span>
            </label>
          </div>

          {collectTotal > 0 && counterDiscountPaise > 0 ? (
            <div className="mt-4 rounded-xl border border-[rgba(197,160,40,0.35)] bg-[rgba(255,255,255,0.06)] px-3 py-3 backdrop-blur-sm sm:px-4">
              <p className="text-sm font-bold uppercase tracking-[0.12em] text-[#f0d878]">
                Head-wise discount summary
              </p>
              <ul className="mt-2 space-y-1 text-sm text-white/90 sm:text-base">
                {discountSlices.map((s) => (
                  <li
                    key={s.dueKey}
                    className="flex justify-between gap-2 rounded-md bg-white/5 px-2 py-1"
                  >
                    <span className="min-w-0 truncate">{s.label}</span>
                    <span className="shrink-0 font-bold text-[#f0d878]">
                      −{formatInr(s.amountPaise)}
                    </span>
                  </li>
                ))}
              </ul>
              <label className="mt-3 block text-base">
                <span className="mb-1 block text-sm font-medium text-white/75">
                  Reason for discount
                </span>
                <input
                  className="field w-full !border-white/25 !bg-white !py-2.5 !text-base !text-[var(--brand-deep)]"
                  value={counterDiscountReason}
                  onChange={(e) => onCounterDiscountReason(e.target.value)}
                  placeholder="e.g. Security deposit relaxed on management approval"
                  autoComplete="off"
                />
              </label>
              <p className="mt-2 text-sm leading-snug text-white/65">
                Waivers post on collect · auto-limit{" "}
                {formatInr(FEE_ADJUST_AUTO_LIMIT_PAISE)} per head
              </p>
            </div>
          ) : null}

          {collectTotal > 0 ? (
            <div className="mt-4 rounded-xl border border-[rgba(197,160,40,0.45)] bg-[rgba(255,255,255,0.08)] px-3 py-3 backdrop-blur-sm sm:px-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <label className="block min-w-[11rem] flex-1 text-base">
                  <span className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-[#f0d878] sm:text-base">
                    Amount to collect
                    {isPartialCollect ? (
                      <span className="rounded-full bg-[#c5a028] px-2 py-0.5 text-xs font-extrabold tracking-wide text-[#1a2740] sm:text-sm">
                        Partial
                      </span>
                    ) : null}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-white/80">₹</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      max={netAfterDiscount / 100}
                      className="field w-full !border-white/25 !bg-white !py-3 !text-2xl !font-bold !text-[var(--brand-deep)] sm:!text-3xl"
                      value={collectAmountRupees}
                      onChange={(e) => onCollectAmount(e.target.value)}
                      placeholder="0"
                      aria-label="Amount to collect in rupees"
                    />
                  </div>
                  <span className="mt-1 block text-sm leading-snug text-white/70 sm:text-base">
                    {counterDiscountPaise > 0
                      ? `Net due ${formatInr(netAfterDiscount)} after discount — lower for partial pay`
                      : `Selected dues ${formatInr(collectTotal)} — lower for partial payment (oldest months first)`}
                  </span>
                </label>
                {isPartialCollect ? (
                  <button
                    type="button"
                    className="rounded-lg border border-white/25 bg-white/10 px-3 py-2.5 text-sm font-bold text-white hover:bg-white/15 sm:text-base"
                    onClick={onFillFullSelected}
                  >
                    Use full {formatInr(netAfterDiscount)}
                  </button>
                ) : null}
              </div>
              {allocationPreview && allocationPreview.length > 0 ? (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <p className="text-sm font-bold uppercase tracking-wide text-white/65">
                    Will apply to
                  </p>
                  <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto text-sm text-white/90 sm:text-base">
                    {allocationPreview.map((l) => (
                      <li
                        key={`${l.dueKey}-${l.amountPaise}`}
                        className="flex justify-between gap-2 rounded-md bg-white/5 px-2 py-1"
                      >
                        <span className="min-w-0 truncate">{l.label}</span>
                        <span className="shrink-0 font-bold tabular-nums text-[#f0d878]">
                          {formatInr(l.amountPaise)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Added payments */}
          {tenderLines.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {tenderLines.map((t, i) => (
                <li
                  key={t.key}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 backdrop-blur-sm"
                >
                  <div className="min-w-0 text-base sm:text-lg">
                    <div className="font-semibold text-white">
                      <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--brand-gold)] text-xs font-bold text-[var(--brand-deep)] sm:text-sm">
                        {i + 1}
                      </span>
                      {tenderChannelLabel(
                        encodeTenderChannel(t.mode, t.bankAccountId),
                      )}{" "}
                      ·{" "}
                      {formatInr(Math.round((Number(t.amount) || 0) * 100))}
                    </div>
                    <div className="mt-0.5 text-sm text-white/75 sm:text-base">
                      {[t.ref, t.instrumentDate, t.bankName]
                        .filter(Boolean)
                        .join(" · ")}
                      {t.mode === "cheque"
                        ? " · Subject to realisation"
                        : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-[#ffb4a8] hover:bg-white/15 sm:text-base"
                    onClick={() => onRemoveTender(t.key)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Single-row composer — locked when amount already fully matched */}
          {collectTarget > 0 && tenderSum >= collectTarget ? (
            <div className="mt-4 rounded-xl border border-[rgba(60,160,100,0.45)] bg-[rgba(60,160,100,0.12)] px-3 py-2.5 text-base font-semibold text-[#b8f0cc] sm:text-lg">
              Amount fully matched — remove a payment if you need to change modes.
            </div>
          ) : (
          <div className="mt-4 rounded-xl border border-[rgba(197,160,40,0.35)] bg-[rgba(248,248,240,0.97)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-extrabold uppercase tracking-[0.14em] text-[var(--brand-deep)] sm:text-base">
                {tenderLines.length === 0 ? "Add payment" : "Add another"}
              </div>
              {remainingPaise > 0 && composer.channel ? (
                <button
                  type="button"
                  className="rounded-full bg-[rgba(197,160,40,0.2)] px-3 py-1 text-sm font-bold text-[var(--brand-deep)] sm:text-base"
                  onClick={onFillRemaining}
                >
                  Use remaining {formatInr(remainingPaise)}
                </button>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
              <label className="block min-w-0 flex-1 text-base lg:max-w-[14rem]">
                <span className="mb-1 block text-sm font-medium text-[var(--muted)] sm:text-base">
                  Mode & account
                </span>
                <PaymentChannelSelect
                  className="field !border-[rgba(32,48,80,0.18)] !py-2 !text-base sm:!text-lg"
                  variant="tender"
                  value={composer.channel}
                  onChange={(channel) =>
                    onPatchComposer({
                      channel,
                      ref: "",
                      bankName: "",
                      amount: "",
                      instrumentDate: collectionDate || todayIso(),
                    })
                  }
                />
              </label>

              {composer.channel && modeMeta ? (
                <>
                  {modeMeta.needsRef ? (
                    <label className="block min-w-0 flex-[1.2] text-base">
                      <span className="mb-1 block text-sm font-medium text-[var(--muted)] sm:text-base">
                        {modeMeta.refLabel}
                      </span>
                      <input
                        className="field !border-[rgba(32,48,80,0.18)] !py-2 !text-base sm:!text-lg"
                        value={composer.ref}
                        onChange={(e) =>
                          onPatchComposer({ ref: e.target.value })
                        }
                        placeholder={modeMeta.refLabel}
                        autoComplete="off"
                      />
                    </label>
                  ) : null}

                  {modeMeta.needsBank ? (
                    <label className="block min-w-0 flex-1 text-base">
                      <span className="mb-1 block text-sm font-medium text-[var(--muted)] sm:text-base">
                        Instrument bank
                      </span>
                      <input
                        className="field !border-[rgba(32,48,80,0.18)] !py-2 !text-base sm:!text-lg"
                        value={composer.bankName}
                        onChange={(e) =>
                          onPatchComposer({ bankName: e.target.value })
                        }
                        placeholder="Bank name"
                        autoComplete="off"
                      />
                    </label>
                  ) : null}

                  {modeMeta.needsInstrumentDate ? (
                    <label className="block min-w-0 text-base lg:w-[9.5rem]">
                      <span className="mb-1 block text-sm font-medium text-[var(--muted)] sm:text-base">
                        Date
                      </span>
                      <input
                        className="field !border-[rgba(32,48,80,0.18)] !py-2 !text-base sm:!text-lg"
                        type="date"
                        value={composer.instrumentDate}
                        onChange={(e) =>
                          onPatchComposer({ instrumentDate: e.target.value })
                        }
                      />
                    </label>
                  ) : null}

                  <label className="block min-w-0 text-base lg:w-[8.5rem]">
                    <span className="mb-1 block text-sm font-medium text-[var(--muted)] sm:text-base">
                      Amount (₹)
                    </span>
                    <input
                      className="field !border-[rgba(197,160,40,0.45)] !bg-[rgba(197,160,40,0.08)] !py-2 !text-lg font-semibold sm:!text-xl"
                      inputMode="decimal"
                      value={composer.amount}
                      onChange={(e) =>
                        onPatchComposer({
                          amount: e.target.value.replace(/[^\d.]/g, ""),
                        })
                      }
                      placeholder="0"
                      autoComplete="off"
                    />
                  </label>

                  <button
                    type="button"
                    className="rounded-xl bg-[#c5a028] px-5 py-3 text-base font-extrabold text-[#152238] shadow-[0_4px_14px_rgba(197,160,40,0.4)] hover:bg-[#f0d878] lg:shrink-0 sm:text-lg"
                    onClick={onAddTender}
                  >
                    Add
                  </button>
                </>
              ) : null}
            </div>

            {composerMode === "cheque" ? (
              <p className="mt-2 rounded-lg bg-[rgba(197,160,40,0.2)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)] sm:text-base">
                Cheque will be marked: realisation subject to clearance
              </p>
            ) : null}
          </div>
          )}

          {hasUncleared ? (
            <p className="mt-3 rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2.5 text-sm font-semibold text-[var(--brand-gold-soft)] sm:text-base">
              Receipt will show: cheque realisation subject to clearance.
            </p>
          ) : null}

          {(() => {
            const matched = collectTarget > 0 && tenderSum === collectTarget;
            const short =
              collectTarget > 0 && tenderSum > 0 && tenderSum < collectTarget;
            const over = collectTarget > 0 && tenderSum > collectTarget;
            const gap = Math.abs(collectTarget - tenderSum);
            return (
              <div
                className={`mt-4 rounded-xl px-3 py-3 text-lg font-bold sm:text-xl ${
                  matched
                    ? "bg-[rgba(60,160,100,0.22)] text-[#b8f0cc]"
                    : short || over
                      ? "bg-[rgba(180,60,60,0.28)] text-[#ffc9c2]"
                      : "bg-white/10 text-white/70"
                }`}
              >
                Payments {formatInr(tenderSum)}
                {isPartialCollect && collectTarget > 0
                  ? ` · target ${formatInr(collectTarget)}`
                  : ""}
                {short ? ` · still need ${formatInr(gap)}` : ""}
                {over ? ` · ${formatInr(gap)} more than required` : ""}
                {matched ? (isPartialCollect ? " · partial matched ✓" : " · matched ✓") : ""}
              </div>
            );
          })()}

          <label className="mt-4 block text-base">
            <span className="mb-1.5 block text-sm font-medium text-white/75 sm:text-base">
              Notes
            </span>
            <input
              className="field !border-white/20 !bg-white/95 !py-2 !text-base !text-[var(--brand-deep)] sm:!text-lg"
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder="Optional note on receipt"
              autoComplete="off"
            />
          </label>

          {(() => {
            const discountOnly =
              collectTarget <= 0 && counterDiscountPaise > 0;
            const matched =
              discountOnly ||
              (collectTarget > 0 &&
                tenderSum === collectTarget &&
                tenderSum > 0);
            return (
              <button
                type="button"
                className={`mt-4 w-full rounded-xl px-4 py-4 text-lg font-extrabold uppercase tracking-wide transition active:scale-[0.99] disabled:cursor-not-allowed sm:text-xl ${
                  matched
                    ? "bg-[#22c55e] text-white shadow-[0_0_0_2px_rgba(255,255,255,0.35),0_10px_28px_rgba(34,197,94,0.55)] hover:bg-[#16a34a] hover:shadow-[0_0_0_2px_rgba(255,255,255,0.5),0_12px_32px_rgba(34,197,94,0.65)]"
                    : "bg-[#ef4444] text-white shadow-[0_0_0_2px_rgba(255,255,255,0.2),0_10px_28px_rgba(239,68,68,0.4)] hover:bg-[#dc2626] disabled:bg-[#ef4444] disabled:opacity-90 disabled:shadow-[0_0_0_2px_rgba(255,255,255,0.15)]"
                }`}
                disabled={!matched || readOnly}
                onClick={onCollect}
              >
                {readOnly
                  ? "Session closed — read-only"
                  : discountOnly
                    ? `Post discount · ${formatInr(counterDiscountPaise)}`
                    : matched
                      ? isPartialCollect
                        ? `Collect partial · ${formatInr(collectTarget)}`
                        : counterDiscountPaise > 0
                          ? `Collect · ${formatInr(collectTarget)} (incl. discount)`
                          : "Collect & print receipt"
                      : collectTarget <= 0
                        ? "Enter amount to collect"
                        : tenderSum <= 0
                          ? "Add payment to match amount"
                          : tenderSum < collectTarget
                            ? `Still need ${formatInr(collectTarget - tenderSum)}`
                            : `Reduce by ${formatInr(tenderSum - collectTarget)}`}
              </button>
            );
          })()}
          <button
            type="button"
            className="mt-2 w-full rounded-xl border-2 border-[#128C7E] bg-[#128C7E]/15 px-4 py-3.5 text-base font-bold text-[#0f766e] hover:bg-[#128C7E]/25 disabled:cursor-not-allowed disabled:opacity-50 sm:text-lg"
            disabled={collectTotal <= 0 || readOnly}
            onClick={onSendUpiLink}
          >
            {collectTotal > 0
              ? `Send UPI link · ${formatInr(collectTotal)}`
              : "Select dues for UPI link"}
          </button>
          <p className="mt-2 text-center text-sm text-white/75 sm:text-base">
            Collecting as{" "}
            <span className="font-semibold text-[#f0d878]">{cashierName}</span>
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Earlier receipts
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Household history · open to view / print / WhatsApp
          </p>
        </div>
        {priorReceipts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted)]">
            No earlier receipts for this household yet.
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-[rgba(32,48,80,0.08)] overflow-y-auto">
            {priorReceipts.map((v) => {
              const voided = !!v.voidedAt;
              const names = Array.from(
                new Set(v.lines.map((l) => l.studentName)),
              );
              const modes = Array.from(
                new Set(v.tenders.map((t) => tenderModeLabel(t.mode))),
              );
              return (
                <li
                  key={v.id}
                  className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 ${
                    voided ? "opacity-60" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-[var(--brand-deep)]">
                        {v.receiptNo}
                      </span>
                      {voided ? (
                        <span className="rounded bg-[rgba(180,60,60,0.12)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--danger)]">
                          Void
                        </span>
                      ) : (
                        <span className="rounded bg-[rgba(15,122,76,0.12)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ok)]">
                          Paid
                        </span>
                      )}
                      {v.schoolReceiptNo ? (
                        <span className="text-[11px] text-[var(--muted)]">
                          Book {v.schoolReceiptNo}
                        </span>
                      ) : null}
                      {v.whatsappSentAt && !voided ? (
                        <span className="rounded bg-[#128C7E]/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#128C7E]">
                          WA
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                      {v.collectionDate} · {names.join(", ")} ·{" "}
                      {modes.join(" + ")} · by {v.cashierName}
                    </p>
                  </div>
                  <div className="text-sm font-bold tabular-nums text-[var(--brand-deep)]">
                    {formatInr(v.totalPaise)}
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.04)]"
                    onClick={() => onOpenReceipt(v.id)}
                  >
                    Open
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function WhatsAppInline({
  household,
  onUpdated,
}: {
  household: Household | null;
  onUpdated: () => void;
}) {
  const current = householdWhatsApp(household);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(householdWhatsApp(household));
    setEditing(false);
    setError(null);
  }, [household?.id, household?.whatsappMobile, household?.mobile]);

  if (!household) return null;

  function save() {
    const value = normalizeMobile(draft);
    if (!isValidMobile(value)) {
      setError("10 digits required");
      return;
    }
    const result = updateHouseholdWhatsApp(household!.id, value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setEditing(false);
    onUpdated();
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.03)] px-2 py-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
          WhatsApp
        </span>
        <span className="text-xs font-semibold tabular-nums text-[var(--brand-deep)]">
          {current || "—"}
        </span>
        <button
          type="button"
          className="text-[11px] font-semibold text-[var(--brand-mid)] hover:underline"
          onClick={() => {
            setDraft(current);
            setEditing(true);
          }}
          title="Change WhatsApp for all household communications"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
        WhatsApp
      </span>
      <input
        className="field !w-[8.5rem] !py-1 !text-xs"
        value={draft}
        onChange={(e) => {
          setDraft(normalizeMobile(e.target.value));
          setError(null);
        }}
        inputMode="numeric"
        maxLength={10}
        autoFocus
        aria-label="WhatsApp number"
      />
      <button
        type="button"
        className="rounded-md bg-[var(--brand-deep)] px-2 py-1 text-[11px] font-bold text-white"
        onClick={save}
      >
        Save
      </button>
      <button
        type="button"
        className="text-[11px] font-semibold text-[var(--muted)]"
        onClick={() => {
          setDraft(current);
          setEditing(false);
          setError(null);
        }}
      >
        Cancel
      </button>
      {household.mobile ? (
        <button
          type="button"
          className="text-[11px] font-semibold text-[var(--brand-mid)]"
          onClick={() => setDraft(normalizeMobile(household.mobile))}
        >
          Use mobile
        </button>
      ) : null}
      {error ? (
        <span className="text-[11px] font-medium text-[var(--danger)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function ReceiptPreviewModal({
  voucher,
  sis,
  masters,
  onClose,
  onSentWhatsApp,
}: {
  voucher: CollectionVoucher;
  sis: SisState | null;
  masters: MastersState | null;
  onClose: () => void;
  onSentWhatsApp?: () => void;
}) {
  const household = sis?.households.find((h) => h.id === voucher.householdId);
  const householdHint = household?.guardianName;
  const waNumber = householdWhatsApp(household);
  const [waDraft, setWaDraft] = useState(waNumber);
  const [waError, setWaError] = useState<string | null>(null);
  const [waNotice, setWaNotice] = useState<string | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [remainQr, setRemainQr] = useState<string | null>(null);
  const [remainAmt, setRemainAmt] = useState(0);
  const [remainUrl, setRemainUrl] = useState<string | null>(null);

  useEffect(() => {
    setWaDraft(householdWhatsApp(household));
    setWaError(null);
    setWaNotice(null);
  }, [voucher.id, household?.id, household?.whatsappMobile, household?.mobile]);

  useEffect(() => {
    let cancelled = false;
    async function buildRemainQr() {
      if (!sis || !masters || !voucher.householdId) {
        setRemainQr(null);
        setRemainAmt(0);
        setRemainUrl(null);
        return;
      }
      const rows = computeHouseholdDues(
        voucher.householdId,
        sis,
        masters,
        loadFees(),
        { includeFuture: true },
      );
      const open = openFeeDues(rows.flatMap((r) => r.dues)).filter(
        (d) => d.balancePaise > 0,
      );
      const total = open.reduce((s, d) => s + d.balancePaise, 0);
      if (total <= 0) {
        if (!cancelled) {
          setRemainQr(null);
          setRemainAmt(0);
          setRemainUrl(null);
        }
        return;
      }
      const { buildSchoolUpiPayUri, resolveSchoolCollectionsUpi } =
        await import("@/lib/admissions");
      const QRCode = (await import("qrcode")).default;
      const upi = resolveSchoolCollectionsUpi(masters);
      const uri = buildSchoolUpiPayUri({
        vpa: upi.vpa,
        payeeName: upi.payeeName,
        amountPaise: total,
        note: `Remaining fees ${voucher.receiptNo}`,
      });
      const dataUrl = await QRCode.toDataURL(uri, {
        width: 160,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      if (!cancelled) {
        setRemainQr(dataUrl);
        setRemainAmt(total);
        setRemainUrl(uri);
      }
    }
    void buildRemainQr();
    return () => {
      cancelled = true;
    };
  }, [voucher.id, voucher.householdId, voucher.receiptNo, sis, masters]);

  async function sendWhatsApp() {
    setWaError(null);
    setWaNotice(null);
    if (waDraft.trim() && waDraft !== waNumber && household) {
      const saved = updateHouseholdWhatsApp(household.id, waDraft);
      if (!saved.ok) {
        setWaError(saved.error);
        return;
      }
    }
    setWaBusy(true);
    try {
      const result = await deliverWhatsAppFeeReceipt({
        voucher,
        mobile: waDraft,
        sis,
        masters,
        householdHint: householdHint ?? undefined,
        receiptElement: document.getElementById(`receipt-${voucher.id}`),
      });
      if (!result.ok) {
        setWaError(result.error);
        return;
      }
      if (result.mode === "api") {
        setWaNotice(
          `Receipt sent from school WhatsApp to +91 ${result.mobile}. Parent should see it from BHB International School.`,
        );
      } else if (result.mode === "share_file") {
        setWaNotice(
          `Receipt PDF shared — choose WhatsApp for +91 ${result.mobile}`,
        );
      } else if (result.pdfDownloaded) {
        setWaNotice(
          `Receipt PDF downloaded + WhatsApp opened for +91 ${result.mobile}. Attach the PDF in the chat if needed. Full receipt link is in the message.`,
        );
      } else {
        setWaNotice(
          `WhatsApp opened for +91 ${result.mobile} with full receipt text + digital receipt link`,
        );
      }
      onSentWhatsApp?.();
    } finally {
      setWaBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(15,22,40,0.55)] p-4 print:static print:bg-transparent print:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Receipt print preview"
    >
      <div className="my-4 w-full max-w-2xl print:my-0 print:max-w-none">
        <div className="print-hide mb-3 space-y-3 rounded-xl bg-white px-4 py-3 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-[var(--brand-deep)]">
                Receipt details
              </p>
              <p className="text-xs text-[var(--muted)]">
                {voucher.receiptNo} · full format
                {voucher.whatsappSentAt ? (
                  <span className="ml-1.5 font-semibold text-[#128C7E]">
                    · WhatsApp sent{" "}
                    {voucher.whatsappSentAt.slice(0, 16).replace("T", " ")}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-[#128C7E] px-4 py-2 text-xs font-bold text-white hover:opacity-95 disabled:opacity-60"
                onClick={() => void sendWhatsApp()}
                disabled={!!voucher.voidedAt || waBusy}
              >
                {waBusy ? "Preparing…" : "Send WhatsApp"}
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-xs font-bold text-white"
                onClick={() => printFeeReceipt(voucher.id)}
              >
                Print
              </button>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-4 py-2 text-xs font-semibold text-[var(--brand-deep)]"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>

          {!voucher.voidedAt ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-[rgba(32,48,80,0.08)] pt-3">
              <label className="min-w-[11rem] flex-1 text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  WhatsApp number
                </span>
                <input
                  className="field !py-1.5"
                  inputMode="numeric"
                  value={waDraft}
                  onChange={(e) =>
                    setWaDraft(normalizeMobile(e.target.value))
                  }
                  placeholder="10-digit mobile"
                  maxLength={10}
                />
              </label>
              <p className="pb-2 text-[10px] text-[var(--muted)] sm:max-w-[16rem]">
                Delivers the full receipt: PDF (share/attach), digital receipt
                link, and break-up text in the WhatsApp message.
              </p>
            </div>
          ) : null}

          {waError ? (
            <p className="text-xs font-semibold text-[#dc2626]">{waError}</p>
          ) : null}
          {waNotice ? (
            <p className="text-xs font-semibold text-[#128C7E]">{waNotice}</p>
          ) : null}
        </div>
        <FeeReceiptSheet
          voucher={voucher}
          householdHint={householdHint}
          sis={sis}
          masters={masters}
          remainingPayQrDataUrl={remainQr}
          remainingPayAmountPaise={remainAmt}
          remainingPayUrl={remainUrl}
        />
      </div>
    </div>
  );
}

function ReceiptsPanel({
  receipts,
  sis,
  masters,
  onVoid,
  onPreview,
}: {
  receipts: CollectionVoucher[];
  sis: SisState | null;
  masters: MastersState | null;
  onVoid: (id: string) => void;
  onPreview: (id: string | null) => void;
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [studentQ, setStudentQ] = useState("");
  const [parentQ, setParentQ] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");

  const guardianOf = (householdId: string) =>
    sis?.households.find((h) => h.id === householdId)?.guardianName ?? "";

  const classOptions = useMemo(() => {
    if (!masters) return [];
    const active = masters.classes.filter((c) => c.isActive !== false);
    return active.length ? active : masters.classes;
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    const forClass = masters.sections.filter((s) => s.classId === classId);
    const active = forClass.filter((s) => s.isActive !== false);
    return active.length ? active : forClass;
  }, [masters, classId]);

  const filtered = useMemo(() => {
    const sq = studentQ.trim().toLowerCase();
    const pq = parentQ.trim().toLowerCase();
    return receipts.filter((v) => {
      if (dateFrom && v.collectionDate < dateFrom) return false;
      if (dateTo && v.collectionDate > dateTo) return false;

      const lineStudentIds = [
        ...new Set(v.lines.map((l) => l.studentId).filter(Boolean)),
      ];
      const lineNames = v.lines
        .map((l) => l.studentName)
        .join(" ")
        .toLowerCase();

      if (sq) {
        const admHit = lineStudentIds.some((id) => {
          const st = sis?.students.find((s) => s.id === id);
          return (
            st?.admissionNo.toLowerCase().includes(sq) ||
            st?.fullName.toLowerCase().includes(sq)
          );
        });
        if (!admHit && !lineNames.includes(sq)) return false;
      }

      if (pq) {
        const hh = sis?.households.find((h) => h.id === v.householdId);
        const g = (hh?.guardianName ?? "").toLowerCase();
        const mobile = `${hh?.mobile ?? ""}${hh?.whatsappMobile ?? ""}`;
        if (!g.includes(pq) && !mobile.includes(pq)) return false;
      }

      if (classId || sectionId) {
        const classHit = lineStudentIds.some((id) => {
          const st = sis?.students.find((s) => s.id === id);
          if (!st) return false;
          if (classId && st.classId !== classId) return false;
          if (sectionId && st.sectionId !== sectionId) return false;
          return true;
        });
        if (!classHit) return false;
      }

      return true;
    });
  }, [
    receipts,
    dateFrom,
    dateTo,
    studentQ,
    parentQ,
    classId,
    sectionId,
    sis,
  ]);

  const filterSummary = describeFilters([
    dateFrom ? `From ${dateFrom}` : "",
    dateTo ? `To ${dateTo}` : "",
    studentQ.trim() ? `Student “${studentQ.trim()}”` : "",
    parentQ.trim() ? `Parent “${parentQ.trim()}”` : "",
    classOptions.find((c) => c.id === classId)?.name
      ? `Class ${classOptions.find((c) => c.id === classId)?.name}`
      : "",
    sectionOptions.find((s) => s.id === sectionId)?.name
      ? `Sec ${sectionOptions.find((s) => s.id === sectionId)?.name}`
      : "",
  ]);

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setStudentQ("");
    setParentQ("");
    setClassId("");
    setSectionId("");
  }

  const hasFilters =
    dateFrom || dateTo || studentQ || parentQ || classId || sectionId;

  if (receipts.length === 0) {
    return (
      <p className="mt-8 text-sm text-[var(--muted)]">
        No receipts yet. Collect from the Collect tab.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <ErpPanel
        title="Receipt register"
        description="Filter by date, student, parent, or class — click a row to open"
      >
        <div className="mb-3 flex flex-wrap justify-end">
          <FilterExportButtons
            title="Fee receipts"
            filterNote={filterSummary}
            fileBaseName="fee_receipts"
            columns={[
              { key: "receipt", header: "Receipt" },
              { key: "date", header: "Date" },
              { key: "student", header: "Student" },
              { key: "parent", header: "Parent" },
              { key: "mode", header: "Mode" },
              { key: "amount", header: "Amount", align: "right" },
            ]}
            rows={filtered.map((v) => {
              const students = [...new Set(v.lines.map((l) => l.studentName))];
              const modes = [
                ...new Set(
                  v.tenders.map((t) => tenderModeLabel(t.mode)),
                ),
              ];
              return {
                receipt: v.receiptNo || v.id,
                date: v.collectionDate,
                student: students.join(", "),
                parent: guardianOf(v.householdId),
                mode: modes.join(", "),
                amount: formatInr(v.totalPaise),
              };
            })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="block text-xs font-semibold text-[var(--muted)]">
            From date
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            To date
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Student
            <input
              type="search"
              value={studentQ}
              onChange={(e) => setStudentQ(e.target.value)}
              placeholder="Name or adm no."
              className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Parent / mobile
            <input
              type="search"
              value={parentQ}
              onChange={(e) => setParentQ(e.target.value)}
              placeholder="Guardian or mobile"
              className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Class
            <select
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setSectionId("");
              }}
              className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-2 text-sm"
            >
              <option value="">All classes</option>
              {classOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Section
            <select
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              disabled={!classId}
              className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-2 text-sm disabled:opacity-50"
            >
              <option value="">All sections</option>
              {sectionOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span>
            Showing {filtered.length} of {receipts.length} receipts
          </span>
          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </ErpPanel>

      <ErpTableShell>
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">
            No receipts match these filters.
          </p>
        ) : (
          <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
            {filtered.map((v) => {
              const voided = !!v.voidedAt;
              const students = Array.from(
                new Set(v.lines.map((l) => l.studentName)),
              );
              const modes = [
                ...new Set(v.tenders.map((t) => tenderModeLabel(t.mode))),
              ];
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => onPreview(v.id)}
                    className={`flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[rgba(197,160,40,0.08)] ${
                      voided ? "opacity-60" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-[var(--brand-deep)]">
                          {v.receiptNo}
                        </span>
                        {voided ? (
                          <span className="rounded bg-[rgba(180,60,60,0.12)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--danger)]">
                            Void
                          </span>
                        ) : null}
                        {v.schoolReceiptNo ? (
                          <span className="text-[11px] text-[var(--muted)]">
                            Book {v.schoolReceiptNo}
                          </span>
                        ) : null}
                        {modes.length ? (
                          <span className="text-[11px] text-[var(--muted)]">
                            {modes.join(" · ")}
                          </span>
                        ) : null}
                        {v.whatsappSentAt && !voided ? (
                          <span className="rounded bg-[#128C7E]/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#128C7E]">
                            WA
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                        {v.collectionDate} · {students.join(", ")}
                        {guardianOf(v.householdId)
                          ? ` · ${guardianOf(v.householdId)}`
                          : ""}{" "}
                        · by {v.cashierName}
                      </p>
                    </div>
                    <div className="text-sm font-bold tabular-nums text-[var(--brand-deep)]">
                      {formatInr(v.totalPaise)}
                    </div>
                  </button>
                  {!voided ? (
                    <div className="flex justify-end gap-2 border-t border-[rgba(32,48,80,0.06)] px-4 py-2">
                      <button
                        type="button"
                        className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
                        onClick={() => onPreview(v.id)}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--danger)]"
                        onClick={() => onVoid(v.id)}
                      >
                        Void
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </ErpTableShell>
    </div>
  );
}

function MiniBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-sm font-semibold text-[var(--brand-deep)] sm:text-base"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
