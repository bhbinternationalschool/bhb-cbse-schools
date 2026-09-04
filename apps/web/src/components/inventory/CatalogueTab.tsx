"use client";

/**
 * Catalogue — items with their cost, price, margin and stock in one table.
 *
 * The answer to "how do I define purchase price and sell at market price" is
 * this screen: `Cost` is what the school pays (weighted average of receipts,
 * seeded by opening stock), `Sale` is what the counter charges from the
 * selected price list, and `Margin` is the difference, shown per row so a
 * price set below cost is visible rather than discovered at year end.
 *
 * Filtering and paging happen on the server. Typing in the search box updates
 * local state only; one debounced request runs after you stop.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
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
  TextField,
} from "@/components/inventory/InvUi";
import { invApi, useDebounced, useInvItems, useSaver } from "@/lib/inventory/client";
import {
  formatPaise,
  formatQty,
  inputToPaise,
  marginPct,
  paiseToInput,
  type InvBootstrap,
  type InvItem,
  type InvItemQuery,
  type InvItemRow,
} from "@/lib/inventory/types";

type Draft = Partial<InvItem> & {
  salePriceInput?: string;
  mrpInput?: string;
  maxDiscountInput?: string;
  openingQtyInput?: string;
  openingCostInput?: string;
  openingDateInput?: string;
  openingLocationId?: string;
};

/* ─── Import a sheet ───────────────────────────────────────── */

const IMPORT_COLUMNS = [
  "sku",
  "name",
  "category",
  "uom",
  "hsn",
  "gst",
  "mrp",
  "sale",
  "maxdisc",
  "reorder",
] as const;

const IMPORT_SAMPLE = [
  "sku\tname\tcategory\tuom\thsn\tgst\tmrp\tsale\tmaxdisc\treorder",
  "ENG-6\tEnglish Reader 6\tBooks\tNos\t4901\t5\t320\t300\t10\t20",
  "UNI-SH-M\tShirt Medium\tUniform\tNos\t6205\t5\t450\t450\t0\t15",
].join("\n");

type ParsedRow = {
  sku: string;
  name: string;
  category: string;
  uom: string;
  hsnCode: string;
  gstRate: number;
  mrpPaise: number;
  salePaise: number;
  maxDiscountPct: number;
  reorderLevel: number;
};

const toPaise = (v: string): number => {
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const toNum = (v: string): number => {
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Turn pasted text into rows.
 *
 * Tab-separated because that is what a spreadsheet puts on the clipboard;
 * commas are accepted as a fallback for a saved CSV. A header line is used
 * when present so column ORDER does not have to match, which is the difference
 * between "paste your sheet" and "rebuild your sheet to our layout".
 */
function parseSheet(text: string): { rows: ParsedRow[]; problem: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: [], problem: "" };

  const split = (l: string) => (l.includes("\t") ? l.split("\t") : l.split(","));
  const first = split(lines[0]!).map((c) => c.trim().toLowerCase());
  const hasHeader = first.includes("sku") || first.includes("name");

  let order: string[] = [...IMPORT_COLUMNS];
  let body = lines;
  if (hasHeader) {
    order = first;
    body = lines.slice(1);
  }
  const at = (cells: string[], key: string): string => {
    const i = order.indexOf(key);
    return i >= 0 && i < cells.length ? cells[i]!.trim() : "";
  };

  if (!order.includes("name")) {
    return { rows: [], problem: 'The sheet needs a "name" column.' };
  }

  const rows = body.map((line) => {
    const c = split(line);
    return {
      sku: at(c, "sku"),
      name: at(c, "name"),
      category: at(c, "category"),
      uom: at(c, "uom"),
      hsnCode: at(c, "hsn"),
      gstRate: toNum(at(c, "gst")),
      mrpPaise: toPaise(at(c, "mrp")),
      salePaise: toPaise(at(c, "sale")),
      maxDiscountPct: toNum(at(c, "maxdisc")),
      reorderLevel: toNum(at(c, "reorder")),
    };
  });
  return { rows, problem: "" };
}

type ImportResult = Awaited<ReturnType<typeof invApi.importItems>>;

function ImportSheet({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => parseSheet(text), [text]);

  // Any edit invalidates a preview: confirming a result that describes
  // different text is how the wrong thing gets imported.
  useEffect(() => {
    setPreview(null);
  }, [text]);

  async function run(dryRun: boolean) {
    if (parsed.problem) {
      setError(parsed.problem);
      return;
    }
    if (parsed.rows.length === 0) {
      setError("Nothing to import yet — paste your sheet above.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await invApi.importItems({ rows: parsed.rows, dryRun });
      setPreview(res);
      if (res.applied) {
        setText("");
        onDone();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const bad = (preview?.rows ?? []).filter((r) => r.action === "error");

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Copy the rows straight out of your supplier&rsquo;s quotation or last
        year&rsquo;s sheet and paste them here. A header row is used if there is
        one, so the column order does not have to match. Prices are in rupees.
      </p>

      <textarea
        className={`${FIELD_CLASS} h-48 w-full font-mono text-xs`}
        placeholder={IMPORT_SAMPLE}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || parsed.rows.length === 0}
          onClick={() => void run(true)}
        >
          Check {parsed.rows.length > 0 ? `${parsed.rows.length} rows` : ""}
        </Button>
        <Button
          size="sm"
          disabled={busy || !preview || !preview.ok || preview.applied}
          onClick={() => void run(false)}
        >
          Import
        </Button>
        {parsed.rows.length > 0 && !preview ? (
          <span className="text-xs text-muted-foreground">
            Check the sheet first — nothing is written until you do.
          </span>
        ) : null}
      </div>

      <InvAlert error={error} />

      {preview ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill tone="good">{preview.summary.create} new</Pill>
            <Pill tone="neutral">{preview.summary.update} updated</Pill>
            {preview.summary.error > 0 ? (
              <Pill tone="bad">{preview.summary.error} to fix</Pill>
            ) : null}
          </div>

          {preview.applied ? (
            <p className="rounded-lg border border-[var(--success)] bg-[var(--success-soft)] px-3 py-2 text-xs text-[var(--success)]">
              Imported. {preview.summary.create} item(s) created,{" "}
              {preview.summary.update} updated.
            </p>
          ) : preview.ok ? (
            <p className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
              Nothing has been written yet. Press Import to apply exactly what
              is listed above.
            </p>
          ) : (
            <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
              <p className="font-semibold">{preview.error}</p>
              <p className="mt-1 opacity-90">
                Nothing was imported. Fix these rows and check again — the whole
                sheet goes in together, so you never have to work out which half
                landed.
              </p>
              <ul className="mt-2 space-y-0.5">
                {bad.slice(0, 25).map((r) => (
                  <li key={r.row}>
                    Row {r.row}
                    {r.sku ? ` (${r.sku})` : ""}: {r.error}
                  </li>
                ))}
              </ul>
              {bad.length > 25 ? (
                <p className="mt-1">…and {bad.length - 25} more.</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function CatalogueTab({
  boot,
  onChanged,
}: {
  boot: InvBootstrap;
  onChanged?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [priceListId, setPriceListId] = useState(
    boot.settings.defaultPriceListId ||
      boot.priceLists.find((l) => l.isDefault)?.id ||
      boot.priceLists[0]?.id ||
      "",
  );
  const [sort, setSort] = useState<NonNullable<InvItemQuery["sort"]>>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const debounced = useDebounced(search, 300);

  // Any filter change returns to page one; staying on page 7 of a two-page
  // result silently shows an empty table.
  useEffect(() => {
    setPage(1);
  }, [debounced, categoryId, status, lowStockOnly, priceListId]);

  const query: InvItemQuery = useMemo(
    () => ({
      search: debounced,
      categoryId,
      status,
      lowStockOnly,
      priceListId,
      page,
      pageSize: 50,
      sort,
      sortDir,
    }),
    [debounced, categoryId, status, lowStockOnly, priceListId, page, sort, sortDir],
  );

  const items = useInvItems(query);
  const saver = useSaver();
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const categoryOptions = boot.categories
    .filter((c) => c.isActive)
    .map((c) => ({ value: c.id, label: c.name }));
  const uomOptions = boot.uoms
    .filter((u) => u.isActive)
    .map((u) => ({ value: u.id, label: u.name }));
  const vendorOptions = boot.vendors
    .filter((v) => v.isActive)
    .map((v) => ({ value: v.id, label: v.name }));
  const locationOptions = boot.locations
    .filter((l) => l.isActive)
    .map((l) => ({ value: l.id, label: l.name }));

  function openNew() {
    setDraft({
      name: "",
      sku: "",
      itemKind: "consumable",
      categoryId: boot.categories[0]?.id ?? "",
      uomId: boot.uoms[0]?.id ?? "",
      gstRate: 0,
      reorderLevel: 0,
      isActive: true,
      salePriceInput: "",
      mrpInput: "",
      maxDiscountInput: "",
      openingQtyInput: "",
      openingCostInput: "",
      openingLocationId:
        boot.settings.defaultLocationId || boot.locations[0]?.id || "",
    });
  }

  function openEdit(row: InvItemRow) {
    setDraft({
      ...row,
      salePriceInput: paiseToInput(row.salePaise),
      mrpInput: paiseToInput(row.mrpPaise),
      maxDiscountInput: row.maxDiscountPct ? String(row.maxDiscountPct) : "",
      openingQtyInput: "",
      openingCostInput: "",
      openingLocationId:
        boot.settings.defaultLocationId || boot.locations[0]?.id || "",
    });
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  /**
   * Save the item, then its price, then any opening stock.
   *
   * These are three separate writes because they are three separate records.
   * The item save must land first — the other two need its id — and a failure
   * in any step surfaces rather than being reported as a clean save.
   */
  async function save() {
    if (!draft?.name) return;
    const result = await saver.run(async () => {
      const item = await invApi.saveItem({
        id: draft.id,
        sku: draft.sku,
        name: draft.name,
        categoryId: draft.categoryId,
        uomId: draft.uomId,
        itemKind: draft.itemKind,
        variantLabel: draft.variantLabel,
        hsnCode: draft.hsnCode,
        gstRate: draft.gstRate,
        reorderLevel: draft.reorderLevel,
        defaultVendorId: draft.defaultVendorId,
        barcode: draft.barcode,
        notes: draft.notes,
        isActive: draft.isActive,
      });

      const salePaise = inputToPaise(draft.salePriceInput ?? "");
      const mrpPaise = inputToPaise(draft.mrpInput ?? "");
      if (priceListId && (salePaise > 0 || mrpPaise > 0)) {
        await invApi.savePrices(priceListId, [
          {
            itemId: item.id,
            salePaise,
            mrpPaise,
            maxDiscountPct: Number(draft.maxDiscountInput) || 0,
          },
        ]);
      }

      const openingQty = Number(draft.openingQtyInput);
      if (Number.isFinite(openingQty) && openingQty > 0 && draft.openingLocationId) {
        await invApi.setOpeningStock({
          itemId: item.id,
          locationId: draft.openingLocationId,
          qty: openingQty,
          unitCostPaise: inputToPaise(draft.openingCostInput ?? ""),
          at: draft.openingDateInput || undefined,
          note: "Opening stock entered from catalogue",
        });
      }
      return item;
    }, { success: `Saved ${draft.name}` });

    if (result) {
      setDraft(null);
      items.reload();
      onChanged?.();
    }
  }

  async function remove() {
    if (!draft?.id) return;
    const res = await saver.run(() => invApi.removeItem(draft.id as string));
    if (res) {
      saver.setNotice(res.reason);
      setDraft(null);
      items.reload();
      onChanged?.();
    }
  }

  function toggleSort(next: NonNullable<InvItemQuery["sort"]>) {
    if (sort === next) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(next);
      setSortDir(next === "margin" || next === "stock" ? "asc" : "asc");
    }
  }

  const rows = items.data?.rows ?? [];
  const total = items.data?.total ?? 0;
  const pageSize = items.data?.pageSize ?? 50;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  const draftMargin = useMemo(() => {
    if (!draft) return null;
    const sale = inputToPaise(draft.salePriceInput ?? "");
    if (!sale) return null;
    const cost =
      inputToPaise(draft.openingCostInput ?? "") || draft.avgCostPaise || 0;
    if (!cost) return null;
    return { sale, cost, diff: sale - cost, pct: marginPct(sale, cost) };
  }, [draft]);

  const sortLabel = (key: NonNullable<InvItemQuery["sort"]>, label: string) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      onClick={() => toggleSort(key)}
    >
      {label}
      {sort === key ? <span>{sortDir === "asc" ? "▲" : "▼"}</span> : null}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={`${FIELD_CLASS} w-full pl-8`}
            placeholder="Search item, SKU, size or barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={`${FIELD_CLASS} w-[150px]`}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">All categories</option>
          {categoryOptions.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className={`${FIELD_CLASS} w-[180px]`}
          value={priceListId}
          onChange={(e) => setPriceListId(e.target.value)}
          title="Prices shown are from this price list"
        >
          {boot.priceLists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
        <select
          className={`${FIELD_CLASS} w-[130px]`}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="all">All</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => setLowStockOnly(e.target.checked)}
          />
          Low stock
        </label>
        <Button variant="outline" size="sm" onClick={() => items.reload()}>
          <RefreshCw className="size-3.5" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
          <Upload className="size-3.5" />
          Import sheet
        </Button>
        <Button size="sm" onClick={openNew}>
          <Plus className="size-4" />
          New item
        </Button>
      </div>

      <InvAlert
        error={items.error || saver.error}
        notice={saver.notice}
        onDismiss={() => {
          saver.setError("");
          saver.setNotice("");
        }}
      />

      {items.loading && rows.length === 0 ? (
        <InvSpinner label="Loading catalogue" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center">
          <p className="text-sm font-medium">
            {search || categoryId || lowStockOnly
              ? "Nothing matches these filters"
              : "The catalogue is empty"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add the books, uniform and stationery the school sells or issues.
          </p>
          <Button className="mt-3" size="sm" onClick={openNew}>
            <Plus className="size-4" />
            Add the first item
          </Button>
        </div>
      ) : (
        <ErpTableShell density="compact" className="overflow-x-auto">
          <ErpTable minWidth="min-w-[980px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left">{sortLabel("sku", "SKU")}</th>
                <th className="px-3 py-2 text-left">{sortLabel("name", "Item")}</th>
                <th className="px-3 py-2 text-left font-medium">Category</th>
                <th className="px-3 py-2 text-right">
                  {sortLabel("stock", "Stock")}
                </th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Sale</th>
                <th className="px-3 py-2 text-right">
                  {sortLabel("margin", "Margin")}
                </th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {rows.map((r) => {
                const low = r.reorderLevel > 0 && r.qtyOnHand <= r.reorderLevel;
                const belowCost = r.salePaise > 0 && r.marginPaise < 0;
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {r.sku}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        {r.variantLabel ? (
                          <Pill tone="info">{r.variantLabel}</Pill>
                        ) : null}
                        {r.itemKind === "asset" ? <Pill>asset</Pill> : null}
                        {!r.isActive ? <Pill tone="warn">inactive</Pill> : null}
                      </div>
                      {r.defaultVendorName ? (
                        <div className="text-xs text-muted-foreground">
                          {r.defaultVendorName}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.categoryName || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={low ? "font-semibold text-amber-600" : ""}>
                        {formatQty(r.qtyOnHand, r.uomDecimals)}
                      </span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        {r.uomName}
                      </span>
                      {low ? (
                        <div className="text-[11px] text-amber-600">
                          reorder at {formatQty(r.reorderLevel, r.uomDecimals)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {r.avgCostPaise ? formatPaise(r.avgCostPaise) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.salePaise ? (
                        formatPaise(r.salePaise)
                      ) : (
                        <span className="text-xs text-amber-600">not priced</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.salePaise && r.avgCostPaise ? (
                        <span
                          className={
                            belowCost
                              ? "font-semibold text-destructive"
                              : "text-emerald-600 dark:text-emerald-400"
                          }
                        >
                          {formatPaise(r.marginPaise)}
                          <span className="ml-1 text-[11px]">
                            ({marginPct(r.salePaise, r.avgCostPaise)}%)
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="xs" onClick={() => openEdit(r)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}

      {total > pageSize ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="xs"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="px-2">
              {page} / {lastPage}
            </span>
            <Button
              variant="outline"
              size="xs"
              disabled={page >= lastPage}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : total > 0 ? (
        <p className="text-xs text-muted-foreground">
          {total} item{total === 1 ? "" : "s"}.
        </p>
      ) : null}

      <InvDrawer
        open={importing}
        wide
        title="Import items from a sheet"
        subtitle="Checked before anything is written; re-importing the same sheet updates rather than duplicates"
        onClose={() => setImporting(false)}
      >
        <ImportSheet
          onDone={() => {
            items.reload();
          }}
        />
      </InvDrawer>

      <InvDrawer
        open={!!draft}
        wide
        title={draft?.id ? "Edit item" : "New item"}
        subtitle={
          draft?.id
            ? `${draft.sku} · cost is maintained by goods receipts`
            : "Cost comes from purchases; set the sale price here"
        }
        onClose={() => setDraft(null)}
        footer={
          <>
            {draft?.id ? (
              <Button
                variant="ghost"
                size="sm"
                className="mr-auto text-destructive"
                disabled={saver.saving}
                onClick={remove}
              >
                Delete
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saver.saving || !draft?.name}>
              {saver.saving ? "Saving…" : "Save item"}
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <InvAlert error={saver.error} />

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Item name"
                required
                className="sm:col-span-2"
                value={draft.name ?? ""}
                onChange={(v) => set("name", v)}
                placeholder="e.g. English Reader — Class 6"
              />
              <TextField
                label="SKU"
                hint={draft.id ? undefined : "Left blank, one is generated"}
                value={draft.sku ?? ""}
                onChange={(v) => set("sku", v)}
              />
              <TextField
                label="Size / variant"
                hint="e.g. 32, Small, Class 6"
                value={draft.variantLabel ?? ""}
                onChange={(v) => set("variantLabel", v)}
              />
              <SelectField
                label="Category"
                value={draft.categoryId ?? ""}
                options={categoryOptions}
                onChange={(v) => set("categoryId", v)}
              />
              <SelectField
                label="Unit"
                value={draft.uomId ?? ""}
                options={uomOptions}
                onChange={(v) => set("uomId", v)}
              />
              <SelectField
                label="Type"
                value={draft.itemKind ?? "consumable"}
                placeholder="Consumable"
                options={[
                  { value: "consumable", label: "Consumable — sold or issued" },
                  { value: "asset", label: "Asset — tagged and tracked" },
                ]}
                onChange={(v) =>
                  set("itemKind", v === "asset" ? "asset" : "consumable")
                }
              />
              <SelectField
                label="Usual vendor"
                value={draft.defaultVendorId ?? ""}
                options={vendorOptions}
                onChange={(v) => set("defaultVendorId", v)}
              />
            </div>

            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Selling price —{" "}
                {boot.priceLists.find((l) => l.id === priceListId)?.name ??
                  "price list"}
              </legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <MoneyField
                  label="School sale price"
                  hint="What the counter charges"
                  value={draft.salePriceInput ?? ""}
                  onChange={(v) => set("salePriceInput", v)}
                />
                <MoneyField
                  label="MRP"
                  hint="Printed price, if any"
                  value={draft.mrpInput ?? ""}
                  onChange={(v) => set("mrpInput", v)}
                />
                <NumberField
                  label="Max discount"
                  suffix="%"
                  hint="Cap at the counter"
                  value={draft.maxDiscountInput ?? ""}
                  onChange={(v) => set("maxDiscountInput", v)}
                />
              </div>

              <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
                {draft.avgCostPaise ? (
                  <span>
                    Current average cost{" "}
                    <strong>{formatPaise(draft.avgCostPaise)}</strong> — updated by
                    every goods receipt.
                  </span>
                ) : (
                  <span>
                    No cost yet. It is set by the first goods receipt, or by the
                    opening stock cost below.
                  </span>
                )}
                {draftMargin ? (
                  <span
                    className={
                      draftMargin.diff < 0
                        ? "ml-1 font-semibold text-destructive"
                        : "ml-1 font-semibold text-emerald-600 dark:text-emerald-400"
                    }
                  >
                    Margin {formatPaise(draftMargin.diff)} ({draftMargin.pct}%)
                    {draftMargin.diff < 0 ? " — selling below cost" : ""}
                  </span>
                ) : null}
              </div>
            </fieldset>

            {!draft.id ? (
              <fieldset className="space-y-3 rounded-lg border p-3">
                <legend className="px-1 text-xs font-medium text-muted-foreground">
                  Opening stock (optional)
                </legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <NumberField
                    label="Quantity in hand"
                    value={draft.openingQtyInput ?? ""}
                    onChange={(v) => set("openingQtyInput", v)}
                  />
                  <MoneyField
                    label="Cost per unit"
                    hint="Seeds the average cost"
                    value={draft.openingCostInput ?? ""}
                    onChange={(v) => set("openingCostInput", v)}
                  />
                  <SelectField
                    label="Location"
                    value={draft.openingLocationId ?? ""}
                    options={locationOptions}
                    onChange={(v) => set("openingLocationId", v)}
                  />
                  <TextField
                    label="As on date"
                    type="date"
                    hint="Backdate to the session start if this is last year's closing"
                    value={draft.openingDateInput ?? ""}
                    onChange={(v) => set("openingDateInput", v)}
                  />
                </div>
              </fieldset>
            ) : null}

            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Tax & stock control
              </legend>
              <div className="grid gap-3 sm:grid-cols-4">
                <TextField
                  label="HSN code"
                  value={draft.hsnCode ?? ""}
                  onChange={(v) => set("hsnCode", v)}
                />
                <NumberField
                  label="GST"
                  suffix="%"
                  value={String(draft.gstRate ?? 0)}
                  onChange={(v) => set("gstRate", Number(v) || 0)}
                />
                <NumberField
                  label="Reorder level"
                  hint="Warn below this"
                  value={String(draft.reorderLevel ?? 0)}
                  onChange={(v) => set("reorderLevel", Number(v) || 0)}
                />
                <TextField
                  label="Barcode"
                  value={draft.barcode ?? ""}
                  onChange={(v) => set("barcode", v)}
                />
              </div>
              {draft.id ? (
                <SelectField
                  label="Status"
                  className="sm:w-48"
                  value={draft.isActive === false ? "inactive" : "active"}
                  placeholder="Active"
                  options={[
                    { value: "active", label: "Active" },
                    { value: "inactive", label: "Inactive" },
                  ]}
                  onChange={(v) => set("isActive", v !== "inactive")}
                />
              ) : null}
            </fieldset>
          </div>
        ) : null}
      </InvDrawer>
    </div>
  );
}
