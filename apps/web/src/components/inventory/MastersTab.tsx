"use client";

/**
 * Masters — categories, units and stock locations, plus module settings.
 *
 * Deliberately plain: these lists are short and edited rarely, so each row is
 * an inline form that saves on its own. Nothing here re-reads the catalogue.
 */

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FIELD_CLASS,
  InvAlert,
  Pill,
  StatTile,
} from "@/components/inventory/InvUi";
import { invApi, useSaver } from "@/lib/inventory/client";
import { formatPaise, inputToPaise, paiseToInput } from "@/lib/inventory/types";
import type {
  InvBootstrap,
  InvCategory,
  InvLocation,
  InvMasterKind,
  InvUom,
} from "@/lib/inventory/types";

const LOCATION_KINDS = [
  "store",
  "library",
  "lab",
  "hostel",
  "mess",
  "office",
  "other",
] as const;

export function MastersTab({
  boot,
  onChanged,
}: {
  boot: InvBootstrap;
  onChanged: () => void;
}) {
  const saver = useSaver();

  const [newCategory, setNewCategory] = useState({
    name: "",
    kind: "consumable" as "consumable" | "asset",
  });
  const [newUom, setNewUom] = useState({ name: "", decimals: "0" });
  const [newLocation, setNewLocation] = useState({
    name: "",
    kind: "store" as (typeof LOCATION_KINDS)[number],
  });

  async function addMaster(kind: InvMasterKind, row: Record<string, unknown>) {
    const ok = await saver.run(() => invApi.saveMaster(kind, row), {
      success: "Added",
    });
    if (ok) onChanged();
    return !!ok;
  }

  async function toggleActive(
    kind: InvMasterKind,
    row: { id: string; name: string; isActive: boolean },
  ) {
    const ok = await saver.run(() =>
      invApi.saveMaster(kind, { id: row.id, name: row.name, isActive: !row.isActive }),
    );
    if (ok) onChanged();
  }

  async function removeMaster(kind: InvMasterKind, id: string) {
    const res = await saver.run(() => invApi.removeMaster(kind, id));
    if (res) {
      saver.setNotice(res.reason);
      onChanged();
    }
  }

  async function saveSettings(patch: Parameters<typeof invApi.saveSettings>[0]) {
    const ok = await saver.run(() => invApi.saveSettings(patch), {
      success: "Settings saved",
    });
    if (ok) onChanged();
  }

  const [threshold, setThreshold] = useState(
    paiseToInput(boot.settings.poApprovalThresholdPaise),
  );

  return (
    <div className="space-y-4">
      <InvAlert
        error={saver.error}
        notice={saver.notice}
        onDismiss={() => {
          saver.setError("");
          saver.setNotice("");
        }}
      />

      <div className="grid gap-2 sm:grid-cols-4">
        <StatTile label="Items" value={boot.counts.activeItems} sub="active" />
        <StatTile label="Vendors" value={boot.counts.vendors} />
        <StatTile label="Kits" value={boot.counts.kits} />
        <StatTile label="Price lists" value={boot.priceLists.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Categories */}
        <section className="space-y-2 rounded-xl border p-3">
          <h3 className="text-sm font-semibold">Categories</h3>
          <p className="text-xs text-muted-foreground">
            Classify items. &ldquo;Asset&rdquo; categories are tracked in the asset
            register rather than consumed on sale.
          </p>
          <MasterList
            rows={boot.categories}
            render={(c: InvCategory) => (
              <>
                <span className="font-medium">{c.name}</span>
                {c.kind === "asset" ? <Pill>asset</Pill> : null}
              </>
            )}
            onToggle={(r) => toggleActive("category", r)}
            onRemove={(id) => removeMaster("category", id)}
          />
          <div className="flex items-center gap-1.5 pt-1">
            <input
              className={`${FIELD_CLASS} w-full flex-1`}
              placeholder="New category"
              value={newCategory.name}
              onChange={(e) =>
                setNewCategory((s) => ({ ...s, name: e.target.value }))
              }
            />
            <select
              className={`${FIELD_CLASS} w-28`}
              value={newCategory.kind}
              onChange={(e) =>
                setNewCategory((s) => ({
                  ...s,
                  kind: e.target.value as "consumable" | "asset",
                }))
              }
            >
              <option value="consumable">Consumable</option>
              <option value="asset">Asset</option>
            </select>
            <Button
              size="sm"
              disabled={!newCategory.name.trim() || saver.saving}
              onClick={async () => {
                if (await addMaster("category", newCategory)) {
                  setNewCategory({ name: "", kind: "consumable" });
                }
              }}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </section>

        {/* Units */}
        <section className="space-y-2 rounded-xl border p-3">
          <h3 className="text-sm font-semibold">Units of measurement</h3>
          <p className="text-xs text-muted-foreground">
            Decimals decide how quantities are shown — 0 for pieces, 3 for kg.
          </p>
          <MasterList
            rows={boot.uoms}
            render={(u: InvUom) => (
              <>
                <span className="font-medium">{u.name}</span>
                {u.decimals ? <Pill tone="info">{u.decimals} dp</Pill> : null}
              </>
            )}
            onToggle={(r) => toggleActive("uom", r)}
            onRemove={(id) => removeMaster("uom", id)}
          />
          <div className="flex items-center gap-1.5 pt-1">
            <input
              className={`${FIELD_CLASS} w-full flex-1`}
              placeholder="New unit"
              value={newUom.name}
              onChange={(e) => setNewUom((s) => ({ ...s, name: e.target.value }))}
            />
            <select
              className={`${FIELD_CLASS} w-20`}
              value={newUom.decimals}
              onChange={(e) =>
                setNewUom((s) => ({ ...s, decimals: e.target.value }))
              }
            >
              <option value="0">0 dp</option>
              <option value="1">1 dp</option>
              <option value="2">2 dp</option>
              <option value="3">3 dp</option>
            </select>
            <Button
              size="sm"
              disabled={!newUom.name.trim() || saver.saving}
              onClick={async () => {
                if (
                  await addMaster("uom", {
                    name: newUom.name,
                    decimals: Number(newUom.decimals) || 0,
                  })
                ) {
                  setNewUom({ name: "", decimals: "0" });
                }
              }}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </section>

        {/* Locations */}
        <section className="space-y-2 rounded-xl border p-3">
          <h3 className="text-sm font-semibold">Stock locations</h3>
          <p className="text-xs text-muted-foreground">
            Where stock physically sits. Every movement names one.
          </p>
          <MasterList
            rows={boot.locations}
            render={(l: InvLocation) => (
              <>
                <span className="font-medium">{l.name}</span>
                <Pill tone="info">{l.kind}</Pill>
              </>
            )}
            onToggle={(r) => toggleActive("location", r)}
            onRemove={(id) => removeMaster("location", id)}
          />
          <div className="flex items-center gap-1.5 pt-1">
            <input
              className={`${FIELD_CLASS} w-full flex-1`}
              placeholder="New location"
              value={newLocation.name}
              onChange={(e) =>
                setNewLocation((s) => ({ ...s, name: e.target.value }))
              }
            />
            <select
              className={`${FIELD_CLASS} w-24`}
              value={newLocation.kind}
              onChange={(e) =>
                setNewLocation((s) => ({
                  ...s,
                  kind: e.target.value as (typeof LOCATION_KINDS)[number],
                }))
              }
            >
              {LOCATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!newLocation.name.trim() || saver.saving}
              onClick={async () => {
                if (await addMaster("location", newLocation)) {
                  setNewLocation({ name: "", kind: "store" });
                }
              }}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </section>
      </div>

      <section className="space-y-3 rounded-xl border p-3">
        <h3 className="text-sm font-semibold">Module settings</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Purchase orders need approval above
            </span>
            <div className="flex items-center gap-1.5">
              <input
                className={`${FIELD_CLASS} w-full text-right tabular-nums`}
                inputMode="decimal"
                value={threshold}
                onChange={(e) =>
                  setThreshold(e.target.value.replace(/[^\d.]/g, ""))
                }
              />
              <Button
                size="sm"
                variant="outline"
                disabled={saver.saving}
                onClick={() =>
                  saveSettings({
                    poApprovalThresholdPaise: inputToPaise(threshold),
                  })
                }
              >
                Save
              </Button>
            </div>
            <span className="block text-[11px] text-muted-foreground">
              Currently {formatPaise(boot.settings.poApprovalThresholdPaise)}
            </span>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Default location
            </span>
            <select
              className={`${FIELD_CLASS} w-full`}
              value={boot.settings.defaultLocationId}
              onChange={(e) => saveSettings({ defaultLocationId: e.target.value })}
            >
              <option value="">— none —</option>
              {boot.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Default price list
            </span>
            <select
              className={`${FIELD_CLASS} w-full`}
              value={boot.settings.defaultPriceListId}
              onChange={(e) => saveSettings({ defaultPriceListId: e.target.value })}
            >
              <option value="">— none —</option>
              {boot.priceLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={boot.settings.trackGst}
                onChange={(e) => saveSettings({ trackGst: e.target.checked })}
              />
              Track GST on purchase and sale
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={boot.settings.walkinSalesEnabled}
                onChange={(e) =>
                  saveSettings({ walkinSalesEnabled: e.target.checked })
                }
              />
              Allow walk-in (cash) sales
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={boot.settings.allowNegativeStock}
                onChange={(e) =>
                  saveSettings({ allowNegativeStock: e.target.checked })
                }
              />
              Allow stock to go negative
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={boot.settings.allowCreditSales}
                onChange={(e) =>
                  saveSettings({ allowCreditSales: e.target.checked })
                }
              />
              Allow sales on account (unpaid)
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={boot.settings.gstCreditEligible}
                onChange={(e) =>
                  saveSettings({ gstCreditEligible: e.target.checked })
                }
              />
              We reclaim input GST
              <span className="text-[10px] text-muted-foreground">
                (off = GST counts as part of the cost)
              </span>
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}

function MasterList<T extends { id: string; name: string; isActive: boolean }>({
  rows,
  render,
  onToggle,
  onRemove,
}: {
  rows: T[];
  render: (row: T) => React.ReactNode;
  onToggle: (row: T) => void;
  onRemove: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground">Nothing yet.</p>;
  }
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((r) => (
        <li
          key={r.id}
          className={`flex items-center gap-2 px-2.5 py-1.5 text-sm ${
            r.isActive ? "" : "opacity-60"
          }`}
        >
          <span className="flex flex-1 items-center gap-1.5">{render(r)}</span>
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:underline"
            onClick={() => onToggle(r)}
          >
            {r.isActive ? "disable" : "enable"}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(r.id)}
            aria-label={`Remove ${r.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
