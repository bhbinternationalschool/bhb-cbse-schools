"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatInr } from "@/lib/masters";
import {
  adjustStock,
  bulkSetOpeningStock,
  bulkSetSalePrice,
  categoryLabel,
  downloadStoreCatalogTemplate,
  exportStoreCatalogCsv,
  importStoreCatalogCsv,
  listActiveStoreCategories,
  loadStore,
  seedStoreIfEmpty,
  upsertStoreCategory,
  upsertStoreInfraLevel,
  upsertStoreItem,
  upsertStoreSaleGroup,
  upsertStoreSource,
  upsertStoreUom,
  type StoreAudience,
  type StoreCategoryDef,
  type StoreInfraLevel,
  type StoreIssuePolicy,
  type StoreItem,
  type StoreSaleGroup,
  type StoreSource,
  type StoreUom,
} from "@/lib/store";

export type StockMasterScreen =
  | "stock_group"
  | "sale_group"
  | "single_item"
  | "multi_item"
  | "opening_stock"
  | "sale_price"
  | "uom"
  | "infra_level"
  | "production"
  | "consumption"
  | "source"
  | "import_item";

const STOCK_MASTER_MENU: { id: StockMasterScreen; label: string }[] = [
  { id: "stock_group", label: "Stock Group" },
  { id: "sale_group", label: "Sale Group" },
  { id: "single_item", label: "Single Item Creation" },
  { id: "multi_item", label: "Multi Item Creation" },
  { id: "opening_stock", label: "Set Opening Stock" },
  { id: "sale_price", label: "Set Sale Price" },
  { id: "uom", label: "Unit Of Measurement" },
  { id: "infra_level", label: "Infra Level" },
  { id: "production", label: "Production" },
  { id: "consumption", label: "Consumption" },
  { id: "source", label: "Source Master" },
  { id: "import_item", label: "Import Item" },
];

const field =
  "rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1.5 text-sm text-[var(--brand-deep)]";
const card = "rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4";
const btn =
  "rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
const btnOutline =
  "rounded-lg border border-[rgba(32,48,80,0.2)] bg-white px-3 py-1.5 text-sm text-[var(--brand-deep)]";

type CatalogDraft = {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  saleGroupId: string;
  uomId: string;
  sourceId: string;
  infraLevelId: string;
  sizeLabel: string;
  purchasePrice: string;
  salePrice: string;
  stock: string;
  reorder: string;
  issuePolicy: StoreIssuePolicy;
  maxQtyPerAy: string;
  maxDiscountPct: string;
  audience: StoreAudience;
  applicableClassIds: string[];
  barcode: string;
};

type MultiDraft = {
  sku: string;
  name: string;
  categoryId: string;
  purchasePrice: string;
  salePrice: string;
  stock: string;
};

function emptyCatalogDraft(categoryId = ""): CatalogDraft {
  return {
    id: "",
    sku: "",
    name: "",
    categoryId,
    saleGroupId: "",
    uomId: "",
    sourceId: "",
    infraLevelId: "",
    sizeLabel: "",
    purchasePrice: "",
    salePrice: "",
    stock: "0",
    reorder: "0",
    issuePolicy: "once_per_ay",
    maxQtyPerAy: "1",
    maxDiscountPct: "0",
    audience: "student",
    applicableClassIds: [],
    barcode: "",
  };
}

function emptyMultiRow(categoryId = ""): MultiDraft {
  return {
    sku: "",
    name: "",
    categoryId,
    purchasePrice: "",
    salePrice: "",
    stock: "0",
  };
}

function MasterListPanel({
  title,
  hint,
  rows,
  name,
  onName,
  onSave,
  onEdit,
  editId,
  editName,
  onEditName,
  onSaveEdit,
}: {
  title: string;
  hint?: string;
  rows: Array<{ id: string; name: string; meta?: string; isActive?: boolean }>;
  name: string;
  onName: (v: string) => void;
  onSave: () => void;
  onEdit?: (id: string, current: string) => void;
  editId?: string | null;
  editName?: string;
  onEditName?: (v: string) => void;
  onSaveEdit?: () => void;
}) {
  return (
    <div className={card}>
      <h2 className="text-sm font-bold text-[var(--brand-deep)]">{title}</h2>
      {hint ? <p className="mt-1 text-[11px] text-[var(--muted)]">{hint}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className={`${field} min-w-[200px]`}
          placeholder="Name"
          value={name}
          onChange={(e) => onName(e.target.value)}
        />
        <button type="button" className={btn} onClick={onSave}>
          Save
        </button>
      </div>
      <ul className="mt-3 divide-y text-sm">
        {rows.map((r) => (
          <li
            key={r.id}
            className={`flex flex-wrap items-center gap-2 py-2 ${
              r.isActive === false ? "opacity-50" : ""
            }`}
          >
            {editId === r.id ? (
              <>
                <input
                  className={`${field} min-w-[180px]`}
                  value={editName ?? ""}
                  onChange={(e) => onEditName?.(e.target.value)}
                />
                <button type="button" className={btnOutline} onClick={onSaveEdit}>
                  Update
                </button>
              </>
            ) : (
              <>
                <span className="font-semibold text-[var(--brand-deep)]">
                  {r.name}
                </span>
                {r.meta ? (
                  <span className="text-[10px] text-[var(--muted)]">{r.meta}</span>
                ) : null}
                {onEdit ? (
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[var(--brand-deep)]"
                    onClick={() => onEdit(r.id, r.name)}
                  >
                    Rename
                  </button>
                ) : null}
              </>
            )}
          </li>
        ))}
        {!rows.length ? (
          <li className="py-3 text-[var(--muted)]">No entries yet.</li>
        ) : null}
      </ul>
    </div>
  );
}

export function StockMasterWorkspace() {
  const [screen, setScreen] = useState<StockMasterScreen>("stock_group");
  const [menuOpen, setMenuOpen] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  const [categories, setCategories] = useState<StoreCategoryDef[]>([]);
  const [saleGroups, setSaleGroups] = useState<StoreSaleGroup[]>([]);
  const [uoms, setUoms] = useState<StoreUom[]>([]);
  const [infraLevels, setInfraLevels] = useState<StoreInfraLevel[]>([]);
  const [sources, setSources] = useState<StoreSource[]>([]);
  const [allItems, setAllItems] = useState<StoreItem[]>([]);
  const [items, setItems] = useState<StoreItem[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [catEditId, setCatEditId] = useState<string | null>(null);
  const [catEditName, setCatEditName] = useState("");

  const [newSaleGroupName, setNewSaleGroupName] = useState("");
  const [saleEditId, setSaleEditId] = useState<string | null>(null);
  const [saleEditName, setSaleEditName] = useState("");

  const [newUomName, setNewUomName] = useState("");
  const [uomEditId, setUomEditId] = useState<string | null>(null);
  const [uomEditName, setUomEditName] = useState("");

  const [newInfraName, setNewInfraName] = useState("");
  const [infraEditId, setInfraEditId] = useState<string | null>(null);
  const [infraEditName, setInfraEditName] = useState("");

  const [newSourceName, setNewSourceName] = useState("");
  const [newSourcePhone, setNewSourcePhone] = useState("");
  const [sourceEditId, setSourceEditId] = useState<string | null>(null);
  const [sourceEditName, setSourceEditName] = useState("");
  const [sourceEditPhone, setSourceEditPhone] = useState("");

  const [catalogDraft, setCatalogDraft] = useState<CatalogDraft>(
    emptyCatalogDraft(),
  );
  const [multiRows, setMultiRows] = useState<MultiDraft[]>([emptyMultiRow()]);

  const [openingDraft, setOpeningDraft] = useState<Record<string, string>>({});
  const [salePriceDraft, setSalePriceDraft] = useState<Record<string, string>>({});

  const [prodItemId, setProdItemId] = useState("");
  const [prodQty, setProdQty] = useState("");
  const [prodNote, setProdNote] = useState("");
  const [consItemId, setConsItemId] = useState("");
  const [consQty, setConsQty] = useState("");
  const [consNote, setConsNote] = useState("");

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function refresh() {
    seedStoreIfEmpty();
    const store = loadStore();
    setCategories(store.categories);
    setSaleGroups(store.saleGroups);
    setUoms(store.uoms);
    setInfraLevels(store.infraLevels);
    setSources(store.sources);
    setAllItems(store.items);
    setItems(store.items.filter((i) => i.isActive));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const activeScreenLabel =
    STOCK_MASTER_MENU.find((m) => m.id === screen)?.label ?? "Stock Master";

  function saveCatalog() {
    const purchase = Math.round(
      Number(catalogDraft.purchasePrice || "0") * 100,
    );
    const sale = Math.round(Number(catalogDraft.salePrice || "0") * 100);
    const stock = Math.floor(Number(catalogDraft.stock || "0") || 0);
    if (!catalogDraft.categoryId) {
      setError("Pick a stock group");
      return;
    }
    const r = upsertStoreItem({
      id: catalogDraft.id || undefined,
      sku: catalogDraft.sku,
      name: catalogDraft.name,
      categoryId: catalogDraft.categoryId,
      saleGroupId: catalogDraft.saleGroupId || undefined,
      uomId: catalogDraft.uomId || undefined,
      sourceId: catalogDraft.sourceId || undefined,
      infraLevelId: catalogDraft.infraLevelId || undefined,
      sizeLabel: catalogDraft.sizeLabel,
      purchasePricePaise: purchase,
      salePricePaise: sale,
      unitPricePaise: sale,
      openingQty: catalogDraft.id ? undefined : stock,
      stockOnHand: catalogDraft.id ? undefined : stock,
      reorderLevel: Math.floor(Number(catalogDraft.reorder || "0") || 0),
      issuePolicy: catalogDraft.issuePolicy,
      maxQtyPerAy: Math.floor(Number(catalogDraft.maxQtyPerAy || "1") || 1),
      maxDiscountPct: Math.min(
        100,
        Math.max(0, Math.round(Number(catalogDraft.maxDiscountPct || "0") || 0)),
      ),
      audience: catalogDraft.audience,
      applicableClassIds: catalogDraft.applicableClassIds,
      barcode: catalogDraft.barcode,
      isActive: true,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setCatalogDraft(emptyCatalogDraft(catalogDraft.categoryId));
    refresh();
    flash(catalogDraft.id ? `Updated ${r.item.sku}` : `Added ${r.item.sku}`);
  }

  function saveMultiItems() {
    const rows = multiRows.filter((r) => r.sku.trim() && r.name.trim());
    if (!rows.length) {
      setError("Add at least one row with SKU and name");
      return;
    }
    let added = 0;
    for (const row of rows) {
      const r = upsertStoreItem({
        sku: row.sku,
        name: row.name,
        categoryId: row.categoryId || catalogDraft.categoryId,
        purchasePricePaise: Math.round(Number(row.purchasePrice || "0") * 100),
        salePricePaise: Math.round(Number(row.salePrice || "0") * 100),
        openingQty: Math.floor(Number(row.stock || "0") || 0),
        stockOnHand: Math.floor(Number(row.stock || "0") || 0),
        isActive: true,
      });
      if (r.ok) added += 1;
    }
    if (!added) {
      setError("Could not save any rows — check stock group");
      return;
    }
    setMultiRows([emptyMultiRow(catalogDraft.categoryId)]);
    refresh();
    flash(`Saved ${added} item(s)`);
  }

  function postStockMove(
    itemId: string,
    qtyRaw: string,
    kind: "production" | "consumption",
    note: string,
  ) {
    const qty = Math.abs(Math.floor(Number(qtyRaw) || 0));
    if (!itemId || !qty) {
      setError("Pick item and quantity");
      return;
    }
    const qtyDelta = kind === "production" ? qty : -qty;
    const r = adjustStock({
      itemId,
      qtyDelta,
      kind,
      note,
      by: "Stock Master",
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (kind === "production") {
      setProdQty("");
      setProdNote("");
    } else {
      setConsQty("");
      setConsNote("");
    }
    refresh();
    flash(`${kind === "production" ? "Production" : "Consumption"} posted`);
  }

  return (
    <div className="mt-4">
      {error ? (
        <p className="mb-3 rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-3 rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div ref={menuRef} className="relative shrink-0 lg:w-56">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg border-2 border-[var(--brand-deep)] bg-white px-3 py-2 text-sm font-bold text-[#1d4ed8]"
            onClick={() => setMenuOpen((o) => !o)}
          >
            Stock Master
            <span className="text-[10px]">{menuOpen ? "▲" : "▼"}</span>
          </button>
          {menuOpen ? (
            <ul className="absolute z-20 mt-0 w-full border border-[rgba(32,48,80,0.2)] bg-white shadow-lg lg:static lg:mt-1 lg:shadow-none">
              {STOCK_MASTER_MENU.map((m, idx) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={`block w-full px-3 py-2.5 text-left text-sm ${
                      screen === m.id
                        ? "bg-[rgba(29,78,216,0.08)] font-semibold text-[#1d4ed8]"
                        : "text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.04)]"
                    } ${idx > 0 ? "border-t border-[rgba(32,48,80,0.12)]" : ""}`}
                    onClick={() => {
                      setScreen(m.id);
                      setMenuOpen(false);
                      setError(null);
                    }}
                  >
                    {m.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <h2 className="text-base font-bold text-[var(--brand-deep)]">
            {activeScreenLabel}
          </h2>

          {screen === "stock_group" ? (
            <MasterListPanel
              title="Stock Group"
              hint="Inventory classification — books, uniform, stationery, etc."
              rows={categories.map((c) => ({
                id: c.id,
                name: c.name,
                meta: `${allItems.filter((i) => i.categoryId === c.id).length} item(s)`,
                isActive: c.isActive,
              }))}
              name={newCategoryName}
              onName={setNewCategoryName}
              onSave={() => {
                const r = upsertStoreCategory({ name: newCategoryName });
                if (!r.ok) return setError(r.error);
                setNewCategoryName("");
                refresh();
                flash(`Stock group “${r.category.name}” saved`);
              }}
              editId={catEditId}
              editName={catEditName}
              onEdit={(id, current) => {
                setCatEditId(id);
                setCatEditName(current);
              }}
              onEditName={setCatEditName}
              onSaveEdit={() => {
                if (!catEditId) return;
                const r = upsertStoreCategory({
                  id: catEditId,
                  name: catEditName,
                });
                if (!r.ok) return setError(r.error);
                setCatEditId(null);
                refresh();
                flash("Stock group renamed");
              }}
            />
          ) : null}

          {screen === "sale_group" ? (
            <MasterListPanel
              title="Sale Group"
              hint="Counter / POS grouping for sale screens."
              rows={saleGroups.map((c) => ({
                id: c.id,
                name: c.name,
                meta: `${allItems.filter((i) => i.saleGroupId === c.id).length} item(s)`,
                isActive: c.isActive,
              }))}
              name={newSaleGroupName}
              onName={setNewSaleGroupName}
              onSave={() => {
                const r = upsertStoreSaleGroup({ name: newSaleGroupName });
                if (!r.ok) return setError(r.error);
                setNewSaleGroupName("");
                refresh();
                flash(`Sale group “${r.row.name}” saved`);
              }}
              editId={saleEditId}
              editName={saleEditName}
              onEdit={(id, current) => {
                setSaleEditId(id);
                setSaleEditName(current);
              }}
              onEditName={setSaleEditName}
              onSaveEdit={() => {
                if (!saleEditId) return;
                const r = upsertStoreSaleGroup({
                  id: saleEditId,
                  name: saleEditName,
                });
                if (!r.ok) return setError(r.error);
                setSaleEditId(null);
                refresh();
                flash("Sale group renamed");
              }}
            />
          ) : null}

          {screen === "single_item" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={card}>
                <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                  {catalogDraft.id ? "Edit item" : "Single Item Creation"}
                </h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-sm sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      SKU
                    </span>
                    <input
                      className={`${field} w-full`}
                      value={catalogDraft.sku}
                      onChange={(e) =>
                        setCatalogDraft((d) => ({ ...d, sku: e.target.value }))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Stock group
                    </span>
                    <select
                      className={`${field} w-full`}
                      value={catalogDraft.categoryId}
                      onChange={(e) =>
                        setCatalogDraft((d) => ({
                          ...d,
                          categoryId: e.target.value,
                        }))
                      }
                    >
                      <option value="">Select…</option>
                      {categories
                        .filter((c) => c.isActive)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Sale group
                    </span>
                    <select
                      className={`${field} w-full`}
                      value={catalogDraft.saleGroupId}
                      onChange={(e) =>
                        setCatalogDraft((d) => ({
                          ...d,
                          saleGroupId: e.target.value,
                        }))
                      }
                    >
                      <option value="">— none —</option>
                      {saleGroups.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Name / description
                    </span>
                    <input
                      className={`${field} w-full`}
                      value={catalogDraft.name}
                      onChange={(e) =>
                        setCatalogDraft((d) => ({ ...d, name: e.target.value }))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      UOM
                    </span>
                    <select
                      className={`${field} w-full`}
                      value={catalogDraft.uomId}
                      onChange={(e) =>
                        setCatalogDraft((d) => ({
                          ...d,
                          uomId: e.target.value,
                        }))
                      }
                    >
                      <option value="">— none —</option>
                      {uoms.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Source
                    </span>
                    <select
                      className={`${field} w-full`}
                      value={catalogDraft.sourceId}
                      onChange={(e) =>
                        setCatalogDraft((d) => ({
                          ...d,
                          sourceId: e.target.value,
                        }))
                      }
                    >
                      <option value="">— none —</option>
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Infra level
                    </span>
                    <select
                      className={`${field} w-full`}
                      value={catalogDraft.infraLevelId}
                      onChange={(e) =>
                        setCatalogDraft((d) => ({
                          ...d,
                          infraLevelId: e.target.value,
                        }))
                      }
                    >
                      <option value="">— none —</option>
                      {infraLevels.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Size / variant
                    </span>
                    <input
                      className={`${field} w-full`}
                      value={catalogDraft.sizeLabel}
                      onChange={(e) =>
                        setCatalogDraft((d) => ({
                          ...d,
                          sizeLabel: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Purchase price ₹
                    </span>
                    <input
                      className={`${field} w-full`}
                      value={catalogDraft.purchasePrice}
                      onChange={(e) =>
                        setCatalogDraft((d) => ({
                          ...d,
                          purchasePrice: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Sale price ₹
                    </span>
                    <input
                      className={`${field} w-full`}
                      value={catalogDraft.salePrice}
                      onChange={(e) =>
                        setCatalogDraft((d) => ({
                          ...d,
                          salePrice: e.target.value,
                        }))
                      }
                    />
                  </label>
                  {!catalogDraft.id ? (
                    <label className="text-sm">
                      <span className="mb-1 block text-[11px] text-[var(--muted)]">
                        Opening stock
                      </span>
                      <input
                        className={`${field} w-full`}
                        value={catalogDraft.stock}
                        onChange={(e) =>
                          setCatalogDraft((d) => ({
                            ...d,
                            stock: e.target.value,
                          }))
                        }
                      />
                    </label>
                  ) : null}
                  <label className="text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Reorder level
                    </span>
                    <input
                      className={`${field} w-full`}
                      value={catalogDraft.reorder}
                      onChange={(e) =>
                        setCatalogDraft((d) => ({
                          ...d,
                          reorder: e.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={btn} onClick={saveCatalog}>
                    {catalogDraft.id ? "Save changes" : "Create item"}
                  </button>
                  {catalogDraft.id ? (
                    <button
                      type="button"
                      className={btnOutline}
                      onClick={() => setCatalogDraft(emptyCatalogDraft())}
                    >
                      Cancel edit
                    </button>
                  ) : null}
                </div>
              </div>

              <div className={card}>
                <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                  Item list
                </h3>
                <ul className="mt-2 max-h-[32rem] divide-y overflow-y-auto text-sm">
                  {allItems.map((i) => (
                    <li
                      key={i.id}
                      className={`flex flex-wrap items-center justify-between gap-2 py-2 ${
                        i.isActive ? "" : "opacity-50"
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-[var(--brand-deep)]">
                          {i.name}
                        </div>
                        <div className="text-[10px] text-[var(--muted)]">
                          {i.sku} · {categoryLabel(i.categoryId)} · sale{" "}
                          {formatInr(i.salePricePaise)} · stock {i.stockOnHand}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-[var(--brand-deep)]"
                        onClick={() =>
                          setCatalogDraft({
                            id: i.id,
                            sku: i.sku,
                            name: i.name,
                            categoryId: i.categoryId,
                            saleGroupId: i.saleGroupId,
                            uomId: i.uomId,
                            sourceId: i.sourceId,
                            infraLevelId: i.infraLevelId,
                            sizeLabel: i.sizeLabel,
                            purchasePrice: String(i.purchasePricePaise / 100),
                            salePrice: String(i.salePricePaise / 100),
                            stock: String(i.stockOnHand),
                            reorder: String(i.reorderLevel),
                            issuePolicy: i.issuePolicy,
                            maxQtyPerAy: String(i.maxQtyPerAy),
                            maxDiscountPct: String(i.maxDiscountPct),
                            audience: i.audience,
                            applicableClassIds: [...i.applicableClassIds],
                            barcode: i.barcode,
                          })
                        }
                      >
                        Edit
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {screen === "multi_item" ? (
            <div className={card}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-[var(--muted)]">
                  Add multiple SKUs in one save.
                </p>
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() =>
                    setMultiRows((rows) => [
                      ...rows,
                      emptyMultiRow(catalogDraft.categoryId),
                    ])
                  }
                >
                  + Add row
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs text-[var(--muted)]">
                      <th className="py-2 pr-2">SKU</th>
                      <th className="py-2 pr-2">Description</th>
                      <th className="py-2 pr-2">Stock group</th>
                      <th className="py-2 pr-2 text-right">Purchase ₹</th>
                      <th className="py-2 pr-2 text-right">Sale ₹</th>
                      <th className="py-2 pr-2 text-right">Opening qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {multiRows.map((row, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-[rgba(32,48,80,0.06)]"
                      >
                        <td className="py-2 pr-2">
                          <input
                            className={`${field} w-28`}
                            value={row.sku}
                            onChange={(e) => {
                              const next = [...multiRows];
                              next[idx] = { ...row, sku: e.target.value };
                              setMultiRows(next);
                            }}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            className={`${field} w-48`}
                            value={row.name}
                            onChange={(e) => {
                              const next = [...multiRows];
                              next[idx] = { ...row, name: e.target.value };
                              setMultiRows(next);
                            }}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <select
                            className={`${field}`}
                            value={row.categoryId || catalogDraft.categoryId}
                            onChange={(e) => {
                              const next = [...multiRows];
                              next[idx] = {
                                ...row,
                                categoryId: e.target.value,
                              };
                              setMultiRows(next);
                            }}
                          >
                            {categories
                              .filter((c) => c.isActive)
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="py-2 pr-2 text-right">
                          <input
                            className={`${field} w-20 text-right`}
                            value={row.purchasePrice}
                            onChange={(e) => {
                              const next = [...multiRows];
                              next[idx] = {
                                ...row,
                                purchasePrice: e.target.value,
                              };
                              setMultiRows(next);
                            }}
                          />
                        </td>
                        <td className="py-2 pr-2 text-right">
                          <input
                            className={`${field} w-20 text-right`}
                            value={row.salePrice}
                            onChange={(e) => {
                              const next = [...multiRows];
                              next[idx] = {
                                ...row,
                                salePrice: e.target.value,
                              };
                              setMultiRows(next);
                            }}
                          />
                        </td>
                        <td className="py-2 pr-2 text-right">
                          <input
                            className={`${field} w-16 text-right`}
                            value={row.stock}
                            onChange={(e) => {
                              const next = [...multiRows];
                              next[idx] = { ...row, stock: e.target.value };
                              setMultiRows(next);
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className={`${btn} mt-3`} onClick={saveMultiItems}>
                Save all items
              </button>
            </div>
          ) : null}

          {screen === "opening_stock" ? (
            <div className={card}>
              <p className="mb-3 text-[11px] text-[var(--muted)]">
                Set opening quantity for each item (updates on-hand stock).
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b text-xs text-[var(--muted)]">
                      <th className="py-2 text-left">Item</th>
                      <th className="py-2 text-right">Current</th>
                      <th className="py-2 text-right">Opening qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id} className="border-b border-[rgba(32,48,80,0.06)]">
                        <td className="py-2">
                          {i.sku} · {i.name}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {i.stockOnHand}
                        </td>
                        <td className="py-2 text-right">
                          <input
                            className={`${field} w-20 text-right`}
                            value={
                              openingDraft[i.id] ??
                              String(i.openingQty || i.stockOnHand)
                            }
                            onChange={(e) =>
                              setOpeningDraft({
                                ...openingDraft,
                                [i.id]: e.target.value,
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className={`${btn} mt-3`}
                onClick={() => {
                  const updates = items.map((i) => ({
                    itemId: i.id,
                    openingQty: Math.floor(
                      Number(
                        openingDraft[i.id] ??
                          i.openingQty ??
                          i.stockOnHand,
                      ) || 0,
                    ),
                  }));
                  const r = bulkSetOpeningStock(updates);
                  if (!r.ok) return setError(r.error);
                  setOpeningDraft({});
                  refresh();
                  flash(`Opening stock updated for ${r.updated} item(s)`);
                }}
              >
                Save opening stock
              </button>
            </div>
          ) : null}

          {screen === "sale_price" ? (
            <div className={card}>
              <p className="mb-3 text-[11px] text-[var(--muted)]">
                Bulk update sale / list price for all items.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b text-xs text-[var(--muted)]">
                      <th className="py-2 text-left">Item</th>
                      <th className="py-2 text-right">Current sale ₹</th>
                      <th className="py-2 text-right">New sale ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id} className="border-b border-[rgba(32,48,80,0.06)]">
                        <td className="py-2">
                          {i.sku} · {i.name}
                        </td>
                        <td className="py-2 text-right">
                          {(i.salePricePaise / 100).toFixed(2)}
                        </td>
                        <td className="py-2 text-right">
                          <input
                            className={`${field} w-24 text-right`}
                            value={
                              salePriceDraft[i.id] ??
                              String(i.salePricePaise / 100)
                            }
                            onChange={(e) =>
                              setSalePriceDraft({
                                ...salePriceDraft,
                                [i.id]: e.target.value,
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className={`${btn} mt-3`}
                onClick={() => {
                  const updates = items.map((i) => ({
                    itemId: i.id,
                    salePricePaise: Math.round(
                      Number(
                        salePriceDraft[i.id] ?? i.salePricePaise / 100,
                      ) * 100,
                    ),
                  }));
                  const r = bulkSetSalePrice(updates);
                  if (!r.ok) return setError(r.error);
                  setSalePriceDraft({});
                  refresh();
                  flash(`Sale price updated for ${r.updated} item(s)`);
                }}
              >
                Save sale prices
              </button>
            </div>
          ) : null}

          {screen === "uom" ? (
            <MasterListPanel
              title="Unit Of Measurement"
              rows={uoms.map((u) => ({
                id: u.id,
                name: u.name,
                meta: `${allItems.filter((i) => i.uomId === u.id).length} item(s)`,
                isActive: u.isActive,
              }))}
              name={newUomName}
              onName={setNewUomName}
              onSave={() => {
                const r = upsertStoreUom({ name: newUomName });
                if (!r.ok) return setError(r.error);
                setNewUomName("");
                refresh();
                flash(`UOM “${r.row.name}” saved`);
              }}
              editId={uomEditId}
              editName={uomEditName}
              onEdit={(id, current) => {
                setUomEditId(id);
                setUomEditName(current);
              }}
              onEditName={setUomEditName}
              onSaveEdit={() => {
                if (!uomEditId) return;
                const r = upsertStoreUom({ id: uomEditId, name: uomEditName });
                if (!r.ok) return setError(r.error);
                setUomEditId(null);
                refresh();
                flash("UOM renamed");
              }}
            />
          ) : null}

          {screen === "infra_level" ? (
            <MasterListPanel
              title="Infra Level"
              hint="Store / lab / mess location levels for stock."
              rows={infraLevels.map((l) => ({
                id: l.id,
                name: l.name,
                meta: `${allItems.filter((i) => i.infraLevelId === l.id).length} item(s)`,
                isActive: l.isActive,
              }))}
              name={newInfraName}
              onName={setNewInfraName}
              onSave={() => {
                const r = upsertStoreInfraLevel({ name: newInfraName });
                if (!r.ok) return setError(r.error);
                setNewInfraName("");
                refresh();
                flash(`Infra level “${r.row.name}” saved`);
              }}
              editId={infraEditId}
              editName={infraEditName}
              onEdit={(id, current) => {
                setInfraEditId(id);
                setInfraEditName(current);
              }}
              onEditName={setInfraEditName}
              onSaveEdit={() => {
                if (!infraEditId) return;
                const r = upsertStoreInfraLevel({
                  id: infraEditId,
                  name: infraEditName,
                });
                if (!r.ok) return setError(r.error);
                setInfraEditId(null);
                refresh();
                flash("Infra level renamed");
              }}
            />
          ) : null}

          {screen === "production" ? (
            <div className={card}>
              <p className="mb-3 text-[11px] text-[var(--muted)]">
                Record in-house production (stock in).
              </p>
              <div className="grid max-w-md gap-2">
                <select
                  className={field}
                  value={prodItemId}
                  onChange={(e) => setProdItemId(e.target.value)}
                >
                  <option value="">Select item…</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.sku} · {i.name}
                    </option>
                  ))}
                </select>
                <input
                  className={field}
                  placeholder="Qty produced"
                  value={prodQty}
                  onChange={(e) => setProdQty(e.target.value)}
                />
                <input
                  className={field}
                  placeholder="Note"
                  value={prodNote}
                  onChange={(e) => setProdNote(e.target.value)}
                />
                <button
                  type="button"
                  className={btn}
                  onClick={() =>
                    postStockMove(prodItemId, prodQty, "production", prodNote)
                  }
                >
                  Post production
                </button>
              </div>
            </div>
          ) : null}

          {screen === "consumption" ? (
            <div className={card}>
              <p className="mb-3 text-[11px] text-[var(--muted)]">
                Record internal consumption (stock out).
              </p>
              <div className="grid max-w-md gap-2">
                <select
                  className={field}
                  value={consItemId}
                  onChange={(e) => setConsItemId(e.target.value)}
                >
                  <option value="">Select item…</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.sku} · {i.name} (on hand {i.stockOnHand})
                    </option>
                  ))}
                </select>
                <input
                  className={field}
                  placeholder="Qty consumed"
                  value={consQty}
                  onChange={(e) => setConsQty(e.target.value)}
                />
                <input
                  className={field}
                  placeholder="Note"
                  value={consNote}
                  onChange={(e) => setConsNote(e.target.value)}
                />
                <button
                  type="button"
                  className={btn}
                  onClick={() =>
                    postStockMove(consItemId, consQty, "consumption", consNote)
                  }
                >
                  Post consumption
                </button>
              </div>
            </div>
          ) : null}

          {screen === "source" ? (
            <div className={card}>
              <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                Source Master
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  className={`${field} min-w-[160px]`}
                  placeholder="Source / vendor name"
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                />
                <input
                  className={`${field} w-36`}
                  placeholder="Phone"
                  value={newSourcePhone}
                  onChange={(e) => setNewSourcePhone(e.target.value)}
                />
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    const r = upsertStoreSource({
                      name: newSourceName,
                      phone: newSourcePhone,
                    });
                    if (!r.ok) return setError(r.error);
                    setNewSourceName("");
                    setNewSourcePhone("");
                    refresh();
                    flash(`Source “${r.row.name}” saved`);
                  }}
                >
                  Save
                </button>
              </div>
              <ul className="mt-3 divide-y text-sm">
                {sources.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                    {sourceEditId === s.id ? (
                      <>
                        <input
                          className={field}
                          value={sourceEditName}
                          onChange={(e) => setSourceEditName(e.target.value)}
                        />
                        <input
                          className={`${field} w-32`}
                          value={sourceEditPhone}
                          onChange={(e) => setSourceEditPhone(e.target.value)}
                        />
                        <button
                          type="button"
                          className={btnOutline}
                          onClick={() => {
                            const r = upsertStoreSource({
                              id: s.id,
                              name: sourceEditName,
                              phone: sourceEditPhone,
                            });
                            if (!r.ok) return setError(r.error);
                            setSourceEditId(null);
                            refresh();
                            flash("Source updated");
                          }}
                        >
                          Update
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-[var(--brand-deep)]">
                          {s.name}
                        </span>
                        {s.phone ? (
                          <span className="text-[10px] text-[var(--muted)]">
                            {s.phone}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="text-[11px] font-semibold"
                          onClick={() => {
                            setSourceEditId(s.id);
                            setSourceEditName(s.name);
                            setSourceEditPhone(s.phone);
                          }}
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </li>
                ))}
                {!sources.length ? (
                  <li className="py-3 text-[var(--muted)]">No sources yet.</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {screen === "import_item" ? (
            <div className={card}>
              <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                Import Item
              </h3>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                CSV import with stock group, prices, and opening stock.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => downloadStoreCatalogTemplate()}
                >
                  Download template
                </button>
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => exportStoreCatalogCsv()}
                >
                  Export catalog
                </button>
                <label className={`${btnOutline} cursor-pointer`}>
                  Import CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const result = importStoreCatalogCsv(
                          String(reader.result ?? ""),
                        );
                        if (result.error) {
                          setError(result.error);
                          return;
                        }
                        refresh();
                        flash(
                          `Imported ${result.added} new · ${result.updated} updated`,
                        );
                      };
                      reader.readAsText(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
