"use client";

import { useEffect, useState } from "react";
import { formatInr } from "@/lib/fees";
import {
  createStoreSellReturn,
  loadStore,
  returnedQtyByItem,
  seedStoreIfEmpty,
  type StoreIssue,
  type StoreSellReturn,
} from "@/lib/store";
import { useDemoSession } from "@/components/shell/SessionContext";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

const card = "rounded-xl border border-[var(--border)] bg-[var(--card)] p-4";
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function StoreSellReturnPanel() {
  const session = useDemoSession();
  const [issues, setIssues] = useState<StoreIssue[]>([]);
  const [sellReturns, setSellReturns] = useState<StoreSellReturn[]>([]);
  const [issueId, setIssueId] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayIso);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function refresh() {
    seedStoreIfEmpty();
    const store = loadStore();
    setIssues(
      store.issues
        .filter((i) => !i.voidedAt)
        .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn)),
    );
    setSellReturns(store.sellReturns ?? []);
  }

  useEffect(() => {
    refresh();
  }, []);

  const issue = issues.find((i) => i.id === issueId);
  const already = issue ? returnedQtyByItem(issue.id) : new Map<string, number>();

  function onSave() {
    if (!issue) {
      setError("Pick an issue");
      return;
    }
    const lines = issue.lines
      .map((l) => ({
        itemId: l.itemId,
        qty: Math.floor(Number(qty[l.itemId] || "0") || 0),
      }))
      .filter((l) => l.qty > 0);
    const r = createStoreSellReturn({
      issueId: issue.id,
      returnedOn: date,
      note,
      createdBy: session.fullName,
      lines,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setQty({});
    setNote("");
    setError(null);
    setNotice(
      `Return ${r.sellReturn.returnNo} · ${formatInr(r.sellReturn.totalPaise)} credited · stock restored`,
    );
    window.setTimeout(() => setNotice(null), 2800);
    refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}
      <div className={card}>
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Return sold items to school
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Stock restored · Fee Take / credit due auto-reduced (billed = sale −
          returns).
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Issue
            </span>
            <select
              className={`${field} min-w-[280px]`}
              value={issueId}
              onChange={(e) => {
                setIssueId(e.target.value);
                setQty({});
              }}
            >
              <option value="">Pick issue</option>
              {issues.slice(0, 80).map((iss) => (
                <option key={iss.id} value={iss.id}>
                  {iss.issueNo} · {iss.issuedOn} · {formatInr(iss.totalPaise)}
                  {iss.returnedPaise
                    ? ` (−${formatInr(iss.returnedPaise)})`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Date
            </span>
            <input
              type="date"
              className={field}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Note
            </span>
            <input
              className={`${field} min-w-[160px]`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={btn}
            disabled={!issueId}
            onClick={onSave}
          >
            Post return
          </button>
        </div>
        {issue ? (
          <ul className="mt-4 divide-y text-sm">
            {issue.lines.map((l) => {
              const left = l.qty - (already.get(l.itemId) ?? 0);
              return (
                <li
                  key={l.itemId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    {l.name}
                    {l.sizeLabel ? ` ${l.sizeLabel}` : ""} · sold {l.qty} · left{" "}
                    {left}
                  </span>
                  <input
                    className={`${field} w-20`}
                    type="number"
                    min={0}
                    max={left}
                    disabled={left <= 0}
                    value={qty[l.itemId] ?? ""}
                    onChange={(e) =>
                      setQty((q) => ({ ...q, [l.itemId]: e.target.value }))
                    }
                    placeholder="Qty"
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <div className={card}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Recent sell returns
        </h3>
        <ul className="mt-2 divide-y text-sm">
          {sellReturns.slice(0, 20).map((r) => (
            <li key={r.id} className="flex justify-between py-2">
              <span>
                {r.returnNo} · {r.returnedOn}
              </span>
              <span className="font-semibold text-[#c2410c]">
                −{formatInr(r.totalPaise)}
              </span>
            </li>
          ))}
          {!sellReturns.length ? (
            <li className="py-3 text-[var(--muted)]">No sell returns yet.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
