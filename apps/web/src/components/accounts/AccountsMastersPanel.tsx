"use client";

import { useMemo, useState } from "react";
import {
  checkCoaAccountRemoval,
  deleteCoaAccount,
  upsertCoaAccount,
} from "@/lib/accountsCoa";
import {
  checkExpenseCategoryRemoval,
  deleteExpenseCategory,
  upsertExpenseCategory,
} from "@/lib/accountsExpenseCategories";
import {
  accountKindFromCoaGroup,
  listExpenseSubcategories,
  listRootExpenseCategories,
} from "@/lib/accountsLookups";
import type {
  AccountsState,
  AccountsVendor,
  CoaAccount,
  CoaGroup,
  ExpenseCategory,
} from "@/lib/accountsTypes";
import {
  checkVendorRemoval,
  deleteVendor,
  upsertVendor,
} from "@/lib/accountsVendors";
import { formatInr } from "@/lib/fees";
import type { AccountsPanelProps } from "@/components/accounts/AccountsPanels";
import { RemoveControl } from "@/components/masters/RemoveControl";

const CARD =
  "rounded-2xl border border-[rgba(32,48,80,0.12)] bg-white p-4";
const FIELD =
  "w-full rounded-xl border border-[rgba(32,48,80,0.18)] px-3 py-2 text-sm";
const BTN =
  "rounded-xl bg-[#0f2744] px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const BTN_GHOST =
  "rounded-xl border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]";

type MasterTab =
  | "accounts"
  | "categories"
  | "subcategories"
  | "vendors";

function MasterRowActions({
  onEdit,
  removeCheck,
  onRemove,
}: {
  onEdit: () => void;
  removeCheck: ReturnType<typeof checkCoaAccountRemoval>;
  onRemove: () => void;
}) {
  return (
    <div className="flex shrink-0 items-start gap-2">
      <button type="button" className={BTN_GHOST} onClick={onEdit}>
        Edit
      </button>
      <RemoveControl check={removeCheck} onRemove={onRemove} compact />
    </div>
  );
}

export function AccountsMastersPanel({
  state,
  onRefresh,
  onFlash,
  onError,
}: AccountsPanelProps) {
  const [tab, setTab] = useState<MasterTab>("accounts");

  const [editingAccId, setEditingAccId] = useState<string | null>(null);
  const [accCode, setAccCode] = useState("");
  const [accName, setAccName] = useState("");
  const [accGroup, setAccGroup] = useState<CoaGroup>("expense");

  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catName, setCatName] = useState("");
  const [catCoa, setCatCoa] = useState("5900");
  const [catVendorIds, setCatVendorIds] = useState<string[]>([]);

  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [subParent, setSubParent] = useState(
    listRootExpenseCategories(state)[0]?.id ?? "",
  );
  const [subName, setSubName] = useState("");
  const [subCoa, setSubCoa] = useState("5900");
  const [subVendorIds, setSubVendorIds] = useState<string[]>([]);

  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [vendorType, setVendorType] = useState("supplier");
  const [vendorPhone, setVendorPhone] = useState("");
  const [vendorGstin, setVendorGstin] = useState("");

  const expenseAccounts = useMemo(
    () =>
      state.coaAccounts.filter(
        (a) => a.isActive !== false && accountKindFromCoaGroup(a.group) === "expense",
      ),
    [state.coaAccounts],
  );
  const collectionAccounts = useMemo(
    () =>
      state.coaAccounts.filter(
        (a) =>
          a.isActive !== false &&
          accountKindFromCoaGroup(a.group) === "collection",
      ),
    [state.coaAccounts],
  );
  const rootCategories = useMemo(
    () => listRootExpenseCategories(state),
    [state.expenseCategories],
  );
  const subcategories = useMemo(
    () =>
      state.expenseCategories.filter(
        (c) => c.isActive !== false && !!c.parentId,
      ),
    [state.expenseCategories],
  );
  const activeVendors = useMemo(
    () => state.vendors.filter((v) => v.isActive !== false),
    [state.vendors],
  );

  function resetAccForm() {
    setEditingAccId(null);
    setAccCode("");
    setAccName("");
    setAccGroup("expense");
  }

  function startEditAccount(a: CoaAccount) {
    setEditingAccId(a.id);
    setAccCode(a.code);
    setAccName(a.name);
    setAccGroup(a.group);
    setTab("accounts");
  }

  function saveAccount() {
    const res = upsertCoaAccount({
      id: editingAccId ?? undefined,
      code: accCode,
      name: accName,
      group: accGroup,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(
      editingAccId
        ? `Account ${res.account.code} updated`
        : `Account ${res.account.code} saved`,
    );
    resetAccForm();
    onRefresh();
  }

  function removeAccount(accountId: string) {
    const res = deleteCoaAccount(accountId);
    if (!res.ok) {
      onError(res.error);
      return;
    }
    if (editingAccId === accountId) resetAccForm();
    onFlash("Account deleted");
    onRefresh();
  }

  function resetCatForm() {
    setEditingCatId(null);
    setCatName("");
    setCatCoa("5900");
    setCatVendorIds([]);
  }

  function startEditCategory(c: ExpenseCategory) {
    setEditingCatId(c.id);
    setCatName(c.name);
    setCatCoa(c.coaCode);
    setCatVendorIds(c.vendorIds ?? []);
    setTab("categories");
  }

  function toggleCatVendor(vendorId: string) {
    setCatVendorIds((prev) =>
      prev.includes(vendorId)
        ? prev.filter((id) => id !== vendorId)
        : [...prev, vendorId],
    );
  }

  function saveCategory() {
    const res = upsertExpenseCategory({
      id: editingCatId ?? undefined,
      name: catName,
      coaCode: catCoa,
      parentId: "",
      vendorIds: catVendorIds,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(editingCatId ? "Category updated" : "Category saved");
    resetCatForm();
    onRefresh();
  }

  function removeCategory(categoryId: string) {
    const res = deleteExpenseCategory(categoryId);
    if (!res.ok) {
      onError(res.error);
      return;
    }
    if (editingCatId === categoryId) resetCatForm();
    onFlash("Category deleted");
    onRefresh();
  }

  function resetSubForm() {
    setEditingSubId(null);
    setSubName("");
    setSubCoa("5900");
    setSubVendorIds([]);
    setSubParent(listRootExpenseCategories(state)[0]?.id ?? "");
  }

  function startEditSubcategory(c: ExpenseCategory) {
    setEditingSubId(c.id);
    setSubParent(c.parentId);
    setSubName(c.name);
    setSubCoa(c.coaCode);
    setSubVendorIds(c.vendorIds ?? []);
    setTab("subcategories");
  }

  function toggleSubVendor(vendorId: string) {
    setSubVendorIds((prev) =>
      prev.includes(vendorId)
        ? prev.filter((id) => id !== vendorId)
        : [...prev, vendorId],
    );
  }

  function saveSubcategory() {
    if (!subParent) {
      onError("Choose a parent category");
      return;
    }
    const parent = state.expenseCategories.find((c) => c.id === subParent);
    const res = upsertExpenseCategory({
      id: editingSubId ?? undefined,
      name: subName,
      coaCode: subCoa || parent?.coaCode || "5900",
      parentId: subParent,
      vendorIds: subVendorIds,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(editingSubId ? "Sub-category updated" : "Sub-category saved");
    resetSubForm();
    onRefresh();
  }

  function removeSubcategory(categoryId: string) {
    const res = deleteExpenseCategory(categoryId);
    if (!res.ok) {
      onError(res.error);
      return;
    }
    if (editingSubId === categoryId) resetSubForm();
    onFlash("Sub-category deleted");
    onRefresh();
  }

  function resetVendorForm() {
    setEditingVendorId(null);
    setVendorName("");
    setVendorType("supplier");
    setVendorPhone("");
    setVendorGstin("");
  }

  function startEditVendor(v: AccountsVendor) {
    setEditingVendorId(v.id);
    setVendorName(v.name);
    setVendorType(v.type || "supplier");
    setVendorPhone(v.phone);
    setVendorGstin(v.gstin);
    setTab("vendors");
  }

  function saveVendor() {
    const res = upsertVendor({
      id: editingVendorId ?? undefined,
      name: vendorName,
      type: vendorType,
      phone: vendorPhone,
      gstin: vendorGstin,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(editingVendorId ? "Vendor updated" : "Vendor saved");
    resetVendorForm();
    onRefresh();
  }

  function removeVendor(vendorId: string) {
    const res = deleteVendor(vendorId);
    if (!res.ok) {
      onError(res.error);
      return;
    }
    if (editingVendorId === vendorId) resetVendorForm();
    onFlash("Vendor deleted");
    onRefresh();
  }

  function vendorLabelSummary(vendorIds: string[] | undefined) {
    const ids = vendorIds ?? [];
    if (!ids.length) return "";
    const names = ids
      .map((id) => state.vendors.find((v) => v.id === id)?.name)
      .filter(Boolean);
    return names.length ? ` · ${names.length} vendor(s)` : "";
  }

  function VendorLinkPicker({
    selectedIds,
    onToggle,
  }: {
    selectedIds: string[];
    onToggle: (vendorId: string) => void;
  }) {
    if (activeVendors.length === 0) {
      return (
        <p className="text-[11px] text-[var(--muted)]">
          Add vendors under the Vendors tab to link them here.
        </p>
      );
    }
    return (
      <div className="space-y-1 rounded-xl border border-[rgba(32,48,80,0.08)] p-2">
        <p className="text-[11px] font-semibold text-[var(--muted)]">
          Linked vendors (optional)
        </p>
        {activeVendors.map((v) => (
          <label
            key={v.id}
            className="flex items-center gap-2 text-sm text-[var(--brand-deep)]"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(v.id)}
              onChange={() => onToggle(v.id)}
            />
            {v.name}
          </label>
        ))}
      </div>
    );
  }

  function renderAccountRow(a: CoaAccount) {
    const active = editingAccId === a.id;
    return (
      <li
        key={a.id}
        className={`flex items-start justify-between gap-2 border-b border-[rgba(32,48,80,0.06)] py-1.5 ${
          active ? "rounded-lg bg-[rgba(15,39,68,0.06)] px-2" : ""
        }`}
      >
        <span className="min-w-0 pt-0.5">
          {a.code} · {a.name}
        </span>
        <MasterRowActions
          onEdit={() => startEditAccount(a)}
          removeCheck={checkCoaAccountRemoval(a.id, state)}
          onRemove={() => removeAccount(a.id)}
        />
      </li>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-[var(--muted)]">
        Chart of accounts, vendors, expense categories and sub-categories.
        Link vendors to categories for optional selection on expense entry. Delete is
        allowed only when no vouchers, bills, or ledger entries reference an item.
      </p>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["accounts", "Accounts"],
            ["categories", "Categories"],
            ["subcategories", "Sub-categories"],
            ["vendors", "Vendors"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
              tab === id
                ? "bg-[var(--brand-deep)] text-white"
                : "border border-[rgba(32,48,80,0.15)] bg-white text-[var(--brand-deep)]"
            }`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "accounts" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={`${CARD} space-y-3`}>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              {editingAccId ? "Edit account" : "New account"}
            </h3>
            <select
              className={FIELD}
              value={accGroup}
              onChange={(e) => setAccGroup(e.target.value as CoaGroup)}
            >
              <option value="expense">Expense account</option>
              <option value="income">Collection / income account</option>
              <option value="assets">Asset</option>
              <option value="liabilities">Liability</option>
              <option value="equity">Equity</option>
            </select>
            <input
              className={FIELD}
              placeholder="Code e.g. 5070"
              value={accCode}
              onChange={(e) => setAccCode(e.target.value)}
              disabled={!!editingAccId}
              title={
                editingAccId
                  ? "Account code cannot be changed after creation"
                  : undefined
              }
            />
            <input
              className={FIELD}
              placeholder="Account name"
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
            />
            <div className="flex gap-2">
              {editingAccId ? (
                <button type="button" className={BTN_GHOST} onClick={resetAccForm}>
                  Cancel
                </button>
              ) : null}
              <button type="button" className={BTN} onClick={saveAccount}>
                {editingAccId ? "Update account" : "Save account"}
              </button>
            </div>
          </section>

          <section className={`${CARD} space-y-3`}>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              Expense accounts
            </h3>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {expenseAccounts.map(renderAccountRow)}
            </ul>
            <h3 className="pt-2 text-sm font-bold text-[var(--brand-deep)]">
              Collection accounts
            </h3>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {collectionAccounts.map(renderAccountRow)}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "categories" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={`${CARD} space-y-3`}>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              {editingCatId ? "Edit category" : "New category"}
            </h3>
            <input
              className={FIELD}
              placeholder="Category name"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
            />
            <input
              className={FIELD}
              placeholder="COA code"
              value={catCoa}
              onChange={(e) => setCatCoa(e.target.value)}
            />
            <VendorLinkPicker selectedIds={catVendorIds} onToggle={toggleCatVendor} />
            <div className="flex gap-2">
              {editingCatId ? (
                <button type="button" className={BTN_GHOST} onClick={resetCatForm}>
                  Cancel
                </button>
              ) : null}
              <button type="button" className={BTN} onClick={saveCategory}>
                {editingCatId ? "Update category" : "Save category"}
              </button>
            </div>
          </section>
          <section className={CARD}>
            <h3 className="mb-2 text-sm font-bold text-[var(--brand-deep)]">
              Categories ({rootCategories.length})
            </h3>
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {rootCategories.map((c) => {
                const active = editingCatId === c.id;
                return (
                  <li
                    key={c.id}
                    className={`flex items-start justify-between gap-2 border-b border-[rgba(32,48,80,0.06)] py-1.5 ${
                      active ? "rounded-lg bg-[rgba(15,39,68,0.06)] px-2" : ""
                    }`}
                  >
                    <span className="min-w-0 pt-0.5">
                      {c.name}
                      <span className="text-[var(--muted)]">
                        {" "}
                        · {c.coaCode}
                        {vendorLabelSummary(c.vendorIds)}
                      </span>
                    </span>
                    <MasterRowActions
                      onEdit={() => startEditCategory(c)}
                      removeCheck={checkExpenseCategoryRemoval(c.id, state)}
                      onRemove={() => removeCategory(c.id)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "subcategories" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={`${CARD} space-y-3`}>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              {editingSubId ? "Edit sub-category" : "New sub-category"}
            </h3>
            <select
              className={FIELD}
              value={subParent}
              onChange={(e) => setSubParent(e.target.value)}
            >
              {rootCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              className={FIELD}
              placeholder="Sub-category name"
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
            />
            <input
              className={FIELD}
              placeholder="COA code (optional)"
              value={subCoa}
              onChange={(e) => setSubCoa(e.target.value)}
            />
            <VendorLinkPicker selectedIds={subVendorIds} onToggle={toggleSubVendor} />
            <div className="flex gap-2">
              {editingSubId ? (
                <button type="button" className={BTN_GHOST} onClick={resetSubForm}>
                  Cancel
                </button>
              ) : null}
              <button type="button" className={BTN} onClick={saveSubcategory}>
                {editingSubId ? "Update sub-category" : "Save sub-category"}
              </button>
            </div>
          </section>
          <section className={CARD}>
            <h3 className="mb-2 text-sm font-bold text-[var(--brand-deep)]">
              Sub-categories ({subcategories.length})
            </h3>
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {subcategories.map((c) => {
                const parent = state.expenseCategories.find(
                  (p) => p.id === c.parentId,
                );
                const active = editingSubId === c.id;
                return (
                  <li
                    key={c.id}
                    className={`flex items-start justify-between gap-2 border-b border-[rgba(32,48,80,0.06)] py-1.5 ${
                      active ? "rounded-lg bg-[rgba(15,39,68,0.06)] px-2" : ""
                    }`}
                  >
                    <span className="min-w-0 pt-0.5">
                      {parent?.name} → {c.name}
                      <span className="text-[var(--muted)]">
                        {" "}
                        · {c.coaCode}
                        {vendorLabelSummary(c.vendorIds)}
                      </span>
                    </span>
                    <MasterRowActions
                      onEdit={() => startEditSubcategory(c)}
                      removeCheck={checkExpenseCategoryRemoval(c.id, state)}
                      onRemove={() => removeSubcategory(c.id)}
                    />
                  </li>
                );
              })}
            </ul>
            {subParent ? (
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                Under{" "}
                {state.expenseCategories.find((c) => c.id === subParent)?.name}:{" "}
                {listExpenseSubcategories(subParent, state)
                  .map((s) => s.name)
                  .join(", ") || "none yet"}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === "vendors" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={`${CARD} space-y-3`}>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              {editingVendorId ? "Edit vendor" : "New vendor"}
            </h3>
            <input
              className={FIELD}
              placeholder="Vendor name"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
            />
            <input
              className={FIELD}
              placeholder="Type e.g. supplier"
              value={vendorType}
              onChange={(e) => setVendorType(e.target.value)}
            />
            <input
              className={FIELD}
              placeholder="Phone"
              value={vendorPhone}
              onChange={(e) => setVendorPhone(e.target.value)}
            />
            <input
              className={FIELD}
              placeholder="GSTIN"
              value={vendorGstin}
              onChange={(e) => setVendorGstin(e.target.value)}
            />
            <div className="flex gap-2">
              {editingVendorId ? (
                <button type="button" className={BTN_GHOST} onClick={resetVendorForm}>
                  Cancel
                </button>
              ) : null}
              <button type="button" className={BTN} onClick={saveVendor}>
                {editingVendorId ? "Update vendor" : "Save vendor"}
              </button>
            </div>
          </section>
          <section className={CARD}>
            <h3 className="mb-2 text-sm font-bold text-[var(--brand-deep)]">
              Vendors ({state.vendors.length})
            </h3>
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {state.vendors.map((v) => {
                const active = editingVendorId === v.id;
                return (
                  <li
                    key={v.id}
                    className={`flex items-start justify-between gap-2 border-b border-[rgba(32,48,80,0.06)] py-1.5 ${
                      active ? "rounded-lg bg-[rgba(15,39,68,0.06)] px-2" : ""
                    } ${v.isActive === false ? "opacity-60" : ""}`}
                  >
                    <span className="min-w-0 pt-0.5">
                      {v.name}
                      {v.phone ? (
                        <span className="text-[var(--muted)]"> · {v.phone}</span>
                      ) : null}
                    </span>
                    <MasterRowActions
                      onEdit={() => startEditVendor(v)}
                      removeCheck={checkVendorRemoval(v.id, state)}
                      onRemove={() => removeVendor(v.id)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
