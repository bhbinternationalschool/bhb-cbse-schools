"use client";

/**
 * Kits — what a class is supposed to receive.
 *
 * This is the "assign a sell item to a class group" answer. A kit is a named
 * bundle of catalogue items with quantities, tied to one or more classes. At
 * the counter (Phase 3) picking a student proposes their class's kit, so the
 * clerk does not rebuild a Class 6 uniform set by hand every time.
 *
 * Price mode: `sum` prices the kit from its lines at price-list rates, so a
 * price change flows through automatically; `fixed` charges one bundled
 * amount regardless, for a set sold as a package.
 */

import { useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import {
  FIELD_CLASS,
  InvAlert,
  InvDrawer,
  InvSpinner,
  MoneyField,
  Pill,
  SelectField,
  TextField,
} from "@/components/inventory/InvUi";
import { invApi, useAsync, useSaver } from "@/lib/inventory/client";
import {
  formatPaise,
  inputToPaise,
  paiseToInput,
  type InvItemRow,
  type InvKitDetail,
} from "@/lib/inventory/types";

type ClassOption = { id: string; label: string };

type KitDraft = {
  id?: string;
  name: string;
  priceMode: "sum" | "fixed";
  fixedPriceInput: string;
  audience: "student" | "staff" | "both";
  notes: string;
  isActive: boolean;
  items: { itemId: string; qty: number; isOptional: boolean }[];
  classIds: string[];
};

const EMPTY_DRAFT: KitDraft = {
  name: "",
  priceMode: "sum",
  fixedPriceInput: "",
  audience: "student",
  notes: "",
  isActive: true,
  items: [],
  classIds: [],
};

export function KitsTab({
  classes,
  onChanged,
}: {
  classes: ClassOption[];
  onChanged?: () => void;
}) {
  const kits = useAsync(() => invApi.listKits({ status: "all" }), []);
  const saver = useSaver();
  const [draft, setDraft] = useState<KitDraft | null>(null);

  // The item picker needs the priced catalogue; one page of 200 covers a
  // school store, and the picker filters within it.
  const catalogue = useAsync(
    () => invApi.listItems({ status: "active", pageSize: 200, sort: "name" }),
    [],
  );
  const [itemFilter, setItemFilter] = useState("");

  const itemsById = useMemo(() => {
    const m = new Map<string, InvItemRow>();
    for (const r of catalogue.data?.rows ?? []) m.set(r.id, r);
    return m;
  }, [catalogue.data]);

  const classLabel = useMemo(() => {
    const m = new Map(classes.map((c) => [c.id, c.label]));
    return (id: string) => m.get(id) ?? id;
  }, [classes]);

  function openNew() {
    setDraft({ ...EMPTY_DRAFT, items: [], classIds: [] });
  }

  function openEdit(k: InvKitDetail) {
    setDraft({
      id: k.id,
      name: k.name,
      priceMode: k.priceMode,
      fixedPriceInput: paiseToInput(k.fixedPricePaise),
      audience: k.audience,
      notes: k.notes,
      isActive: k.isActive,
      items: k.items.map((l) => ({
        itemId: l.itemId,
        qty: l.qty,
        isOptional: l.isOptional,
      })),
      classIds: [...k.classIds],
    });
  }

  const set = <K extends keyof KitDraft>(key: K, value: KitDraft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  function addLine(itemId: string) {
    if (!itemId) return;
    setDraft((d) => {
      if (!d) return d;
      if (d.items.some((l) => l.itemId === itemId)) return d;
      return { ...d, items: [...d.items, { itemId, qty: 1, isOptional: false }] };
    });
  }

  function updateLine(
    itemId: string,
    patch: Partial<{ qty: number; isOptional: boolean }>,
  ) {
    setDraft((d) =>
      d
        ? {
            ...d,
            items: d.items.map((l) =>
              l.itemId === itemId ? { ...l, ...patch } : l,
            ),
          }
        : d,
    );
  }

  function removeLine(itemId: string) {
    setDraft((d) =>
      d ? { ...d, items: d.items.filter((l) => l.itemId !== itemId) } : d,
    );
  }

  function toggleClass(classId: string) {
    setDraft((d) =>
      d
        ? {
            ...d,
            classIds: d.classIds.includes(classId)
              ? d.classIds.filter((c) => c !== classId)
              : [...d.classIds, classId],
          }
        : d,
    );
  }

  async function save() {
    if (!draft?.name) return;
    const saved = await saver.run(
      () =>
        invApi.saveKit({
          id: draft.id,
          name: draft.name,
          priceMode: draft.priceMode,
          fixedPricePaise: inputToPaise(draft.fixedPriceInput),
          audience: draft.audience,
          notes: draft.notes,
          isActive: draft.isActive,
          items: draft.items,
          classIds: draft.classIds,
        }),
      { success: `Saved ${draft.name}` },
    );
    if (saved) {
      setDraft(null);
      kits.reload();
      onChanged?.();
    }
  }

  async function remove() {
    if (!draft?.id) return;
    const res = await saver.run(() => invApi.removeKit(draft.id as string));
    if (res) {
      saver.setNotice("Kit deleted");
      setDraft(null);
      kits.reload();
      onChanged?.();
    }
  }

  const draftTotal = useMemo(() => {
    if (!draft) return 0;
    if (draft.priceMode === "fixed") return inputToPaise(draft.fixedPriceInput);
    return draft.items
      .filter((l) => !l.isOptional)
      .reduce((sum, l) => sum + (itemsById.get(l.itemId)?.salePaise ?? 0) * l.qty, 0);
  }, [draft, itemsById]);

  const pickerOptions = useMemo(() => {
    const rows = catalogue.data?.rows ?? [];
    const term = itemFilter.trim().toLowerCase();
    const chosen = new Set(draft?.items.map((l) => l.itemId) ?? []);
    return rows
      .filter((r) => !chosen.has(r.id))
      .filter(
        (r) =>
          !term ||
          r.name.toLowerCase().includes(term) ||
          r.sku.toLowerCase().includes(term),
      )
      .slice(0, 50);
  }, [catalogue.data, itemFilter, draft?.items]);

  const list = kits.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          A kit bundles items for a class group — the counter proposes it when
          the student is picked.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => kits.reload()}>
            <RefreshCw className="size-3.5" />
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="size-4" />
            New kit
          </Button>
        </div>
      </div>

      <InvAlert
        error={kits.error || saver.error}
        notice={saver.notice}
        onDismiss={() => {
          saver.setError("");
          saver.setNotice("");
        }}
      />

      {kits.loading ? (
        <InvSpinner label="Loading kits" />
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center">
          <p className="text-sm font-medium">No kits yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create one per class group — &ldquo;Class 6 book set&rdquo;,
            &ldquo;Winter uniform — pre-primary&rdquo;.
          </p>
          <Button className="mt-3" size="sm" onClick={openNew}>
            <Plus className="size-4" />
            Add the first kit
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => openEdit(k)}
              className="rounded-xl border bg-card p-3 text-left transition-colors hover:border-ring"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{k.name}</span>
                    {!k.isActive ? <Pill tone="warn">inactive</Pill> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {k.items.length} item{k.items.length === 1 ? "" : "s"} ·{" "}
                    {k.audience}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">
                    {formatPaise(k.effectivePricePaise)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {k.priceMode === "fixed" ? "fixed price" : "sum of lines"}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {k.classIds.length === 0 ? (
                  <Pill tone="warn">no class assigned</Pill>
                ) : (
                  k.classIds.map((c) => (
                    <Pill key={c} tone="info">
                      {classLabel(c)}
                    </Pill>
                  ))
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <InvDrawer
        open={!!draft}
        wide
        title={draft?.id ? "Edit kit" : "New kit"}
        subtitle="Items, quantities and the classes this kit belongs to"
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
              {saver.saving ? "Saving…" : "Save kit"}
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <InvAlert error={saver.error} />

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Kit name"
                required
                className="sm:col-span-2"
                value={draft.name}
                onChange={(v) => set("name", v)}
                placeholder="e.g. Class 6 book set"
              />
              <SelectField
                label="For"
                value={draft.audience}
                placeholder="Students"
                options={[
                  { value: "student", label: "Students" },
                  { value: "staff", label: "Staff" },
                  { value: "both", label: "Students and staff" },
                ]}
                onChange={(v) => set("audience", v as KitDraft["audience"])}
              />
              <SelectField
                label="Pricing"
                value={draft.priceMode}
                placeholder="Sum of item prices"
                options={[
                  { value: "sum", label: "Sum of item prices" },
                  { value: "fixed", label: "Fixed bundle price" },
                ]}
                onChange={(v) =>
                  set("priceMode", v === "fixed" ? "fixed" : "sum")
                }
              />
              {draft.priceMode === "fixed" ? (
                <MoneyField
                  label="Bundle price"
                  hint="Charged instead of the line total"
                  value={draft.fixedPriceInput}
                  onChange={(v) => set("fixedPriceInput", v)}
                />
              ) : null}
              {draft.id ? (
                <SelectField
                  label="Status"
                  value={draft.isActive ? "active" : "inactive"}
                  placeholder="Active"
                  options={[
                    { value: "active", label: "Active" },
                    { value: "inactive", label: "Inactive" },
                  ]}
                  onChange={(v) => set("isActive", v !== "inactive")}
                />
              ) : null}
            </div>

            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Items in this kit
              </legend>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${FIELD_CLASS} w-full max-w-[220px] flex-1`}
                  placeholder="Filter catalogue…"
                  value={itemFilter}
                  onChange={(e) => setItemFilter(e.target.value)}
                />
                <select
                  className={`${FIELD_CLASS} w-full max-w-[320px] flex-1`}
                  value=""
                  onChange={(e) => {
                    addLine(e.target.value);
                    e.currentTarget.selectedIndex = 0;
                  }}
                >
                  <option value="">
                    {catalogue.loading
                      ? "Loading catalogue…"
                      : `Add an item (${pickerOptions.length} available)`}
                  </option>
                  {pickerOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.variantLabel ? ` — ${r.variantLabel}` : ""} ·{" "}
                      {r.salePaise ? formatPaise(r.salePaise) : "not priced"}
                    </option>
                  ))}
                </select>
              </div>

              {draft.items.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted-foreground">
                  No items yet — add them from the dropdown above.
                </p>
              ) : (
                <ErpTable minWidth="min-w-0">
                  <ErpTableHead>
                    <tr>
                      <th className="py-1 text-left font-medium">Item</th>
                      <th className="py-1 text-right font-medium">Qty</th>
                      <th className="py-1 text-right font-medium">Price</th>
                      <th className="py-1 text-center font-medium">Optional</th>
                      <th />
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody>
                    {draft.items.map((l) => {
                      const item = itemsById.get(l.itemId);
                      const line = (item?.salePaise ?? 0) * l.qty;
                      return (
                        <tr key={l.itemId}>
                          <td className="py-1.5">
                            <div className="font-medium">
                              {item?.name ?? "Item"}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {item?.sku}
                              {item && !item.salePaise ? " · not priced" : ""}
                            </div>
                          </td>
                          <td className="py-1.5 text-right">
                            <input
                              className={`${FIELD_CLASS} ml-auto w-16 text-right tabular-nums`}
                              inputMode="decimal"
                              value={String(l.qty)}
                              onChange={(e) =>
                                updateLine(l.itemId, {
                                  qty:
                                    Number(e.target.value.replace(/[^\d.]/g, "")) ||
                                    0,
                                })
                              }
                            />
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {l.isOptional ? (
                              <span className="text-muted-foreground">
                                {formatPaise(line)}
                              </span>
                            ) : (
                              formatPaise(line)
                            )}
                          </td>
                          <td className="py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={l.isOptional}
                              onChange={(e) =>
                                updateLine(l.itemId, {
                                  isOptional: e.target.checked,
                                })
                              }
                            />
                          </td>
                          <td className="py-1.5 text-right">
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => removeLine(l.itemId)}
                              aria-label="Remove item"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </ErpTableBody>
                  <tfoot>
                    <tr className="border-t font-medium">
                      <td className="py-1.5" colSpan={2}>
                        {draft.priceMode === "fixed"
                          ? "Bundle price"
                          : "Kit total (required items)"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatPaise(draftTotal)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </ErpTable>
              )}
            </fieldset>

            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Classes this kit applies to
              </legend>
              {classes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No classes found in masters.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {classes.map((c) => {
                    const on = draft.classIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleClass(c.id)}
                        className={
                          on
                            ? "rounded-full bg-sky-600 px-2.5 py-1 text-xs font-medium text-white"
                            : "rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                        }
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {draft.classIds.length === 0 ? (
                <p className="text-[11px] text-amber-600">
                  With no class selected this kit will not be proposed to anyone
                  at the counter.
                </p>
              ) : null}
            </fieldset>

            <TextField
              label="Notes"
              value={draft.notes}
              onChange={(v) => set("notes", v)}
            />
          </div>
        ) : null}
      </InvDrawer>
    </div>
  );
}
