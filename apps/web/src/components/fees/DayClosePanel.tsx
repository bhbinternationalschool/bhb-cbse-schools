"use client";

import { useEffect, useMemo, useState } from "react";
import {
  approveDayClose,
  buildDayBook,
  CASH_DENOMINATIONS,
  denomPhysicalTotal,
  emptyDenominations,
  formatInr,
  getDayCloseForDate,
  listDayCloses,
  rejectDayClose,
  saveDayCloseDraft,
  submitDayClose,
  tenderModeLabel,
  type DayCloseDenomLine,
  type DayCloseSession,
} from "@/lib/fees";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function statusLabel(status: DayCloseSession["status"]) {
  switch (status) {
    case "draft":
      return "Draft";
    case "submitted":
      return "Awaiting Accounts";
    case "approved":
      return "Closed · handed over";
    case "rejected":
      return "Rejected — recount";
    default:
      return status;
  }
}

function statusClass(status: DayCloseSession["status"]) {
  switch (status) {
    case "approved":
      return "bg-[#16a34a]/15 text-[#15803d]";
    case "submitted":
      return "bg-[rgba(197,160,40,0.2)] text-[#8a6d12]";
    case "rejected":
      return "bg-[#dc2626]/12 text-[#dc2626]";
    default:
      return "bg-[var(--surface-sunken)] text-[var(--muted)]";
  }
}

export function DayClosePanel({
  tick,
  cashierName,
  onChanged,
  onOpenReceipt,
}: {
  tick: number;
  cashierName: string;
  onChanged: () => void;
  onOpenReceipt: (voucherId: string) => void;
}) {
  const [closeDate, setCloseDate] = useState(todayIso);
  const [denoms, setDenoms] = useState<DayCloseDenomLine[]>(emptyDenominations);
  const [cashierRemarks, setCashierRemarks] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverRemarks, setReceiverRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const book = useMemo(() => {
    void tick;
    return buildDayBook(closeDate);
  }, [closeDate, tick]);

  const session = useMemo(() => {
    void tick;
    return getDayCloseForDate(closeDate);
  }, [closeDate, tick]);

  const history = useMemo(() => {
    void tick;
    return listDayCloses().slice(0, 12);
  }, [tick]);

  const locked =
    session?.status === "submitted" || session?.status === "approved";
  const canEditCount =
    !session || session.status === "draft" || session.status === "rejected";

  const physical = denomPhysicalTotal(denoms);
  const systemCash = book.cashPaise;
  const variance = physical - systemCash;

  useEffect(() => {
    const s = getDayCloseForDate(closeDate);
    if (s && (s.status === "draft" || s.status === "rejected")) {
      setDenoms(s.denominations);
      setCashierRemarks(s.cashierRemarks);
    } else if (s && (s.status === "submitted" || s.status === "approved")) {
      setDenoms(s.denominations);
      setCashierRemarks(s.cashierRemarks);
      setReceiverName(s.receiverName);
      setReceiverRemarks(s.receiverRemarks);
    } else {
      setDenoms(emptyDenominations());
      setCashierRemarks("");
      setReceiverName("");
      setReceiverRemarks("");
    }
    setError(null);
    setNotice(null);
  }, [closeDate, tick]);

  function setQty(denomPaise: number, raw: string) {
    const qty = Math.max(0, Math.floor(Number(raw) || 0));
    setDenoms((prev) =>
      prev.map((d) => (d.denomPaise === denomPaise ? { ...d, qty } : d)),
    );
  }

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function onSaveDraft() {
    const res = saveDayCloseDraft({
      closeDate,
      cashierName,
      denominations: denoms,
      cashierRemarks,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged();
    flash("Day-close draft saved");
  }

  function onSubmit() {
    const res = submitDayClose({
      closeDate,
      cashierName,
      denominations: denoms,
      cashierRemarks,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged();
    flash("Handover submitted — waiting for Accounts");
  }

  function onApprove() {
    const res = approveDayClose({
      closeDate,
      receiverName: receiverName || "Accounts",
      receiverRemarks,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged();
    flash("Handover approved — day closed");
  }

  function onReject() {
    const res = rejectDayClose({
      closeDate,
      receiverName: receiverName || "Accounts",
      receiverRemarks,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged();
    flash("Returned to cashier for recount");
  }

  const notes = CASH_DENOMINATIONS.filter((d) => d.kind === "note");
  const coins = CASH_DENOMINATIONS.filter((d) => d.kind === "coin");

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--brand-deep)]">
              Day close & cash handover
            </h2>
            <p className="mt-0.5 max-w-xl text-xs text-[var(--muted)]">
              Day book by payment mode, count cash notes/coins, submit to
              Accounts. After submit, new receipts for that date are locked.
            </p>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Close date
            </span>
            <input
              className="field !py-1.5"
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
            />
          </label>
        </div>

        {session ? (
          <div className="mt-3">
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusClass(session.status)}`}
            >
              {statusLabel(session.status)}
            </span>
            <span className="ml-2 text-[11px] text-[var(--muted)]">
              Cashier {session.cashierName}
              {session.submittedAt
                ? ` · submitted ${session.submittedAt.slice(0, 16).replace("T", " ")}`
                : ""}
            </span>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--brand-deep)]">
            {notice}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Day total"
          value={formatInr(book.totalPaise)}
          hint="Cash + UPI + card + cheque…"
        />
        <Kpi
          label="System cash"
          value={formatInr(systemCash)}
          hint="Cash tenders only (drawer)"
          accent={systemCash > 0 ? "cash" : undefined}
        />
        <Kpi
          label="Physical cash"
          value={formatInr(physical)}
          hint="From notes/coins count below"
        />
        <Kpi
          label="Cash variance"
          value={formatInr(variance)}
          hint="Physical − system cash"
          accent={
            variance === 0 ? "ok" : variance > 0 ? "excess" : "short"
          }
        />
      </div>

      <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[11px] leading-snug text-[var(--muted)]">
        <span className="font-semibold text-[var(--brand-deep)]">
          Why day total ≠ cash variance:
        </span>{" "}
        Day total is everything collected today (fees + store, all modes). Cash
        variance only compares the cash drawer — UPI, card, and cheque are not
        counted in notes/coins. Match your denomination count to{" "}
        <span className="font-semibold text-[var(--brand-deep)]">
          System cash ({formatInr(systemCash)})
        </span>
        , not day total ({formatInr(book.totalPaise)}).
        {book.storeCollectedPaise > 0
          ? ` Store collected today: ${formatInr(book.storeCollectedPaise)} (included in day total; cash portion is inside system cash if paid in cash).`
          : ""}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          label="Receipts"
          value={String(book.receiptCount)}
          hint="Live (non-void)"
        />
        <Kpi
          label="Store collected"
          value={formatInr(book.storeCollectedPaise)}
          hint="Paid on Fee Take today"
          accent={book.storeCollectedPaise > 0 ? "cash" : undefined}
        />
        <Kpi
          label="Non-cash modes"
          value={formatInr(Math.max(0, book.totalPaise - systemCash))}
          hint="UPI / card / cheque / bank"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Collection by type
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            What was paid on receipts today (fees vs store) — all modes
          </p>
          {book.kindTotals.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted)]">
              No collections on {closeDate}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {book.kindTotals.map((k) => (
                <li
                  key={k.kind}
                  className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-semibold text-[var(--brand-deep)]">
                      {k.label}
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {k.lineCount} line{k.lineCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-bold ${
                      k.kind === "store"
                        ? "text-[#16a34a]"
                        : "text-[var(--brand-deep)]"
                    }`}
                  >
                    {formatInr(k.paise)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Day book by mode
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Cash goes to drawer · other modes to bank/cheque register
          </p>
          {book.modeTotals.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted)]">
              No collections on {closeDate}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {book.modeTotals.map((m) => (
                <li
                  key={m.mode}
                  className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-semibold text-[var(--brand-deep)]">
                      {tenderModeLabel(m.mode)}
                      {m.mode === "cash" ? (
                        <span className="ml-1.5 text-[10px] font-bold uppercase text-[#15803d]">
                          Count this
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {m.tenderCount} tender{m.tenderCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-bold ${
                      m.mode === "cash"
                        ? "text-[#16a34a]"
                        : "text-[var(--brand-deep)]"
                    }`}
                  >
                    {formatInr(m.paise)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              Store collections today
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Collected against store dues on {closeDate}
              {book.storeCollectedPaise > 0
                ? ` · ${formatInr(book.storeCollectedPaise)}`
                : ""}
            </p>
          </div>
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Sales raised in the store are listed in its own day book —{" "}
          <a
            className="underline"
            href="/inventory?tab=reports"
          >
            Store &amp; purchase → Reports → Sales day book
          </a>
          . This card shows only what was collected here, on Fee Take.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                Cash denomination count
              </h3>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                Count notes/coins to match{" "}
                <span className="font-semibold text-[#15803d]">
                  system cash {formatInr(systemCash)}
                </span>
                {" · "}
                physical now{" "}
                <span className="font-semibold text-[var(--brand-deep)]">
                  {formatInr(physical)}
                </span>
                {" · variance "}
                <span
                  className={`font-semibold ${
                    variance === 0
                      ? "text-[#15803d]"
                      : variance > 0
                        ? "text-[#b45309]"
                        : "text-[#dc2626]"
                  }`}
                >
                  {formatInr(variance)}
                </span>
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <DenomTable
              title="Notes"
              rows={notes}
              denoms={denoms}
              disabled={!canEditCount}
              onQty={setQty}
            />
            <DenomTable
              title="Coins"
              rows={coins}
              denoms={denoms}
              disabled={!canEditCount}
              onQty={setQty}
            />
          </div>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Cashier remarks
              {variance !== 0 ? " (required if variance)" : " (optional)"}
            </span>
            <textarea
              className="field min-h-[4.5rem] resize-y"
              value={cashierRemarks}
              disabled={!canEditCount}
              onChange={(e) => setCashierRemarks(e.target.value)}
              placeholder="e.g. ₹50 short — will adjust tomorrow"
            />
          </label>

          {canEditCount ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
                onClick={onSaveDraft}
              >
                Save draft
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95"
                onClick={onSubmit}
              >
                Submit handover
              </button>
            </div>
          ) : locked && session?.status === "submitted" ? (
            <p className="mt-3 text-xs text-[var(--muted)]">
              Collections for {closeDate} are locked until Accounts approves or
              rejects.
            </p>
          ) : session?.status === "approved" ? (
            <p className="mt-3 text-xs font-semibold text-[#15803d]">
              Day closed. Counter cash handed to main safe (demo ledger).
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          {session?.status === "submitted" ||
          session?.status === "approved" ||
          session?.status === "rejected" ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                Accounts receive
              </h3>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                Demo: same screen acts as receiver. Approve moves cash to main
                pool; reject unlocks recount.
              </p>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted)]">System cash</dt>
                  <dd className="font-semibold">
                    {formatInr(session.systemCashPaise)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted)]">Physical counted</dt>
                  <dd className="font-semibold">
                    {formatInr(session.physicalCashPaise)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted)]">Variance</dt>
                  <dd
                    className={`font-bold ${
                      session.variancePaise === 0
                        ? "text-[#15803d]"
                        : "text-[#dc2626]"
                    }`}
                  >
                    {formatInr(session.variancePaise)}
                  </dd>
                </div>
                {session.cashierRemarks ? (
                  <div className="rounded-lg bg-[var(--surface-sunken)] px-2.5 py-2 text-xs text-[var(--brand-deep)]">
                    Cashier: {session.cashierRemarks}
                  </div>
                ) : null}
              </dl>

              {session.status === "submitted" ? (
                <>
                  <label className="mt-3 block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Receiver name
                    </span>
                    <input
                      className="field !py-1.5"
                      value={receiverName}
                      onChange={(e) => setReceiverName(e.target.value)}
                      placeholder="Accounts clerk / Principal"
                    />
                  </label>
                  <label className="mt-2 block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Receiver remarks
                    </span>
                    <textarea
                      className="field min-h-[3.5rem] resize-y"
                      value={receiverRemarks}
                      onChange={(e) => setReceiverRemarks(e.target.value)}
                      placeholder="Required if rejecting"
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-[#16a34a] px-3 py-2 text-sm font-semibold text-white hover:opacity-95"
                      onClick={onApprove}
                    >
                      Approve & receive
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[#dc2626]/40 px-3 py-2 text-sm font-semibold text-[#dc2626] hover:bg-[#dc2626]/08"
                      onClick={onReject}
                    >
                      Reject
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  {session.status === "approved"
                    ? `Received by ${session.receiverName}${
                        session.resolvedAt
                          ? ` · ${session.resolvedAt.slice(0, 16).replace("T", " ")}`
                          : ""
                      }`
                    : `Rejected by ${session.receiverName}: ${session.receiverRemarks}`}
                </p>
              )}
            </div>
          ) : null}

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              Receipts on this date
            </h3>
            {book.vouchers.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">None</p>
            ) : (
              <ul className="mt-2 max-h-56 divide-y divide-[var(--border)] overflow-y-auto">
                {book.vouchers.map((v) => {
                  const feePaise = v.lines
                    .filter(
                      (l) => l.kind !== "store" && l.kind !== "transport",
                    )
                    .reduce((s, l) => s + l.amountPaise, 0);
                  const transportPaise = v.lines
                    .filter((l) => l.kind === "transport")
                    .reduce((s, l) => s + l.amountPaise, 0);
                  const storePaise = v.lines
                    .filter((l) => l.kind === "store")
                    .reduce((s, l) => s + l.amountPaise, 0);
                  return (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-2 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-[var(--brand-deep)]">
                        {v.receiptNo}
                        {v.schoolReceiptNo ? (
                          <span className="font-normal text-[var(--muted)]">
                            {" "}
                            · {v.schoolReceiptNo}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {v.cashierName} ·{" "}
                        {v.tenders
                          .map(
                            (t) =>
                              `${tenderModeLabel(t.mode)} ${formatInr(t.amountPaise)}`,
                          )
                          .join(" + ")}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {[
                          feePaise > 0 ? `Fees ${formatInr(feePaise)}` : null,
                          transportPaise > 0
                            ? `Transport ${formatInr(transportPaise)}`
                            : null,
                          storePaise > 0
                            ? `Store ${formatInr(storePaise)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs font-bold text-[var(--brand-deep)]">
                        {formatInr(v.totalPaise)}
                      </span>
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-[var(--brand-mid)]"
                        onClick={() => onOpenReceipt(v.id)}
                      >
                        Open
                      </button>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {history.length > 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Recent day-closes
          </h3>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {history.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-[var(--surface-sunken)]"
                  onClick={() => setCloseDate(h.closeDate)}
                >
                  <div>
                    <span className="text-sm font-semibold text-[var(--brand-deep)]">
                      {h.closeDate}
                    </span>
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${statusClass(h.status)}`}
                    >
                      {statusLabel(h.status)}
                    </span>
                    <div className="text-[10px] text-[var(--muted)]">
                      {h.receiptCount} rcpt · cash {formatInr(h.systemCashPaise)}{" "}
                      · phys {formatInr(h.physicalCashPaise)}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-bold ${
                      h.variancePaise === 0
                        ? "text-[#15803d]"
                        : "text-[#dc2626]"
                    }`}
                  >
                    {formatInr(h.variancePaise)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: "cash" | "ok" | "excess" | "short";
}) {
  const valueClass =
    accent === "ok"
      ? "text-[#15803d]"
      : accent === "short"
        ? "text-[#dc2626]"
        : accent === "excess"
          ? "text-[#b45309]"
          : accent === "cash"
            ? "text-[#16a34a]"
            : "text-[var(--brand-deep)]";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className={`mt-1 text-xl font-extrabold tracking-tight ${valueClass}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-[var(--muted)]">{hint}</div>
    </div>
  );
}

function DenomTable({
  title,
  rows,
  denoms,
  disabled,
  onQty,
}: {
  title: string;
  rows: typeof CASH_DENOMINATIONS;
  denoms: DayCloseDenomLine[];
  disabled: boolean;
  onQty: (denomPaise: number, raw: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </div>
      <ul className="overflow-hidden rounded-lg border border-[var(--border)]">
        {rows.map((meta) => {
          const line = denoms.find((d) => d.denomPaise === meta.denomPaise);
          const qty = line?.qty ?? 0;
          const lineTotal = meta.denomPaise * qty;
          return (
            <li
              key={meta.denomPaise}
              className="flex items-center gap-2 border-b border-[var(--border)] px-2.5 py-1.5 last:border-b-0"
            >
              <span className="w-12 text-xs font-semibold text-[var(--brand-deep)]">
                {meta.label}
              </span>
              <span className="text-[10px] text-[var(--muted)]">×</span>
              <input
                className="field !w-16 !py-1 !text-center"
                type="number"
                min={0}
                step={1}
                disabled={disabled}
                value={qty || ""}
                placeholder="0"
                onChange={(e) => onQty(meta.denomPaise, e.target.value)}
              />
              <span className="ml-auto text-xs font-bold text-[var(--brand-deep)]">
                {formatInr(lineTotal)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
