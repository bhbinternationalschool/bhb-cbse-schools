"use client";

import { useEffect, useMemo, useState } from "react";
import {
  categoryLabel,
  deleteStoreAssetAllocation,
  loadStore,
  seedStoreIfEmpty,
  upsertStoreAssetAllocation,
  type StoreAssetAllocation,
  type StoreItem,
} from "@/lib/store";

const field =
  "rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1.5 text-sm text-[var(--brand-deep)]";
const card = "rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4";
const btn =
  "rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";

export function StoreAssetAllocationPanel() {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [allocations, setAllocations] = useState<StoreAssetAllocation[]>([]);
  const [itemId, setItemId] = useState("");
  const [assetTag, setAssetTag] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [location, setLocation] = useState("");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function refresh() {
    seedStoreIfEmpty();
    const store = loadStore();
    setItems(store.items.filter((i) => i.isActive));
    setAllocations(store.assetAllocations);
  }

  useEffect(() => {
    refresh();
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  const rows = useMemo(
    () =>
      [...allocations].sort((a, b) =>
        a.assetTag.localeCompare(b.assetTag),
      ),
    [allocations],
  );

  function resetForm() {
    setEditId(null);
    setItemId("");
    setAssetTag("");
    setAssignedTo("");
    setLocation("");
    setQty("1");
    setNote("");
  }

  function onSave() {
    const r = upsertStoreAssetAllocation({
      id: editId || undefined,
      itemId,
      assetTag,
      assignedTo,
      location,
      qty: Math.floor(Number(qty) || 1),
      note,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    resetForm();
    refresh();
    flash(editId ? "Asset updated" : "Asset allocated");
  }

  function onEdit(row: StoreAssetAllocation) {
    setEditId(row.id);
    setItemId(row.itemId);
    setAssetTag(row.assetTag);
    setAssignedTo(row.assignedTo);
    setLocation(row.location);
    setQty(String(row.qty));
    setNote(row.note);
  }

  function onDelete(id: string) {
    if (!window.confirm("Remove this asset allocation?")) return;
    const r = deleteStoreAssetAllocation(id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (editId === id) resetForm();
    refresh();
    flash("Asset allocation removed");
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
          {editId ? "Edit asset" : "Tag and assign asset"}
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Track fixed assets — furniture, IT equipment, lab items — by tag and
          assignee.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Asset tag
            </span>
            <input
              className={`${field} w-36`}
              value={assetTag}
              onChange={(e) => setAssetTag(e.target.value)}
              placeholder="AST-001"
            />
          </label>
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
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Assigned to
            </span>
            <input
              className={`${field} min-w-[160px]`}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="Staff / dept"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Location
            </span>
            <input
              className={`${field} min-w-[140px]`}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Room / block"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Qty
            </span>
            <input
              className={`${field} w-20`}
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Note
            </span>
            <input
              className={`${field} min-w-[140px]`}
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
          Asset register
        </h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wide text-[var(--muted)]">
                <th className="py-2 pr-3">Tag</th>
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Assigned to</th>
                <th className="py-2 pr-3">Location</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-[var(--muted)]">
                    No assets allocated yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const item = items.find((i) => i.id === r.itemId);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-[rgba(32,48,80,0.06)]"
                    >
                      <td className="py-2 pr-3 font-semibold text-[var(--brand-deep)]">
                        {r.assetTag}
                      </td>
                      <td className="py-2 pr-3">
                        <div>{item?.name || r.itemId}</div>
                        <div className="text-[10px] text-[var(--muted)]">
                          {item?.sku}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-[var(--muted)]">
                        {item ? categoryLabel(item.categoryId) : "—"}
                      </td>
                      <td className="py-2 pr-3">{r.assignedTo || "—"}</td>
                      <td className="py-2 pr-3">{r.location || "—"}</td>
                      <td className="py-2 pr-3 text-right">{r.qty}</td>
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
