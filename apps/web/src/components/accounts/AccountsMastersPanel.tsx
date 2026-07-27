"use client";

import { useMemo, useState } from "react";
import {
  accountKindFromCoaGroup,
  listExpenseSubcategories,
  listRootExpenseCategories,
  upsertCoaAccount,
  upsertExpenseCategory,
  type AccountsState,
  type CoaGroup,
} from "@/lib/accounts";
import type { AccountsPanelProps } from "@/components/accounts/AccountsPanels";

const CARD =
  "rounded-2xl border border-[rgba(32,48,80,0.12)] bg-white p-4";
const FIELD =
  "w-full rounded-xl border border-[rgba(32,48,80,0.18)] px-3 py-2 text-sm";
const BTN =
  "rounded-xl bg-[#0f2744] px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

type MasterTab = "accounts" | "categories" | "subcategories";

export function AccountsMastersPanel({
  state,
  onRefresh,
  onFlash,
  onError,
}: AccountsPanelProps) {
  const [tab, setTab] = useState<MasterTab>("accounts");

  const [accCode, setAccCode] = useState("");
  const [accName, setAccName] = useState("");
  const [accGroup, setAccGroup] = useState<CoaGroup>("expense");

  const [catName, setCatName] = useState("");
  const [catCoa, setCatCoa] = useState("5900");

  const [subParent, setSubParent] = useState(
    listRootExpenseCategories(state)[0]?.id ?? "",
  );
  const [subName, setSubName] = useState("");
  const [subCoa, setSubCoa] = useState("5900");

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

  function saveAccount() {
    const res = upsertCoaAccount({
      code: accCode,
      name: accName,
      group: accGroup,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(`Account ${res.account.code} saved`);
    setAccCode("");
    setAccName("");
    onRefresh();
  }

  function saveCategory() {
    const res = upsertExpenseCategory({
      name: catName,
      coaCode: catCoa,
      parentId: "",
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Category saved");
    setCatName("");
    onRefresh();
  }

  function saveSubcategory() {
    if (!subParent) {
      onError("Choose a parent category");
      return;
    }
    const parent = state.expenseCategories.find((c) => c.id === subParent);
    const res = upsertExpenseCategory({
      name: subName,
      coaCode: subCoa || parent?.coaCode || "5900",
      parentId: subParent,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Sub-category saved");
    setSubName("");
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-[var(--muted)]">
        Chart of accounts for expenses & collections, plus expense categories and
        sub-categories used on voucher lines.
      </p>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["accounts", "Accounts"],
            ["categories", "Categories"],
            ["subcategories", "Sub-categories"],
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
              New account
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
            />
            <input
              className={FIELD}
              placeholder="Account name"
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
            />
            <button type="button" className={BTN} onClick={saveAccount}>
              Save account
            </button>
          </section>

          <section className={`${CARD} space-y-3`}>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              Expense accounts
            </h3>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {expenseAccounts.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span>
                    {a.code} · {a.name}
                  </span>
                </li>
              ))}
            </ul>
            <h3 className="pt-2 text-sm font-bold text-[var(--brand-deep)]">
              Collection accounts
            </h3>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {collectionAccounts.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span>
                    {a.code} · {a.name}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "categories" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={`${CARD} space-y-3`}>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              New category
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
            <button type="button" className={BTN} onClick={saveCategory}>
              Save category
            </button>
          </section>
          <section className={CARD}>
            <h3 className="mb-2 text-sm font-bold text-[var(--brand-deep)]">
              Categories ({rootCategories.length})
            </h3>
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {rootCategories.map((c) => (
                <li key={c.id} className="flex justify-between gap-2 border-b border-[rgba(32,48,80,0.06)] py-1">
                  <span>{c.name}</span>
                  <span className="text-[var(--muted)]">{c.coaCode}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "subcategories" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={`${CARD} space-y-3`}>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              New sub-category
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
            <button type="button" className={BTN} onClick={saveSubcategory}>
              Save sub-category
            </button>
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
                return (
                  <li
                    key={c.id}
                    className="flex justify-between gap-2 border-b border-[rgba(32,48,80,0.06)] py-1"
                  >
                    <span>
                      {parent?.name} → {c.name}
                    </span>
                    <span className="text-[var(--muted)]">{c.coaCode}</span>
                  </li>
                );
              })}
            </ul>
            {subParent ? (
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                Under {state.expenseCategories.find((c) => c.id === subParent)?.name}:{" "}
                {listExpenseSubcategories(subParent, state)
                  .map((s) => s.name)
                  .join(", ") || "none yet"}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
