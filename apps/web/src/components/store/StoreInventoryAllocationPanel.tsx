"use client";

import { useEffect, useMemo, useState } from "react";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import {
  categoryLabel,
  deleteStoreInventoryAllocation,
  infraLevelLabel,
  loadStore,
  seedStoreIfEmpty,
  upsertStoreInventoryAllocation,
  type StoreInfraLevel,
  type StoreInventoryAllocation,
  type StoreItem,
} from "@/lib/store";

const card = "rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4";
export function StoreInventoryAllocationPanel() {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [infraLevels, setInfraLevels] = useState<StoreInfraLevel[]>([]);
  const [allocations, setAllocations] = useState<StoreInventoryAllocation[]>(
    [],
  );
  const [itemId, setItemId] = useState("");
  const [infraLevelId, setInfraLevelId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function refresh() {
    seedStoreIfEmpty();
    const store = loadStore();
    setItems(store.items.filter((i) => i.isActive));
    setInfraLevels(store.infraLevels.filter((l) => l.isActive));
    setAllocations(store.inventoryAllocations);
  }

  useEffect(() => {
    refresh();
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  const rows = useMemo(() => {
    const store = loadStore();
    return [...allocations].sort((a, b) => {
      const ia = items.find((i) => i.id === a.itemId)?.name || "";
      const ib = items.find((i) => i.id === b.itemId)?.name || "";
      return ia.localeCompare(ib);
    }).map((a) => ({
      ...a,
      itemLabel: items.find((i) => i.id === a.itemId),
      infraLabel: infraLevelLabel(a.infraLevelId, store),
    }));
  }, [allocations, items]);

  function resetForm() {
    setEditId(null);
    setItemId("");
    setInfraLevelId("");
    setQty("");
    setNote("");
  }

  function onSave() {
    const r = upsertStoreInventoryAllocation({
      id: editId || undefined,
      itemId,
      infraLevelId,
      qty: Math.floor(Number(qty) || 0),
      note,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    resetForm();
    refresh();
    flash(editId ? "Allocation updated" : "Allocation saved");
  }

  function onEdit(row: StoreInventoryAllocation) {
    setEditId(row.id);
    setItemId(row.itemId);
    setInfraLevelId(row.infraLevelId);
    setQty(String(row.qty));
    setNote(row.note);
  }

  function onDelete(id: string) {
    if (!window.confirm("Remove this allocation?")) return;
    const r = deleteStoreInventoryAllocation(id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (editId === id) resetForm();
    refresh();
    flash("Allocation removed");
  }

  return (
    <div className="mt-4 space-y-4">
      {error ? (
        <p className="rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <div className={card}>
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          {editId ? "Edit allocation" : "Allocate stock to infra level"}
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Assign on-hand inventory qty to labs, mess, store rooms, etc.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Item
            </span>
            <select
              className={`${field} min-w-[200px]`}
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
            >
              <option value="">Pick item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.sku} · {i.name}
                  {i.sizeLabel ? ` (${i.sizeLabel})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Infra level
            </span>
            <select
              className={`${field} min-w-[160px]`}
              value={infraLevelId}
              onChange={(e) => setInfraLevelId(e.target.value)}
            >
              <option value="">Pick level</option>
              {infraLevels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Qty
            </span>
            <input
              className={`${field} w-24`}
              type="number"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Note
            </span>
            <input
              className={`${field} min-w-[180px]`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <button type="button" className={btn} onClick={onSave}>
            {editId ? "Update" : "Save"}
          </button>
          {editId ? (
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] bg-white px-3 py-1.5 text-sm"
              onClick={resetForm}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className={card}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Current allocations
        </h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wide text-[var(--muted)]">
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Infra level</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2 pr-3">Note</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-[var(--muted)]">
                    No allocations yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-[rgba(32,48,80,0.06)]">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-[var(--brand-deep)]">
                        {r.itemLabel?.name || r.itemId}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {r.itemLabel?.sku}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-[var(--muted)]">
                      {r.itemLabel
                        ? categoryLabel(r.itemLabel.categoryId)
                        : "—"}
                    </td>
                    <td className="py-2 pr-3">{r.infraLabel}</td>
                    <td className="py-2 pr-3 text-right font-semibold">
                      {r.qty}
                    </td>
                    <td className="py-2 pr-3 text-[var(--muted)]">
                      {r.note || "—"}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        className="mr-2 text-[11px] font-semibold text-[var(--brand-deep)]"
                        onClick={() => onEdit(r)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-[#dc2626]"
                        onClick={() => onDelete(r.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
