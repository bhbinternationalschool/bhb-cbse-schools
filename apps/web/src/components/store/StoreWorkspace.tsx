"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  formatInr,
  loadFees,
  paidByDueKey,
  searchFeeStudents,
  type StudentSearchHit,
} from "@/lib/fees";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import {
  audienceLabel,
  categoryLabel,
  checkItemIssuePolicy,
  createStoreIssue,
  issuePolicyLabel,
  itemAppliesToRecipient,
  listActiveStoreItems,
  listLowStockItems,
  loadStore,
  maxAllowedDiscountPaise,
  seedStoreIfEmpty,
  storeDueKey,
  voidStoreIssue,
  type PriorIssueHit,
  type StoreIssue,
  type StoreIssueKind,
  type StoreItem,
  type StorePaymentMode,
} from "@/lib/store";
import {
  runStoreReport,
  type StoreReportFormat,
  type StoreReportId,
} from "@/lib/storeReportCatalog";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import { StudentHitsFilterExport } from "@/components/reports/StudentHitsFilterExport";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  HoldStatusBanner,
  PrincipalHoldOverrideDialog,
} from "@/components/fees/PrincipalHoldOverrideDialog";
import { checkHold, type HoldCheck } from "@/lib/holds";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { PurchaseWorkspace } from "@/components/purchase/PurchaseWorkspace";
import { StockMasterWorkspace } from "@/components/store/StockMasterWorkspace";
import {
  StoreModuleNav,
  type StoreSubScreen,
  type StoreTab,
} from "@/components/store/StoreModuleNav";
import { StoreReportsPanel } from "@/components/store/StoreReportsPanel";
import { StoreInventoryAllocationPanel } from "@/components/store/StoreInventoryAllocationPanel";
import { StoreAssetAllocationPanel } from "@/components/store/StoreAssetAllocationPanel";
import { StoreAccountsWorkspace } from "@/components/store/StoreAccountsWorkspace";
import { StoreSellReturnPanel } from "@/components/store/StoreSellReturnPanel";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

type CartRow = {
  itemId: string;
  qty: string;
  sizeLabel: string;
};

export function StoreWorkspace() {
  const session = useDemoSession();
  const [tab, setTab] = useState<StoreTab>("dashboard");
  const [subScreen, setSubScreen] = useState<StoreSubScreen>("allocation");
  const [issueSubTab, setIssueSubTab] = useState<"sell" | "history" | "return">(
    "sell",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("tab");
    const sub = params.get("sub");
    const allowed: StoreTab[] = [
      "dashboard",
      "master",
      "purchase",
      "issue",
      "inv_report",
      "acct_report",
      "inv_allocation",
      "asset_allocation",
    ];
    if (raw === "catalog" || raw === "stock") {
      setTab("master");
      return;
    }
    if (raw === "indent" || raw === "po" || raw === "grn") {
      setTab("purchase");
      return;
    }
    if (raw === "history") {
      setTab("issue");
      setIssueSubTab("history");
      return;
    }
    if (raw === "reports") {
      setTab("inv_report");
      return;
    }
    if (raw && (allowed as string[]).includes(raw)) {
      setTab(raw as StoreTab);
      if (
        (raw === "inv_allocation" || raw === "asset_allocation") &&
        (sub === "allocation" || sub === "report")
      ) {
        setSubScreen(sub);
      }
    }
  }, []);

  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [items, setItems] = useState<StoreItem[]>([]);
  const [allItems, setAllItems] = useState<StoreItem[]>([]);
  const [issues, setIssues] = useState<StoreIssue[]>([]);
  const [recipientKind, setRecipientKind] = useState<"student" | "staff">(
    "student",
  );
  const [staffId, setStaffId] = useState("");
  const [staffQuery, setStaffQuery] = useState("");
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [hits, setHits] = useState<StudentSearchHit[]>([]);
  const [selected, setSelected] = useState<StudentSearchHit | null>(null);
  const [issuedOn, setIssuedOn] = useState(todayIso);
  const [note, setNote] = useState("");
  const [cart, setCart] = useState<CartRow[]>([]);
  const [pickItemId, setPickItemId] = useState("");
  const [paymentMode, setPaymentMode] = useState<StorePaymentMode>("credit");
  const [discountInr, setDiscountInr] = useState("");
  const [issueKind, setIssueKind] = useState<StoreIssueKind>("first");
  const [replacesIssueId, setReplacesIssueId] = useState("");
  const [replacementReason, setReplacementReason] = useState("");
  const [returnToStock, setReturnToStock] = useState(true);
  const [policyBlock, setPolicyBlock] = useState<{
    message: string;
    prior?: PriorIssueHit;
    itemId: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [holdCheck, setHoldCheck] = useState<HoldCheck | null>(null);
  const [holdDialog, setHoldDialog] = useState(false);
  const [skipHold, setSkipHold] = useState(false);

  const [historyQ, setHistoryQ] = useState("");
  const [historyMode, setHistoryMode] = useState<"all" | "cash" | "credit">("all");

  const [reportDate, setReportDate] = useState(todayIso);
  const [reportClassId, setReportClassId] = useState("");
  const [reportSkuId, setReportSkuId] = useState("");
  const [reportRunning, setReportRunning] = useState<string | null>(null);

  function refreshHolds(studentId?: string) {
    if (!studentId) {
      setHoldCheck(null);
      return;
    }
    setHoldCheck(checkHold(studentId, "HOLD_STORE_CREDIT"));
  }

  function refresh() {
    const m = loadMasters();
    const s = loadSis();
    const store = loadStore();
    setMasters(m);
    setSis(s);
    setAllItems(store.items);
    setItems(listActiveStoreItems(store));
    setIssues(
      store.issues
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
    setTick((t) => t + 1);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const [{ ensureStoreHydrated }, { ensurePurchaseHydrated }] =
        await Promise.all([
          import("@/lib/storePersistence"),
          import("@/lib/purchasePersistence"),
        ]);
      await Promise.all([ensureStoreHydrated(), ensurePurchaseHydrated()]);
      refresh();
    })();
  }, []);

  const lowStock = useMemo(() => listLowStockItems(loadStore()), [tick]);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive);
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    return masters.sections.filter((s) => s.classId === classId && s.isActive);
  }, [masters, classId]);

  useEffect(() => {
    if (!sectionId) return;
    if (!sectionOptions.some((s) => s.id === sectionId)) setSectionId("");
  }, [sectionId, sectionOptions]);

  useEffect(() => {
    if (!sis || !masters) return;
    setHits(
      searchFeeStudents(query, sis, masters, undefined, {
        classId,
        sectionId,
      }),
    );
  }, [query, classId, sectionId, sis, masters, tick]);

  useEffect(() => {
    refreshHolds(selected?.student.id);
    setSkipHold(false);
  }, [selected?.student.id, tick]);

  const cartTotal = useMemo(() => {
    let sum = 0;
    const discLines: { linePaise: number; maxDiscountPct: number }[] = [];
    for (const row of cart) {
      const item = items.find((i) => i.id === row.itemId);
      if (!item) continue;
      const qty = Math.max(1, Math.floor(Number(row.qty) || 1));
      const linePaise = item.salePricePaise * qty;
      sum += linePaise;
      discLines.push({
        linePaise,
        maxDiscountPct: item.maxDiscountPct,
      });
    }
    const maxDisc = maxAllowedDiscountPaise(discLines);
    const disc = Math.round(Number(discountInr || "0") * 100);
    const clamped = Math.min(
      Number.isFinite(disc) ? Math.max(0, disc) : 0,
      maxDisc,
      sum,
    );
    return { total: Math.max(0, sum - clamped), maxDisc, linesTotal: sum };
  }, [cart, items, discountInr]);

  const issueableItems = useMemo(() => {
    return items.filter((item) =>
      itemAppliesToRecipient(item, {
        audience: recipientKind,
        classId: selected?.student.classId,
      }),
    );
  }, [items, recipientKind, selected?.student.classId]);

  const staffRoster = useMemo(() => {
    const roster = masters?.staff ?? [];
    const q = staffQuery.trim().toLowerCase();
    return roster
      .filter((s) => s.status === "active")
      .filter((s) => {
        if (!q) return true;
        const name = (s.fullName || "").toLowerCase();
        const code = (s.empCode || s.id || "").toLowerCase();
        return name.includes(q) || code.includes(q);
      })
      .slice(0, 20);
  }, [masters, staffQuery]);

  const selectedStaff = useMemo(
    () => (masters?.staff ?? []).find((s) => s.id === staffId) || null,
    [masters, staffId],
  );

  const priorIssuesForStudent = useMemo(() => {
    if (!selected) return [];
    return issues.filter(
      (i) => i.studentId === selected.student.id && !i.voidedAt,
    );
  }, [issues, selected]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function addToCart() {
    if (!pickItemId) return;
    const item = issueableItems.find((i) => i.id === pickItemId) || items.find((i) => i.id === pickItemId);
    if (!item) return;

    if (recipientKind === "student" && selected && issueKind === "first") {
      const check = checkItemIssuePolicy(
        loadStore(),
        selected.student.id,
        item,
        1,
        selected.student.academicYearCode || DEFAULT_AY,
        "first",
      );
      if (!check.ok) {
        setPolicyBlock({
          message: check.error,
          prior: check.prior,
          itemId: item.id,
        });
        setError(check.error);
        return;
      }
    }

    setPolicyBlock(null);
    setCart((prev) => {
      const existing = prev.find((r) => r.itemId === pickItemId);
      if (existing) {
        return prev.map((r) =>
          r.itemId === pickItemId
            ? {
                ...r,
                qty: String(Math.max(1, Math.floor(Number(r.qty) || 1) + 1)),
              }
            : r,
        );
      }
      return [
        ...prev,
        {
          itemId: pickItemId,
          qty: "1",
          sizeLabel: item.sizeLabel ?? "",
        },
      ];
    });
    setPickItemId("");
  }

  function startReplacement(kind: StoreIssueKind, prior?: PriorIssueHit) {
    setIssueKind(kind);
    if (prior) {
      setReplacesIssueId(prior.issue.id);
      setReplacementReason(
        kind === "replacement_lost"
          ? "lost"
          : kind === "replacement_damaged"
            ? "damaged"
            : "size_exchange",
      );
      setCart([
        {
          itemId: prior.line.itemId || policyBlock?.itemId || "",
          qty: String(prior.line.qty || 1),
          sizeLabel: prior.line.sizeLabel || "",
        },
      ]);
    } else if (policyBlock?.itemId) {
      setCart([
        {
          itemId: policyBlock.itemId,
          qty: "1",
          sizeLabel:
            items.find((i) => i.id === policyBlock.itemId)?.sizeLabel || "",
        },
      ]);
      if (policyBlock.prior) setReplacesIssueId(policyBlock.prior.issue.id);
    }
    setPolicyBlock(null);
    setError(null);
    flash(
      kind === "size_exchange"
        ? "Size exchange mode — adjust size, then issue"
        : "Replacement mode — post with reason",
    );
  }

  function onIssue() {
    if (recipientKind === "student" && !selected) {
      setError("Pick a student first");
      return;
    }
    if (recipientKind === "staff" && !staffId) {
      setError("Pick a staff member first");
      return;
    }
    if (cart.length === 0) {
      setError("Add at least one catalog item");
      return;
    }
    if (
      recipientKind === "student" &&
      paymentMode === "credit" &&
      !skipHold &&
      selected
    ) {
      const hold = checkHold(selected.student.id, "HOLD_STORE_CREDIT");
      setHoldCheck(hold);
      if (!hold.allowed) {
        setHoldDialog(true);
        setError(hold.message);
        return;
      }
    }

    const discPaise = Math.min(
      Math.round(Number(discountInr || "0") * 100) || 0,
      cartTotal.maxDisc,
    );
    const returnLines =
      issueKind === "size_exchange" && returnToStock && replacesIssueId
        ? (() => {
            const orig = issues.find((i) => i.id === replacesIssueId);
            return (orig?.lines || [])
              .filter((l) => cart.some((c) => c.itemId === l.itemId))
              .map((l) => ({ itemId: l.itemId, qty: l.qty }));
          })()
        : undefined;

    const result = createStoreIssue({
      recipientKind,
      studentId: selected?.student.id,
      householdId: selected?.student.householdId,
      staffId: recipientKind === "staff" ? staffId : undefined,
      classId: selected?.student.classId,
      issuedOn,
      academicYearCode: selected?.student.academicYearCode || DEFAULT_AY,
      note,
      paymentMode,
      saleDiscountPaise: discPaise,
      issueKind,
      replacesIssueId: replacesIssueId || undefined,
      replacementReason: replacementReason || undefined,
      issuedBy: session.fullName,
      returnToStock: issueKind === "size_exchange" && returnToStock,
      returnLines,
      skipHoldCheck:
        skipHold || paymentMode === "cash" || recipientKind === "staff",
      lines: cart.map((r) => ({
        itemId: r.itemId,
        qty: Math.max(1, Math.floor(Number(r.qty) || 1)),
        sizeLabel: r.sizeLabel,
      })),
    });
    if (!result.ok) {
      if (result.prior) {
        setPolicyBlock({
          message: result.error,
          prior: result.prior,
          itemId: result.prior.line.itemId,
        });
      }
      setError(result.error);
      return;
    }
    setCart([]);
    setNote("");
    setDiscountInr("");
    setIssueKind("first");
    setReplacesIssueId("");
    setReplacementReason("");
    setPolicyBlock(null);
    refresh();
    flash(
      paymentMode === "cash"
        ? `Cash sale ${result.issue.issueNo} · ${formatInr(result.issue.totalPaise)}`
        : `Credit ${result.issue.issueNo} · ${formatInr(result.issue.totalPaise)}${
            recipientKind === "student" ? " due on Fee Take" : ""
          }`,
    );
  }

  function onVoid(iss: StoreIssue) {
    if (
      !window.confirm(
        `Void ${iss.issueNo}? Stock will be restored.${
          iss.paymentMode === "credit"
            ? " Removes from Fee Take if unpaid."
            : ""
        }`,
      )
    ) {
      return;
    }
    const fees = loadFees();
    const collected =
      iss.paymentMode === "credit"
        ? paidByDueKey(fees).get(storeDueKey(iss.studentId, iss.id)) ?? 0
        : 0;
    const r = voidStoreIssue(iss.id, {
      by: session.fullName,
      collectedPaise: collected,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    refresh();
    flash(`Voided ${iss.issueNo}`);
  }

  function onRunReport(id: StoreReportId, format: StoreReportFormat) {
    const key = `${id}:${format}`;
    setReportRunning(key);
    const result = runStoreReport(id, {
      date: reportDate,
      classId: reportClassId || undefined,
      skuItemId: reportSkuId || undefined,
      format,
      masters: masters ?? undefined,
      sis: sis ?? undefined,
    });
    setReportRunning(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    flash(result.message);
  }

  const catalogByCat = useMemo(() => {
    const map = new Map<string, StoreItem[]>();
    for (const item of issueableItems) {
      const key = categoryLabel(item.categoryId);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [issueableItems]);

  const filteredHistory = useMemo(() => {
    const q = historyQ.trim().toLowerCase();
    return issues.filter((iss) => {
      if (historyMode === "cash" && iss.paymentMode !== "cash") return false;
      if (historyMode === "credit" && iss.paymentMode !== "credit") return false;
      if (!q) return true;
      const st = sis?.students.find((s) => s.id === iss.studentId);
      const staff = (masters?.staff ?? []).find((s) => s.id === iss.staffId);
      return (
        iss.issueNo.toLowerCase().includes(q) ||
        (st?.fullName || "").toLowerCase().includes(q) ||
        (staff?.fullName || "").toLowerCase().includes(q) ||
        (staff?.empCode || "").toLowerCase().includes(q) ||
        iss.note.toLowerCase().includes(q)
      );
    });
  }, [issues, historyQ, historyMode, sis, masters]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
            Store / books
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Stock master · issue · purchase (indent → PO → GRN) · reports
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.length === 0 ? (
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-sm font-semibold text-[var(--brand-deep)]"
              onClick={() => {
                seedStoreIfEmpty();
                refresh();
                flash("Starter catalog loaded");
              }}
            >
              Load sample catalog
            </button>
          ) : null}
          <Link
            href="/fees"
            className="btn-accent rounded-lg px-3 py-1.5 text-sm font-semibold"
          >
            Open Fee Take
          </Link>
        </div>
      </div>

      {lowStock.length > 0 ? (
        <p className="mt-3 rounded-lg border border-[rgba(180,83,9,0.25)] bg-[rgba(180,83,9,0.08)] px-3 py-2 text-[12px] text-[#9a3412]">
          Low stock:{" "}
          {lowStock
            .slice(0, 4)
            .map((i) => `${i.sku} (${i.stockOnHand})`)
            .join(" · ")}
          {lowStock.length > 4 ? ` · +${lowStock.length - 4} more` : ""}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <StoreModuleNav
        tab={tab}
        subScreen={subScreen}
        onTabChange={(next) => {
          setTab(next);
          if (next === "issue") setIssueSubTab("sell");
        }}
        onSubScreenChange={setSubScreen}
      />

      {tab === "dashboard" ? (
        <div className="mt-4">
          <ModuleDashboardHost
            moduleId="store"
            onNavigateTab={(t) => setTab(t as StoreTab)}
          />
        </div>
      ) : null}

      {tab === "purchase" ? (
        <div className="mt-4">
          <PurchaseWorkspace embedded />
        </div>
      ) : null}

      {tab === "master" ? <StockMasterWorkspace /> : null}

      {tab === "issue" ? (
        <>
          <div className="mt-4">
            <ModuleTabs
              aria-label="Sell / Issue"
              value={issueSubTab}
              onChange={(id) =>
                setIssueSubTab(id as "sell" | "history" | "return")
              }
              size="md"
              className="!mt-0"
              items={[
                { id: "sell", label: "Sell / Issue", tone: "teal" },
                { id: "return", label: "Sell return", tone: "amber" },
                { id: "history", label: "History", tone: "slate" },
              ]}
            />
          </div>
          {issueSubTab === "sell" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="space-y-4">
            <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
              <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                Issue to student
              </h2>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                Cashier: {session.fullName}
                {issueKind !== "first" ? (
                  <span className="ml-2 font-semibold text-[#c2410c]">
                    · {issueKind.replace(/_/g, " ")}
                  </span>
                ) : null}
              </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
                  recipientKind === "student"
                    ? "bg-[var(--brand-deep)] text-white"
                    : "border border-[rgba(32,48,80,0.15)] text-[var(--muted)]"
                }`}
                onClick={() => {
                  setRecipientKind("student");
                  setStaffId("");
                  setCart([]);
                }}
              >
                Students
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
                  recipientKind === "staff"
                    ? "bg-[var(--brand-deep)] text-white"
                    : "border border-[rgba(32,48,80,0.15)] text-[var(--muted)]"
                }`}
                onClick={() => {
                  setRecipientKind("staff");
                  setSelected(null);
                  setQuery("");
                  setCart([]);
                }}
              >
                Staff
              </button>
            </div>

            {recipientKind === "student" ? (
              <>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)]">
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Find student
                  </span>
                  <input
                    className="field"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSelected(null);
                    }}
                    placeholder="Name, admission no, or mobile…"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Class
                  </span>
                  <select
                    className="field !py-1.5"
                    value={classId}
                    onChange={(e) => {
                      setClassId(e.target.value);
                      setSectionId("");
                      setSelected(null);
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
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Section
                  </span>
                  <select
                    className="field !py-1.5"
                    value={sectionId}
                    disabled={!classId}
                    onChange={(e) => {
                      setSectionId(e.target.value);
                      setSelected(null);
                    }}
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

              <div className="mt-2 flex justify-end">
                <StudentHitsFilterExport
                  title="Store · student search"
                  hits={hits}
                  query={query}
                  classLabel={classOptions.find((c) => c.id === classId)?.name}
                  sectionLabel={
                    sectionOptions.find((s) => s.id === sectionId)?.name
                  }
                  onMessage={(msg) => {
                    setNotice(msg);
                    window.setTimeout(() => setNotice(null), 2200);
                  }}
                />
              </div>

              {!selected && (query.trim() || classId || sectionId) ? (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {hits.length === 0 ? (
                    <li className="rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-3 text-sm text-[var(--muted)]">
                      No students match.
                    </li>
                  ) : (
                    hits.slice(0, 12).map((h) => (
                      <li key={h.student.id}>
                        <button
                          type="button"
                          className="w-full rounded-lg border border-[rgba(32,48,80,0.12)] px-3 py-2 text-left hover:border-[rgba(197,160,40,0.45)] hover:bg-[rgba(197,160,40,0.08)]"
                          onClick={() => {
                            setSelected(h);
                            setQuery(h.student.fullName);
                          }}
                        >
                          <div className="text-sm font-semibold text-[var(--brand-deep)]">
                            <StudentNameLabel student={h.student} />
                          </div>
                          <div className="text-[11px] text-[var(--muted)]">
                            {h.classLabel} · fee open {formatInr(h.balancePaise)}
                          </div>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}

              {selected ? (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2">
                    <div className="text-sm text-[var(--brand-deep)]">
                      <span className="font-semibold">
                        {selected.student.fullName}
                      </span>
                      <span className="text-[var(--muted)]">
                        {" "}
                        · {selected.student.admissionNo} · {selected.classLabel}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="text-xs font-semibold text-[var(--brand-mid)]"
                      onClick={() => {
                        setSelected(null);
                        setQuery("");
                      }}
                    >
                      Change
                    </button>
                  </div>
                  {paymentMode === "credit" ? (
                    <HoldStatusBanner
                      check={holdCheck}
                      onOverride={() => setHoldDialog(true)}
                    />
                  ) : null}
                </div>
              ) : null}
              </>
            ) : (
              <div className="mt-3 space-y-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Find staff
                  </span>
                  <input
                    className="field"
                    value={staffQuery}
                    onChange={(e) => setStaffQuery(e.target.value)}
                    placeholder="Name or emp code…"
                  />
                </label>
                {!staffId ? (
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {staffRoster.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className="w-full rounded-lg border border-[rgba(32,48,80,0.12)] px-3 py-2 text-left text-sm hover:bg-[rgba(197,160,40,0.08)]"
                          onClick={() => {
                            setStaffId(s.id);
                            setStaffQuery(s.fullName);
                          }}
                        >
                          <span className="font-semibold text-[var(--brand-deep)]">
                            {s.fullName}
                          </span>
                          <span className="text-[11px] text-[var(--muted)]">
                            {" "}
                            · {s.empCode || s.id}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex items-center justify-between rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2 text-sm">
                    <span className="font-semibold text-[var(--brand-deep)]">
                      {selectedStaff?.fullName || staffId}
                      <span className="font-normal text-[var(--muted)]">
                        {" "}
                        · {selectedStaff?.empCode}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="text-xs font-semibold text-[var(--brand-mid)]"
                      onClick={() => {
                        setStaffId("");
                        setStaffQuery("");
                      }}
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>
            )}

              {policyBlock ? (
                <div className="mt-3 rounded-lg border border-[rgba(180,83,9,0.3)] bg-[rgba(180,83,9,0.08)] px-3 py-2 text-[12px] text-[#9a3412]">
                  <p className="font-semibold">{policyBlock.message}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded bg-[#c2410c] px-2 py-1 text-[10px] font-bold text-white"
                      onClick={() =>
                        startReplacement("replacement_lost", policyBlock.prior)
                      }
                    >
                      Replacement — lost
                    </button>
                    <button
                      type="button"
                      className="rounded bg-[#c2410c] px-2 py-1 text-[10px] font-bold text-white"
                      onClick={() =>
                        startReplacement(
                          "replacement_damaged",
                          policyBlock.prior,
                        )
                      }
                    >
                      Damaged
                    </button>
                    <button
                      type="button"
                      className="rounded border border-[#c2410c] px-2 py-1 text-[10px] font-bold text-[#c2410c]"
                      onClick={() =>
                        startReplacement("size_exchange", policyBlock.prior)
                      }
                    >
                      Size exchange
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-[10px] font-semibold"
                      onClick={() => setPolicyBlock(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Issue date
                  </span>
                  <input
                    className="field !py-1.5"
                    type="date"
                    value={issuedOn}
                    onChange={(e) => setIssuedOn(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Payment
                  </span>
                  <select
                    className="field !py-1.5"
                    value={paymentMode}
                    onChange={(e) =>
                      setPaymentMode(e.target.value as StorePaymentMode)
                    }
                  >
                    <option value="credit">Credit → Fee Take</option>
                    <option value="cash">Cash at counter</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Discount ₹ (max {formatInr(cartTotal.maxDisc)})
                  </span>
                  <input
                    className="field !py-1.5"
                    inputMode="decimal"
                    value={discountInr}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const paise = Math.round(Number(raw || "0") * 100);
                      if (
                        Number.isFinite(paise) &&
                        paise > cartTotal.maxDisc &&
                        cartTotal.maxDisc >= 0
                      ) {
                        setDiscountInr(
                          (cartTotal.maxDisc / 100).toFixed(
                            cartTotal.maxDisc % 100 === 0 ? 0 : 2,
                          ),
                        );
                        return;
                      }
                      setDiscountInr(raw);
                    }}
                    placeholder="0"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Issue kind
                  </span>
                  <select
                    className="field !py-1.5"
                    value={issueKind}
                    onChange={(e) =>
                      setIssueKind(e.target.value as StoreIssueKind)
                    }
                  >
                    <option value="first">First issue</option>
                    <option value="replacement_lost">Replacement — lost</option>
                    <option value="replacement_damaged">
                      Replacement — damaged
                    </option>
                    <option value="size_exchange">Size exchange</option>
                    <option value="extra_optional">Extra / optional</option>
                  </select>
                </label>
              </div>

              {issueKind !== "first" && issueKind !== "extra_optional" ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Original issue
                    </span>
                    <select
                      className="field !py-1.5"
                      value={replacesIssueId}
                      onChange={(e) => setReplacesIssueId(e.target.value)}
                    >
                      <option value="">Select prior issue…</option>
                      {priorIssuesForStudent.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.issueNo} · {i.issuedOn} · {formatInr(i.totalPaise)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Reason note
                    </span>
                    <input
                      className="field !py-1.5"
                      value={replacementReason}
                      onChange={(e) => setReplacementReason(e.target.value)}
                      placeholder="Lost on picnic / size 32→34"
                    />
                  </label>
                  {issueKind === "size_exchange" ? (
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={returnToStock}
                        onChange={(e) => setReturnToStock(e.target.checked)}
                      />
                      <span className="text-[12px] text-[var(--brand-deep)]">
                        Return old size to stock (usable)
                      </span>
                    </label>
                  ) : null}
                </div>
              ) : null}

              <label className="mt-3 block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Note (optional)
                </span>
                <input
                  className="field !py-1.5"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. New session book set"
                />
              </label>

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-[12rem] flex-1 text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Add item
                  </span>
                  <select
                    className="field !py-1.5"
                    value={pickItemId}
                    onChange={(e) => setPickItemId(e.target.value)}
                  >
                    <option value="">Select from catalog…</option>
                    {catalogByCat.map(([cat, list]) => (
                      <optgroup key={cat} label={cat}>
                        {list.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.sku} · {i.name}
                            {i.sizeLabel ? ` (${i.sizeLabel})` : ""} ·{" "}
                            {formatInr(i.salePricePaise)} · stock {i.stockOnHand}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)]"
                  onClick={addToCart}
                >
                  Add
                </button>
              </div>

              {cart.length > 0 ? (
                <ul className="mt-3 divide-y divide-[rgba(32,48,80,0.08)] rounded-lg border border-[rgba(32,48,80,0.12)]">
                  {cart.map((row) => {
                    const item = items.find((i) => i.id === row.itemId);
                    if (!item) return null;
                    const qty = Math.max(1, Math.floor(Number(row.qty) || 1));
                    return (
                      <li
                        key={row.itemId}
                        className="flex flex-wrap items-center gap-2 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-[var(--brand-deep)]">
                            {item.name}
                          </div>
                          <div className="text-[10px] text-[var(--muted)]">
                            {item.sku} · sale {formatInr(item.salePricePaise)} · on
                            hand {item.stockOnHand} · max disc {item.maxDiscountPct}% ·{" "}
                            {issuePolicyLabel(item.issuePolicy)}
                          </div>
                        </div>
                        <input
                          className="field !w-16 !py-1 !text-center"
                          type="number"
                          min={1}
                          value={row.qty}
                          onChange={(e) =>
                            setCart((prev) =>
                              prev.map((r) =>
                                r.itemId === row.itemId
                                  ? { ...r, qty: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                        <input
                          className="field !w-20 !py-1"
                          value={row.sizeLabel}
                          onChange={(e) =>
                            setCart((prev) =>
                              prev.map((r) =>
                                r.itemId === row.itemId
                                  ? { ...r, sizeLabel: e.target.value }
                                  : r,
                              ),
                            )
                          }
                          placeholder="Size"
                        />
                        <span className="w-20 text-right text-sm font-bold text-[var(--brand-deep)]">
                          {formatInr(item.salePricePaise * qty)}
                        </span>
                        <button
                          type="button"
                          className="text-xs font-semibold text-[#dc2626]"
                          onClick={() =>
                            setCart((prev) =>
                              prev.filter((r) => r.itemId !== row.itemId),
                            )
                          }
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  Cart is empty — add books or uniform items above.
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {paymentMode === "cash" ? "Cash total" : "Credit due"}
                  </div>
                  <div className="text-xl font-extrabold text-[var(--brand-deep)]">
                    {formatInr(cartTotal.total)}
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">
                    Max discount locked: {formatInr(cartTotal.maxDisc)}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  disabled={
                    cart.length === 0 ||
                    (recipientKind === "student" ? !selected : !staffId)
                  }
                  onClick={onIssue}
                >
                  {paymentMode === "cash" ? "Take cash & issue" : "Issue on credit"}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
              <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                Active catalog
              </h2>
              <ul className="mt-2 max-h-64 divide-y divide-[rgba(32,48,80,0.08)] overflow-y-auto text-sm">
                {items.length === 0 ? (
                  <li className="py-3 text-[var(--muted)]">
                    No items — open Catalog tab or load sample.
                  </li>
                ) : (
                  items.map((i) => (
                    <li
                      key={i.id}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--brand-deep)]">
                          {i.name}
                        </div>
                        <div className="text-[10px] text-[var(--muted)]">
                          {categoryLabel(i.categoryId)} · {i.sku}
                          {i.sizeLabel ? ` · ${i.sizeLabel}` : ""} · stock{" "}
                          {i.stockOnHand} · {audienceLabel(i.audience)}
                        </div>
                      </div>
                      <span className="shrink-0 font-bold tabular-nums">
                        {formatInr(i.salePricePaise)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
              <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                Recent issues
              </h2>
              {issues.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--muted)]">No issues yet.</p>
              ) : (
                <ul className="mt-2 max-h-72 divide-y divide-[rgba(32,48,80,0.08)] overflow-y-auto">
                  {issues.slice(0, 12).map((iss) => {
                    const st = sis?.students.find((s) => s.id === iss.studentId);
                    const staff =
                      iss.recipientKind === "staff"
                        ? (masters?.staff ?? []).find((s) => s.id === iss.staffId)
                        : null;
                    const who =
                      iss.recipientKind === "staff"
                        ? staff?.fullName || iss.staffId || "Staff"
                        : st?.fullName ?? iss.studentId;
                    const voided = !!iss.voidedAt;
                    return (
                      <li
                        key={iss.id}
                        className={`py-2 ${voided ? "opacity-55" : ""}`}
                      >
                        <div className="flex justify-between gap-2">
                          <div>
                            <div className="text-sm font-bold text-[var(--brand-deep)]">
                              {iss.issueNo}{" "}
                              <span className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                                {iss.paymentMode}
                                {iss.recipientKind === "staff" ? " · staff" : ""}
                              </span>
                              {voided ? (
                                <span className="ml-1 text-[10px] uppercase text-[#dc2626]">
                                  Void
                                </span>
                              ) : null}
                            </div>
                            <div className="text-[11px] text-[var(--muted)]">
                              {who} · {iss.issuedOn}
                            </div>
                          </div>
                          <div className="text-right text-sm font-bold">
                            {formatInr(iss.totalPaise)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
          ) : issueSubTab === "return" ? (
            <StoreSellReturnPanel />
          ) : (
        <div className="mt-4 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Search
              </span>
              <input
                className="field !py-1.5"
                value={historyQ}
                onChange={(e) => setHistoryQ(e.target.value)}
                placeholder="Issue no / student / note"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Mode
              </span>
              <select
                className="field !py-1.5"
                value={historyMode}
                onChange={(e) =>
                  setHistoryMode(e.target.value as "all" | "cash" | "credit")
                }
              >
                <option value="all">All</option>
                <option value="cash">Cash</option>
                <option value="credit">Credit</option>
              </select>
            </label>
          </div>
          <ul className="mt-4 divide-y">
            {filteredHistory.length === 0 ? (
              <li className="py-4 text-sm text-[var(--muted)]">No issues.</li>
            ) : (
              filteredHistory.map((iss) => {
                const st = sis?.students.find((s) => s.id === iss.studentId);
                const staff =
                  iss.recipientKind === "staff"
                    ? (masters?.staff ?? []).find((s) => s.id === iss.staffId)
                    : null;
                const who =
                  iss.recipientKind === "staff"
                    ? staff?.fullName || iss.staffId || "Staff"
                    : st?.fullName ?? iss.studentId;
                const voided = !!iss.voidedAt;
                return (
                  <li
                    key={iss.id}
                    className={`py-3 ${voided ? "opacity-55" : ""}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-[var(--brand-deep)]">
                          {iss.issueNo} · {iss.paymentMode}/{iss.paymentStatus}
                          {iss.recipientKind === "staff" ? " · staff" : ""}
                          {voided ? " · VOID" : ""}
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {who} · {iss.issuedOn} ·{" "}
                          {iss.issueKind}
                          {iss.issuedBy ? ` · by ${iss.issuedBy}` : ""}
                        </div>
                        <ul className="mt-1 text-[10px] text-[var(--muted)]">
                          {iss.lines.map((l, idx) => (
                            <li key={idx}>
                              {l.name}
                              {l.sizeLabel ? ` ${l.sizeLabel}` : ""} ×{l.qty}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{formatInr(iss.totalPaise)}</div>
                        {!voided ? (
                          <button
                            type="button"
                            className="mt-1 text-[11px] font-semibold text-[#dc2626]"
                            onClick={() => onVoid(iss)}
                          >
                            Void
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
          )}
        </>
      ) : null}

      {tab === "inv_report" ? (
        <StoreReportsPanel
          categories={["stock", "coverage"]}
          reportDate={reportDate}
          onReportDateChange={setReportDate}
          reportClassId={reportClassId}
          onReportClassIdChange={setReportClassId}
          reportSkuId={reportSkuId}
          onReportSkuIdChange={setReportSkuId}
          classOptions={classOptions}
          items={items}
          reportRunning={reportRunning}
          onRunReport={onRunReport}
          showCoverageFilters
        />
      ) : null}

      {tab === "acct_report" ? <StoreAccountsWorkspace /> : null}

      {tab === "inv_allocation" && subScreen === "allocation" ? (
        <StoreInventoryAllocationPanel />
      ) : null}

      {tab === "inv_allocation" && subScreen === "report" ? (
        <StoreReportsPanel
          categories={["allocation"]}
          reportIds={["inventory_allocation"]}
          reportDate={reportDate}
          onReportDateChange={setReportDate}
          reportClassId={reportClassId}
          onReportClassIdChange={setReportClassId}
          reportSkuId={reportSkuId}
          onReportSkuIdChange={setReportSkuId}
          classOptions={classOptions}
          items={items}
          reportRunning={reportRunning}
          onRunReport={onRunReport}
        />
      ) : null}

      {tab === "asset_allocation" && subScreen === "allocation" ? (
        <StoreAssetAllocationPanel />
      ) : null}

      {tab === "asset_allocation" && subScreen === "report" ? (
        <StoreReportsPanel
          categories={["allocation"]}
          reportIds={["asset_allocation"]}
          reportDate={reportDate}
          onReportDateChange={setReportDate}
          reportClassId={reportClassId}
          onReportClassIdChange={setReportClassId}
          reportSkuId={reportSkuId}
          onReportSkuIdChange={setReportSkuId}
          classOptions={classOptions}
          items={items}
          reportRunning={reportRunning}
          onRunReport={onRunReport}
        />
      ) : null}

      {holdDialog && selected && holdCheck && !holdCheck.allowed ? (
        <PrincipalHoldOverrideDialog
          studentId={selected.student.id}
          studentName={selected.student.fullName}
          holdCode="HOLD_STORE_CREDIT"
          block={holdCheck}
          overriddenBy={session.fullName}
          onClose={() => setHoldDialog(false)}
          onGranted={() => {
            setHoldDialog(false);
            setSkipHold(true);
            refreshHolds(selected.student.id);
            flash("Store credit hold unlocked — you can issue now");
          }}
        />
      ) : null}
    </div>
  );
}
