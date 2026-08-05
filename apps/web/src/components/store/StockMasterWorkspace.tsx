"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatInr, loadMasters, type MastersState } from "@/lib/masters";
import { seedAccountsIfEmpty } from "@/lib/accounts";
import { RemoveControl } from "@/components/masters/RemoveControl";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import {
  adjustStock,
  bulkSetOpeningStock,
  bulkSetSalePrice,
  categoryLabel,
  checkStoreCategoryRemoval,
  deleteStoreCategory,
  downloadStoreCatalogTemplate,
  exportStoreCatalogCsv,
  importStoreCatalogCsv,
  listActiveStoreCategories,
  loadStore,
  seedStoreIfEmpty,
  syncAccountsVendorsToStoreSources,
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

const card = "rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4";
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
  const [newCategorySourceIds, setNewCategorySourceIds] = useState<string[]>(
    [],
  );
  const [catEditId, setCatEditId] = useState<string | null>(null);
  const [catEditName, setCatEditName] = useState("");
  const [catEditActive, setCatEditActive] = useState(true);

  const [masters, setMasters] = useState<MastersState | null>(null);
  const [newSaleGroupName, setNewSaleGroupName] = useState("");
  const [newSaleGroupCategoryId, setNewSaleGroupCategoryId] = useState("");
  const [newSaleGroupClassIds, setNewSaleGroupClassIds] = useState<string[]>(
    [],
  );
  const [saleEditId, setSaleEditId] = useState<string | null>(null);
  const [saleEditName, setSaleEditName] = useState("");
  const [saleEditCategoryId, setSaleEditCategoryId] = useState("");
  const [saleEditClassIds, setSaleEditClassIds] = useState<string[]>([]);
  const [catEditSourceIds, setCatEditSourceIds] = useState<string[]>([]);

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
    seedAccountsIfEmpty();
    syncAccountsVendorsToStoreSources();
    const store = loadStore();
    setMasters(loadMasters());
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

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive);
  }, [masters]);

  function classLabels(ids: string[]): string {
    if (!ids.length) return "All classes";
    return ids
      .map((id) => classOptions.find((c) => c.id === id)?.name || id)
      .join(", ");
  }

  function toggleClassId(
    id: string,
    current: string[],
    setter: (next: string[]) => void,
  ) {
    setter(
      current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    );
  }

  function saveCategoryDraft(opts: {
    id?: string;
    name: string;
    preferredSourceIds: string[];
    isActive?: boolean;
    clearNew?: boolean;
  }) {
    const r = upsertStoreCategory({
      id: opts.id,
      name: opts.name,
      preferredSourceIds: opts.preferredSourceIds,
      isActive: opts.isActive,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (opts.clearNew) {
      setNewCategoryName("");
      setNewCategorySourceIds([]);
    }
    if (opts.id) {
      setCatEditId(null);
    }
    refresh();
    flash(`Stock group “${r.category.name}” saved`);
  }

  function removeCategory(categoryId: string) {
    const r = deleteStoreCategory(categoryId);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (catEditId === categoryId) {
      setCatEditId(null);
      setCatEditSourceIds([]);
    }
    refresh();
    flash("Stock group removed");
  }

  function saveSaleGroupDraft(opts: {
    id?: string;
    name: string;
    categoryId: string;
    classIds: string[];
    clearNew?: boolean;
  }) {
    const r = upsertStoreSaleGroup({
      id: opts.id,
      name: opts.name,
      categoryId: opts.categoryId,
      classIds: opts.classIds,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (opts.clearNew) {
      setNewSaleGroupName("");
      setNewSaleGroupCategoryId("");
      setNewSaleGroupClassIds([]);
    }
    if (opts.id) {
      setSaleEditId(null);
    }
    refresh();
    flash(`Sale group “${r.row.name}” saved`);
  }

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
            <div className={card}>
              <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                Stock Group
              </h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                Broad inventory classes — books, uniform, stationery, kits. Link
                preferred vendors; sale groups and items sit under each group.
              </p>

              <div className="mt-4 rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.02)] p-3">
                <h3 className="text-[12px] font-bold text-[var(--brand-deep)]">
                  Add stock group
                </h3>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Name
                    </span>
                    <input
                      className={`${field} w-full`}
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="e.g. Books & Stationery"
                    />
                  </label>
                  <div className="text-sm sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Preferred vendors / sources (optional)
                    </span>
                    <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.12)] bg-white p-2">
                      {sources
                        .filter((s) => s.isActive)
                        .map((s) => (
                          <label
                            key={s.id}
                            className="flex items-center gap-1 text-[11px]"
                          >
                            <input
                              type="checkbox"
                              checked={newCategorySourceIds.includes(s.id)}
                              onChange={() =>
                                toggleClassId(
                                  s.id,
                                  newCategorySourceIds,
                                  setNewCategorySourceIds,
                                )
                              }
                            />
                            {s.name}
                          </label>
                        ))}
                      {!sources.length ? (
                        <span className="text-[11px] text-[var(--muted)]">
                          Sync vendors from Accounts via Source Master.
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={`${btn} mt-3`}
                  onClick={() =>
                    saveCategoryDraft({
                      name: newCategoryName,
                      preferredSourceIds: newCategorySourceIds,
                      clearNew: true,
                    })
                  }
                >
                  Add stock group
                </button>
              </div>

              <div className="mt-4 overflow-x-auto rounded-lg border border-[rgba(32,48,80,0.12)]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[rgba(32,48,80,0.04)] text-left text-[11px] text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Name</th>
                      <th className="px-3 py-2 font-semibold">Items</th>
                      <th className="px-3 py-2 font-semibold">Sale groups</th>
                      <th className="px-3 py-2 font-semibold">Vendors</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(32,48,80,0.08)]">
                    {[...categories]
                      .sort(
                        (a, b) =>
                          a.sortOrder - b.sortOrder ||
                          a.name.localeCompare(b.name),
                      )
                      .map((c) => {
                        const itemN = allItems.filter(
                          (i) => i.categoryId === c.id,
                        ).length;
                        const sgN = saleGroups.filter(
                          (g) => g.categoryId === c.id,
                        ).length;
                        const vendorNames = (c.preferredSourceIds ?? [])
                          .map(
                            (id) =>
                              sources.find((s) => s.id === id)?.name || id,
                          )
                          .join(", ");
                        const removal = checkStoreCategoryRemoval(c.id);
                        return (
                          <tr
                            key={c.id}
                            className={c.isActive === false ? "opacity-55" : ""}
                          >
                            <td className="px-3 py-2 font-semibold text-[var(--brand-deep)]">
                              {c.name}
                            </td>
                            <td className="px-3 py-2 text-[var(--muted)]">
                              {itemN}
                            </td>
                            <td className="px-3 py-2 text-[var(--muted)]">
                              {sgN}
                            </td>
                            <td className="max-w-[10rem] truncate px-3 py-2 text-[11px] text-[var(--muted)]">
                              {vendorNames || "—"}
                            </td>
                            <td className="px-3 py-2 text-[11px]">
                              {c.isActive === false ? (
                                <span className="text-[#c2410c]">Inactive</span>
                              ) : (
                                <span className="text-[#0f766e]">Active</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap items-start justify-end gap-2">
                                <button
                                  type="button"
                                  className="text-[11px] font-semibold text-[var(--brand-deep)]"
                                  onClick={() => {
                                    setCatEditId(c.id);
                                    setCatEditName(c.name);
                                    setCatEditActive(c.isActive !== false);
                                    setCatEditSourceIds(
                                      c.preferredSourceIds ?? [],
                                    );
                                  }}
                                >
                                  Edit
                                </button>
                                <RemoveControl
                                  check={removal}
                                  onRemove={() => removeCategory(c.id)}
                                  compact
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    {!categories.length ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-6 text-center text-[var(--muted)]"
                        >
                          No stock groups yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {catEditId ? (
                <div className={`${card} mt-4 border-[var(--brand-deep)]/20`}>
                  <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                    Edit stock group
                  </h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm sm:col-span-2">
                      <span className="mb-1 block text-[11px] text-[var(--muted)]">
                        Name
                      </span>
                      <input
                        className={`${field} w-full`}
                        value={catEditName}
                        onChange={(e) => setCatEditName(e.target.value)}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={catEditActive}
                        onChange={(e) => setCatEditActive(e.target.checked)}
                      />
                      <span className="text-[12px] text-[var(--brand-deep)]">
                        Active (shown on sell screen)
                      </span>
                    </label>
                    <div className="text-sm sm:col-span-2">
                      <span className="mb-1 block text-[11px] text-[var(--muted)]">
                        Preferred vendors / sources
                      </span>
                      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.12)] p-2">
                        {sources
                          .filter((s) => s.isActive)
                          .map((s) => (
                            <label
                              key={s.id}
                              className="flex items-center gap-1 text-[11px]"
                            >
                              <input
                                type="checkbox"
                                checked={catEditSourceIds.includes(s.id)}
                                onChange={() =>
                                  toggleClassId(
                                    s.id,
                                    catEditSourceIds,
                                    setCatEditSourceIds,
                                  )
                                }
                              />
                              {s.name}
                            </label>
                          ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={btn}
                      onClick={() =>
                        saveCategoryDraft({
                          id: catEditId,
                          name: catEditName,
                          preferredSourceIds: catEditSourceIds,
                          isActive: catEditActive,
                        })
                      }
                    >
                      Save changes
                    </button>
                    <button
                      type="button"
                      className={btnOutline}
                      onClick={() => {
                        setCatEditId(null);
                        setCatEditSourceIds([]);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {screen === "sale_group" ? (
            <div className={card}>
              <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                Sale Group
              </h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                POS kits — link to a stock group and optional classes (empty =
                all classes).
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Name
                  </span>
                  <input
                    className={`${field} w-full`}
                    value={newSaleGroupName}
                    onChange={(e) => setNewSaleGroupName(e.target.value)}
                    placeholder="e.g. Foundation kit"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Stock group
                  </span>
                  <select
                    className={`${field} w-full`}
                    value={newSaleGroupCategoryId}
                    onChange={(e) => setNewSaleGroupCategoryId(e.target.value)}
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
                <div className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Classes (optional)
                  </span>
                  <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.12)] p-2">
                    {classOptions.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-1 text-[11px]"
                      >
                        <input
                          type="checkbox"
                          checked={newSaleGroupClassIds.includes(c.id)}
                          onChange={() =>
                            toggleClassId(
                              c.id,
                              newSaleGroupClassIds,
                              setNewSaleGroupClassIds,
                            )
                          }
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className={`${btn} mt-3`}
                onClick={() =>
                  saveSaleGroupDraft({
                    name: newSaleGroupName,
                    categoryId: newSaleGroupCategoryId,
                    classIds: newSaleGroupClassIds,
                    clearNew: true,
                  })
                }
              >
                Save sale group
              </button>
              <ul className="mt-4 divide-y text-sm">
                {saleGroups.map((g) => (
                  <li key={g.id} className="py-3">
                    {saleEditId === g.id ? (
                      <div className="space-y-2">
                        <input
                          className={`${field} w-full`}
                          value={saleEditName}
                          onChange={(e) => setSaleEditName(e.target.value)}
                        />
                        <select
                          className={`${field} w-full`}
                          value={saleEditCategoryId}
                          onChange={(e) =>
                            setSaleEditCategoryId(e.target.value)
                          }
                        >
                          <option value="">Stock group…</option>
                          {categories
                            .filter((c) => c.isActive)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.12)] p-2">
                          {classOptions.map((c) => (
                            <label
                              key={c.id}
                              className="flex items-center gap-1 text-[11px]"
                            >
                              <input
                                type="checkbox"
                                checked={saleEditClassIds.includes(c.id)}
                                onChange={() =>
                                  toggleClassId(
                                    c.id,
                                    saleEditClassIds,
                                    setSaleEditClassIds,
                                  )
                                }
                              />
                              {c.name}
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={btnOutline}
                            onClick={() =>
                              saveSaleGroupDraft({
                                id: g.id,
                                name: saleEditName,
                                categoryId: saleEditCategoryId,
                                classIds: saleEditClassIds,
                              })
                            }
                          >
                            Update
                          </button>
                          <button
                            type="button"
                            className="text-xs font-semibold text-[var(--muted)]"
                            onClick={() => setSaleEditId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[var(--brand-deep)]">
                          {g.name}
                        </span>
                        <span className="text-[10px] text-[var(--muted)]">
                          {categoryLabel(g.categoryId)} · {classLabels(g.classIds)}{" "}
                          · {allItems.filter((i) => i.saleGroupId === g.id).length}{" "}
                          item(s)
                        </span>
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[var(--brand-deep)]"
                          onClick={() => {
                            setSaleEditId(g.id);
                            setSaleEditName(g.name);
                            setSaleEditCategoryId(g.categoryId);
                            setSaleEditClassIds(g.classIds);
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </li>
                ))}
                {!saleGroups.length ? (
                  <li className="py-3 text-[var(--muted)]">No sale groups yet.</li>
                ) : null}
              </ul>
            </div>
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
