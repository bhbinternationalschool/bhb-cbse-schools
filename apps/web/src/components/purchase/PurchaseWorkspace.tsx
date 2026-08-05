"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { DEFAULT_AY, formatInr, parseInrToPaise } from "@/lib/masters";
import { useModuleTabQuery } from "@/lib/useModuleTabQuery";
import {
  convertIndentToPo,
  createIndent,
  createPoDirect,
  decideIndent,
  composeWhatsAppPoIssued,
  grnDestinationLabel,
  indentStatusLabel,
  issuePo,
  listPurchaseStoreItems,
  listPurchaseVendors,
  loadPurchase,
  poStatusLabel,
  PURCHASE_REPORTS,
  receiveGrn,
  requiredApproverHint,
  runPurchaseReport,
  seedPurchaseIfEmpty,
  submitIndent,
  type BillOcrSuggestion,
  type GrnDestination,
  type IndentLine,
  type PoLine,
  type PurchaseIndent,
  type PurchaseOrder,
  type PurchaseReportFormat,
  type PurchaseReportId,
  type PurchaseState,
} from "@/lib/purchase";
import { readImageAsDataUrl } from "@/lib/homework";
import { runBillOcrApi } from "@/lib/ocrClient";
import { openWaMe } from "@/lib/waMe";
import { loadAccounts, seedAccountsIfEmpty } from "@/lib/accounts";
import { PurchaseReturnPanel } from "@/components/purchase/PurchaseReturnPanel";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

type PurchaseTab =
  | "dashboard"
  | "indents"
  | "orders"
  | "grn"
  | "returns"
  | "reports";

const TABS: ModuleTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy" },
  { id: "indents", label: "Indents", tone: "navy" },
  { id: "orders", label: "Purchase orders", tone: "teal" },
  { id: "grn", label: "GRN", tone: "amber" },
  { id: "returns", label: "Returns", tone: "coral" },
  { id: "reports", label: "Reports", tone: "slate" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  return `${todayIso().slice(0, 7)}-01`;
}

function inrInputFromPaise(paise: number) {
  const v = paise / 100;
  const s = v.toFixed(2);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

function statusTone(status: string): string {
  if (status === "approved" || status === "closed" || status === "issued") {
    return "text-[#0f7a4c]";
  }
  if (status === "rejected" || status === "cancelled") return "text-[#b42318]";
  if (status === "submitted" || status === "partial_grn") return "text-[#b45309]";
  return "text-[var(--muted)]";
}

type DraftLine = {
  description: string;
  skuItemId: string;
  qty: string;
  uom: string;
  ratePaise: string;
};

function emptyDraftLine(): DraftLine {
  return { description: "", skuItemId: "", qty: "1", uom: "nos", ratePaise: "0" };
}

function IndentRow({
  indent,
  actorName,
  vendors,
  onRefresh,
  onFlash,
  onError,
}: {
  indent: PurchaseIndent;
  actorName: string;
  vendors: ReturnType<typeof listPurchaseVendors>;
  onRefresh: () => void;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [vendorName, setVendorName] = useState(vendors[0]?.name ?? "");

  return (
    <li className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            {indent.indentNo} · {indent.department}
          </p>
          <p className="text-xs text-[var(--muted)]">
            {indent.requesterName} · {indent.urgency} ·{" "}
            <span className={statusTone(indent.status)}>
              {indentStatusLabel(indent.status)}
            </span>
          </p>
          <p className="text-xs text-[var(--muted)]">
            {indent.lines.length} line(s) · est. {formatInr(indent.estimatedPaise)}
            {indent.status === "submitted"
              ? ` · needs ${requiredApproverHint(indent.estimatedPaise)}`
              : ""}
          </p>
          {indent.note ? (
            <p className="mt-1 text-sm text-[var(--brand-deep)]">{indent.note}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {indent.status === "draft" ? (
            <button
              type="button"
              className={btn}
              onClick={() => {
                const res = submitIndent(indent.id);
                if (!res.ok) return onError(res.error);
                onFlash(`Indent ${indent.indentNo} submitted`);
                onRefresh();
              }}
            >
              Submit
            </button>
          ) : null}
          {indent.status === "submitted" ? (
            <>
              <button
                type="button"
                className={btn}
                onClick={() => {
                  const res = decideIndent({
                    indentId: indent.id,
                    approve: true,
                    by: actorName,
                  });
                  if (!res.ok) return onError(res.error);
                  onFlash(`Indent ${indent.indentNo} approved`);
                  onRefresh();
                }}
              >
                Approve
              </button>
              <button
                type="button"
                className={btnOutline}
                onClick={() => {
                  const res = decideIndent({
                    indentId: indent.id,
                    approve: false,
                    by: actorName,
                  });
                  if (!res.ok) return onError(res.error);
                  onFlash(`Indent ${indent.indentNo} rejected`);
                  onRefresh();
                }}
              >
                Reject
              </button>
            </>
          ) : null}
        </div>
      </div>
      {indent.status === "approved" ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[rgba(32,48,80,0.08)] pt-3">
          <label className="text-xs text-[var(--muted)]">
            Vendor
            <select
              className={`${field} mt-0.5 block min-w-[160px]`}
              value={vendorId}
              onChange={(e) => {
                const v = vendors.find((x) => x.id === e.target.value);
                setVendorId(e.target.value);
                setVendorName(v?.name ?? "");
              }}
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <input
            className={`${field} min-w-[140px]`}
            placeholder="Or vendor name"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
          />
          <button
            type="button"
            className={btn}
            onClick={() => {
              const res = convertIndentToPo({
                indentId: indent.id,
                vendorId,
                vendorName,
              });
              if (!res.ok) return onError(res.error);
              onFlash(`PO ${res.order.poNo} created from indent`);
              onRefresh();
            }}
          >
            Convert to PO
          </button>
        </div>
      ) : null}
    </li>
  );
}

function OrderRow({
  order,
  actorName,
  vendorPhone,
  onRefresh,
  onFlash,
  onError,
  onSelectForGrn,
}: {
  order: PurchaseOrder;
  actorName: string;
  vendorPhone?: string;
  onRefresh: () => void;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
  onSelectForGrn: (poId: string) => void;
}) {
  function notifyVendor(po: PurchaseOrder) {
    const phone = vendorPhone?.replace(/\D/g, "") || "";
    if (phone.length < 10) {
      onError("Add vendor phone in Accounts → Vendors to WhatsApp this PO");
      return;
    }
    const msg = composeWhatsAppPoIssued({
      vendorName: po.vendorName,
      poNo: po.poNo,
      amountPaise: po.amountPaise,
      lines: po.lines.map((l) => ({
        description: l.description,
        qty: l.qty,
        uom: l.uom,
      })),
    });
    openWaMe(phone, msg);
    onFlash(`WhatsApp opened for ${po.vendorName}`);
  }

  return (
    <li className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            {order.poNo} · {order.vendorName}
          </p>
          <p className="text-xs text-[var(--muted)]">
            <span className={statusTone(order.status)}>
              {poStatusLabel(order.status)}
            </span>
            {" · "}
            {order.lines.length} line(s) · {formatInr(order.amountPaise)}
          </p>
          {order.note ? (
            <p className="mt-1 text-sm text-[var(--brand-deep)]">{order.note}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {order.status === "draft" ? (
            <button
              type="button"
              className={btn}
              onClick={() => {
                const res = issuePo({ poId: order.id, by: actorName });
                if (!res.ok) return onError(res.error);
                onFlash(`PO ${order.poNo} issued`);
                onRefresh();
                notifyVendor(res.order);
              }}
            >
              Issue + WhatsApp
            </button>
          ) : null}
          {order.status === "issued" || order.status === "partial_grn" ? (
            <>
              <button
                type="button"
                className={btnOutline}
                onClick={() => notifyVendor(order)}
              >
                WhatsApp vendor
              </button>
              <button
                type="button"
                className={btnOutline}
                onClick={() => onSelectForGrn(order.id)}
              >
                Receive GRN
              </button>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function PurchaseWorkspace({
  embedded = false,
}: {
  /** When true, hide page chrome (used under Store › Purchase). */
  embedded?: boolean;
}) {
  const session = useDemoSession();
  const ay = session.academicYearCode || DEFAULT_AY;
  const [tab, setTab] = useModuleTabQuery<PurchaseTab>("dashboard", [
    "dashboard",
    "indents",
    "orders",
    "grn",
    "returns",
    "reports",
  ]);
  const [state, setState] = useState<PurchaseState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actorName = session.fullName || "Purchase user";
  const actorStaffId = session.staffId || "";

  // Indent form
  const [department, setDepartment] = useState("Store");
  const [urgency, setUrgency] = useState<"normal" | "urgent">("normal");
  const [indentNote, setIndentNote] = useState("");
  const [indentLines, setIndentLines] = useState<DraftLine[]>([emptyDraftLine()]);

  // Direct PO form
  const vendors = useMemo(() => listPurchaseVendors(), [state]);
  const storeItems = useMemo(() => listPurchaseStoreItems(), [state]);
  const [poVendorId, setPoVendorId] = useState("");
  const [poVendorName, setPoVendorName] = useState("");
  const [poNote, setPoNote] = useState("");
  const [poLines, setPoLines] = useState<DraftLine[]>([emptyDraftLine()]);

  // GRN
  const [grnPoId, setGrnPoId] = useState("");
  const [grnDate, setGrnDate] = useState(todayIso);
  const [grnDestination, setGrnDestination] = useState<GrnDestination>("store");
  const [grnPhotoNote, setGrnPhotoNote] = useState("");
  const [grnBillImageUrl, setGrnBillImageUrl] = useState("");
  const [grnBillFileName, setGrnBillFileName] = useState("");
  const [grnBillMimeType, setGrnBillMimeType] = useState("image/jpeg");
  const [grnOcr, setGrnOcr] = useState<BillOcrSuggestion | null>(null);
  const [grnOcrBusy, setGrnOcrBusy] = useState(false);
  const [grnQty, setGrnQty] = useState<Record<string, string>>({});

  // Per-item VendorBill editor (created during GRN posting)
  const [grnNoOverride, setGrnNoOverride] = useState("");
  const [grnVendorId, setGrnVendorId] = useState("");
  const [grnNarration, setGrnNarration] = useState("");
  const [grnLedgerByLine, setGrnLedgerByLine] = useState<Record<string, string>>({});
  const [grnRateByLine, setGrnRateByLine] = useState<Record<string, string>>({});
  const [grnDescByLine, setGrnDescByLine] = useState<Record<string, string>>({});
  const [grnDiscountType, setGrnDiscountType] = useState<"none" | "percent" | "amount">("none");
  const [grnDiscountEntry, setGrnDiscountEntry] = useState("");
  const [grnTaxAmount, setGrnTaxAmount] = useState("");

  // Reports
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(todayIso);
  const [format, setFormat] = useState<PurchaseReportFormat>("excel");

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function refresh() {
    try {
      const purchase = seedPurchaseIfEmpty();
      setState(purchase);
      const v = listPurchaseVendors();
      if (!poVendorId && v[0]) {
        setPoVendorId(v[0].id);
        setPoVendorName(v[0].name);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load purchase data";
      setError(msg);
      setState((prev) => prev ?? loadPurchase());
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const { ensurePurchaseHydrated } = await import(
        "@/lib/purchasePersistence"
      );
      await ensurePurchaseHydrated();
      refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPo = state?.orders.find((o) => o.id === grnPoId);

  const openPos = useMemo(
    () =>
      state?.orders.filter(
        (o) => o.status === "issued" || o.status === "partial_grn",
      ) ?? [],
    [state],
  );

  const accounts = useMemo(() => {
    seedAccountsIfEmpty();
    return loadAccounts();
  }, [state]);
  const expenseCategories = useMemo(
    () => accounts.expenseCategories.filter((c) => c.isActive !== false),
    [accounts],
  );
  const defaultLedgerCategoryId = useMemo(() => {
    const office = expenseCategories.find(
      (c) => c.name.toLowerCase() === "office",
    );
    const academic = expenseCategories.find(
      (c) => c.name.toLowerCase() === "academic",
    );
    return office?.id || academic?.id || expenseCategories[0]?.id || "";
  }, [expenseCategories]);

  useEffect(() => {
    if (!selectedPo) return;
    setGrnVendorId(selectedPo.vendorId);
    setGrnNarration(`GRN against ${selectedPo.poNo} · ${selectedPo.vendorName}`);
    setGrnNoOverride("");
    setGrnLedgerByLine({});
    setGrnRateByLine({});
    setGrnDescByLine({});
    setGrnQty({});
    setGrnDiscountType("none");
    setGrnDiscountEntry("0");
    setGrnTaxAmount("0");
    setGrnOcr((prev) =>
      prev
        ? prev
        : {
            billNo: `GRN-${selectedPo.poNo}`,
            billDate: grnDate,
            dueOn: grnDate,
            amountPaise: 0,
            note: "Manual invoice fields (no OCR yet)",
            confidence: "demo_low",
          },
    );
  }, [selectedPo?.id, grnDate]);

  const computedGrnLines = useMemo(() => {
    if (!selectedPo) return [];
    return selectedPo.lines.map((line) => {
      const qtyReceived = Math.max(0, Number(grnQty[line.id]) || 0);
      const ratePaise =
        grnRateByLine[line.id] != null && grnRateByLine[line.id] !== ""
          ? parseInrToPaise(grnRateByLine[line.id]!)
          : line.ratePaise;
      const amountPaise = Math.round(qtyReceived * ratePaise);
      return {
        poLineId: line.id,
        description: grnDescByLine[line.id] ?? line.description,
        qtyReceived,
        ratePaise,
        ledgerCategoryId: grnLedgerByLine[line.id] ?? defaultLedgerCategoryId,
        amountPaise,
      };
    });
  }, [
    selectedPo,
    grnQty,
    grnRateByLine,
    grnLedgerByLine,
    grnDescByLine,
    defaultLedgerCategoryId,
  ]);

  const computedGrnTotals = useMemo(() => {
    const grossPaise = computedGrnLines.reduce((s, l) => s + l.amountPaise, 0);
    const discType = grnDiscountType;
    const entry = grnDiscountEntry.trim();
    let discountPaise = 0;
    if (discType === "percent" && entry) {
      const pct = Number(entry) || 0;
      discountPaise = Math.round((grossPaise * pct) / 100);
    } else if (discType === "amount" && entry) {
      discountPaise = parseInrToPaise(entry);
    }
    discountPaise = Math.min(Math.max(0, discountPaise), grossPaise);
    const taxPaise = parseInrToPaise(grnTaxAmount.trim());
    const grandTotalPaise = Math.max(0, grossPaise - discountPaise + taxPaise);
    return { grossPaise, discountPaise, taxPaise, grandTotalPaise };
  }, [computedGrnLines, grnDiscountType, grnDiscountEntry, grnTaxAmount]);

  if (!state) {
    return (
      <div className="px-4 py-8 text-sm text-[var(--muted)]">
        Loading purchase module…
      </div>
    );
  }

  function parseDraftLines(lines: DraftLine[]): Omit<IndentLine, "id">[] {
    return lines
      .filter((l) => l.description.trim())
      .map((l) => ({
        description: l.description.trim(),
        skuItemId: l.skuItemId || undefined,
        qty: Math.max(0, Number(l.qty) || 0),
        uom: l.uom.trim() || "nos",
        estRatePaise: Math.round(Number(l.ratePaise) || 0),
      }));
  }

  function parsePoDraftLines(lines: DraftLine[]): Omit<PoLine, "id">[] {
    return lines
      .filter((l) => l.description.trim())
      .map((l) => ({
        description: l.description.trim(),
        skuItemId: l.skuItemId || undefined,
        qty: Math.max(0, Number(l.qty) || 0),
        uom: l.uom.trim() || "nos",
        ratePaise: Math.round(Number(l.ratePaise) || 0),
      }));
  }

  function LineEditor({
    lines,
    onChange,
    rateLabel,
  }: {
    lines: DraftLine[];
    onChange: (lines: DraftLine[]) => void;
    rateLabel: string;
  }) {
    return (
      <div className="space-y-2">
        {lines.map((line, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-2">
            <label className="min-w-[160px] flex-1 text-xs text-[var(--muted)]">
              Description
              <input
                className={`${field} mt-0.5 block w-full`}
                value={line.description}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...line, description: e.target.value };
                  onChange(next);
                }}
              />
            </label>
            <label className="min-w-[120px] text-xs text-[var(--muted)]">
              Store SKU
              <select
                className={`${field} mt-0.5 block w-full`}
                value={line.skuItemId}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...line, skuItemId: e.target.value };
                  onChange(next);
                }}
              >
                <option value="">— none —</option>
                {storeItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-16 text-xs text-[var(--muted)]">
              Qty
              <input
                className={`${field} mt-0.5 block w-full`}
                value={line.qty}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...line, qty: e.target.value };
                  onChange(next);
                }}
              />
            </label>
            <label className="w-16 text-xs text-[var(--muted)]">
              UOM
              <input
                className={`${field} mt-0.5 block w-full`}
                value={line.uom}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...line, uom: e.target.value };
                  onChange(next);
                }}
              />
            </label>
            <label className="w-24 text-xs text-[var(--muted)]">
              {rateLabel}
              <input
                className={`${field} mt-0.5 block w-full`}
                value={line.ratePaise}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...line, ratePaise: e.target.value };
                  onChange(next);
                }}
              />
            </label>
            {lines.length > 1 ? (
              <button
                type="button"
                className="text-xs text-[#b42318] underline"
                onClick={() => onChange(lines.filter((_, i) => i !== idx))}
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          className={btnOutline}
          onClick={() => onChange([...lines, emptyDraftLine()])}
        >
          + Line
        </button>
      </div>
    );
  }

  return (
    <ErpWorkspaceShell
      embedded={embedded}
      title="Purchase"
      subtitle={
        embedded
          ? "Indent → PO → GRN · stock & vendor bills"
          : "Indent → PO → GRN · store stock & vendor bills (§20c)"
      }
      icon={<ShoppingCart className="size-6" aria-hidden />}
      error={error}
      notice={notice}
      actions={
        embedded ? undefined : (
          <Link href="/store" className="text-sm text-[var(--brand-deep)] underline">
            ← Store
          </Link>
        )
      }
    >
      <ModuleTabs
        items={TABS}
        value={tab}
        onChange={(id) => setTab(id as PurchaseTab)}
      />

      {tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="purchase"
          onNavigateTab={(t) => setTab(t as PurchaseTab)}
        />
      ) : tab === "indents" ? (
        <div className="mt-4 space-y-6">
          <section className="rounded-2xl border border-[rgba(32,48,80,0.1)] bg-[var(--surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
              New indent
            </h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="text-xs text-[var(--muted)]">
                Department
                <input
                  className={`${field} mt-0.5 block`}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Urgency
                <select
                  className={`${field} mt-0.5 block`}
                  value={urgency}
                  onChange={(e) =>
                    setUrgency(e.target.value as "normal" | "urgent")
                  }
                >
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label className="min-w-[200px] flex-1 text-xs text-[var(--muted)]">
                Note
                <input
                  className={`${field} mt-0.5 block w-full`}
                  value={indentNote}
                  onChange={(e) => setIndentNote(e.target.value)}
                />
              </label>
            </div>
            <div className="mt-3">
              <LineEditor
                lines={indentLines}
                onChange={setIndentLines}
                rateLabel="Est. (paise)"
              />
            </div>
            <button
              type="button"
              className={`${btn} mt-3`}
              onClick={() => {
                const res = createIndent({
                  academicYearCode: ay,
                  requesterName: actorName,
                  requesterStaffId: actorStaffId,
                  department,
                  urgency,
                  lines: parseDraftLines(indentLines),
                  note: indentNote,
                });
                if (!res.ok) return setError(res.error);
                flash(`Indent ${res.indent.indentNo} created`);
                setIndentLines([emptyDraftLine()]);
                setIndentNote("");
                refresh();
              }}
            >
              Save draft indent
            </button>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
              Indents ({state.indents.length})
            </h2>
            <ul className="space-y-2">
              {state.indents.map((indent) => (
                <IndentRow
                  key={indent.id}
                  indent={indent}
                  actorName={actorName}
                  vendors={vendors}
                  onRefresh={refresh}
                  onFlash={flash}
                  onError={setError}
                />
              ))}
              {!state.indents.length ? (
                <li className="text-sm text-[var(--muted)]">No indents yet.</li>
              ) : null}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "orders" ? (
        <div className="mt-4 space-y-6">
          <section className="rounded-2xl border border-[rgba(32,48,80,0.1)] bg-[var(--surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
              Direct purchase order
            </h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="text-xs text-[var(--muted)]">
                Vendor
                <select
                  className={`${field} mt-0.5 block min-w-[160px]`}
                  value={poVendorId}
                  onChange={(e) => {
                    const v = vendors.find((x) => x.id === e.target.value);
                    setPoVendorId(e.target.value);
                    setPoVendorName(v?.name ?? "");
                  }}
                >
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <input
                className={`${field} min-w-[140px]`}
                placeholder="Vendor name"
                value={poVendorName}
                onChange={(e) => setPoVendorName(e.target.value)}
              />
              <label className="min-w-[200px] flex-1 text-xs text-[var(--muted)]">
                Note
                <input
                  className={`${field} mt-0.5 block w-full`}
                  value={poNote}
                  onChange={(e) => setPoNote(e.target.value)}
                />
              </label>
            </div>
            <div className="mt-3">
              <LineEditor
                lines={poLines}
                onChange={setPoLines}
                rateLabel="Rate (paise)"
              />
            </div>
            <button
              type="button"
              className={`${btn} mt-3`}
              onClick={() => {
                const res = createPoDirect({
                  academicYearCode: ay,
                  vendorId: poVendorId,
                  vendorName: poVendorName,
                  lines: parsePoDraftLines(poLines),
                  note: poNote,
                });
                if (!res.ok) return setError(res.error);
                flash(`PO ${res.order.poNo} created`);
                setPoLines([emptyDraftLine()]);
                setPoNote("");
                refresh();
              }}
            >
              Create draft PO
            </button>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
              Purchase orders ({state.orders.length})
            </h2>
            <ul className="space-y-2">
              {state.orders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  actorName={actorName}
                  vendorPhone={
                    vendors.find((v) => v.id === order.vendorId)?.phone ||
                    vendors.find(
                      (v) =>
                        v.name.toLowerCase() ===
                        order.vendorName.toLowerCase(),
                    )?.phone
                  }
                  onRefresh={refresh}
                  onFlash={flash}
                  onError={setError}
                  onSelectForGrn={(poId) => {
                    setGrnPoId(poId);
                    setGrnQty({});
                    setGrnOcr(null);
                    setTab("grn");
                  }}
                />
              ))}
              {!state.orders.length ? (
                <li className="text-sm text-[var(--muted)]">No POs yet.</li>
              ) : null}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "grn" ? (
        <div className="mt-4 space-y-4">
          <section className="rounded-2xl border border-[rgba(32,48,80,0.1)] bg-[var(--surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
              Goods received note
            </h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="text-xs text-[var(--muted)]">
                Purchase order
                <select
                  className={`${field} mt-0.5 block min-w-[200px]`}
                  value={grnPoId}
                  onChange={(e) => {
                    setGrnPoId(e.target.value);
                    setGrnQty({});
                    setGrnOcr(null);
                  }}
                >
                  <option value="">Select PO…</option>
                  {openPos.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.poNo} · {o.vendorName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[var(--muted)]">
                GRN number (receipt no.)
                <input
                  className={`${field} mt-0.5 block w-40`}
                  value={grnNoOverride}
                  onChange={(e) => setGrnNoOverride(e.target.value)}
                  placeholder="Auto"
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Vendor account
                <select
                  className={`${field} mt-0.5 block`}
                  value={grnVendorId || selectedPo?.vendorId || ""}
                  onChange={(e) => setGrnVendorId(e.target.value)}
                >
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-[240px] flex-1 text-xs text-[var(--muted)]">
                Narration
                <input
                  className={`${field} mt-0.5 block w-full`}
                  value={grnNarration}
                  onChange={(e) => setGrnNarration(e.target.value)}
                  placeholder="Shown in Accounts AP note"
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                GRN date
                <input
                  type="date"
                  className={`${field} mt-0.5 block`}
                  value={grnDate}
                  onChange={(e) => setGrnDate(e.target.value)}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Destination
                <select
                  className={`${field} mt-0.5 block`}
                  value={grnDestination}
                  onChange={(e) =>
                    setGrnDestination(e.target.value as GrnDestination)
                  }
                >
                  {(["store", "library", "asset", "expense"] as const).map(
                    (d) => (
                      <option key={d} value={d}>
                        {grnDestinationLabel(d)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="min-w-[200px] flex-1 text-xs text-[var(--muted)]">
                Photo / challan note
                <input
                  className={`${field} mt-0.5 block w-full`}
                  value={grnPhotoNote}
                  onChange={(e) => setGrnPhotoNote(e.target.value)}
                  placeholder="e.g. INV-8842 ₹12,500 received"
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Bill scan (image / PDF)
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className={`${field} mt-0.5 block w-full max-w-xs text-xs`}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const r = await readImageAsDataUrl(file);
                    if (!r.ok) {
                      setError(r.error);
                      return;
                    }
                    setGrnBillImageUrl(r.url);
                    setGrnBillFileName(file.name);
                    setGrnBillMimeType(file.type || "image/jpeg");
                    flash(`Attached ${file.name}`);
                  }}
                />
              </label>
            </div>
            {grnBillImageUrl ? (
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                Scan attached{grnBillFileName ? `: ${grnBillFileName}` : ""}
                {grnBillImageUrl.startsWith("data:image") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={grnBillImageUrl}
                    alt="Bill preview"
                    className="mt-2 max-h-28 rounded-lg border border-[rgba(32,48,80,0.12)]"
                  />
                ) : null}
              </p>
            ) : null}

            {selectedPo ? (
              <div className="mt-4 overflow-x-auto">
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  <button
                    type="button"
                    className={btnOutline}
                    disabled={grnOcrBusy}
                    onClick={() => {
                      void (async () => {
                        setGrnOcrBusy(true);
                        try {
                          const fallback = computedGrnTotals.grossPaise;
                          const r = await runBillOcrApi({
                            dataUrl: grnBillImageUrl || undefined,
                            mimeType: grnBillMimeType,
                            fileName: grnBillFileName,
                            photoNote: grnPhotoNote,
                            fallbackAmountPaise:
                              fallback || selectedPo.amountPaise,
                            billDate: grnDate,
                          });
                          if (r.suggestion) {
                            setGrnOcr(r.suggestion);
                            flash(
                              r.warning
                                ? `${r.suggestion.note} (${r.warning})`
                                : r.suggestion.note,
                            );
                          } else {
                            setError(r.error || "OCR failed");
                          }
                        } finally {
                          setGrnOcrBusy(false);
                        }
                      })();
                    }}
                  >
                    {grnOcrBusy ? "Reading bill…" : "Run bill OCR (Vision)"}
                  </button>
                  {grnOcr ? (
                    <span className="text-[11px] text-[var(--muted)]">
                      Confidence:{" "}
                      {grnOcr.confidence
                        .replace("demo_", "")
                        .replace("vision_", "")}
                    </span>
                  ) : null}
                </div>
                {grnOcr ? (
                  <div className="mb-3 flex flex-wrap gap-3 rounded-xl border border-[rgba(14,116,144,0.25)] bg-[rgba(14,116,144,0.06)] px-3 py-3">
                    <label className="text-xs text-[var(--muted)]">
                      Supplier invoice no
                      <input
                        className={`${field} mt-0.5 block w-36`}
                        value={grnOcr.billNo}
                        onChange={(e) =>
                          setGrnOcr({ ...grnOcr, billNo: e.target.value })
                        }
                      />
                    </label>
                    <label className="text-xs text-[var(--muted)]">
                      Bill date
                      <input
                        type="date"
                        className={`${field} mt-0.5 block`}
                        value={grnOcr.billDate}
                        onChange={(e) =>
                          setGrnOcr({ ...grnOcr, billDate: e.target.value })
                        }
                      />
                    </label>
                    <label className="text-xs text-[var(--muted)]">
                      Due on
                      <input
                        type="date"
                        className={`${field} mt-0.5 block`}
                        value={grnOcr.dueOn}
                        onChange={(e) =>
                          setGrnOcr({ ...grnOcr, dueOn: e.target.value })
                        }
                      />
                    </label>
                    <label className="text-xs text-[var(--muted)]">
                      Invoice amount ₹ (computed)
                      <input
                        className={`${field} mt-0.5 block w-28`}
                        value={(computedGrnTotals.grandTotalPaise / 100).toFixed(2)}
                        readOnly
                      />
                    </label>
                    <p className="w-full text-[11px] text-[var(--muted)]">
                      {grnOcr.note} — posts to Accounts AP on GRN.
                    </p>
                  </div>
                ) : null}
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs text-[var(--muted)]">
                      <th className="py-2 pr-2">Description</th>
                      <th className="py-2 pr-2">Purchase ledger</th>
                      <th className="py-2 pr-2 text-right">Ordered</th>
                      <th className="py-2 pr-2 text-right">Receive now</th>
                      <th className="py-2 pr-2 text-right">Rate ₹</th>
                      <th className="py-2 pr-2 text-right">Amount ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPo.lines.map((line, idx) => {
                      const row = computedGrnLines[idx]!;
                      const rateInr =
                        grnRateByLine[line.id] ?? inrInputFromPaise(line.ratePaise);
                      return (
                        <tr
                          key={line.id}
                          className="border-b border-[rgba(32,48,80,0.06)]"
                        >
                          <td className="py-2 pr-2">
                            <input
                              className={`${field} w-72`}
                              value={grnDescByLine[line.id] ?? line.description}
                              onChange={(e) =>
                                setGrnDescByLine({
                                  ...grnDescByLine,
                                  [line.id]: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <select
                              className={`${field} block`}
                              value={
                                grnLedgerByLine[line.id] ?? defaultLedgerCategoryId
                              }
                              onChange={(e) =>
                                setGrnLedgerByLine({
                                  ...grnLedgerByLine,
                                  [line.id]: e.target.value,
                                })
                              }
                            >
                              {expenseCategories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-2 text-right">{line.qty}</td>
                          <td className="py-2 pr-2 text-right">
                            <input
                              className={`${field} w-20 text-right`}
                              value={grnQty[line.id] ?? ""}
                              placeholder="0"
                              onChange={(e) =>
                                setGrnQty({
                                  ...grnQty,
                                  [line.id]: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="py-2 pr-2 text-right">
                            <input
                              className={`${field} w-24 text-right`}
                              value={rateInr}
                              onChange={(e) =>
                                setGrnRateByLine({
                                  ...grnRateByLine,
                                  [line.id]: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="py-2 pr-2 text-right">
                            {formatInr(row.amountPaise)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-[rgba(14,116,144,0.25)] bg-[rgba(14,116,144,0.06)] px-3 py-3">
                  <label className="text-xs text-[var(--muted)]">
                    Discount type
                    <select
                      className={`${field} mt-0.5 block`}
                      value={grnDiscountType}
                      onChange={(e) =>
                        setGrnDiscountType(
                          e.target.value as "none" | "percent" | "amount",
                        )
                      }
                    >
                      <option value="none">None</option>
                      <option value="percent">Percent</option>
                      <option value="amount">Amount (₹)</option>
                    </select>
                  </label>
                  <label className="text-xs text-[var(--muted)]">
                    Discount entry
                    <input
                      className={`${field} mt-0.5 block w-28`}
                      value={grnDiscountEntry}
                      onChange={(e) => setGrnDiscountEntry(e.target.value)}
                      placeholder={grnDiscountType === "percent" ? "%" : "₹"}
                      disabled={grnDiscountType === "none"}
                    />
                  </label>
                  <label className="text-xs text-[var(--muted)]">
                    Total discount from items
                    <input
                      className={`${field} mt-0.5 block w-32`}
                      value={(computedGrnTotals.discountPaise / 100).toFixed(2)}
                      readOnly
                    />
                  </label>
                  <label className="text-xs text-[var(--muted)]">
                    Tax amount ₹
                    <input
                      className={`${field} mt-0.5 block w-28`}
                      value={grnTaxAmount}
                      onChange={(e) => setGrnTaxAmount(e.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <div className="text-sm font-semibold text-[var(--brand-deep)]">
                    Grand total: {formatInr(computedGrnTotals.grandTotalPaise)}
                  </div>
                </div>
                <button
                  type="button"
                  className={`${btn} mt-3`}
                  onClick={() => {
                    if (!selectedPo) return;
                    const lines = computedGrnLines
                      .filter((l) => l.qtyReceived > 0)
                      .map((l) => ({
                        poLineId: l.poLineId,
                        qtyReceived: l.qtyReceived,
                        description: l.description,
                        ratePaise: l.ratePaise,
                        ledgerCategoryId: l.ledgerCategoryId,
                      }));
                    const res = receiveGrn({
                      poId: selectedPo.id,
                      lines,
                      destination: grnDestination,
                      by: actorName,
                      grnNo: grnNoOverride.trim() || undefined,
                      vendorId: grnVendorId || selectedPo.vendorId,
                      vendorNarration: grnNarration,
                      date: grnOcr?.billDate || grnDate,
                      photoNote: grnPhotoNote,
                      billImageUrl: grnBillImageUrl,
                      discountType: grnDiscountType,
                      discountPaise: computedGrnTotals.discountPaise,
                      taxPaise: computedGrnTotals.taxPaise,
                      ocr: grnOcr
                        ? {
                            billNo: grnOcr.billNo,
                            dueOn: grnOcr.dueOn,
                            billDate: grnOcr.billDate,
                          }
                        : undefined,
                    });
                    if (!res.ok) return setError(res.error);
                    flash(
                      `GRN ${res.grn.grnNo} posted · PO ${poStatusLabel(res.order.status)}`,
                    );
                    setGrnQty({});
                    setGrnNoOverride("");
                    setGrnPhotoNote("");
                    setGrnBillImageUrl("");
                    setGrnBillFileName("");
                    refresh();
                  }}
                >
                  Post GRN
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--muted)]">
                Select an issued PO with pending receipt.
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
              GRN history ({state.grns.length})
            </h2>
            <ul className="space-y-2">
              {state.grns.map((g) => {
                const po = state.orders.find((o) => o.id === g.poId);
                return (
                  <li
                    key={g.id}
                    className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3 text-sm"
                  >
                    <span className="font-semibold text-[var(--brand-deep)]">
                      {g.grnNo}
                    </span>
                    {" · "}
                    {g.date} · {po?.poNo ?? g.poId} ·{" "}
                    {grnDestinationLabel(g.destination)}
                    {g.stockApplied ? " · stock updated" : ""}
                    {g.vendorBillId ? " · vendor bill linked" : ""}
                  </li>
                );
              })}
              {!state.grns.length ? (
                <li className="text-sm text-[var(--muted)]">No GRNs yet.</li>
              ) : null}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "returns" ? <PurchaseReturnPanel /> : null}

      {tab === "reports" ? (
        <div className="mt-4 rounded-2xl border border-[rgba(32,48,80,0.1)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap gap-3">
            <label className="text-xs text-[var(--muted)]">
              From
              <input
                type="date"
                className={`${field} mt-0.5 block`}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              To
              <input
                type="date"
                className={`${field} mt-0.5 block`}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Format
              <select
                className={`${field} mt-0.5 block`}
                value={format}
                onChange={(e) =>
                  setFormat(e.target.value as PurchaseReportFormat)
                }
              >
                <option value="excel">Excel (CSV)</option>
                <option value="pdf">PDF</option>
              </select>
            </label>
          </div>
          <ul className="mt-4 space-y-2">
            {PURCHASE_REPORTS.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[rgba(32,48,80,0.08)] bg-white px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--brand-deep)]">
                    {r.label}
                  </p>
                  {r.hint ? (
                    <p className="text-xs text-[var(--muted)]">{r.hint}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => {
                    const res = runPurchaseReport(r.id as PurchaseReportId, {
                      academicYearCode: ay,
                      fromDate,
                      toDate,
                      format,
                      purchase: state,
                    });
                    if (!res.ok) return setError(res.error);
                    flash(res.message);
                  }}
                >
                  Export
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ErpWorkspaceShell>
  );
}
