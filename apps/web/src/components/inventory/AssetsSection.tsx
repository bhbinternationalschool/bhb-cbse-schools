"use client";

/**
 * Asset register — the tagged things the school owns.
 *
 * A consumable is a quantity; an asset is a particular object with a tag, a
 * room and someone responsible for it. This screen answers "where is projector
 * 14 and who has it", and every move or reassignment is kept as history rather
 * than overwriting the previous answer.
 */

import { useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
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
import { invApi, useAsync, useDebounced, useSaver } from "@/lib/inventory/client";
import {
  assetEventLabel,
  assetStatusLabel,
  formatPaise,
  inputToPaise,
  paiseToInput,
  type InvAssetRow,
  type InvAssetStatus,
  type InvBootstrap,
} from "@/lib/inventory/types";
import { RowActionMenu } from "@/components/ui/erp-grid";

type Draft = Partial<InvAssetRow> & {
  costInput?: string;
  changeNote?: string;
};

const STATUS_OPTIONS: { value: InvAssetStatus; label: string }[] = [
  { value: "in_use", label: "In use" },
  { value: "in_store", label: "In store" },
  { value: "under_repair", label: "Under repair" },
  { value: "scrapped", label: "Scrapped" },
  { value: "lost", label: "Lost" },
];

const CONDITION_OPTIONS = [
  { value: "new", label: "New" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
  { value: "scrapped", label: "Scrapped" },
];

export function AssetsSection({ boot }: { boot: InvBootstrap }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [locationId, setLocationId] = useState("");
  const debounced = useDebounced(search, 300);

  const assets = useAsync(
    () => invApi.listAssets({ search: debounced, status, locationId }),
    [debounced, status, locationId],
  );
  const summary = useAsync(() => invApi.assetSummary(), []);
  const saver = useSaver();

  // Only asset-kind items can be registered — registering a box of chalk as a
  // tagged asset is a category error the form should not allow.
  const assetItems = useAsync(
    () => invApi.listItems({ status: "active", itemKind: "asset", pageSize: 200 }),
    [],
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<InvAssetRow | null>(null);
  const [bulk, setBulk] = useState(false);

  const rows = assets.data ?? [];
  const s = summary.data;

  function reloadAll() {
    assets.reload();
    summary.reload();
  }

  async function save() {
    if (!draft?.assetTag) return;
    const ok = await saver.run(
      () =>
        invApi.saveAsset({
          id: draft.id,
          itemId: draft.itemId,
          assetTag: draft.assetTag,
          serialNo: draft.serialNo,
          locationId: draft.locationId,
          custodian: draft.custodian,
          department: draft.department,
          room: draft.room,
          condition: draft.condition,
          status: draft.status,
          purchaseDate: draft.purchaseDate,
          purchaseCostPaise: inputToPaise(draft.costInput ?? ""),
          warrantyUntil: draft.warrantyUntil,
          notes: draft.notes,
          changeNote: draft.changeNote,
        }),
      { success: `Saved ${draft.assetTag}` },
    );
    if (ok) {
      setDraft(null);
      reloadAll();
    }
  }

  async function remove() {
    if (!draft?.id) return;
    const res = await saver.run(() => invApi.removeAsset(draft.id as string));
    if (res) {
      saver.setNotice(res.reason);
      if (res.deleted) setDraft(null);
      reloadAll();
    }
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Assets" value={s?.total ?? "—"} sub="registered" />
        <StatTile label="In use" value={s?.inUse ?? "—"} tone="good" />
        <StatTile
          label="Repair / lost"
          value={s ? s.underRepair + s.lost : "—"}
          tone={s && s.underRepair + s.lost > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="Book value"
          value={s ? formatPaise(s.valuePaise) : "—"}
          sub="excludes scrapped and lost"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={`${FIELD_CLASS} w-full pl-8`}
            placeholder="Search tag, serial, custodian or room"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={`${FIELD_CLASS} w-[150px]`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className={`${FIELD_CLASS} w-[160px]`}
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
        <Button variant="outline" size="sm" onClick={reloadAll}>
          <RefreshCw className="size-3.5" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setBulk(true)}>
          Register many
        </Button>
        <Button
          size="sm"
          onClick={() =>
            setDraft({
              assetTag: "",
              itemId: assetItems.data?.rows[0]?.id ?? "",
              condition: "new",
              status: "in_store",
              locationId:
                boot.settings.defaultLocationId || boot.locations[0]?.id || "",
              costInput: "",
            })
          }
        >
          <Plus className="size-4" />
          New asset
        </Button>
      </div>

      <InvAlert
        error={assets.error || saver.error}
        notice={saver.notice}
        onDismiss={() => {
          saver.setError("");
          saver.setNotice("");
        }}
      />

      {(assetItems.data?.rows.length ?? 0) === 0 && !assetItems.loading ? (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          No catalogue items are marked as assets yet. Set an item&rsquo;s type to
          &ldquo;Asset&rdquo; in the Catalogue before registering one here.
        </p>
      ) : null}

      {assets.loading ? (
        <InvSpinner label="Loading assets" />
      ) : assets.error ? null : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center">
          <p className="text-sm font-medium">Nothing in the asset register</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tag the furniture, lab gear and IT equipment the school owns.
          </p>
        </div>
      ) : (
        <ErpTableShell density="compact" className="overflow-x-auto" exportAs="asset_register" exportTitle="Asset register">
          <ErpTable minWidth="min-w-[940px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left font-medium">Tag</th>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-left font-medium">Where</th>
                <th className="px-3 py-2 text-left font-medium">Custodian</th>
                <th className="px-3 py-2 text-left font-medium">Condition</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {rows.map((a) => (
                <tr
                  key={a.id}
                  className={
                    ["scrapped", "lost"].includes(a.status) ? "opacity-60" : ""
                  }
                >
                  <td className="px-3 py-2 font-mono text-xs">
                    {a.assetTag}
                    {a.serialNo ? (
                      <div className="text-[11px] text-muted-foreground">
                        SN {a.serialNo}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-sm">{a.itemName}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {a.sku}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {a.locationName || "—"}
                    {a.room ? (
                      <div className="text-[11px] text-muted-foreground">
                        {a.room}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {a.custodian || "—"}
                    {a.department ? (
                      <div className="text-[11px] text-muted-foreground">
                        {a.department}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Pill
                      tone={
                        a.status === "in_use"
                          ? "good"
                          : ["scrapped", "lost"].includes(a.status)
                            ? "bad"
                            : a.status === "under_repair"
                              ? "warn"
                              : "neutral"
                      }
                    >
                      {assetStatusLabel(a.status)}
                    </Pill>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {a.condition}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {a.purchaseCostPaise ? formatPaise(a.purchaseCostPaise) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <RowActionMenu
                      row={a}
                      label="Asset actions"
                      actions={[
                        { id: "history", label: "Movement history", onSelect: (x) => setHistory(x) },
                        {
                          id: "edit",
                          label: "Edit details",
                          onSelect: (x) =>
                            setDraft({
                              ...x,
                              costInput: paiseToInput(x.purchaseCostPaise),
                              changeNote: "",
                            }),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}

      {/* Edit / create */}
      <InvDrawer
        open={!!draft}
        wide
        title={draft?.id ? "Edit asset" : "Register an asset"}
        subtitle={
          draft?.id
            ? "Changes to location, custodian, condition or status are kept as history"
            : "One tagged object"
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
            <Button
              size="sm"
              onClick={save}
              disabled={saver.saving || !draft?.assetTag}
            >
              {saver.saving ? "Saving…" : "Save asset"}
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <InvAlert error={saver.error} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Asset tag"
                required
                hint="Must be unique — this is how the thing is found"
                value={draft.assetTag ?? ""}
                onChange={(v) => set("assetTag", v)}
                placeholder="e.g. IT-PROJ-014"
              />
              <TextField
                label="Serial number"
                value={draft.serialNo ?? ""}
                onChange={(v) => set("serialNo", v)}
              />
              {!draft.id ? (
                <SelectField
                  label="What is it"
                  required
                  className="sm:col-span-2"
                  value={draft.itemId ?? ""}
                  options={(assetItems.data?.rows ?? []).map((r) => ({
                    value: r.id,
                    label: `${r.name}${r.variantLabel ? ` — ${r.variantLabel}` : ""}`,
                  }))}
                  onChange={(v) => set("itemId", v)}
                />
              ) : null}
            </div>

            <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Where and who
              </legend>
              <SelectField
                label="Location"
                value={draft.locationId ?? ""}
                options={boot.locations
                  .filter((l) => l.isActive)
                  .map((l) => ({ value: l.id, label: l.name }))}
                onChange={(v) => set("locationId", v)}
              />
              <TextField
                label="Room"
                value={draft.room ?? ""}
                onChange={(v) => set("room", v)}
                placeholder="e.g. Room 12"
              />
              <TextField
                label="Custodian"
                hint="Staff member, class teacher or department"
                value={draft.custodian ?? ""}
                onChange={(v) => set("custodian", v)}
              />
              <TextField
                label="Department"
                value={draft.department ?? ""}
                onChange={(v) => set("department", v)}
              />
            </fieldset>

            <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                State
              </legend>
              <SelectField
                label="Status"
                value={draft.status ?? "in_use"}
                placeholder="In use"
                options={STATUS_OPTIONS}
                onChange={(v) => set("status", v as InvAssetStatus)}
              />
              <SelectField
                label="Condition"
                value={draft.condition ?? "good"}
                placeholder="Good"
                options={CONDITION_OPTIONS}
                onChange={(v) => set("condition", v as Draft["condition"])}
              />
            </fieldset>

            <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Purchase
              </legend>
              <TextField
                label="Bought on"
                type="date"
                value={draft.purchaseDate ?? ""}
                onChange={(v) => set("purchaseDate", v)}
              />
              <MoneyField
                label="Cost"
                value={draft.costInput ?? ""}
                onChange={(v) => set("costInput", v)}
              />
              <TextField
                label="Warranty until"
                type="date"
                value={draft.warrantyUntil ?? ""}
                onChange={(v) => set("warrantyUntil", v)}
              />
            </fieldset>

            <TextField
              label="Notes"
              value={draft.notes ?? ""}
              onChange={(v) => set("notes", v)}
            />
            {draft.id ? (
              <TextField
                label="Why is this changing"
                hint="Shown against the history entries this save creates"
                value={draft.changeNote ?? ""}
                onChange={(v) => set("changeNote", v)}
              />
            ) : null}
          </div>
        ) : null}
      </InvDrawer>

      <AssetHistoryDrawer asset={history} onClose={() => setHistory(null)} />

      <BulkRegisterDrawer
        open={bulk}
        boot={boot}
        items={(assetItems.data?.rows ?? []).map((r) => ({
          value: r.id,
          label: r.name,
        }))}
        onClose={() => setBulk(false)}
        onDone={(msg) => {
          saver.setNotice(msg);
          setBulk(false);
          reloadAll();
        }}
      />
    </div>
  );
}

function AssetHistoryDrawer({
  asset,
  onClose,
}: {
  asset: InvAssetRow | null;
  onClose: () => void;
}) {
  const events = useAsync(
    () => (asset ? invApi.assetHistory(asset.id) : Promise.resolve([])),
    [asset?.id],
  );

  return (
    <InvDrawer
      open={!!asset}
      title="Asset history"
      subtitle={asset ? `${asset.assetTag} · ${asset.itemName}` : ""}
      onClose={onClose}
    >
      {events.loading ? (
        <InvSpinner label="Loading history" />
      ) : events.error ? (
        <InvAlert error={events.error} />
      ) : (events.data ?? []).length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nothing recorded yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {(events.data ?? []).map((e) => (
            <li key={e.id} className="rounded-lg border p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {assetEventLabel(e.kind)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {String(e.at).slice(0, 10)}
                </span>
              </div>
              {e.fromValue || e.toValue ? (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {e.fromValue ? `${e.fromValue} → ` : ""}
                  {e.toValue}
                </div>
              ) : null}
              {e.note ? (
                <div className="mt-0.5 text-xs">{e.note}</div>
              ) : null}
              {e.createdBy ? (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  by {e.createdBy}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </InvDrawer>
  );
}

function BulkRegisterDrawer({
  open,
  boot,
  items,
  onClose,
  onDone,
}: {
  open: boolean;
  boot: InvBootstrap;
  items: { value: string; label: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const saver = useSaver();
  const [itemId, setItemId] = useState("");
  const [count, setCount] = useState("10");
  const [prefix, setPrefix] = useState("");
  const [start, setStart] = useState("1");
  const [locationId, setLocationId] = useState(
    boot.settings.defaultLocationId || boot.locations[0]?.id || "",
  );
  const [costInput, setCostInput] = useState("");

  const n = Number(count) || 0;
  const startNo = Number(start) || 1;
  const preview =
    prefix && n > 0
      ? `${prefix}${String(startNo).padStart(3, "0")} … ${prefix}${String(startNo + n - 1).padStart(3, "0")}`
      : "";

  async function submit() {
    const res = await saver.run(() =>
      invApi.bulkRegisterAssets({
        itemId,
        count: n,
        tagPrefix: prefix,
        startNumber: startNo,
        locationId,
        purchaseCostPaise: inputToPaise(costInput),
      }),
    );
    if (res) {
      onDone(`Registered ${res.created} assets (${res.firstTag} – ${res.lastTag})`);
      setPrefix("");
    }
  }

  return (
    <InvDrawer
      open={open}
      title="Register several assets"
      subtitle="Twenty identical chairs are twenty tagged rows"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={saver.saving || !itemId || !prefix || n < 1}
          >
            {saver.saving ? "Registering…" : `Register ${n || 0}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <InvAlert error={saver.error} />
        <SelectField
          label="What are they"
          required
          value={itemId}
          options={items}
          onChange={setItemId}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="Tag prefix"
            required
            value={prefix}
            onChange={setPrefix}
            placeholder="e.g. FUR-CHR-"
          />
          <NumberField label="Start at" value={start} onChange={setStart} />
          <NumberField label="How many" value={count} onChange={setCount} />
        </div>
        {preview ? (
          <p className="rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs">
            {preview}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Location"
            value={locationId}
            options={boot.locations
              .filter((l) => l.isActive)
              .map((l) => ({ value: l.id, label: l.name }))}
            onChange={setLocationId}
          />
          <MoneyField
            label="Cost each"
            value={costInput}
            onChange={setCostInput}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          If any of these tags already exist the whole batch is refused, so you
          are never left guessing which ones were created.
        </p>
      </div>
    </InvDrawer>
  );
}
