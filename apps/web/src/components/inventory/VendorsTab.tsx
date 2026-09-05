"use client";

/**
 * Vendors — one record, stored server-side.
 *
 * The old module kept vendors in three places (Accounts `vendors`, Store
 * `sources`, and a name snapshot on each PO) and none of them reached the
 * database, so a vendor disappeared at the next login. Here a vendor is a row
 * in `inv_vendors`; the drawer's Save is an HTTP request, and the list reloads
 * from the server afterwards. What you see is what is stored.
 */

import { useMemo, useState } from "react";
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
  NumberField,
  Pill,
  SelectField,
  TextField,
} from "@/components/inventory/InvUi";
import { invApi, useAsync, useDebounced, useSaver } from "@/lib/inventory/client";
import type { InvVendor } from "@/lib/inventory/types";
import { RowActionMenu } from "@/components/ui/erp-grid";

const EMPTY: Partial<InvVendor> = {
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  gstin: "",
  pan: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  paymentTermsDays: 0,
  defaultDiscountPct: 0,
  bankAccountName: "",
  bankAccountNo: "",
  bankIfsc: "",
  notes: "",
  isActive: true,
};

export function VendorsTab({ onChanged }: { onChanged?: () => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const debounced = useDebounced(search, 300);

  const list = useAsync(
    () => invApi.listVendors({ search: debounced, status }),
    [debounced, status],
  );

  const [draft, setDraft] = useState<Partial<InvVendor> | null>(null);
  const saver = useSaver();

  const set = <K extends keyof InvVendor>(key: K, value: InvVendor[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  async function save() {
    if (!draft) return;
    const saved = await saver.run(() => invApi.saveVendor(draft), {
      success: `Saved ${draft.name}`,
    });
    if (saved) {
      setDraft(null);
      list.reload();
      onChanged?.();
    }
  }

  async function remove(v: InvVendor) {
    const res = await saver.run(() => invApi.removeVendor(v.id));
    if (res) {
      saver.setNotice(res.reason);
      setDraft(null);
      list.reload();
      onChanged?.();
    }
  }

  const vendors = useMemo(() => list.data ?? [], [list.data]);
  const counts = useMemo(
    () => ({
      total: vendors.length,
      inactive: vendors.filter((v) => !v.isActive).length,
    }),
    [vendors],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={`${FIELD_CLASS} w-full pl-8`}
            placeholder="Search name, code, phone or GSTIN"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={`${FIELD_CLASS} w-[130px]`}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="all">All</option>
        </select>
        <Button variant="outline" size="sm" onClick={() => list.reload()}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
        <Button size="sm" onClick={() => setDraft({ ...EMPTY })}>
          <Plus className="size-4" />
          New vendor
        </Button>
      </div>

      <InvAlert
        error={list.error || saver.error}
        notice={saver.notice}
        onDismiss={() => {
          saver.setError("");
          saver.setNotice("");
        }}
      />

      {list.loading ? (
        <InvSpinner label="Loading vendors" />
      ) : vendors.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center">
          <p className="text-sm font-medium">No vendors yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add the suppliers you buy books, uniform and stationery from. They
            are saved to the school database, not to this browser.
          </p>
          <Button className="mt-3" size="sm" onClick={() => setDraft({ ...EMPTY })}>
            <Plus className="size-4" />
            Add the first vendor
          </Button>
        </div>
      ) : (
        <ErpTableShell density="compact" className="overflow-x-auto" exportAs="store_vendors" exportTitle="Store vendors">
          <ErpTable minWidth="min-w-[820px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left font-medium">Code</th>
                <th className="px-3 py-2 text-left font-medium">Vendor</th>
                <th className="px-3 py-2 text-left font-medium">Contact</th>
                <th className="px-3 py-2 text-left font-medium">GSTIN</th>
                <th className="px-3 py-2 text-right font-medium">Terms</th>
                <th className="px-3 py-2 text-right font-medium">Discount</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {vendors.map((v) => (
                <tr key={v.id}>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {v.code || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{v.name}</span>
                      {!v.isActive ? <Pill tone="warn">inactive</Pill> : null}
                    </div>
                    {v.city ? (
                      <div className="text-xs text-muted-foreground">{v.city}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <div>{v.contactPerson || "—"}</div>
                    <div className="text-xs text-muted-foreground">{v.phone}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{v.gstin || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {v.paymentTermsDays ? `${v.paymentTermsDays} d` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {v.defaultDiscountPct ? `${v.defaultDiscountPct}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RowActionMenu
                      row={v}
                      label={`Actions for ${v.name}`}
                      actions={[
                        { id: "edit", label: "Edit details", onSelect: (r) => setDraft(r) },
                        {
                          id: "bills",
                          label: "Bills & payments (Accounts)",
                          onSelect: () => {
                            window.location.href = "/accounts?tab=bills";
                          },
                        },
                        {
                          id: "wa",
                          label: "Send WhatsApp",
                          disabled: (r) => !r.phone,
                          onSelect: (r) => {
                            window.open(`https://wa.me/${String(r.phone ?? "").replace(/\D/g, "")}`, "_blank", "noopener");
                          },
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

      {vendors.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {counts.total} vendor{counts.total === 1 ? "" : "s"} shown
          {counts.inactive ? `, ${counts.inactive} inactive` : ""}.
        </p>
      ) : null}

      <InvDrawer
        open={!!draft}
        title={draft?.id ? "Edit vendor" : "New vendor"}
        subtitle={
          draft?.id
            ? `Code ${draft.code || "—"} · saved to the school database`
            : "Saved to the school database — it will still be here after you log out"
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
                onClick={() => remove(draft as InvVendor)}
              >
                Delete
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saver.saving || !draft?.name}>
              {saver.saving ? "Saving…" : "Save vendor"}
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <InvAlert error={saver.error} />

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Vendor name"
                required
                className="sm:col-span-2"
                value={draft.name ?? ""}
                onChange={(v) => set("name", v)}
                placeholder="e.g. Sharma Book Depot"
              />
              <TextField
                label="Contact person"
                value={draft.contactPerson ?? ""}
                onChange={(v) => set("contactPerson", v)}
              />
              <TextField
                label="Phone"
                value={draft.phone ?? ""}
                onChange={(v) => set("phone", v)}
              />
              <TextField
                label="Email"
                type="email"
                value={draft.email ?? ""}
                onChange={(v) => set("email", v)}
              />
              <TextField
                label="Legal / billing name"
                hint="If the invoice name differs from the trade name"
                value={draft.legalName ?? ""}
                onChange={(v) => set("legalName", v)}
              />
            </div>

            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Tax & trade terms
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="GSTIN"
                  value={draft.gstin ?? ""}
                  onChange={(v) => set("gstin", v.toUpperCase())}
                />
                <TextField
                  label="PAN"
                  value={draft.pan ?? ""}
                  onChange={(v) => set("pan", v.toUpperCase())}
                />
                <NumberField
                  label="Payment terms"
                  suffix="days"
                  hint="Days after the bill date that payment is due"
                  value={String(draft.paymentTermsDays ?? 0)}
                  onChange={(v) => set("paymentTermsDays", Number(v) || 0)}
                />
                <NumberField
                  label="Standard discount"
                  suffix="%"
                  hint="Defaults onto purchase order lines for this vendor"
                  value={String(draft.defaultDiscountPct ?? 0)}
                  onChange={(v) => set("defaultDiscountPct", Number(v) || 0)}
                />
              </div>
            </fieldset>

            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Address
              </legend>
              <TextField
                label="Address"
                value={draft.address ?? ""}
                onChange={(v) => set("address", v)}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField
                  label="City"
                  value={draft.city ?? ""}
                  onChange={(v) => set("city", v)}
                />
                <TextField
                  label="State"
                  value={draft.state ?? ""}
                  onChange={(v) => set("state", v)}
                />
                <TextField
                  label="PIN"
                  value={draft.pincode ?? ""}
                  onChange={(v) => set("pincode", v)}
                />
              </div>
            </fieldset>

            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Bank details (for payments)
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Account name"
                  className="sm:col-span-2"
                  value={draft.bankAccountName ?? ""}
                  onChange={(v) => set("bankAccountName", v)}
                />
                <TextField
                  label="Account number"
                  value={draft.bankAccountNo ?? ""}
                  onChange={(v) => set("bankAccountNo", v)}
                />
                <TextField
                  label="IFSC"
                  value={draft.bankIfsc ?? ""}
                  onChange={(v) => set("bankIfsc", v.toUpperCase())}
                />
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Notes"
                className="sm:col-span-2"
                value={draft.notes ?? ""}
                onChange={(v) => set("notes", v)}
              />
              <SelectField
                label="Status"
                value={draft.isActive === false ? "inactive" : "active"}
                placeholder="Active"
                options={[
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                ]}
                onChange={(v) => set("isActive", v !== "inactive")}
              />
            </div>
          </div>
        ) : null}
      </InvDrawer>
    </div>
  );
}
