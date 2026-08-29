"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IndianRupee } from "lucide-react";
import { PaymentChannelSelect } from "@/components/accounts/PaymentChannelSelect";
import type { AccountsState } from "@/lib/accountsTypes";
import {
  decodeTenderChannel,
  encodeTenderChannel,
  tenderChannelLabel,
} from "@/lib/paymentChannels";
import {
  allocateCollectionToDues,
  collectPayment,
  type InjectedStoreDue,
  type VoucherLine,
  computeHouseholdDues,
  formatInr,
  householdSiblingIds,
  loadFees,
  chequeStats,
  dayCloseNeedsAttention,
  openFeeDues,
  openChargeVoucherCount,
  formatManualBookRef,
  isCollectionDateLocked,
  leafNumber,
  paperRefOf,
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
  linkAdjustmentsToVoucher,
  postCounterDiscountWaivers,
  type CounterDiscountSlice,

} from "@/lib/feeAdjustments";
import { FutureConcessionModal } from "@/components/fees/FutureConcessionModal";
import {
  applyFutureConcessionsFromCounter,
  isRecurringAcademicFeeHead,
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
import { attachGatewayCheckout } from "@/lib/paymentGatewayClient";
import { StoreSellInline } from "@/components/fees/StoreSellInline";
import { StorePurchasesPanel } from "@/components/fees/StorePurchasesPanel";
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
import { TransportRiderChip } from "@/components/transport/TransportRiderChip";

/**
 * The search box owns its keystrokes. Typing re-renders ONLY this input;
 * the workspace re-renders once per debounce tick instead of per key —
 * the difference between this feeling like the store counter's search
 * and feeling stuck.
 */
function FeeSearchInput({
  onDebounced,
  autoFocus,
}: {
  onDebounced: (q: string) => void;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    const t = setTimeout(() => onDebounced(value), 200);
    return () => clearTimeout(t);
  }, [value, onDebounced]);
  return (
    <input
      className="field"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Child, father, mother, mobile, adm no, class…"
      autoComplete="off"
      autoFocus={autoFocus}
    />
  );
}

const ChargeVouchersPanel = lazyNamedTabPanel(
  () => import("@/components/fees/ChargeVouchersPanel"),
  "ChargeVouchersPanel",
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
  // The search box owns its keystrokes (FeeSearchInput above) — only the
  // debounced value lives here, so typing never re-renders this whole
  // workspace. That per-key full re-render is what made Find student feel
  // slow next to the store counter's search.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [hits, setHits] = useState<StudentSearchHit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * Which children's fee DETAILS are on screen — one at a time by default:
   * tapping a sibling card switches the visible list to that child. Ticks
   * are family-wide and SURVIVE the switch: every child's card shows their
   * ticked total, the collect summary counts them all, and the receipt
   * lists every line — nothing ticked is ever invisible, just collapsed.
   * "Open all" widens the view to every child when the office wants it.
   */
  const [activeStudentIds, setActiveStudentIds] = useState<Set<string>>(
    new Set(),
  );
  const [includeFuture, setIncludeFuture] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  /** Rupees to collect at counter — defaults to full selected balance; lower for partial pay */
  const [collectAmountRupees, setCollectAmountRupees] = useState("");
  /** Per fee-head counter discount (dueKey → rupees) on selected lines */
  const [lineDiscountRupees, setLineDiscountRupees] = useState<
    Record<string, string>
  >({});
  const [counterDiscountReason, setCounterDiscountReason] = useState("");
  /**
   * Dues whose discount the clerk has chosen to make recurring.
   *
   * Starts empty and stays empty unless someone ticks: a discount belongs to
   * the month in hand until the office says it repeats. The old flow inferred
   * this from a pre-ticked modal AFTER collect, which is how a single month's
   * discount became a standing Masters rule nobody chose.
   */
  const [recurringDueKeys, setRecurringDueKeys] = useState<Set<string>>(
    new Set(),
  );
  /**
   * Lines ticked to be DISCOUNTED but not collected today.
   *
   * The counter often settles one head while agreeing a reduction on another
   * the parent is not paying for yet — ₹100 off August transport while only
   * tuition is taken. Without this a discount could only go on a head being
   * collected, so the clerk had to either take money they were not given or
   * leave Fee Take and edit Masters.
   *
   * These lines contribute their discount and nothing else: they are out of
   * the collect total, out of the allocation, and off the receipt.
   */
  const [discountOnlyKeys, setDiscountOnlyKeys] = useState<Set<string>>(
    new Set(),
  );
  const [futureConcessionPrompt, setFutureConcessionPrompt] = useState<{
    candidates: FutureConcessionCandidate[];
    selected: Set<string>;
  } | null>(null);
  const [tenderLines, setTenderLines] = useState<TenderLine[]>([]);
  const [composer, setComposer] = useState<TenderComposer>(emptyComposer);
  const [collectionDate, setCollectionDate] = useState(todayIso);
  /**
   * Accounts desk state, HYDRATED here rather than assumed. The payment-mode
   * dropdown is built from the bank accounts, and this browser only has them
   * after a pull from the server — which used to happen only when the
   * Accounts (or Transport) module was opened first, so a counter machine
   * that went straight to Fee Take offered nothing but cash.
   */
  const [accountsState, setAccountsState] = useState<AccountsState | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { ensureAccountsHydrated } = await import(
          "@/lib/accountsPersistence"
        );
        await ensureAccountsHydrated();
      } catch {
        // Offline or first load — fall through to whatever is cached locally.
      }
      // Transport dues are billed HERE, on the counter — so the counter pulls
      // the transport desk itself instead of trusting some other module to
      // have done it. A changed pull re-ticks the dues so a student already
      // on screen gains their transport line.
      try {
        const { ensureTransportHydrated } = await import(
          "@/lib/transportPersistence"
        );
        const changed = await ensureTransportHydrated();
        if (live && changed) refresh();
      } catch {
        // Same fallback as accounts.
      }
      const { loadAccounts } = await import("@/lib/accountsStore");
      if (live) setAccountsState(loadAccounts());
      // ensureAccountsHydrated marks the module hydrated the moment the FIRST
      // caller enters it, so when the app shell kicked hydration off just
      // before us, our call returns while that pull is still in flight — and
      // a single read here would freeze an empty store into the dropdown
      // (observed live: bank in localStorage at 6s, dropdown stuck on cash).
      // Re-read on a short ladder until the store shows substance.
      for (const delay of [1500, 3500, 8000, 15000]) {
        await new Promise((r) => setTimeout(r, delay));
        if (!live) return;
        const next = loadAccounts();
        if (next.bankAccounts.length > 0 || next.coaAccounts.length > 0) {
          setAccountsState(next);
          if (next.bankAccounts.length > 0) break;
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const [schoolReceiptNo, setSchoolReceiptNo] = useState("");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [collectError, setCollectError] = useState<string | null>(null);
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
      searchFeeStudents(debouncedQuery, s, m, f, {
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
      const { withHydrationSlot } = await import("@/lib/deskHydrateGuard");
      await Promise.all([
        withHydrationSlot(() => ensureSisHydrated()),
        withHydrationSlot(() => ensureFeesHydrated()),
        withHydrationSlot(() => ensurePaymentsHydrated()),
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
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("tab");
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
    // Deep link from global search — open a specific receipt by voucher id.
    const openReceipt = params.get("openReceipt");
    if (openReceipt) {
      setTab("receipts");
      setPreviewReceiptId(openReceipt);
    }
  }, []);

  // The fees blob is a multi-megabyte localStorage parse — doing it PER
  // KEYSTROKE is what made the search feel hung. Parse once per data tick.
  const feesForSearch = useMemo(() => {
    void tick;
    return loadFees();
  }, [tick]);

  useEffect(() => {
    if (!sis || !masters) return;
    // One letter matches half the roster and costs a full scan — wait for
    // two, unless a class filter narrows the field.
    if (debouncedQuery.trim().length < 2 && !classId) {
      setHits([]);
      return;
    }
    // Transition: the roster scan may take a frame — never block a keystroke.
    startTransition(() => {
      setHits(
        searchFeeStudents(debouncedQuery, sis, masters, feesForSearch, {
          classId,
          sectionId,
          academicYearCode: ay,
          includeFuture,
        }),
      );
    });
  }, [debouncedQuery, classId, sectionId, sis, masters, feesForSearch, ay, includeFuture]);

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

  // Store credit sales for this household, read live from the store module.
  // Not mirrored into the fee tables: the fees client rebuilds those wholesale
  // and would delete anything it did not produce itself.
  const [storeDues, setStoreDues] = useState<InjectedStoreDue[]>([]);
  const [storeDuesError, setStoreDuesError] = useState("");
  const [unsettledStore, setUnsettledStore] = useState<
    { saleNo: string; saleId: string; amountPaise: number; receiptNo: string }[]
  >([]);

  useEffect(() => {
    if (!sis || !selectedStudent) {
      setStoreDues([]);
      return;
    }
    const ids = householdSiblingIds(sis, selectedStudent).map((m) => m.id);
    let alive = true;
    void fetch(
      `/api/inventory/sales?view=dues&studentIds=${encodeURIComponent(ids.join(","))}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((body: { ok?: boolean; dues?: InjectedStoreDue[]; error?: string }) => {
        if (!alive) return;
        if (body.ok === false) {
          // Say the store could not be reached rather than showing no dues,
          // which would read as "this family owes the store nothing".
          setStoreDuesError(body.error || "Store dues could not be loaded");
          setStoreDues([]);
          return;
        }
        setStoreDuesError("");
        setStoreDues(body.dues ?? []);
      })
      .catch(() => {
        if (!alive) return;
        setStoreDuesError("Store dues could not be loaded");
        setStoreDues([]);
      });
    return () => {
      alive = false;
    };
  }, [sis, selectedStudent, tick]);

  /**
   * Push the store portion of a receipt into the store.
   *
   * Anything that does not land is listed for the clerk to retry rather than
   * logged and forgotten — an unsettled store line means the family is still
   * shown as owing money they have already paid.
   */
  /**
   * A voided fee receipt gives the store its due back: the collections it
   * made are reversed, the slip stops saying PAID, and the family sees the
   * store line owing again. Without this the store kept the money on paper
   * while the parent had it in hand.
   */
  async function reverseStoreLinesForReceipt(receiptNo: string) {
    try {
      const res = await fetch("/api/inventory/sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "reverse-collect",
          receiptNo,
          reason: `Fee receipt ${receiptNo} voided`,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reversal?: { reversed: number; amountPaise: number };
        error?: string;
      };
      if (!res.ok || body.ok === false) {
        throw new Error(body.error || "Store refused the reversal");
      }
      const n = body.reversal?.reversed ?? 0;
      if (n > 0) {
        flash(
          `Store collection returned — ${n} sale${n === 1 ? "" : "s"} back to unpaid`,
        );
      }
    } catch (e) {
      flash(
        `Receipt voided, but the store collection could not be returned (${e instanceof Error ? e.message : "error"}) — fix it on the Store counter`,
      );
    }
    setTick((t) => t + 1);
  }

  async function settleStoreLines(receiptNo: string, lines: VoucherLine[]) {
    const storeLines = lines.filter((l) => l.kind === "store" && l.amountPaise > 0);
    if (storeLines.length === 0) return;

    const failures: {
      saleNo: string;
      saleId: string;
      amountPaise: number;
      receiptNo: string;
    }[] = [];

    for (const line of storeLines) {
      const saleId = line.dueKey.split(":")[2] || "";
      if (!saleId) continue;
      try {
        const res = await fetch("/api/inventory/sales", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "collect",
            saleId,
            amountPaise: line.amountPaise,
            mode: "cash",
            reference: receiptNo,
            externalRef: receiptNo,
          }),
        });
        const body = (await res.json()) as { ok?: boolean };
        if (!res.ok || body.ok === false) throw new Error("refused");
      } catch {
        failures.push({
          saleNo: line.storeIssueNo || saleId,
          saleId,
          amountPaise: line.amountPaise,
          receiptNo,
        });
      }
    }

    if (failures.length > 0) {
      setUnsettledStore((prev) => [...prev, ...failures]);
    }
    setTick((t) => t + 1);
  }

  const householdBundle = useMemo(() => {
    if (!sis || !masters || !selectedStudent) return [];
    const fees = loadFees();
    const members = householdSiblingIds(sis, selectedStudent);
    return computeHouseholdDues(
      selectedStudent.householdId,
      sis,
      masters,
      fees,
      { includeFuture, includePaid: true, storeDues },
    ).filter((row) => members.some((m) => m.id === row.student.id));
  }, [sis, masters, selectedStudent, includeFuture, storeDues, tick]);

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

  /**
   * The children whose fees are on the counter right now. Falls back to the
   * picked student when the active set does not match this household — that
   * happens for one render after switching families, and an empty right
   * panel would read as "this child has no dues", which is not what we know.
   */
  const activeBundle = useMemo(() => {
    const onCounter = householdBundle.filter((row) =>
      activeStudentIds.has(row.student.id),
    );
    if (onCounter.length > 0) return onCounter;
    return householdBundle.filter((row) => row.student.id === selectedId);
  }, [householdBundle, activeStudentIds, selectedId]);

  /**
   * The SELECTION domain — every child of the family. A tick keeps counting
   * whichever child's list happens to be open on screen; the visible list
   * (activeBundle) only decides what is displayed, never what is collected.
   */
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

  const collectTotal = selectedDues.reduce(
    (s, d) => (discountOnlyKeys.has(d.dueKey) ? s : s + d.balancePaise),
    0,
  );

  const discountSlices = useMemo(
    () => buildPerLineDiscountSlices(selectedDues, lineDiscountRupees),
    [selectedDues, lineDiscountRupees],
  );

  // Only heads that actually repeat can be offered as recurring — the same
  // test collect uses, so the tick never promises something collect refuses.
  const recurringEligible = useMemo(() => {
    if (!masters || !sis) return new Set<string>();
    return new Set(
      listFutureConcessionCandidates(
        discountSlices,
        selectedDues,
        masters,
        householdBundle.map((r) => r.student),
        ay,
      ).map((c) => c.dueKey),
    );
  }, [discountSlices, selectedDues, masters, sis, householdBundle, ay]);

  const counterDiscountPaise = discountSlices.reduce(
    (s, x) => s + x.amountPaise,
    0,
  );

  const netAfterDiscount = Math.max(0, collectTotal - counterDiscountPaise);

  useEffect(() => {
    // Selection changed: prune discounts down to what is still ticked, and a
    // fresh selection restarts the discount reason.
    setLineDiscountRupees((prev) => {
      const next: Record<string, string> = {};
      for (const key of selectedKeys) {
        if (prev[key]) next[key] = prev[key];
      }
      return next;
    });
    setCounterDiscountReason("");
    setFutureConcessionPrompt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  useEffect(() => {
    // ONE rule for the amount box: it always restates the NET of what is
    // ticked. It used to be two effects — gross on selection change, net on
    // discount change — so reselecting heads while discounts stood left the
    // box on the gross figure while the banner showed net. Banner right,
    // box wrong: the exact bug the counter kept hitting.
    setTenderLines([]);
    setComposer(emptyComposer());
    setCollectAmountRupees(
      netAfterDiscount > 0 ? String(netAfterDiscount / 100) : "",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, netAfterDiscount]);

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

  /**
   * A refused collection, said where the money is.
   *
   * flash() puts the reason in the workspace header pill and clears it after
   * 2.8s. The collect button sits at the bottom of a long scrolled page, so a
   * refusal — a duplicate school receipt no., a day-closed date — appeared
   * off-screen and was gone before the counter could scroll to it. The button
   * looked dead instead of refusing for a stated reason. This one stays until
   * the next attempt.
   */
  function failCollect(msg: string) {
    setCollectError(msg);
    flash(msg);
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
    setActiveStudentIds(new Set([hit.student.id]));
    setSelectedKeys(new Set());
    resetPaymentFields();
  }

  /**
   * Open or close a child on the counter. Closing also drops that child's
   * ticked fee lines: leaving them in the selection would collect money for
   * a student whose fees are no longer on screen.
   */
  function toggleActiveStudent(studentId: string) {
    // Switch, don't accumulate: one child's details at a time. The previous
    // child's ticks stay selected — their card badge and the collect summary
    // keep showing them ("Open all" restores the everyone-at-once view).
    setActiveStudentIds(new Set([studentId]));
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
    // Split-tender rebalance: typing a later mode's amount pulls that much
    // out of the FIRST added line, so the total tracks the collect target
    // (e.g. ₹1000 cash auto-filled, type ₹300 UPI → cash becomes ₹700).
    if (patch.amount !== undefined && tenderLines.length > 0) {
      const typedPaise = Math.round((Number(patch.amount) || 0) * 100);
      setTenderLines((prev) => {
        if (prev.length === 0) return prev;
        const othersPaise = prev
          .slice(1)
          .reduce((s, t) => s + Math.round((Number(t.amount) || 0) * 100), 0);
        const firstPaise = Math.max(
          0,
          collectTarget - othersPaise - typedPaise,
        );
        const firstAmount = String(firstPaise / 100);
        if (prev[0]!.amount === firstAmount) return prev;
        return prev.map((t, i) =>
          i === 0 ? { ...t, amount: firstAmount } : t,
        );
      });
    }
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
      failCollect(result.error);
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
    setCollectError(null);

    const discountOnly = collectTarget <= 0 && counterDiscountPaise > 0;

    if (collectTarget <= 0 && !discountOnly) {
      failCollect("Enter a collection amount");
      return;
    }
    if (!discountOnly && tenderSum !== collectTarget) {
      failCollect(
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
      // The clerk has already answered this on the line itself. The prompt is
      // only for candidates that CLASH — a head that already carries a
      // Masters concession — because that is the case which needs explaining
      // before it is stacked. Everything else follows the tick, and an
      // unticked line simply does not recur.
      const chosen = candidates.filter((c) => recurringDueKeys.has(c.dueKey));
      const clashing = chosen.filter((c) => c.existing.length > 0);
      if (clashing.length > 0 && !futureConcessionPrompt) {
        setFutureConcessionPrompt({
          candidates: clashing,
          // Never pre-ticked: stacking onto a head that already has a
          // discount must be a deliberate act after reading what it does.
          selected: new Set(),
        });
        return;
      }
      if (chosen.length > 0) {
        executeCollect(new Set(chosen.map((c) => c.key)));
        return;
      }
    }

    executeCollect(futureConcessionPrompt?.selected ?? new Set());
  }

  function executeCollect(applyFutureKeys: Set<string>) {
    if (!selectedStudent || !sis) return;
    setFutureConcessionPrompt(null);

    let futureConcessionMsg = "";
    let waiverAdjustmentIds: string[] = [];

    // Both artefacts are posted, and that is correct now that grants are
    // judged against the due's own month: the waiver settles the month being
    // collected, and the recurring grant starts at the NEXT installment.
    // Before that gating existed the grant reached backwards and the month
    // showed twice the discount typed.
    if (counterDiscountPaise > 0) {
      const waiverResult = postCounterDiscountWaivers({
        slices: discountSlices,
        reason: counterDiscountReason.trim() || "Counter concession",
        createdBy: session.fullName,
        academicYearCode: ay,
      });
      if (!waiverResult.ok) {
        failCollect(waiverResult.error);
        return;
      }
      waiverAdjustmentIds = waiverResult.adjustmentIds;

      refresh();
    }

    // Future-month grants apply AFTER the receipt exists (paid path), so
    // each grant carries its source receipt and dies with it on void. The
    // discount-only path has no receipt — grants apply immediately there.
    const applyFutureGrants = (voucher?: { id: string; receiptNo: string }) => {
      if (applyFutureKeys.size === 0 || !masters || counterDiscountPaise <= 0) {
        return;
      }
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
        sourceVoucherId: voucher?.id,
        sourceReceiptNo: voucher?.receiptNo,
      });
      if (!futureResult.ok) {
        futureConcessionMsg = ` · future grants failed: ${futureResult.error}`;
        return;
      }
      const bits: string[] = [];
      if (futureResult.granted > 0) {
        bits.push(
          `${futureResult.granted} future grant${futureResult.granted === 1 ? "" : "s"} approved`,
        );
      }
      if (futureResult.pending > 0) {
        bits.push(`${futureResult.pending} pending Principal in Concessions`);
      }
      // A refused head must say so in full. "1 already on file" reads as
      // housekeeping; the clerk needs to know a discount they just granted
      // did NOT take, and which existing one is in the way.
      if (futureResult.blocked.length > 0) {
        bits.push(futureResult.blocked.join(" · "));
      }
      if (futureResult.skipped > futureResult.blocked.length) {
        bits.push(
          `${futureResult.skipped - futureResult.blocked.length} already on file`,
        );
      }
      if (bits.length > 0) futureConcessionMsg = ` · ${bits.join(" · ")}`;
    };

    if (collectTarget <= 0) {
      if (counterDiscountPaise > 0) {
        applyFutureGrants();
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
    const duesForCollect = freshSelectedDues().filter(
      (d) => !discountOnlyKeys.has(d.dueKey),
    );
    const alloc = allocateCollectionToDues(
      duesForCollect,
      tenderSum,
      (id) => nameById.get(id) ?? "Student",
    );
    if (!alloc.ok) {
      failCollect(alloc.error);
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
    // The receipt exists now, so any store portion is told to the store.
    //
    // Order matters. The receipt is written first: if the store call fails the
    // money is still recorded and the parent has their receipt, and the store
    // simply still shows the due. Doing it the other way round could take the
    // money with nothing to show for it. The call carries the receipt number,
    // and the store settles once per receipt, so a retry is safe.
    void settleStoreLines(result.voucher.receiptNo, lines);

    // Bind this receipt's counter waivers to it, so voiding takes them back.
    linkAdjustmentsToVoucher(waiverAdjustmentIds, result.voucher.id);

    applyFutureGrants({
      id: result.voucher.id,
      receiptNo: result.voucher.receiptNo,
    });

    setSelectedKeys(new Set());
    setCollectAmountRupees("");
    setRecurringDueKeys(new Set());
    setDiscountOnlyKeys(new Set());
    resetPaymentFields();
    refresh();
    // The receipt just posted into the accounts desk — re-read it so the
    // payment-mode dropdown never goes stale for the next student.
    void import("@/lib/accountsStore").then(({ loadAccounts }) =>
      setAccountsState(loadAccounts()),
    );
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

  async function onSendUpiLink() {
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

    const attached = await attachGatewayCheckout(created.link);
    const link = attached.link;
    const payload = buildEnrichedPaymentSharePayload(
      link,
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
        link,
        url,
        TENANT.nameDisplay,
        attached.attached,
      );
      window.open(whatsAppPaymentLinkUrl(mobile, msg), "_blank", "noopener");
      flash(
        `${attached.attached ? "Checkout" : "UPI"} link ${link.code} · ${formatInr(link.amountPaise)} — WhatsApp opened`,
      );
    } else {
      void navigator.clipboard.writeText(url).then(
        () =>
          flash(
            `${attached.attached ? "Checkout" : "UPI"} link ${link.code} copied — set WhatsApp on household to send`,
          ),
        () => flash(`Created ${link.code}: ${url}`),
      );
    }
    setSelectedKeys(new Set());
    refresh();
    setTab("paylinks");
  }

  function onVoid(id: string) {
    const voucher = receipts.find((v) => v.id === id);
    const hadStore = !!voucher?.lines.some((l) => l.kind === "store");
    if (
      !window.confirm(
        hadStore
          ? "Void this receipt? Dues will reopen and the store items on it go back to ISSUED (unpaid)."
          : "Void this receipt? Dues will reopen.",
      )
    ) {
      return;
    }
    voidVoucher(id);
    if (previewReceiptId === id) setPreviewReceiptId(null);
    // The store took this money on the strength of the receipt; the receipt
    // is gone, so the money goes back and the slip returns to ISSUED.
    if (hadStore && voucher) {
      void reverseStoreLinesForReceipt(voucher.receiptNo);
    }
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
            className="inline-flex items-center rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm font-bold text-[var(--danger)] transition hover:brightness-95"
          >
            Defaulters
          </Link>
        </div>
      }
    >
      {tab === "collect" ? (
        <div className="mt-6 space-y-5">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)]">
              <label className="block text-sm">
                <span className="mb-1.5 block text-[var(--muted)]">
                  Find student
                </span>
                <FeeSearchInput
                  onDebounced={setDebouncedQuery}
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
                  debouncedQuery.trim() ? `Search “${debouncedQuery.trim()}”` : "",
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
            {(debouncedQuery.trim() || classId || sectionId) && !selectedStudent ? (
              <div className="mt-3">
                <p className="mb-2 text-[11px] text-[var(--muted)]">
                  {hits.length} match{hits.length === 1 ? "" : "es"} — pick one
                  to open household
                </p>
                {hits.length === 0 ? (
                  <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-3 text-sm text-[var(--muted)]">
                    No students match. Check fee group on SIS if balances look
                    empty.
                  </p>
                ) : (
                  <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                    {hits.map((h) => (
                      <li key={h.student.id}>
                        <button
                          type="button"
                          onClick={() => pickStudent(h)}
                          className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-left hover:border-[rgba(197,160,40,0.45)] hover:bg-[rgba(197,160,40,0.1)]"
                        >
                          <span className="text-sm font-semibold text-[var(--brand-deep)]">
                            <StudentNameLabel student={h.student} />
                          </span>
                          <span className="text-[11px] text-[var(--muted)]">
                            {h.classLabel} · {h.student.admissionNo}
                          </span>
                          {/* Why this row is here — a hit on the mother's
                              name or a sibling's mobile is not obvious from
                              the child's name alone. */}
                          {(h.matchReasons ?? []).map((r) => (
                            <span
                              key={r}
                              className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]"
                            >
                              {r}
                            </span>
                          ))}
                          <span
                            className={`ml-auto text-xs font-bold tabular-nums ${
                              h.balancePaise > 0
                                ? "text-[var(--danger)]"
                                : "text-[var(--success)]"
                            }`}
                          >
                            {formatInr(h.balancePaise)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {storeDuesError && selectedStudent ? (
              <p className="mt-3 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
                {storeDuesError}. Any store dues this family has are not shown
                below — collect them in Store &amp; purchase until this clears.
              </p>
            ) : null}

            {unsettledStore.length > 0 ? (
              <div className="mt-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
                <p className="font-semibold">
                  Collected on the receipt, but the store was not told
                </p>
                <ul className="mt-1 space-y-0.5">
                  {unsettledStore.map((u) => (
                    <li key={`${u.receiptNo}-${u.saleId}`}>
                      {u.saleNo} · {formatInr(u.amountPaise)} · receipt{" "}
                      {u.receiptNo}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">
                  The family has paid and has their receipt. Until this is
                  retried the store still shows the amount owing — do not
                  collect it again.
                </p>
                <button
                  type="button"
                  className="mt-1.5 rounded-md border border-[var(--danger)] px-2 py-1 font-semibold"
                  onClick={() => {
                    const pending = [...unsettledStore];
                    setUnsettledStore([]);
                    void Promise.all(
                      pending.map((u) =>
                        settleStoreLines(u.receiptNo, [
                          {
                            dueKey: `store:${selectedStudent?.id ?? ""}:${u.saleId}`,
                            studentId: selectedStudent?.id ?? "",
                            studentName: "",
                            label: u.saleNo,
                            kind: "store",
                            amountPaise: u.amountPaise,
                            storeIssueNo: u.saleNo,
                          } as VoucherLine,
                        ]),
                      ),
                    );
                  }}
                >
                  Retry
                </button>
              </div>
            ) : null}

            {selectedStudent ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="text-sm text-[var(--brand-deep)]">
                    <span className="font-semibold">
                      {selectedStudent.fullName}
                    </span>
                    <span className="text-[var(--muted)]">
                      {" "}
                      {(() => {
                        const parent =
                          selectedStudent.fatherName ||
                          sis?.households.find(
                            (h) => h.id === selectedStudent.householdId,
                          )?.guardianName ||
                          "";
                        return parent ? `· ${parent} ` : "";
                      })()}
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
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] px-6 py-16 text-center">
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
              accountsState={accountsState}
              netAfterDiscount={netAfterDiscount}
              lineDiscountRupees={lineDiscountRupees}
              recurringEligible={recurringEligible}
              recurringChosen={recurringDueKeys}
              discountOnlyKeys={discountOnlyKeys}
              onToggleDiscountOnly={(dueKey, on) =>
                setDiscountOnlyKeys((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(dueKey);
                  else next.delete(dueKey);
                  return next;
                })
              }
              onToggleRecurring={(dueKey, on) =>
                setRecurringDueKeys((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(dueKey);
                  else next.delete(dueKey);
                  return next;
                })
              }
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
              collectError={collectError}
              onSendUpiLink={() => void onSendUpiLink()}
              masters={masters}
              cashierName={session.fullName}
              priorReceipts={householdReceipts}
              storeTick={tick}
              readOnly={readOnly}
              onOpenReceipt={setPreviewReceiptId}
              transferPreviews={lastSessionPreviews}
              onTransferLastSession={onTransferLastSessionDues}
              activeBundle={activeBundle}
              activeStudentIds={activeStudentIds}
              onToggleActiveStudent={toggleActiveStudent}
              onOpenAllSiblings={() =>
                setActiveStudentIds(
                  new Set(householdBundle.map((r) => r.student.id)),
                )
              }
              onStoreSold={(saleNo, totalPaise) => {
                // refresh() re-reads store dues (the loader keys on tick), so
                // the new due appears in the fee lines ready to be ticked.
                refresh();
                flash(
                  `Store sale ${saleNo} · ${formatInr(totalPaise)} added — tick it below to collect with the fees`,
                );
              }}
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
    <div className={`rounded-lg border px-2.5 py-1.5 ${s.box}`}>
      <div className={`text-[10px] font-bold uppercase tracking-wide ${s.label}`}>
        {label}
      </div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${s.value}`}>
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
  accountsState,
  netAfterDiscount,
  lineDiscountRupees,
  onLineDiscount,
  recurringEligible,
  recurringChosen,
  onToggleRecurring,
  discountOnlyKeys,
  onToggleDiscountOnly,
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
  collectError,
  onSendUpiLink,
  masters,
  cashierName,
  priorReceipts,
  storeTick,
  onOpenReceipt,
  transferPreviews,
  onTransferLastSession,
  readOnly = false,
  activeBundle,
  activeStudentIds,
  onToggleActiveStudent,
  onOpenAllSiblings,
  onStoreSold,
}: {
  student: SisStudent;
  householdBundle: { student: SisStudent; dues: FeeDueLine[] }[];
  /** Subset of householdBundle currently open on the counter. */
  activeBundle: { student: SisStudent; dues: FeeDueLine[] }[];
  activeStudentIds: Set<string>;
  onToggleActiveStudent: (studentId: string) => void;
  onOpenAllSiblings: () => void;
  onStoreSold: (saleNo: string, totalPaise: number) => void;
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
  accountsState: AccountsState | null;
  netAfterDiscount: number;
  lineDiscountRupees: Record<string, string>;
  onLineDiscount: (dueKey: string, rupees: string) => void;
  recurringEligible: Set<string>;
  recurringChosen: Set<string>;
  onToggleRecurring: (dueKey: string, on: boolean) => void;
  discountOnlyKeys: Set<string>;
  onToggleDiscountOnly: (dueKey: string, on: boolean) => void;
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
  /** Why the last collection attempt was refused — shown at the button. */
  collectError: string | null;
  onSendUpiLink: () => void;
  masters: MastersState | null;
  cashierName: string;
  priorReceipts: CollectionVoucher[];
  storeTick: number;
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

  /**
   * Children who are ticked but NOT on screen.
   *
   * Ticks are family-wide while the fee list shows one child at a time, so a
   * sibling's ticks keep counting from behind a collapsed card. The office
   * then types the visible child's amount, it does not match the family total,
   * and the collect button sits there disabled saying "Still need ..." — which
   * reads as "the button is broken for this child". Only families with more
   * than one child can hit it, which is why it looks student-specific.
   */
  const offScreenTicked = useMemo(() => {
    if (siblingCount <= 1) return [];
    return householdBundle
      .filter((row) => !activeStudentIds.has(row.student.id))
      .map((row) => ({
        student: row.student,
        paise: row.dues
          .filter((d) => selectedKeys.has(d.dueKey))
          .reduce((sum, d) => sum + d.balancePaise, 0),
      }))
      .filter((r) => r.paise > 0);
  }, [householdBundle, activeStudentIds, selectedKeys, siblingCount]);
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

  // Computed once, used by BOTH the panel button and the sticky mobile bar.
  // It lived inside an IIFE next to the desktop button; the mobile bar would
  // have had to restate the expression, and two independent definitions of
  // "is this payment complete" is how they drift apart. One value, one rule.
  const discountOnly = collectTarget <= 0 && counterDiscountPaise > 0;
  const matched =
    discountOnly ||
    (collectTarget > 0 && tenderSum === collectTarget && tenderSum > 0);

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
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--brand-deep)]">
              Household Fee Collection
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {siblingCount} student{siblingCount === 1 ? "" : "s"}
              {siblingCount > 1 ? " (siblings)" : ""} · open dues{" "}
              <span
                className={`font-semibold ${
                  householdBundle.some((r) =>
                    openFeeDues(r.dues).some((d) => d.dueOn <= today),
                  )
                    ? "text-[var(--danger)]"
                    : "text-[var(--brand-deep)]"
                }`}
              >
                {formatInr(householdDueTotal)}
              </span>
              {" · "}
              selected{" "}
              <span
                className={`font-semibold ${
                  collectTarget > 0 ? "text-[var(--success)]" : "text-[var(--muted)]"
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
              <span className="mt-0.5 block font-normal text-xs text-[var(--muted)]">
                Grouped by month — tick a month or individual fee heads to clear
              </span>
            </p>
          </div>
          <label className="flex max-w-[13rem] items-start gap-2 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeFuture}
              onChange={(e) => onIncludeFuture(e.target.checked)}
            />
            <span>
              Include future months
              <span className="mt-0.5 block font-normal text-[11px] text-[var(--muted)]">
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
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--brand-deep)]">
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
              className="rounded-lg border border-[var(--danger)]/35 bg-[var(--card)] px-2.5 py-1 text-[11px] font-semibold text-[var(--danger)]"
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
      </div>

      {/* ── Counter layout, store-counter style ──────────────────────────
             LEFT   = who + what: the family's children, then their fees
             RIGHT  = the money: a sticky payment column, always in view
             (approved design 2026-08-27 — mirrors the store counter's
             1fr/right-aside shape; phones still get the sticky bottom bar)
      ── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] items-start">
        <div className="min-w-0 space-y-4">
        {/* ── LEFT COLUMN: children of this family ── */}
        <div className="space-y-3 min-w-0">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm">
            <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--brand-deep)]">
                {siblingCount > 1
                  ? `Children in this family (${siblingCount})`
                  : "Student"}
              </span>
              {siblingCount > 1 ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--brand-mid)] hover:underline"
                  onClick={onOpenAllSiblings}
                >
                  Open all
                </button>
              ) : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {householdBundle.map((row) => {
                const openDs = openFeeDues(row.dues);
                const rDue = openDs.reduce((s, d) => s + d.balancePaise, 0);
                const rOver = openDs.some((d) => d.dueOn <= today);
                const on = activeStudentIds.has(row.student.id);
                const pickedForStudent = openDs.filter((d) =>
                  selectedKeys.has(d.dueKey),
                );
                const pickedPaise = pickedForStudent.reduce(
                  (s, d) => s + d.balancePaise,
                  0,
                );
                const pickedDiscount = discountSlices.reduce(
                  (s, x) => (x.studentId === row.student.id ? s + x.amountPaise : s),
                  0,
                );
                const pickedNet = Math.max(0, pickedPaise - pickedDiscount);
                return (
                  <button
                    key={row.student.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggleActiveStudent(row.student.id)}
                    className={`relative rounded-xl border-2 p-2.5 text-left transition active:scale-[0.99] ${
                      on
                        ? "border-[var(--brand-gold)] bg-[rgba(197,160,40,0.08)]"
                        : "border-[var(--border)] bg-[var(--surface-sunken)] hover:border-[rgba(197,160,40,0.45)]"
                    }`}
                  >
                    <span
                      className={`absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold ${
                        on
                          ? "border-[var(--brand-gold)] bg-[var(--brand-gold)] text-white"
                          : "border-[var(--border)] bg-[var(--card)] text-transparent"
                      }`}
                      aria-hidden
                    >
                      ✓
                    </span>
                    <div className="pr-6 text-sm font-bold text-[var(--brand-deep)]">
                      <StudentNameLabel student={row.student} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {classLabel(row.student)} · {row.student.admissionNo}
                    </div>
                    <div
                      className={`mt-1.5 text-base font-bold tabular-nums ${
                        rOver
                          ? "text-[var(--danger)]"
                          : rDue > 0
                            ? "text-[var(--brand-deep)]"
                            : "text-[var(--success)]"
                      }`}
                    >
                      {formatInr(rDue)}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          rOver
                            ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                            : rDue > 0
                              ? "bg-[rgba(197,160,40,0.18)] text-[var(--brand-deep)]"
                              : "bg-[var(--success-soft)] text-[var(--success)]"
                        }`}
                      >
                        {rOver
                          ? "Overdue"
                          : rDue > 0
                            ? `${openDs.length} open`
                            : "All clear"}
                      </span>
                      {pickedPaise > 0 ? (
                        <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">
                          ticked {formatInr(pickedNet)}
                          {pickedDiscount > 0
                            ? ` (−${formatInr(pickedDiscount)})`
                            : ""}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>

            {siblingCount > 1 ? (
              <p className="mt-2.5 border-t border-dashed border-[var(--border)] pt-2 text-[11px] leading-snug text-[var(--muted)]">
                Tap a child to see their fees — one at a time. Ticks are
                remembered when you switch: each card&apos;s green badge shows
                what stays selected, and the total collects them all.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {siblingCount > 1 ? (
              <MiniBtn onClick={onSelectAllSiblings}>
                Tick all open fees
              </MiniBtn>
            ) : (
              <MiniBtn onClick={onSelectAllSiblings}>Select all dues</MiniBtn>
            )}
            <MiniBtn onClick={onSelectOverdue}>Tick overdue</MiniBtn>
            <MiniBtn onClick={onClear}>Clear all</MiniBtn>
          </div>

          {/* Sell store items to the child on the counter — the due joins
              these fee lines and is paid on the same receipt. */}
          <StoreSellInline
            studentId={
              activeBundle[0]?.student.id ?? student.id
            }
            studentName={
              activeBundle[0]?.student.fullName ?? student.fullName
            }
            classId={activeBundle[0]?.student.classId ?? student.classId}
            sectionId={activeBundle[0]?.student.sectionId ?? student.sectionId}
            readOnly={readOnly}
            onSold={onStoreSold}
          />
        </div>

        {/* ── RIGHT COLUMN: fees of the children on the counter ── */}
        <div className="space-y-3 min-w-0">
          <div className="max-h-[min(70vh,44rem)] space-y-3 overflow-y-auto pr-1">
            {activeBundle.every((r) => openFeeDues(r.dues).length === 0) &&
            activeBundle.every((r) => r.dues.length === 0) ? (
              <p className="text-xs text-[var(--muted)]">
                No open dues
                {!student.feeGroupId
                  ? " — assign a fee group on the student profile"
                  : ""}
                .
              </p>
            ) : (
              activeBundle.map((row) => {
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
                const rowDiscount = discountSlices.reduce(
                  (s, x) =>
                    x.studentId === row.student.id ? s + x.amountPaise : s,
                  0,
                );
                const rowSelectedNet = Math.max(0, rowSelected - rowDiscount);
                const hasOverdue = openDues.some((d) => d.dueOn <= today);

                return (
                  <div
                    key={row.student.id}
                    className="flex min-h-0 flex-col rounded-xl border border-[rgba(197,160,40,0.45)] bg-[var(--card)] p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] pb-2">
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        <label className="flex min-w-0 cursor-pointer items-start gap-2.5">
                          <input
                            type="checkbox"
                            className="mt-1"
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
                            </div>
                            <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                              {classLabel(row.student)} ·{" "}
                              {row.student.admissionNo} ·{" "}
                              {feeGroupLabel(row.student)}
                            </div>
                          </div>
                        </label>
                        <TransportRiderChip
                          studentId={row.student.id}
                          academicYearCode={row.student.academicYearCode}
                          dues={row.dues}
                        />
                      </div>
                      <div className="text-right">
                        <div
                          className={`text-sm font-bold ${
                            hasOverdue
                              ? "text-[var(--danger)]"
                              : rowTotal === 0 && row.dues.length > 0
                                ? "text-[var(--success)]"
                                : "text-[var(--brand-deep)]"
                          }`}
                        >
                          {formatInr(rowTotal)}
                        </div>
                        <div
                          className={`text-xs font-semibold ${
                            rowSelected > 0
                              ? "text-[var(--success)]"
                              : "text-[var(--muted)]"
                          }`}
                        >
                          {selectedForStudent.length}/{openDues.length} open ·{" "}
                          {formatInr(rowSelectedNet)}
                          {rowDiscount > 0
                            ? ` (−${formatInr(rowDiscount)})`
                            : ""}
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
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        No fee lines for this student
                      </p>
                    ) : (
                      <DueBreakupPicker
                        dues={row.dues}
                        selectedKeys={selectedKeys}
                        today={today}
                        onToggle={onToggle}
                        onToggleMonth={onToggleMonth}
                        lineDiscountRupees={lineDiscountRupees}
                        recurringEligible={recurringEligible}
                        recurringChosen={recurringChosen}
                        onToggleRecurring={onToggleRecurring}
                        discountOnlyKeys={discountOnlyKeys}
                        onToggleDiscountOnly={onToggleDiscountOnly}
                        onLineDiscount={onLineDiscount}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
        </div>

        {/* ── THE MONEY: sticky right column ── */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-3">
          <div
            className="relative overflow-hidden rounded-2xl border border-[var(--border)] shadow-[0_12px_40px_rgba(32,48,80,0.1)]"
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
            <div className="relative p-3.5 sm:p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[#f0d878]">
                    Counter collection
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-2xl font-bold tracking-tight text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)] sm:text-3xl">
                      {formatInr(collectTarget)}
                    </span>
                    {isPartialCollect ? (
                      <span className="text-xs font-semibold text-[#f0d878]">
                        partial · {formatInr(netAfterDiscount)} net
                      </span>
                    ) : counterDiscountPaise > 0 ? (
                      <span className="text-xs font-semibold text-[#f0d878]">
                        after {formatInr(counterDiscountPaise)} discount
                      </span>
                    ) : siblingCount > 1 ? (
                      <span className="rounded-full bg-[#c5a028] px-2 py-0.5 text-[11px] font-bold text-[#1a2740]">
                        Household · {siblingCount} students
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-[#f0d878]">
                        to collect
                      </span>
                    )}
                  </div>
                  {offScreenTicked.length > 0 ? (
                    <div className="mt-1.5 rounded-lg bg-[rgba(197,160,40,0.22)] px-2 py-1.5 text-[11px] leading-snug text-white">
                      Includes{" "}
                      {offScreenTicked.map((r, i) => (
                        <span key={r.student.id}>
                          {i > 0 ? " · " : ""}
                          <strong>{formatInr(r.paise)}</strong> ticked for{" "}
                          {r.student.fullName}
                        </span>
                      ))}{" "}
                      — not on screen.
                      <button
                        type="button"
                        className="ml-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-[#1a2740] hover:bg-white"
                        onClick={() =>
                          offScreenTicked.forEach((r) =>
                            onClearStudent(r.student.id),
                          )
                        }
                      >
                        Untick them
                      </button>
                    </div>
                  ) : null}
                </div>
                <label className="block text-xs">
                  <span className="mb-1 block text-xs font-medium text-white/75">
                    Collection date
                  </span>
                  <input
                    className="field !border-white/20 !bg-white/95 !py-1.5 !text-xs !text-[#203050] dark:!bg-[#05080f] dark:!text-white dark:!font-bold dark:!border-white/30 dark:placeholder:!text-white/40"
                    type="date"
                    value={collectionDate}
                    onChange={(e) => onCollectionDate(e.target.value)}
                    required
                  />
                  {isCollectionDateLocked(collectionDate) ? (
                    <span className="mt-1 block text-[11px] font-semibold leading-snug text-[#fca5a5]">
                      This date is day-closed — pick another date or reject handover
                    </span>
                  ) : null}
                </label>
                <label className="block min-w-[9rem] text-xs sm:min-w-[11rem]">
                  <span className="mb-1 block text-xs font-medium text-white/75">
                    School receipt no.
                  </span>
                  <input
                    className="field !border-white/20 !bg-white/95 !py-1.5 !text-xs !text-[#203050] dark:!bg-[#05080f] dark:!text-white dark:!font-bold dark:!border-white/30 dark:placeholder:!text-white/40"
                    value={schoolReceiptNo}
                    onChange={(e) => onSchoolReceiptNo(e.target.value)}
                    placeholder="Optional · e.g. FEE-BOOK-A/4521"
                    autoComplete="off"
                  />
                </label>
              </div>

              {collectTotal > 0 && counterDiscountPaise > 0 ? (
                <div className="mt-4 rounded-xl border border-[rgba(197,160,40,0.35)] bg-[rgba(255,255,255,0.06)] px-3 py-3 backdrop-blur-sm sm:px-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#f0d878]">
                    Head-wise discount summary
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-white/90">
                    {discountSlices.map((s) => {
                      const due = allHouseholdDues.find(
                        (d) => d.dueKey === s.dueKey,
                      );
                      const student = householdBundle.find(
                        (r) => r.student.id === s.studentId,
                      )?.student;
                      // Where this discount can go beyond this month, say so
                      // — and when it cannot, say WHY, so the office is never
                      // left wondering why no future-months question came.
                      const futureHint =
                        due?.kind === "academic" &&
                        due.feeHeadId &&
                        masters &&
                        student &&
                        isRecurringAcademicFeeHead(
                          masters,
                          student,
                          due.feeHeadId,
                          student.academicYearCode || "",
                        )
                          ? "future months offered on Collect"
                          : due?.kind === "transport"
                            ? "for future months, set a transport discount on the Transport roster"
                            : due?.kind === "academic"
                              ? "one-time head — nothing to extend"
                              : "";
                      return (
                        <li
                          key={s.dueKey}
                          className="rounded-md bg-white/5 px-2 py-1"
                        >
                          <div className="flex justify-between gap-2">
                            <span className="min-w-0 truncate">{s.label}</span>
                            <span className="shrink-0 font-bold text-[#f0d878]">
                              −{formatInr(s.amountPaise)}
                            </span>
                          </div>
                          {futureHint ? (
                            <div className="text-[10px] text-white/60">
                              {futureHint}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  <label className="mt-3 block text-xs">
                    <span className="mb-1 block text-xs font-medium text-white/75">
                      Reason for discount
                    </span>
                    <input
                      className="field w-full !border-white/25 !bg-white !py-2 !text-xs !text-[#203050] dark:!bg-[#05080f] dark:!text-white dark:!font-bold dark:!border-white/30 dark:placeholder:!text-white/40"
                      value={counterDiscountReason}
                      onChange={(e) => onCounterDiscountReason(e.target.value)}
                      placeholder="e.g. Security deposit relaxed on management approval"
                      autoComplete="off"
                    />
                  </label>
                </div>
              ) : null}

              {collectTotal > 0 ? (
                <div className="mt-4 rounded-xl border border-[rgba(197,160,40,0.45)] bg-[rgba(255,255,255,0.08)] px-3 py-3 backdrop-blur-sm sm:px-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <label className="block min-w-[11rem] flex-1 text-xs">
                      <span className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[#f0d878]">
                        Amount to collect
                        {isPartialCollect ? (
                          <span className="rounded-full bg-[#c5a028] px-2 py-0.5 text-[10px] font-extrabold text-[#1a2740]">
                            Partial
                          </span>
                        ) : null}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-bold text-white/80">₹</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          max={netAfterDiscount / 100}
                          className="field w-full !border-white/25 !bg-white !py-2 !text-xl !font-bold !text-[#203050] dark:!bg-[#05080f] dark:!text-white dark:!border-white/30 dark:placeholder:!text-white/40"
                          value={collectAmountRupees}
                          onChange={(e) => onCollectAmount(e.target.value)}
                          placeholder="0"
                          aria-label="Amount to collect in rupees"
                        />
                      </div>
                    </label>
                    {isPartialCollect ? (
                      <button
                        type="button"
                        className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/15"
                        onClick={onFillFullSelected}
                      >
                        Use full {formatInr(netAfterDiscount)}
                      </button>
                    ) : null}
                  </div>
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
                      <div className="min-w-0 text-xs">
                        <div className="font-semibold text-white">
                          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-gold)] text-[10px] font-bold text-[var(--brand-deep)]">
                            {i + 1}
                          </span>
                          {tenderChannelLabel(
                            encodeTenderChannel(t.mode, t.bankAccountId),
                          )}{" "}
                          ·{" "}
                          {formatInr(Math.round((Number(t.amount) || 0) * 100))}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs font-semibold text-white/90 hover:bg-white/20"
                        onClick={() => onRemoveTender(t.key)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {collectTarget > 0 ? (
                <div className="mt-4 rounded-xl border border-[rgba(197,160,40,0.35)] bg-[rgba(248,248,240,0.97)] p-3 shadow-sm">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--brand-deep)]">
                      {tenderLines.length === 0 ? "Add payment" : "Add another"}
                    </div>
                    {remainingPaise > 0 && composer.channel ? (
                      <button
                        type="button"
                        className="rounded-full bg-[rgba(197,160,40,0.2)] px-2.5 py-0.5 text-xs font-bold text-[var(--brand-deep)]"
                        onClick={onFillRemaining}
                      >
                        Use remaining {formatInr(remainingPaise)}
                      </button>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="block text-xs">
                      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                        Mode & account
                      </span>
                      <PaymentChannelSelect
                        className="field !border-[rgba(32,48,80,0.18)] !bg-white !py-1.5 !text-xs !text-[#203050]"
                        variant="tender"
                        accounts={accountsState ?? undefined}
                        value={composer.channel}
                        onChange={(channel) =>
                          onPatchComposer({
                            channel,
                            ref: "",
                            bankName: "",
                            // First mode auto-fills the full collect amount;
                            // later modes auto-fill whatever is still uncovered.
                            amount:
                              remainingPaise > 0
                                ? String(remainingPaise / 100)
                                : "",
                            instrumentDate: collectionDate || todayIso(),
                          })
                        }
                      />
                    </label>

                    {composer.channel && modeMeta ? (
                      <div className="flex flex-wrap items-end gap-2">
                        {modeMeta.needsRef ? (
                          <label className="block flex-1 text-xs">
                            <span className="mb-1 block text-[11px] text-[var(--muted)]">
                              {modeMeta.refLabel}
                            </span>
                            <input
                              className="field !bg-white !py-1.5 !text-xs !text-[#203050] placeholder:!text-[#20305066]"
                              value={composer.ref}
                              onChange={(e) =>
                                onPatchComposer({ ref: e.target.value })
                              }
                              placeholder={modeMeta.refLabel}
                              autoComplete="off"
                            />
                          </label>
                        ) : null}

                        <label className="block w-28 text-xs">
                          <span className="mb-1 block text-[11px] text-[var(--muted)]">
                            Amount (₹)
                          </span>
                          <input
                            className="field !border-[rgba(197,160,40,0.45)] !bg-white !py-1.5 !text-xs font-bold !text-[#203050] placeholder:!text-[#20305066]"
                            inputMode="decimal"
                            value={composer.amount}
                            onChange={(e) =>
                              onPatchComposer({ amount: e.target.value })
                            }
                            placeholder="0"
                          />
                        </label>

                        <button
                          type="button"
                          className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-bold text-white hover:opacity-95"
                          onClick={onAddTender}
                        >
                          Add line
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {collectError ? (
                <p className="mt-3 rounded-lg border border-[#fca5a5] bg-[rgba(239,68,68,0.15)] px-3 py-2 text-[11px] font-semibold leading-snug text-[#fecaca]">
                  {collectError}
                </p>
              ) : null}

              {(() => {
                return (
                  <button
                    type="button"
                    className={`mt-4 w-full rounded-xl px-4 py-3 text-sm font-extrabold uppercase tracking-wide transition active:scale-[0.99] disabled:cursor-not-allowed ${
                      matched
                        ? "bg-[#22c55e] text-white shadow-lg hover:bg-[#16a34a]"
                        : "bg-[#ef4444] text-white hover:bg-[#dc2626] disabled:opacity-90"
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
                className="mt-2 w-full rounded-xl border-2 border-[#128C7E] bg-[#128C7E]/15 px-4 py-2.5 text-xs font-bold text-[#0f766e] hover:bg-[#128C7E]/25 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={collectTotal <= 0 || readOnly}
                onClick={onSendUpiLink}
              >
                {collectTotal > 0
                  ? `Send UPI link · ${formatInr(collectTotal)}`
                  : "Select dues for UPI link"}
              </button>
              <p className="mt-2 text-center text-xs text-white/75">
                Collecting as{" "}
                <span className="font-semibold text-[#f0d878]">{cashierName}</span>
              </p>
            </div>
          </div>

          {/* Store purchases — issued vs paid, in the fee record */}
          <StorePurchasesPanel
            studentIds={householdBundle.map((r) => r.student.id)}
            nameById={
              new Map(
                householdBundle.map(
                  (r) => [r.student.id, r.student.fullName] as const,
                ),
              )
            }
            tick={storeTick}
          />

          {/* Earlier receipts */}
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-xs font-bold text-[var(--brand-deep)]">
                Earlier receipts
              </h2>
              <p className="text-[11px] text-[var(--muted)]">
                Household history · view / print / WhatsApp
              </p>
            </div>
            {priorReceipts.length === 0 ? (
              <p className="px-4 py-4 text-xs text-[var(--muted)]">
                No earlier receipts for this household yet.
              </p>
            ) : (
          <ul className="max-h-64 divide-y divide-[var(--border)] overflow-y-auto">
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
                      {paperRefOf(v) ? (
                        <span className="rounded bg-[rgba(197,160,40,0.16)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--brand-deep)]">
                          Book {paperRefOf(v)}
                        </span>
                      ) : null}
                      {/* The UTR is what a parent quotes from their bank app,
                          so it belongs on the row that a UTR search returns. */}
                      {v.tenders
                        .map((t) => t.ref?.trim())
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((ref) => (
                          <span
                            key={ref}
                            className="font-mono text-[10px] text-[var(--muted)]"
                            title="Transaction reference"
                          >
                            {ref}
                          </span>
                        ))}
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
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
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
        </aside>
      </div>

      {/* ── Sticky collect bar, phones only ──────────────────────────────
          The page stacks on a phone: sibling tabs, then every month's dues,
          then the household card, and only then the Collect button. A clerk
          taking a payment had to scroll past all of it, and back up again to
          check the amount.

          This keeps the amount and the action in the thumb zone the whole
          time. It is the SAME onCollect and the same disabled rule as the
          button in the panel — deliberately not a second code path, because
          two ways to take money is how they drift apart. Hidden on lg where
          the panel button is already visible. */}
      <div className="sticky bottom-0 z-20 -mx-3 mt-4 border-t border-[var(--border)] bg-[var(--card)]/95 px-3 py-2.5 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
              {isPartialCollect ? "Partial collection" : "Amount to collect"}
            </div>
            <div className="truncate text-lg font-bold text-[var(--brand-deep)]">
              {formatInr(collectTarget)}
            </div>
          </div>
          <button
            type="button"
            disabled={!matched || readOnly}
            onClick={onCollect}
            className={`min-h-12 shrink-0 rounded-xl px-5 text-sm font-extrabold uppercase tracking-wide transition active:scale-[0.99] disabled:cursor-not-allowed ${
              matched && !readOnly
                ? "bg-[var(--ok)] text-white shadow-lg"
                : "bg-[var(--surface-sunken)] text-[var(--muted)]"
            }`}
          >
            {readOnly
              ? "Closed"
              : matched
                ? "Collect"
                : tenderSum < collectTarget && tenderSum > 0
                  ? `Need ${formatInr(collectTarget - tenderSum)}`
                  : "Add payment"}
          </button>
        </div>
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
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-1">
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
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * The office prints with Cmd+P / File → Print as often as with the Print
   * button — and browser print applies none of the isolation classes, so the
   * whole Fee Take page went to paper (seen in the wild: an 11-page PDF for
   * one receipt). While THIS modal is open, any print — button or browser —
   * isolates the receipt sheet: `beforeprint` fires for both paths.
   */
  useEffect(() => {
    const target = () => document.getElementById(`receipt-${voucher.id}`);
    const isolate = () => {
      document.body.classList.add("printing-fee-receipt");
      target()?.classList.add("print-target");
    };
    const release = () => {
      document.body.classList.remove("printing-fee-receipt");
      target()?.classList.remove("print-target");
    };
    window.addEventListener("beforeprint", isolate);
    window.addEventListener("afterprint", release);
    return () => {
      release();
      window.removeEventListener("beforeprint", isolate);
      window.removeEventListener("afterprint", release);
    };
  }, [voucher.id]);

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

  // The parent's referral QR — their own code, so an enquiry scanned from
  // this receipt is attributed back to them.
  const [referralQr, setReferralQr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function buildReferralQr() {
      const hh = sis?.households.find((h) => h.id === voucher.householdId);
      if (!hh) {
        setReferralQr(null);
        return;
      }
      const { referralCodeFor } = await import("@/lib/referrals");
      const QRCode = (await import("qrcode")).default;
      const url = `https://${TENANT.publicPortal}/apply?ref=${encodeURIComponent(
        referralCodeFor(hh),
      )}`;
      const dataUrl = await QRCode.toDataURL(url, {
        width: 180,
        margin: 0,
        errorCorrectionLevel: "M",
        color: { dark: "#203050", light: "#ffffff" },
      });
      if (!cancelled) setReferralQr(dataUrl);
    }
    void buildReferralQr();
    return () => {
      cancelled = true;
    };
  }, [voucher.householdId, sis]);

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
        <div className="print-hide mb-3 space-y-3 rounded-xl bg-[var(--card)] px-4 py-3 shadow-lg">
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
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--brand-deep)]"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>

          {!voucher.voidedAt ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3">
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
            <p className="text-xs font-semibold text-[var(--danger)]">{waError}</p>
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
          referralQrDataUrl={referralQr}
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
  const [modeFilter, setModeFilter] = useState<"" | TenderMode>("");
  const [concessionFilter, setConcessionFilter] = useState<"" | "with" | "without">("");
  const [collectorQ, setCollectorQ] = useState("");
  /**
   * One box for every number a receipt can be found by: our receipt no., the
   * paper book number written on it, the UTR / UPI ref of any tender, and the
   * transaction id. The counter is usually holding exactly one of these — a
   * parent quoting a UTR from their bank app, or a paper stub — and had no way
   * to get from it to the receipt.
   */
  const [refQ, setRefQ] = useState("");
  /** Paper-book register: only receipts carrying a book number. */
  const [paperOnly, setPaperOnly] = useState(false);
  const [leafFrom, setLeafFrom] = useState("");
  const [leafTo, setLeafTo] = useState("");

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

      if (modeFilter && !v.tenders.some((t) => t.mode === modeFilter)) {
        return false;
      }

      if (concessionFilter) {
        const hasConcession = v.lines.some(
          (l) => (l.concessionPaise ?? 0) > 0,
        );
        if (concessionFilter === "with" && !hasConcession) return false;
        if (concessionFilter === "without" && hasConcession) return false;
      }

      if (
        collectorQ.trim() &&
        !v.cashierName.toLowerCase().includes(collectorQ.trim().toLowerCase())
      ) {
        return false;
      }

      const paperNo = paperRefOf(v);

      if (paperOnly && !paperNo) return false;

      // Serial range over the book. Compared numerically when both ends and
      // the stub are numbers — "9" must not sort after "10" — and as text
      // otherwise, so lettered series still filter sensibly.
      if (leafFrom || leafTo) {
        if (!paperNo) return false;
        const n = leafNumber(paperNo);
        const a = leafNumber(leafFrom);
        const b = leafNumber(leafTo);
        if (n != null && (a != null || b != null)) {
          if (a != null && n < a) return false;
          if (b != null && n > b) return false;
        } else {
          const key = paperNo.toUpperCase();
          if (leafFrom && key < leafFrom.toUpperCase()) return false;
          if (leafTo && key > leafTo.toUpperCase()) return false;
        }
      }

      const rq = refQ.trim().toLowerCase();
      if (rq) {
        const haystack = [
          v.receiptNo,
          paperNo,
          v.transactionId ?? "",
          ...v.tenders.map((t) => t.ref ?? ""),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(rq)) return false;
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
    modeFilter,
    concessionFilter,
    collectorQ,
    refQ,
    paperOnly,
    leafFrom,
    leafTo,
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
    modeFilter ? `Mode ${tenderModeLabel(modeFilter)}` : "",
    concessionFilter === "with"
      ? "With concession"
      : concessionFilter === "without"
        ? "No concession"
        : "",
    collectorQ.trim() ? `Collector “${collectorQ.trim()}”` : "",
    refQ.trim() ? `Ref “${refQ.trim()}”` : "",
    paperOnly ? "Paper book only" : "",
    leafFrom || leafTo ? `Serial ${leafFrom || "…"}–${leafTo || "…"}` : "",
  ]);

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setStudentQ("");
    setParentQ("");
    setClassId("");
    setSectionId("");
    setModeFilter("");
    setConcessionFilter("");
    setCollectorQ("");
    setRefQ("");
    setPaperOnly(false);
    setLeafFrom("");
    setLeafTo("");
  }

  const hasFilters =
    dateFrom ||
    dateTo ||
    studentQ ||
    parentQ ||
    classId ||
    sectionId ||
    modeFilter ||
    concessionFilter ||
    collectorQ ||
    refQ ||
    paperOnly ||
    leafFrom ||
    leafTo;

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
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            To date
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Student
            <input
              type="search"
              value={studentQ}
              onChange={(e) => setStudentQ(e.target.value)}
              placeholder="Name or adm no."
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Parent / mobile
            <input
              type="search"
              value={parentQ}
              onChange={(e) => setParentQ(e.target.value)}
              placeholder="Guardian or mobile"
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm"
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
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm"
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
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm disabled:opacity-50"
            >
              <option value="">All sections</option>
              {sectionOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Mode
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as "" | TenderMode)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm"
            >
              <option value="">All modes</option>
              {TENDER_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Concession
            <select
              value={concessionFilter}
              onChange={(e) =>
                setConcessionFilter(e.target.value as "" | "with" | "without")
              }
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm"
            >
              <option value="">All receipts</option>
              <option value="with">With concession</option>
              <option value="without">No concession</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Collector
            <input
              type="search"
              value={collectorQ}
              onChange={(e) => setCollectorQ(e.target.value)}
              placeholder="Cashier name"
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)] sm:col-span-2">
            Receipt no. / UTR / paper book no.
            <input
              type="search"
              value={refQ}
              onChange={(e) => setRefQ(e.target.value)}
              placeholder="RCV-00118 · UTR / UPI ref · 1376 · FEE-BOOK-A/4521"
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm"
            />
          </label>
        </div>

        {/* Paper-book register: the office reconciles the printed book against
            what the system holds, so it needs the book's own view — stubs only,
            in serial order, over a date range. */}
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-[rgba(197,160,40,0.35)] bg-[rgba(197,160,40,0.06)] px-2.5 py-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-deep)]">
            <input
              type="checkbox"
              checked={paperOnly}
              onChange={(e) => setPaperOnly(e.target.checked)}
            />
            Paper book only
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Serial from
            <input
              value={leafFrom}
              onChange={(e) => setLeafFrom(e.target.value)}
              placeholder="1370"
              className="mt-0.5 w-24 rounded-lg border border-[var(--border)] px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            to
            <input
              value={leafTo}
              onChange={(e) => setLeafTo(e.target.value)}
              placeholder="1399"
              className="mt-0.5 w-24 rounded-lg border border-[var(--border)] px-2 py-1 text-sm"
            />
          </label>
          {paperOnly || leafFrom || leafTo ? (
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold"
              onClick={() => {
                setPaperOnly(false);
                setLeafFrom("");
                setLeafTo("");
              }}
            >
              Clear book filter
            </button>
          ) : null}
          <span className="text-[11px] text-[var(--muted)]">
            Missing stubs in a range are the ones to chase in the book.
          </span>
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
          <ul className="divide-y divide-[var(--border)]">
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
                    <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-2">
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
      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--brand-deep)] sm:text-base"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
