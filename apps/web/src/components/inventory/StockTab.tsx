"use client";

/**
 * Stock — what is on hand, where it is, and its history.
 *
 * On-hand is never edited directly here. It is the sum of the ledger, so a
 * correction is a counted quantity plus a reason, and a move between locations
 * is a pair of entries. The stock card then explains every number on this
 * screen, which is the whole point of keeping the ledger rather than a column.
 */

import { useMemo, useState } from "react";
import { ArrowRightLeft, ClipboardCheck, RefreshCw, Search } from "lucide-react";
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
  NumberField,
  SelectField,
  StatTile,
  TextField,
} from "@/components/inventory/InvUi";
import { AssetsSection } from "@/components/inventory/AssetsSection";
import { invApi, useAsync, useDebounced, useSaver } from "@/lib/inventory/client";
import {
  formatPaise,
  formatQty,
  type InvBootstrap,
  type InvStockReportRowData,
} from "@/lib/inventory/types";

type Section = "onhand" | "assets";

export function StockTab({ boot }: { boot: InvBootstrap }) {
  const [section, setSection] = useState<Section>("onhand");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { id: "onhand", label: "On hand" },
            { id: "assets", label: "Asset register" },
          ] as { id: Section; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSection(t.id)}
            className={
              section === t.id
                ? "rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                : "rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === "onhand" ? <OnHandSection boot={boot} /> : null}
      {section === "assets" ? <AssetsSection boot={boot} /> : null}
    </div>
  );
}

/* ─── On hand ──────────────────────────────────────────────── */

function OnHandSection({ boot }: { boot: InvBootstrap }) {
  const [locationId, setLocationId] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 250);

  const stock = useAsync(
    () => invApi.stockReport(locationId, lowOnly),
    [locationId, lowOnly],
  );
  const saver = useSaver();

  const [card, setCard] = useState<InvStockReportRowData | null>(null);
  const [transfer, setTransfer] = useState<InvStockReportRowData | null>(null);
  const [count, setCount] = useState<InvStockReportRowData | null>(null);

  const rows = useMemo(() => {
    const all = stock.data?.rows ?? [];
    const term = debounced.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (r) =>
        r.itemName.toLowerCase().includes(term) ||
        r.sku.toLowerCase().includes(term) ||
        r.categoryName.toLowerCase().includes(term),
    );
  }, [stock.data, debounced]);

  const totals = stock.data?.totals;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <StatTile
          label="Stock value"
          value={totals ? formatPaise(totals.valuePaise) : "—"}
          sub="quantity × average cost"
        />
        <StatTile label="Items stocked" value={stock.data?.rows.length ?? "—"} />
        <StatTile
          label="Below reorder"
          value={totals?.belowReorder ?? "—"}
          tone={totals && totals.belowReorder > 0 ? "warn" : "neutral"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={`${FIELD_CLASS} w-full pl-8`}
            placeholder="Filter items"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={`${FIELD_CLASS} w-[170px]`}
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">All locations</option>
          {boot.locations
            .filter((l) => l.isActive)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
          />
          Below reorder only
        </label>
        <Button variant="outline" size="sm" onClick={() => stock.reload()}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      <InvAlert
        error={stock.error || saver.error}
        notice={saver.notice}
        onDismiss={() => {
          saver.setError("");
          saver.setNotice("");
        }}
      />

      {stock.loading ? (
        <InvSpinner label="Loading stock" />
      ) : stock.error ? null : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {lowOnly
            ? "Nothing is below its reorder level."
            : "No stock to show yet."}
        </div>
      ) : (
        <ErpTableShell density="compact" className="overflow-x-auto">
          <ErpTable minWidth="min-w-[900px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-left font-medium">Category</th>
                <th className="px-3 py-2 text-right font-medium">On hand</th>
                <th className="px-3 py-2 text-right font-medium">Avg cost</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {rows.map((r) => (
                <tr key={r.itemId}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.itemName}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {r.sku}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.categoryName || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span
                      className={
                        r.belowReorder ? "font-semibold text-amber-600" : ""
                      }
                    >
                      {formatQty(r.qtyOnHand)}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      {r.uomName}
                    </span>
                    {r.belowReorder ? (
                      <div className="text-[11px] text-amber-600">
                        reorder at {formatQty(r.reorderLevel)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {r.avgCostPaise ? formatPaise(r.avgCostPaise) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatPaise(r.valuePaise)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button variant="ghost" size="xs" onClick={() => setCard(r)}>
                      History
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setTransfer(r)}
                    >
                      Move
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => setCount(r)}>
                      Count
                    </Button>
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}

      <StockCardDrawer item={card} onClose={() => setCard(null)} />
      <TransferDrawer
        item={transfer}
        boot={boot}
        onClose={() => setTransfer(null)}
        onDone={(msg) => {
          saver.setNotice(msg);
          setTransfer(null);
          stock.reload();
        }}
      />
      <CountDrawer
        item={count}
        boot={boot}
        onClose={() => setCount(null)}
        onDone={(msg) => {
          saver.setNotice(msg);
          setCount(null);
          stock.reload();
        }}
      />
    </div>
  );
}

/* ─── Stock card ───────────────────────────────────────────── */

type LedgerRow = {
  id: string;
  at: string;
  kind: string;
  qtyDelta: number;
  unitCostPaise: number;
  refNo: string;
  note: string;
  createdBy: string;
  balance: number;
  locationName: string;
};

const MOVE_LABEL: Record<string, string> = {
  opening: "Opening stock",
  purchase_in: "Received",
  purchase_return_out: "Returned to vendor",
  sale_out: "Sold",
  sale_return_in: "Taken back",
  transfer_out: "Moved out",
  transfer_in: "Moved in",
  adjust_in: "Count up",
  adjust_out: "Count down",
  consumption: "Consumed",
  production: "Produced",
};

function StockCardDrawer({
  item,
  onClose,
}: {
  item: InvStockReportRowData | null;
  onClose: () => void;
}) {
  const card = useAsync(
    () =>
      item
        ? invApi.stockCard(item.itemId)
        : Promise.resolve({ rows: [], qtyOnHand: 0 }),
    [item?.itemId],
  );

  const rows = (card.data?.rows ?? []) as unknown as LedgerRow[];

  return (
    <InvDrawer
      open={!!item}
      wide
      title="Stock history"
      subtitle={item ? `${item.itemName} · ${item.sku}` : ""}
      onClose={onClose}
    >
      {card.loading ? (
        <InvSpinner label="Loading history" />
      ) : card.error ? (
        <InvAlert error={card.error} />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No movements recorded for this item yet.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Every change to this item&rsquo;s quantity, oldest first. The balance
            column is the running total — it is where the on-hand figure comes
            from.
          </p>
          <ErpTableShell density="compact" className="overflow-x-auto">
            <ErpTable minWidth="min-w-[640px]">
              <ErpTableHead>
                <tr>
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">What</th>
                  <th className="px-3 py-2 text-right font-medium">Change</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                  <th className="px-3 py-2 text-left font-medium">Reference</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {String(r.at).slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{MOVE_LABEL[r.kind] ?? r.kind}</div>
                      {r.locationName ? (
                        <div className="text-[11px] text-muted-foreground">
                          {r.locationName}
                        </div>
                      ) : null}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        r.qtyDelta < 0 ? "text-destructive" : "text-emerald-600"
                      }`}
                    >
                      {r.qtyDelta > 0 ? "+" : ""}
                      {formatQty(r.qtyDelta)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatQty(r.balance)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-mono">{r.refNo || "—"}</div>
                      {r.note ? (
                        <div className="text-[11px] text-muted-foreground">
                          {r.note}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </ErpTableShell>
        </div>
      )}
    </InvDrawer>
  );
}

/* ─── Transfer ─────────────────────────────────────────────── */

function TransferDrawer({
  item,
  boot,
  onClose,
  onDone,
}: {
  item: InvStockReportRowData | null;
  boot: InvBootstrap;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const saver = useSaver();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [qty, setQty] = useState("");
  const [movedOn, setMovedOn] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState("");

  const options = boot.locations
    .filter((l) => l.isActive)
    .map((l) => ({ value: l.id, label: l.name }));

  async function submit() {
    if (!item || !fromId || !toId) return;
    const res = await saver.run(() =>
      invApi.transferStock({
        itemId: item.itemId,
        fromLocationId: fromId,
        toLocationId: toId,
        qty: Number(qty) || 0,
        at: movedOn || undefined,
        note,
      }),
    );
    if (res) {
      onDone(`Moved ${formatQty(res.qty)} of ${item.itemName}`);
      setFromId("");
      setToId("");
      setQty("");
      setNote("");
    }
  }

  return (
    <InvDrawer
      open={!!item}
      title="Move stock"
      subtitle={item ? `${item.itemName} · ${formatQty(item.qtyOnHand)} on hand` : ""}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={saver.saving || !fromId || !toId || !(Number(qty) > 0)}
          >
            <ArrowRightLeft className="size-4" />
            {saver.saving ? "Moving…" : "Move"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <InvAlert error={saver.error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="From"
            required
            value={fromId}
            options={options}
            onChange={setFromId}
          />
          <SelectField
            label="To"
            required
            value={toId}
            options={options.filter((o) => o.value !== fromId)}
            onChange={setToId}
          />
        </div>
        <NumberField label="Quantity" value={qty} onChange={setQty} />
        <TextField
          label="Moved on"
          type="date"
          value={movedOn}
          onChange={setMovedOn}
        />
        <TextField label="Note" value={note} onChange={setNote} />
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
          A move is recorded as two ledger entries — out of one location, into
          the other — so the total on hand does not change.
        </p>
      </div>
    </InvDrawer>
  );
}

/* ─── Physical count ───────────────────────────────────────── */

function CountDrawer({
  item,
  boot,
  onClose,
  onDone,
}: {
  item: InvStockReportRowData | null;
  boot: InvBootstrap;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const saver = useSaver();
  const [locationId, setLocationId] = useState(
    boot.settings.defaultLocationId || boot.locations[0]?.id || "",
  );
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [countedOn, setCountedOn] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const delta =
    item && counted !== "" ? (Number(counted) || 0) - item.qtyOnHand : 0;

  async function submit() {
    if (!item || !reason.trim() || counted === "") return;
    const res = await saver.run(() =>
      invApi.adjustStock({
        itemId: item.itemId,
        locationId,
        countedQty: Number(counted) || 0,
        reason: reason.trim(),
        at: countedOn || undefined,
      }),
    );
    if (res) {
      onDone(
        res.delta === 0
          ? `${item.itemName} counted — no change`
          : `${item.itemName} adjusted by ${res.delta > 0 ? "+" : ""}${formatQty(res.delta)}`,
      );
      setCounted("");
      setReason("");
    }
  }

  return (
    <InvDrawer
      open={!!item}
      title="Physical count"
      subtitle={item ? `${item.itemName} · system says ${formatQty(item.qtyOnHand)}` : ""}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={saver.saving || !reason.trim() || counted === ""}
          >
            <ClipboardCheck className="size-4" />
            {saver.saving ? "Saving…" : "Record count"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <InvAlert error={saver.error} />
        <SelectField
          label="Location counted"
          value={locationId}
          options={boot.locations
            .filter((l) => l.isActive)
            .map((l) => ({ value: l.id, label: l.name }))}
          onChange={setLocationId}
        />
        <NumberField
          label="Counted quantity"
          value={counted}
          onChange={setCounted}
        />
        <TextField
          label="Counted on"
          type="date"
          value={countedOn}
          onChange={setCountedOn}
        />
        {counted !== "" && delta !== 0 ? (
          <p
            className={`text-xs ${delta < 0 ? "text-destructive" : "text-emerald-600"}`}
          >
            {delta > 0 ? "+" : ""}
            {formatQty(delta)} will be recorded as an adjustment.
          </p>
        ) : null}
        <TextField
          label="Reason"
          required
          hint="Recorded on the ledger entry so the change explains itself"
          value={reason}
          onChange={setReason}
          placeholder="e.g. Annual physical count"
        />
      </div>
    </InvDrawer>
  );
}
