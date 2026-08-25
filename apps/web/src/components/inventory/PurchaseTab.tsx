"use client";

/**
 * Purchase — orders, receiving, bills and returns.
 *
 * The flow this screen exists to make obvious: you order at an agreed rate,
 * you receive what actually turned up, and receiving is what creates both the
 * stock and the bill. Cost is never typed into the catalogue by hand — it is
 * whatever the goods actually landed at, freight and non-reclaimable tax
 * included, which is why the receipt form shows the landed rate as you type.
 */

import { useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import {
  FIELD_CLASS,
  InvAlert,
  InvDrawer,
  InvSpinner,
  MoneyField,
  NumberField,
  Pill,
  SelectField,
  StatTile,
  TextField,
} from "@/components/inventory/InvUi";
import { invApi, useAsync, useSaver } from "@/lib/inventory/client";
import {
  billStatusLabel,
  formatPaise,
  inputToPaise,
  lineAmounts,
  paiseToInput,
  poStatusLabel,
  type InvBootstrap,
  type InvGrn,
  type InvItemRow,
  type InvPendingPoLine,
  type InvPurchaseOrder,
} from "@/lib/inventory/types";

type Section = "orders" | "receive" | "bills" | "returns";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "orders", label: "Orders" },
  { id: "receive", label: "Receive goods" },
  { id: "bills", label: "Bills to pay" },
  { id: "returns", label: "Returns" },
];

export function PurchaseTab({ boot }: { boot: InvBootstrap }) {
  const [section, setSection] = useState<Section>("orders");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={
              section === s.id
                ? "rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                : "rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "orders" ? <OrdersSection boot={boot} /> : null}
      {section === "receive" ? <ReceiveSection boot={boot} /> : null}
      {section === "bills" ? <BillsSection /> : null}
      {section === "returns" ? <ReturnsSection boot={boot} /> : null}
    </div>
  );
}

/* ─── Orders ───────────────────────────────────────────────── */

type OrderLineDraft = {
  itemId: string;
  qtyInput: string;
  rateInput: string;
  discountInput: string;
  gstInput: string;
};

function OrdersSection({ boot }: { boot: InvBootstrap }) {
  const [status, setStatus] = useState("open");
  const orders = useAsync(() => invApi.listOrders({ status }), [status]);
  const catalogue = useAsync(
    () => invApi.listItems({ status: "active", pageSize: 300, sort: "name" }),
    [],
  );
  const saver = useSaver();

  const [draft, setDraft] = useState<{
    id?: string;
    vendorId: string;
    orderDate: string;
    expectedDate: string;
    freightInput: string;
    note: string;
    lines: OrderLineDraft[];
  } | null>(null);

  const itemsById = useMemo(() => {
    const m = new Map<string, InvItemRow>();
    for (const r of catalogue.data?.rows ?? []) m.set(r.id, r);
    return m;
  }, [catalogue.data]);

  const vendorOptions = boot.vendors
    .filter((v) => v.isActive)
    .map((v) => ({ value: v.id, label: v.name }));

  function openNew() {
    setDraft({
      vendorId: "",
      orderDate: new Date().toISOString().slice(0, 10),
      expectedDate: "",
      freightInput: "",
      note: "",
      lines: [],
    });
  }

  function openEdit(o: InvPurchaseOrder) {
    setDraft({
      id: o.id,
      vendorId: o.vendorId,
      orderDate: o.orderDate,
      expectedDate: o.expectedDate,
      freightInput: paiseToInput(o.freightPaise),
      note: o.note,
      lines: o.lines.map((l) => ({
        itemId: l.itemId,
        qtyInput: String(l.qty),
        rateInput: paiseToInput(l.ratePaise),
        discountInput: l.discountPct ? String(l.discountPct) : "",
        gstInput: l.gstRate ? String(l.gstRate) : "",
      })),
    });
  }

  /** Add an item, defaulting its rate from what this vendor last charged. */
  function addLine(itemId: string) {
    if (!itemId) return;
    setDraft((d) => {
      if (!d || d.lines.some((l) => l.itemId === itemId)) return d;
      const item = itemsById.get(itemId);
      return {
        ...d,
        lines: [
          ...d.lines,
          {
            itemId,
            qtyInput: "1",
            rateInput: paiseToInput(item?.lastPurchasePaise || item?.avgCostPaise || 0),
            discountInput: "",
            gstInput: item?.gstRate ? String(item.gstRate) : "",
          },
        ],
      };
    });
  }

  const totals = useMemo(() => {
    if (!draft) return { subtotal: 0, tax: 0, total: 0 };
    let subtotal = 0;
    let tax = 0;
    for (const l of draft.lines) {
      const a = lineAmounts({
        qty: Number(l.qtyInput) || 0,
        ratePaise: inputToPaise(l.rateInput),
        discountPct: Number(l.discountInput) || 0,
        gstRate: Number(l.gstInput) || 0,
      });
      subtotal += a.lineTotalPaise;
      tax += a.taxPaise;
    }
    const freight = inputToPaise(draft.freightInput);
    return { subtotal, tax, total: subtotal + tax + freight };
  }, [draft]);

  const overThreshold = totals.total > boot.settings.poApprovalThresholdPaise;

  async function save() {
    if (!draft?.vendorId || draft.lines.length === 0) return;
    const ok = await saver.run(
      () =>
        invApi.saveOrder({
          id: draft.id,
          vendorId: draft.vendorId,
          orderDate: draft.orderDate || undefined,
          expectedDate: draft.expectedDate || undefined,
          freightPaise: inputToPaise(draft.freightInput),
          note: draft.note,
          lines: draft.lines.map((l) => ({
            itemId: l.itemId,
            qty: Number(l.qtyInput) || 0,
            ratePaise: inputToPaise(l.rateInput),
            discountPct: Number(l.discountInput) || 0,
            gstRate: Number(l.gstInput) || 0,
          })),
        }),
      { success: "Order saved" },
    );
    if (ok) {
      setDraft(null);
      orders.reload();
    }
  }

  async function decide(
    o: InvPurchaseOrder,
    decision: "submit" | "approve" | "issue" | "cancel",
  ) {
    const ok = await saver.run(() => invApi.decideOrder(o.id, decision), {
      success: `${o.poNo} updated`,
    });
    if (ok) orders.reload();
  }

  const list = orders.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${FIELD_CLASS} w-[170px]`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="open">Open orders</option>
          <option value="pending_approval">Awaiting approval</option>
          <option value="closed">Fully received</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All</option>
        </select>
        <Button variant="outline" size="sm" onClick={() => orders.reload()}>
          <RefreshCw className="size-3.5" />
        </Button>
        <Button size="sm" onClick={openNew}>
          <Plus className="size-4" />
          New order
        </Button>
      </div>

      <InvAlert
        error={orders.error || saver.error}
        notice={saver.notice}
        onDismiss={() => {
          saver.setError("");
          saver.setNotice("");
        }}
      />

      {orders.loading ? (
        <InvSpinner label="Loading orders" />
      ) : orders.error ? null : list.length === 0 ? (
        <EmptyBlock
          title="No purchase orders"
          hint="Raise one to record what you agreed to buy and at what rate."
          onAdd={openNew}
          addLabel="New order"
        />
      ) : (
        <ErpTableShell density="compact" className="overflow-x-auto">
          <ErpTable minWidth="min-w-[900px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left font-medium">Order</th>
                <th className="px-3 py-2 text-left font-medium">Vendor</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 text-right font-medium">Received</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {list.map((o) => {
                const ordered = o.lines.reduce((s, l) => s + l.qty, 0);
                const received = o.lines.reduce((s, l) => s + l.qtyReceived, 0);
                return (
                  <tr key={o.id}>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{o.poNo}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {o.orderDate}
                        {o.expectedDate ? ` · due ${o.expectedDate}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">{o.vendorName}</td>
                    <td className="px-3 py-2">
                      <Pill
                        tone={
                          o.status === "cancelled"
                            ? "bad"
                            : o.status === "closed"
                              ? "good"
                              : o.status === "pending_approval"
                                ? "warn"
                                : "info"
                        }
                      >
                        {poStatusLabel(o.status)}
                      </Pill>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPaise(o.totalPaise)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {received} / {ordered}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {["draft", "pending_approval", "approved"].includes(o.status) ? (
                        <Button variant="ghost" size="xs" onClick={() => openEdit(o)}>
                          Edit
                        </Button>
                      ) : null}
                      {o.status === "draft" && o.needsApproval ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => decide(o, "submit")}
                        >
                          Send for approval
                        </Button>
                      ) : null}
                      {o.status === "draft" && !o.needsApproval ? (
                        <Button variant="ghost" size="xs" onClick={() => decide(o, "issue")}>
                          Send to vendor
                        </Button>
                      ) : null}
                      {o.status === "pending_approval" ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => decide(o, "approve")}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {o.status === "approved" ? (
                        <Button variant="ghost" size="xs" onClick={() => decide(o, "issue")}>
                          Send to vendor
                        </Button>
                      ) : null}
                      {!["closed", "cancelled"].includes(o.status) ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-destructive"
                          onClick={() => decide(o, "cancel")}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}

      <InvDrawer
        open={!!draft}
        wide
        title={draft?.id ? "Edit purchase order" : "New purchase order"}
        subtitle="Agreed rates and quantities. Stock and the bill come later, when goods arrive."
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={saver.saving || !draft?.vendorId || !draft?.lines.length}
            >
              {saver.saving ? "Saving…" : "Save order"}
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <InvAlert error={saver.error} />
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField
                label="Vendor"
                required
                value={draft.vendorId}
                options={vendorOptions}
                onChange={(v) => setDraft((d) => (d ? { ...d, vendorId: v } : d))}
              />
              <TextField
                label="Order date"
                type="date"
                value={draft.orderDate}
                onChange={(v) => setDraft((d) => (d ? { ...d, orderDate: v } : d))}
              />
              <TextField
                label="Expected delivery"
                type="date"
                value={draft.expectedDate}
                onChange={(v) => setDraft((d) => (d ? { ...d, expectedDate: v } : d))}
              />
              <MoneyField
                label="Freight / delivery"
                value={draft.freightInput}
                onChange={(v) => setDraft((d) => (d ? { ...d, freightInput: v } : d))}
              />
            </div>

            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Items
              </legend>
              <select
                className={`${FIELD_CLASS} w-full`}
                value=""
                onChange={(e) => {
                  addLine(e.target.value);
                  e.currentTarget.selectedIndex = 0;
                }}
              >
                <option value="">
                  {catalogue.loading ? "Loading catalogue…" : "Add an item…"}
                </option>
                {(catalogue.data?.rows ?? [])
                  .filter((r) => !draft.lines.some((l) => l.itemId === r.id))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.variantLabel ? ` — ${r.variantLabel}` : ""}
                    </option>
                  ))}
              </select>

              {draft.lines.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted-foreground">
                  No items yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {draft.lines.map((l, idx) => {
                    const item = itemsById.get(l.itemId);
                    const a = lineAmounts({
                      qty: Number(l.qtyInput) || 0,
                      ratePaise: inputToPaise(l.rateInput),
                      discountPct: Number(l.discountInput) || 0,
                      gstRate: Number(l.gstInput) || 0,
                    });
                    const patch = (p: Partial<OrderLineDraft>) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              lines: d.lines.map((x, i) =>
                                i === idx ? { ...x, ...p } : x,
                              ),
                            }
                          : d,
                      );
                    return (
                      <div key={l.itemId} className="rounded-lg border p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium">{item?.name}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {item?.sku}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              setDraft((d) =>
                                d
                                  ? { ...d, lines: d.lines.filter((_, i) => i !== idx) }
                                  : d,
                              )
                            }
                            aria-label="Remove line"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-4">
                          <NumberField
                            label="Qty"
                            value={l.qtyInput}
                            onChange={(v) => patch({ qtyInput: v })}
                          />
                          <MoneyField
                            label="Rate"
                            value={l.rateInput}
                            onChange={(v) => patch({ rateInput: v })}
                          />
                          <NumberField
                            label="Discount"
                            suffix="%"
                            value={l.discountInput}
                            onChange={(v) => patch({ discountInput: v })}
                          />
                          <NumberField
                            label="GST"
                            suffix="%"
                            value={l.gstInput}
                            onChange={(v) => patch({ gstInput: v })}
                          />
                        </div>
                        <div className="mt-1 text-right text-xs text-muted-foreground">
                          Net {formatPaise(a.netRatePaise)} × {l.qtyInput || 0} ={" "}
                          <strong className="text-foreground">
                            {formatPaise(a.lineTotalPaise)}
                          </strong>
                          {a.taxPaise ? ` + ${formatPaise(a.taxPaise)} GST` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatPaise(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>GST</span>
                <span className="tabular-nums">{formatPaise(totals.tax)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                <span>Order value</span>
                <span className="tabular-nums">{formatPaise(totals.total)}</span>
              </div>
              {overThreshold ? (
                <p className="mt-1 text-[11px] text-amber-600">
                  Above the{" "}
                  {formatPaise(boot.settings.poApprovalThresholdPaise)} limit — this
                  order will need approval before it can be sent.
                </p>
              ) : null}
            </div>

            <TextField
              label="Note"
              value={draft.note}
              onChange={(v) => setDraft((d) => (d ? { ...d, note: v } : d))}
            />
          </div>
        ) : null}
      </InvDrawer>
    </div>
  );
}

/* ─── Receive goods ────────────────────────────────────────── */

type ReceiveLine = {
  key: string;
  poLineId?: string;
  itemId: string;
  label: string;
  sku: string;
  qtyPending?: number;
  qtyInput: string;
  rateInput: string;
  discountInput: string;
  gstInput: string;
};

function ReceiveSection({ boot }: { boot: InvBootstrap }) {
  const pending = useAsync(() => invApi.pendingPoLines({}), []);
  const receipts = useAsync(() => invApi.listReceipts({}), []);
  const catalogue = useAsync(
    () => invApi.listItems({ status: "active", pageSize: 300, sort: "name" }),
    [],
  );
  const saver = useSaver();

  const [open, setOpen] = useState(false);
  const [voiding, setVoiding] = useState<InvGrn | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [amending, setAmending] = useState<InvGrn | null>(null);
  const [amendInv, setAmendInv] = useState("");
  const [amendDate, setAmendDate] = useState("");
  const [amendReceiptOn, setAmendReceiptOn] = useState("");
  const [amendBillDate, setAmendBillDate] = useState("");
  const [amendNote, setAmendNote] = useState("");
  const [amendLines, setAmendLines] = useState<
    { lineId: string; itemName: string; qty: string; rate: string; disc: string; gst: string }[]
  >([]);
  const [poId, setPoId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [locationId, setLocationId] = useState(
    boot.settings.defaultLocationId || boot.locations[0]?.id || "",
  );
  const [invoiceNo, setInvoiceNo] = useState("");
  const [receiptDate, setReceiptDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [freightInput, setFreightInput] = useState("");
  const [otherInput, setOtherInput] = useState("");
  const [lines, setLines] = useState<ReceiveLine[]>([]);

  const pendingByPo = useMemo(() => {
    const m = new Map<string, InvPendingPoLine[]>();
    for (const l of pending.data ?? []) {
      const list = m.get(l.poId) ?? [];
      list.push(l);
      m.set(l.poId, list);
    }
    return m;
  }, [pending.data]);

  const poOptions = useMemo(() => {
    const seen = new Map<string, { poNo: string; vendorName: string; vendorId: string }>();
    for (const l of pending.data ?? []) {
      if (!seen.has(l.poId)) {
        seen.set(l.poId, {
          poNo: l.poNo,
          vendorName: l.vendorName,
          vendorId: l.vendorId,
        });
      }
    }
    return [...seen.entries()].map(([id, v]) => ({
      value: id,
      label: `${v.poNo} · ${v.vendorName}`,
      vendorId: v.vendorId,
    }));
  }, [pending.data]);

  /** Selecting an order pre-fills every outstanding line at its agreed rate. */
  function chooseOrder(id: string) {
    setPoId(id);
    if (!id) {
      setLines([]);
      return;
    }
    const opt = poOptions.find((o) => o.value === id);
    setVendorId(opt?.vendorId ?? "");
    setLines(
      (pendingByPo.get(id) ?? []).map((l) => ({
        key: l.id,
        poLineId: l.id,
        itemId: l.itemId,
        label: l.itemName ?? "",
        sku: l.sku ?? "",
        qtyPending: l.qtyPending,
        qtyInput: String(l.qtyPending),
        rateInput: paiseToInput(l.ratePaise),
        discountInput: l.discountPct ? String(l.discountPct) : "",
        gstInput: l.gstRate ? String(l.gstRate) : "",
      })),
    );
  }

  function addDirectLine(itemId: string) {
    if (!itemId) return;
    const item = (catalogue.data?.rows ?? []).find((r) => r.id === itemId);
    setLines((ls) =>
      ls.some((l) => l.itemId === itemId && !l.poLineId)
        ? ls
        : [
            ...ls,
            {
              key: `direct-${itemId}`,
              itemId,
              label: item?.name ?? "",
              sku: item?.sku ?? "",
              qtyInput: "1",
              rateInput: paiseToInput(item?.lastPurchasePaise ?? 0),
              discountInput: "",
              gstInput: item?.gstRate ? String(item.gstRate) : "",
            },
          ],
    );
  }

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const l of lines) {
      const a = lineAmounts({
        qty: Number(l.qtyInput) || 0,
        ratePaise: inputToPaise(l.rateInput),
        discountPct: Number(l.discountInput) || 0,
        gstRate: Number(l.gstInput) || 0,
      });
      subtotal += a.lineTotalPaise;
      tax += a.taxPaise;
    }
    const addons = inputToPaise(freightInput) + inputToPaise(otherInput);
    return {
      subtotal,
      tax,
      addons,
      total: subtotal + tax + addons,
      // Charges that attach to the goods: freight, other charges, and GST
      // unless the trust reclaims it. Mirrors inv_post_grn.
      costAddon: addons + (boot.settings.trackGst ? tax : 0),
    };
  }, [lines, freightInput, otherInput, boot.settings.trackGst]);

  function reset() {
    setOpen(false);
    setPoId("");
    setVendorId("");
    setInvoiceNo("");
    setFreightInput("");
    setOtherInput("");
    setLines([]);
  }

  async function post() {
    const usable = lines.filter((l) => (Number(l.qtyInput) || 0) > 0);
    if (!vendorId || usable.length === 0) return;
    const res = await saver.run(() =>
      invApi.postReceipt({
        poId: poId || undefined,
        vendorId,
        locationId,
        receiptDate,
        supplierInvoiceNo: invoiceNo,
        freightPaise: inputToPaise(freightInput),
        otherChargesPaise: inputToPaise(otherInput),
        createBill: true,
        lines: usable.map((l) => ({
          poLineId: l.poLineId,
          itemId: l.itemId,
          qtyReceived: Number(l.qtyInput) || 0,
          ratePaise: inputToPaise(l.rateInput),
          discountPct: Number(l.discountInput) || 0,
          gstRate: Number(l.gstInput) || 0,
        })),
      }),
    );
    if (res) {
      saver.setNotice(
        `${res.grnNo} posted — stock updated and bill ${res.billNo} raised for ${formatPaise(res.totalPaise)}`,
      );
      reset();
      pending.reload();
      receipts.reload();
    }
  }

  const all = receipts.data ?? [];
  // Cancelled receipts are history, not work — they sit in their own section
  // below so the live table reads as "what we actually hold".
  const list = all.filter((g: InvGrn) => g.status !== "void");
  const cancelledList = all.filter((g: InvGrn) => g.status === "void");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground">
          Receiving posts the stock, sets the landed cost and raises the vendor
          bill — all in one step.
        </p>
        <Button variant="outline" size="sm" onClick={() => receipts.reload()}>
          <RefreshCw className="size-3.5" />
        </Button>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Receive goods
        </Button>
      </div>

      <InvAlert
        error={receipts.error || saver.error}
        notice={saver.notice}
        onDismiss={() => {
          saver.setError("");
          saver.setNotice("");
        }}
      />

      {(pending.data ?? []).length > 0 ? (
        <p className="text-xs text-amber-600">
          {(pending.data ?? []).length} order line
          {(pending.data ?? []).length === 1 ? "" : "s"} still awaiting delivery.
        </p>
      ) : null}

      {receipts.loading ? (
        <InvSpinner label="Loading receipts" />
      ) : receipts.error ? null : list.length === 0 ? (
        <EmptyBlock
          title="Nothing received yet"
          hint="Record a delivery against an order, or a direct cash purchase."
          onAdd={() => setOpen(true)}
          addLabel="Receive goods"
        />
      ) : (
        <ErpTableShell density="compact" className="overflow-x-auto">
          <ErpTable minWidth="min-w-[900px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left font-medium">Receipt</th>
                <th className="px-3 py-2 text-left font-medium">Vendor</th>
                <th className="px-3 py-2 text-left font-medium">Against</th>
                <th className="px-3 py-2 text-left font-medium">Items</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 text-left font-medium">Bill</th>
                <th className="px-3 py-2" />
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {list.map((g: InvGrn) => {
                const voided = g.status === "void";
                return (
                  <tr key={g.id} className={voided ? "opacity-60" : undefined}>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">
                        {g.grnNo}
                        {voided ? (
                          <span className="ml-1 rounded bg-[var(--danger-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--danger)]">
                            cancelled
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {g.receiptDate}
                      </div>
                      {voided && g.voidReason ? (
                        <div className="text-[11px] text-[var(--danger)]">
                          {g.voidReason}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{g.vendorName}</td>
                    <td className="px-3 py-2 text-xs">
                      {g.poNo || <span className="text-muted-foreground">Direct</span>}
                      {g.supplierInvoiceNo ? (
                        <div className="text-[11px] text-muted-foreground">
                          Inv {g.supplierInvoiceNo}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {g.lines.map((l) => (
                        <div key={l.id} className="flex justify-between gap-3">
                          <span>
                            {l.itemName} × {l.qtyReceived}
                            <span className="ml-1 text-muted-foreground">
                              @ {formatPaise(l.landedUnitCostPaise)} landed
                            </span>
                          </span>
                          {/* What this one item cost on this receipt, so a line
                              can be checked against the supplier's invoice
                              without adding it up by hand. */}
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatPaise(l.lineTotalPaise + l.taxPaise)}
                          </span>
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPaise(g.totalPaise)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{g.billNo || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {!voided ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              setAmending(g);
                              setAmendInv(g.supplierInvoiceNo);
                              setAmendDate(g.supplierInvoiceDate);
                              setAmendReceiptOn(g.receiptDate);
                              setAmendBillDate("");
                              setAmendNote(g.note);
                              setAmendLines(
                                g.lines.map((l) => ({
                                  lineId: l.id,
                                  itemName: l.itemName ?? "",
                                  qty: String(l.qtyReceived),
                                  rate: (l.ratePaise / 100).toFixed(2),
                                  disc: String(l.discountPct),
                                  gst: String(l.gstRate),
                                })),
                              );
                            }}
                          >
                            Amend
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setVoiding(g)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}

      {cancelledList.length > 0 ? (
        <details className="rounded-xl border border-[var(--border)]">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-muted-foreground">
            Cancelled receipts ({cancelledList.length})
          </summary>
          <ErpTableShell density="compact" className="overflow-x-auto">
            <ErpTable minWidth="min-w-[640px]">
              <ErpTableHead>
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Receipt</th>
                  <th className="px-3 py-2 text-left font-medium">Vendor</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-left font-medium">Why cancelled</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {cancelledList.map((g: InvGrn) => (
                  <tr key={g.id} className="opacity-70">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{g.grnNo}</div>
                      <div className="text-[11px] text-muted-foreground">{g.receiptDate}</div>
                    </td>
                    <td className="px-3 py-2">{g.vendorName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPaise(g.totalPaise)}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--danger)]">
                      {g.voidReason || "—"}
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </ErpTableShell>
        </details>
      ) : null}

      <InvDrawer
        open={!!voiding}
        title={`Cancel ${voiding?.grnNo ?? ""}`}
        subtitle="Takes the stock back out, reopens the order and reverses the bill"
        onClose={() => {
          setVoiding(null);
          setVoidReason("");
        }}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setVoiding(null);
                setVoidReason("");
              }}
            >
              Keep it
            </Button>
            <Button
              size="sm"
              disabled={saver.saving || !voidReason.trim()}
              onClick={async () => {
                if (!voiding) return;
                const res = await saver.run(() =>
                  invApi.voidReceipt(voiding.id, voidReason.trim()),
                );
                if (res) {
                  saver.setNotice(
                    `${res.grnNo} cancelled${
                      res.reversalVoucherNo
                        ? ` — books reversed by ${res.reversalVoucherNo}`
                        : ""
                    }`,
                  );
                  setVoiding(null);
                  setVoidReason("");
                  receipts.reload();
                  pending.reload();
                }
              }}
            >
              Cancel this receipt
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The goods go back out of stock at the cost they came in at, the
            average cost is rebuilt as though this receipt never happened, the
            order gets its quantity back and the bill is reversed in the books.
            The receipt itself is kept, marked cancelled, with your reason on it.
          </p>
          <p className="rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
            This is refused if any of the goods have already been issued, or if
            the bill has been paid. In those cases raise a purchase return
            instead — the goods left the shelf, and pretending otherwise would
            make the stock register wrong.
          </p>
          <TextField
            label="Why is it being cancelled?"
            value={voidReason}
            onChange={setVoidReason}
          />
          <InvAlert error={saver.error} />
        </div>
      </InvDrawer>

      <InvDrawer
        open={!!amending}
        title={`Amend ${amending?.grnNo ?? ""}`}
        subtitle="Invoice details, dates, quantities, rates, discounts and GST"
        onClose={() => setAmending(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setAmending(null)}>
              Close
            </Button>
            <Button
              size="sm"
              disabled={saver.saving}
              onClick={async () => {
                if (!amending) return;
                const res = await saver.run(() =>
                  invApi.amendReceipt({
                    grnId: amending.id,
                    supplierInvoiceNo: amendInv,
                    supplierInvoiceDate: amendDate,
                    receiptDate: amendReceiptOn || undefined,
                    billDate: amendBillDate || undefined,
                    lines: amendLines
                      .map((al) => {
                        const orig = amending.lines.find((l) => l.id === al.lineId);
                        if (!orig) return null;
                        const qty = Number(al.qty);
                        const rate = Math.round(Number(al.rate) * 100);
                        const disc = Number(al.disc);
                        const gst = Number(al.gst);
                        const changed =
                          qty !== orig.qtyReceived ||
                          rate !== orig.ratePaise ||
                          disc !== orig.discountPct ||
                          gst !== orig.gstRate;
                        if (!changed || !Number.isFinite(qty) || !Number.isFinite(rate))
                          return null;
                        return {
                          lineId: al.lineId,
                          qtyReceived: qty,
                          ratePaise: rate,
                          discountPct: disc,
                          gstRate: gst,
                        };
                      })
                      .filter((x): x is NonNullable<typeof x> => x !== null),
                    note: amendNote,
                  }),
                );
                if (res) {
                  saver.setNotice(
                    res.ledgerVoucherNo
                      ? `${amending.grnNo} updated — books re-posted as ${res.ledgerVoucherNo}`
                      : `${amending.grnNo} updated`,
                  );
                  setAmending(null);
                  receipts.reload();
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Correct what the supplier&apos;s invoice actually says — names,
            dates, quantities, rates, discounts and GST. Every change restates
            stock and the books together, and the old voucher stays visible.
          </p>
          <TextField
            label="Supplier invoice no"
            value={amendInv}
            onChange={setAmendInv}
          />
          <TextField
            label="Supplier invoice date"
            type="date"
            value={amendDate}
            onChange={setAmendDate}
          />
          <TextField
            label="Goods received on"
            type="date"
            value={amendReceiptOn}
            onChange={setAmendReceiptOn}
          />
          <TextField
            label="Bill date (leave blank to keep as is)"
            type="date"
            value={amendBillDate}
            onChange={setAmendBillDate}
          />
          <p className="text-[11px] text-muted-foreground">
            Changing the bill date corrects the books too: the old ledger
            voucher is reversed and a fresh one is posted at the new date —
            both stay visible, which is how an append-only book corrects.
          </p>
          {amendLines.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold">Lines</p>
              <p className="text-[11px] text-muted-foreground">
                Stock, average cost, the order, the bill and the books restate
                together — a quantity cut below what has already been issued is
                refused. Adding or removing an item still needs cancel and
                re-entry.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-2 font-medium">Item</th>
                      <th className="py-1 pr-2 font-medium">Qty</th>
                      <th className="py-1 pr-2 font-medium">Rate ₹</th>
                      <th className="py-1 pr-2 font-medium">Disc %</th>
                      <th className="py-1 font-medium">GST %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {amendLines.map((al, i) => (
                      <tr key={al.lineId}>
                        <td className="py-1 pr-2">{al.itemName}</td>
                        <td className="py-1 pr-2">
                          <input
                            className="w-16 rounded-md border px-1.5 py-1 text-right"
                            inputMode="decimal"
                            value={al.qty}
                            onChange={(e) =>
                              setAmendLines((ls) =>
                                ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)),
                              )
                            }
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            className="w-20 rounded-md border px-1.5 py-1 text-right"
                            inputMode="decimal"
                            value={al.rate}
                            onChange={(e) =>
                              setAmendLines((ls) =>
                                ls.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)),
                              )
                            }
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            className="w-14 rounded-md border px-1.5 py-1 text-right"
                            inputMode="decimal"
                            value={al.disc}
                            onChange={(e) =>
                              setAmendLines((ls) =>
                                ls.map((x, j) => (j === i ? { ...x, disc: e.target.value } : x)),
                              )
                            }
                          />
                        </td>
                        <td className="py-1">
                          <input
                            className="w-14 rounded-md border px-1.5 py-1 text-right"
                            inputMode="decimal"
                            value={al.gst}
                            onChange={(e) =>
                              setAmendLines((ls) =>
                                ls.map((x, j) => (j === i ? { ...x, gst: e.target.value } : x)),
                              )
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <TextField label="Note" value={amendNote} onChange={setAmendNote} />
          <InvAlert error={saver.error} />
        </div>
      </InvDrawer>

      <InvDrawer
        open={open}
        wide
        title="Receive goods"
        subtitle="This posts stock, updates the average cost and raises the bill."
        onClose={reset}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={reset}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={post}
              disabled={saver.saving || !vendorId || lines.length === 0}
            >
              {saver.saving ? "Posting…" : "Post receipt"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <InvAlert error={saver.error} />

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Against a purchase order"
              hint="Leave empty for a direct / cash purchase"
              value={poId}
              options={poOptions.map((o) => ({ value: o.value, label: o.label }))}
              placeholder="— direct purchase —"
              onChange={chooseOrder}
            />
            <SelectField
              label="Vendor"
              required
              value={vendorId}
              options={boot.vendors
                .filter((v) => v.isActive)
                .map((v) => ({ value: v.id, label: v.name }))}
              onChange={setVendorId}
              disabled={!!poId}
            />
            <TextField
              label="Receipt date"
              type="date"
              value={receiptDate}
              onChange={setReceiptDate}
            />
            <SelectField
              label="Into location"
              value={locationId}
              options={boot.locations
                .filter((l) => l.isActive)
                .map((l) => ({ value: l.id, label: l.name }))}
              onChange={setLocationId}
            />
            <TextField
              label="Supplier invoice no."
              value={invoiceNo}
              onChange={setInvoiceNo}
            />
          </div>

          <fieldset className="space-y-2 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              What arrived
            </legend>

            {!poId ? (
              <select
                className={`${FIELD_CLASS} w-full`}
                value=""
                onChange={(e) => {
                  addDirectLine(e.target.value);
                  e.currentTarget.selectedIndex = 0;
                }}
              >
                <option value="">Add an item…</option>
                {(catalogue.data?.rows ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.variantLabel ? ` — ${r.variantLabel}` : ""}
                  </option>
                ))}
              </select>
            ) : null}

            {lines.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">
                {poId ? "This order has nothing outstanding." : "No items yet."}
              </p>
            ) : (
              <div className="space-y-2">
                {lines.map((l, idx) => {
                  const a = lineAmounts({
                    qty: Number(l.qtyInput) || 0,
                    ratePaise: inputToPaise(l.rateInput),
                    discountPct: Number(l.discountInput) || 0,
                    gstRate: Number(l.gstInput) || 0,
                  });
                  const qty = Number(l.qtyInput) || 0;
                  // Show the landed rate as it will be recorded, so a heavy
                  // freight bill is visible before the cost is committed.
                  const share =
                    totals.subtotal > 0 && qty > 0
                      ? Math.round(
                          (totals.costAddon * a.lineTotalPaise) / totals.subtotal / qty,
                        )
                      : 0;
                  const patch = (p: Partial<ReceiveLine>) =>
                    setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, ...p } : x)));
                  const over = l.qtyPending !== undefined && qty > l.qtyPending;
                  return (
                    <div key={l.key} className="rounded-lg border p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">{l.label}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {l.sku}
                            {l.qtyPending !== undefined
                              ? ` · ${l.qtyPending} outstanding`
                              : ""}
                          </div>
                        </div>
                        {!l.poLineId ? (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              setLines((ls) => ls.filter((_, i) => i !== idx))
                            }
                            aria-label="Remove line"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-4">
                        <NumberField
                          label="Received"
                          value={l.qtyInput}
                          onChange={(v) => patch({ qtyInput: v })}
                        />
                        <MoneyField
                          label="Rate"
                          value={l.rateInput}
                          onChange={(v) => patch({ rateInput: v })}
                        />
                        <NumberField
                          label="Discount"
                          suffix="%"
                          value={l.discountInput}
                          onChange={(v) => patch({ discountInput: v })}
                        />
                        <NumberField
                          label="GST"
                          suffix="%"
                          value={l.gstInput}
                          onChange={(v) => patch({ gstInput: v })}
                        />
                      </div>
                      {over ? (
                        <p className="mt-1 text-[11px] text-destructive">
                          More than the {l.qtyPending} still outstanding — this will
                          be refused.
                        </p>
                      ) : null}
                      <div className="mt-1 text-right text-xs text-muted-foreground">
                        Landed cost{" "}
                        <strong className="text-foreground">
                          {formatPaise(a.netRatePaise + share)}
                        </strong>{" "}
                        per unit
                        {share ? ` (incl. ${formatPaise(share)} charges)` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyField
              label="Freight / delivery"
              hint="Spread across the lines by value"
              value={freightInput}
              onChange={setFreightInput}
            />
            <MoneyField
              label="Other charges"
              value={otherInput}
              onChange={setOtherInput}
            />
          </div>

          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <div className="flex justify-between">
              <span>Goods</span>
              <span className="tabular-nums">{formatPaise(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>GST</span>
              <span className="tabular-nums">{formatPaise(totals.tax)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Freight and charges</span>
              <span className="tabular-nums">{formatPaise(totals.addons)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
              <span>Bill total</span>
              <span className="tabular-nums">{formatPaise(totals.total)}</span>
            </div>
          </div>
        </div>
      </InvDrawer>
    </div>
  );
}

/* ─── Bills ────────────────────────────────────────────────── */

function BillsSection() {
  const [status, setStatus] = useState("unpaid");
  const bills = useAsync(() => invApi.listBills({ status }), [status]);
  const saver = useSaver();
  const [pay, setPay] = useState<{
    billId: string;
    billNo: string;
    balancePaise: number;
    amountInput: string;
    mode: string;
    paidOn: string;
    reference: string;
  } | null>(null);

  const allBills = useMemo(() => bills.data ?? [], [bills.data]);
  const list = useMemo(
    () => allBills.filter((b) => b.status !== "cancelled"),
    [allBills],
  );
  // A cancelled bill owes nobody anything — it must not sit in the same
  // table as live bills, and it must not count in the outstanding figure.
  const cancelledBills = useMemo(
    () => allBills.filter((b) => b.status === "cancelled"),
    [allBills],
  );
  const totals = useMemo(
    () => ({
      outstanding: list.reduce((s, b) => s + b.balancePaise, 0),
      overdue: list
        .filter((b) => b.overdueDays > 0)
        .reduce((s, b) => s + b.balancePaise, 0),
    }),
    [list],
  );

  async function submitPayment() {
    if (!pay) return;
    const amount = inputToPaise(pay.amountInput);
    if (amount <= 0) return;
    const res = await saver.run(() =>
      invApi.payBill({
        billId: pay.billId,
        amountPaise: amount,
        mode: pay.mode,
        paidOn: pay.paidOn || undefined,
        reference: pay.reference,
      }),
    );
    if (res) {
      saver.setNotice(
        `Recorded against ${pay.billNo} — ${formatPaise(res.balancePaise)} still outstanding`,
      );
      setPay(null);
      bills.reload();
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <StatTile label="Bills" value={list.length} />
        <StatTile
          label="Outstanding"
          value={formatPaise(totals.outstanding)}
          tone="warn"
        />
        <StatTile
          label="Overdue"
          value={formatPaise(totals.overdue)}
          tone={totals.overdue > 0 ? "bad" : "neutral"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${FIELD_CLASS} w-[150px]`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
          <option value="all">All</option>
        </select>
        <Button variant="outline" size="sm" onClick={() => bills.reload()}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      <InvAlert
        error={bills.error || saver.error}
        notice={saver.notice}
        onDismiss={() => {
          saver.setError("");
          saver.setNotice("");
        }}
      />

      {bills.loading ? (
        <InvSpinner label="Loading bills" />
      ) : bills.error ? null : list.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          No bills here. They are raised automatically when goods are received.
        </div>
      ) : (
        <ErpTableShell density="compact" className="overflow-x-auto">
          <ErpTable minWidth="min-w-[880px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left font-medium">Bill</th>
                <th className="px-3 py-2 text-left font-medium">Vendor</th>
                <th className="px-3 py-2 text-left font-medium">Due</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Paid</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {list.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{b.billNo}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {b.grnNo ? `from ${b.grnNo}` : ""}
                      {b.supplierInvoiceNo ? ` · inv ${b.supplierInvoiceNo}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2">{b.vendorName}</td>
                  <td className="px-3 py-2 text-xs">
                    {b.dueDate || "—"}
                    {b.overdueDays > 0 ? (
                      <div className="text-[11px] font-medium text-destructive">
                        {b.overdueDays} day{b.overdueDays === 1 ? "" : "s"} overdue
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatPaise(b.totalPaise)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatPaise(b.paidPaise)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatPaise(b.balancePaise)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Pill
                      tone={
                        b.status === "paid"
                          ? "good"
                          : b.overdueDays > 0
                            ? "bad"
                            : "warn"
                      }
                    >
                      {billStatusLabel(b.status)}
                    </Pill>
                    {b.balancePaise > 0 ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          setPay({
                            billId: b.id,
                            billNo: b.billNo,
                            balancePaise: b.balancePaise,
                            amountInput: paiseToInput(b.balancePaise),
                            mode: "bank",
                            paidOn: new Date().toISOString().slice(0, 10),
                            reference: "",
                          })
                        }
                      >
                        Pay
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}

      {cancelledBills.length > 0 ? (
        <details className="rounded-xl border border-[var(--border)]">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-muted-foreground">
            Cancelled bills ({cancelledBills.length})
          </summary>
          <ErpTableShell density="compact" className="overflow-x-auto">
            <ErpTable minWidth="min-w-[560px]">
              <ErpTableHead>
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Bill</th>
                  <th className="px-3 py-2 text-left font-medium">Vendor</th>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Was for</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {cancelledBills.map((b) => (
                  <tr key={b.id} className="opacity-70">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{b.billNo}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {b.grnNo ? `from ${b.grnNo}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">{b.vendorName}</td>
                    <td className="px-3 py-2 text-xs">{b.billDate}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPaise(b.totalPaise)}
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </ErpTableShell>
        </details>
      ) : null}

      <InvDrawer
        open={!!pay}
        title="Record a payment"
        subtitle={pay ? `${pay.billNo} · ${formatPaise(pay.balancePaise)} outstanding` : ""}
        onClose={() => setPay(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setPay(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitPayment} disabled={saver.saving}>
              {saver.saving ? "Saving…" : "Record payment"}
            </Button>
          </>
        }
      >
        {pay ? (
          <div className="space-y-3">
            <InvAlert error={saver.error} />
            <MoneyField
              label="Amount"
              hint="Cannot be more than the outstanding balance"
              value={pay.amountInput}
              onChange={(v) => setPay((p) => (p ? { ...p, amountInput: v } : p))}
            />
            <TextField
              label="Paid on"
              type="date"
              value={pay.paidOn}
              onChange={(v) => setPay((p) => (p ? { ...p, paidOn: v } : p))}
            />
            <SelectField
              label="Paid by"
              value={pay.mode}
              placeholder="Bank transfer"
              options={[
                { value: "bank", label: "Bank transfer" },
                { value: "cash", label: "Cash" },
                { value: "upi", label: "UPI" },
                { value: "cheque", label: "Cheque" },
                { value: "neft", label: "NEFT" },
                { value: "rtgs", label: "RTGS" },
                { value: "imps", label: "IMPS" },
                { value: "card", label: "Card" },
              ]}
              onChange={(v) => setPay((p) => (p ? { ...p, mode: v } : p))}
            />
            <TextField
              label="Reference"
              hint="UTR, cheque number or transaction id"
              value={pay.reference}
              onChange={(v) => setPay((p) => (p ? { ...p, reference: v } : p))}
            />
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
              The payment, the bill&rsquo;s balance and the ledger entry post
              together — a backdated date books it on that day, in that
              financial year.
            </p>
          </div>
        ) : null}
      </InvDrawer>
    </div>
  );
}

/* ─── Purchase returns ─────────────────────────────────────── */

function ReturnsSection({ boot }: { boot: InvBootstrap }) {
  const returns = useAsync(() => invApi.listPurchaseReturns({}), []);
  const receipts = useAsync(() => invApi.listReceipts({}), []);
  const saver = useSaver();

  const [grnId, setGrnId] = useState("");
  const [reason, setReason] = useState("");
  const [retOn, setRetOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  const grn = useMemo(
    () => (receipts.data ?? []).find((g) => g.id === grnId),
    [receipts.data, grnId],
  );

  function reset() {
    setOpen(false);
    setGrnId("");
    setReason("");
    setQtyByLine({});
  }

  async function post() {
    if (!grn || !reason.trim()) return;
    const lines = grn.lines
      .map((l) => ({
        grnLineId: l.id,
        itemId: l.itemId,
        qty: Number(qtyByLine[l.id]) || 0,
        gstRate: l.gstRate,
      }))
      .filter((l) => l.qty > 0);
    if (lines.length === 0) return;

    const res = await saver.run(() =>
      invApi.postPurchaseReturn({
        grnId: grn.id,
        vendorId: grn.vendorId,
        locationId: grn.locationId || boot.settings.defaultLocationId,
        reason: reason.trim(),
        returnDate: retOn || undefined,
        lines,
      }),
    );
    if (res) {
      saver.setNotice(
        `${res.returnNo} raised for ${formatPaise(res.totalPaise)} — stock reduced`,
      );
      reset();
      returns.reload();
      receipts.reload();
    }
  }

  const list = returns.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground">
          Sending goods back reduces stock and raises a debit note against the
          vendor.
        </p>
        <Button variant="outline" size="sm" onClick={() => returns.reload()}>
          <RefreshCw className="size-3.5" />
        </Button>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          New return
        </Button>
      </div>

      <InvAlert
        error={returns.error || saver.error}
        notice={saver.notice}
        onDismiss={() => {
          saver.setError("");
          saver.setNotice("");
        }}
      />

      {returns.loading ? (
        <InvSpinner label="Loading returns" />
      ) : returns.error ? null : list.length === 0 ? (
        <EmptyBlock
          title="No purchase returns"
          hint="Record damaged or wrong goods going back to a vendor."
          onAdd={() => setOpen(true)}
          addLabel="New return"
        />
      ) : (
        <ErpTableShell density="compact" className="overflow-x-auto">
          <ErpTable minWidth="min-w-[820px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left font-medium">Return</th>
                <th className="px-3 py-2 text-left font-medium">Vendor</th>
                <th className="px-3 py-2 text-left font-medium">Against</th>
                <th className="px-3 py-2 text-left font-medium">Reason</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{r.returnNo}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.returnDate}
                    </div>
                  </td>
                  <td className="px-3 py-2">{r.vendorName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.grnNo || "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.reason}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatPaise(r.totalPaise)}
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}

      <InvDrawer
        open={open}
        wide
        title="Return goods to vendor"
        subtitle="Pick the receipt the goods came in on"
        onClose={reset}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={reset}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={post}
              disabled={saver.saving || !grn || !reason.trim()}
            >
              {saver.saving ? "Posting…" : "Post return"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <InvAlert error={saver.error} />

          <SelectField
            label="Goods receipt"
            required
            value={grnId}
            options={(receipts.data ?? []).map((g) => ({
              value: g.id,
              label: `${g.grnNo} · ${g.vendorName} · ${g.receiptDate}`,
            }))}
            onChange={(v) => {
              setGrnId(v);
              setQtyByLine({});
            }}
          />

          <TextField
            label="Return date"
            type="date"
            value={retOn}
            onChange={setRetOn}
          />
          <TextField
            label="Reason"
            required
            hint="Recorded on the stock ledger, so the movement explains itself"
            value={reason}
            onChange={setReason}
            placeholder="e.g. Damaged in transit"
          />

          {grn ? (
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                What is going back
              </legend>
              {grn.lines.map((l) => {
                const returnable = l.qtyReceived - (l.qtyReturned ?? 0);
                const entered = Number(qtyByLine[l.id]) || 0;
                return (
                  <div
                    key={l.id}
                    className="flex flex-wrap items-end justify-between gap-2 border-b py-2 last:border-0"
                  >
                    <div>
                      <div className="text-sm font-medium">{l.itemName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {l.sku} · received {l.qtyReceived}
                        {l.qtyReturned ? `, ${l.qtyReturned} already returned` : ""} ·{" "}
                        {formatPaise(l.landedUnitCostPaise)} each
                      </div>
                    </div>
                    <div className="w-28">
                      <NumberField
                        label={`Return (max ${returnable})`}
                        value={qtyByLine[l.id] ?? ""}
                        onChange={(v) =>
                          setQtyByLine((q) => ({ ...q, [l.id]: v }))
                        }
                      />
                      {entered > returnable ? (
                        <p className="text-[11px] text-destructive">
                          Only {returnable} can be returned
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </fieldset>
          ) : null}
        </div>
      </InvDrawer>
    </div>
  );
}

/* ─── Shared ───────────────────────────────────────────────── */

function EmptyBlock({
  title,
  hint,
  onAdd,
  addLabel,
}: {
  title: string;
  hint: string;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="rounded-xl border border-dashed px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      <Button className="mt-3" size="sm" onClick={onAdd}>
        <Plus className="size-4" />
        {addLabel}
      </Button>
    </div>
  );
}
