"use client";

/**
 * One voucher, whole — the single detail view every Accounts table opens.
 *
 * Reached from the voucher list, the account statement, and the day sheet
 * (head → its vouchers → one voucher). It reads `voucher-detail`, a view-level
 * action that returns the voucher's own header and lines and nothing else: no
 * account balance, so the counter, who runs the day sheet without
 * accounts_position, may open it.
 *
 * Changing a voucher stays where it was: the host passes its own actions
 * (Change head / Change it / Void it) only when the user's rights allow them;
 * hosts that pass none get a read-only view.
 */

import { useEffect, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Dialog, DialogPopup } from "@/components/ui/dialog";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";
import { formatInr } from "@/lib/fees";
import { isOpenKey, type VoucherDetail } from "@/lib/ledger/drillDown";
import { formatKeyedAtIst } from "@/lib/ledger/lastEntries";

const BTN_OUTLINE =
  "rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--brand-deep)] disabled:opacity-50";

/**
 * Props that make a table row open something: focusable, Enter/Space opens,
 * a pointer and a hover tint so it reads as clickable. One definition so
 * every drill-down row in Accounts behaves the same.
 */
export function rowOpenProps(onOpen: () => void, label: string) {
  return {
    // A row that acts as a button says so, so its label is announced.
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    onClick: onOpen,
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (isOpenKey(e.key)) {
        e.preventDefault();
        onOpen();
      }
    },
    className:
      "cursor-pointer hover:bg-[var(--surface-sunken)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]",
  };
}

export type VoucherRef = { voucherId?: string; voucherNo?: string };

export type VoucherDetailAction = {
  id: string;
  label: string;
  tone?: "danger";
  /** Hide when the voucher's state does not allow it (reversed, a reversal…). */
  hidden?: (v: VoucherDetail) => boolean;
  onSelect: (v: VoucherDetail) => void;
};

export function VoucherDetailDialog({
  target,
  onClose,
  actions = [],
}: {
  target: VoucherRef;
  onClose: () => void;
  actions?: VoucherDetailAction[];
}) {
  // Following "reversed by RV/…" moves within the dialog; Back returns.
  const [trail, setTrail] = useState<VoucherRef[]>([target]);
  const current = trail[trail.length - 1]!;
  const [voucher, setVoucher] = useState<VoucherDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setVoucher(null);
    setError("");
    void fetch("/api/ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "voucher-detail", ...current }),
    })
      .then((r) => r.json() as Promise<{ ok?: boolean; error?: string; voucher?: VoucherDetail }>)
      .then((r) => {
        if (!live) return;
        if (r.ok && r.voucher) setVoucher(r.voucher);
        else setError(r.error || "Could not read this voucher");
      })
      .catch(() => live && setError("Could not reach the server"));
    return () => {
      live = false;
    };
  }, [current]);

  const go = (ref: VoucherRef) => setTrail((t) => [...t, ref]);
  const dr = voucher?.lines.reduce((n, l) => n + l.debitPaise, 0) ?? 0;
  const cr = voucher?.lines.reduce((n, l) => n + l.creditPaise, 0) ?? 0;
  const shown = voucher ? actions.filter((a) => !a.hidden?.(voucher)) : [];

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
          <div>
            <h3 className="font-mono text-base font-bold text-[var(--brand-deep)]">
              {voucher?.voucherNo ?? current.voucherNo ?? "Voucher"}
            </h3>
            {voucher ? (
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                {voucher.voucherType} · {voucher.date} · {voucher.sourceType || "keyed by hand"}
                {voucher.createdBy ? ` · by ${voucher.createdBy}` : ""}
                {voucher.createdAt ? ` · keyed ${formatKeyedAtIst(voucher.createdAt)}` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {trail.length > 1 ? (
              <button type="button" className={BTN_OUTLINE} onClick={() => setTrail((t) => t.slice(0, -1))}>
                Back
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="text-[var(--muted)]" aria-label="Close">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="space-y-3 p-4">
          {error ? (
            <p className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
              {error}
            </p>
          ) : !voucher ? (
            <p className="text-sm text-[var(--muted)]">Reading the voucher…</p>
          ) : (
            <>
              {/* Status: live, cancelled, or itself the cancelling entry. */}
              {voucher.reversedBy ? (
                <p className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
                  Cancelled — reversed by{" "}
                  <button
                    type="button"
                    className="font-mono font-bold underline"
                    onClick={() => go({ voucherId: voucher.reversedBy!.id })}
                  >
                    {voucher.reversedBy.voucherNo}
                  </button>{" "}
                  on {voucher.reversedBy.date}
                  {voucher.reversedBy.narration ? ` · ${voucher.reversedBy.narration}` : ""}
                </p>
              ) : voucher.reverses ? (
                <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted)]">
                  A reversal — it cancels{" "}
                  <button
                    type="button"
                    className="font-mono font-bold text-[var(--brand-deep)] underline"
                    onClick={() => go({ voucherId: voucher.reverses!.id })}
                  >
                    {voucher.reverses.voucherNo}
                  </button>{" "}
                  of {voucher.reverses.date}. Together the two move nothing.
                </p>
              ) : (
                <p className="text-xs font-semibold text-[var(--success)]">Live — in every total.</p>
              )}

              {voucher.narration ? <p className="text-sm">{voucher.narration}</p> : null}

              <div className="overflow-x-auto">
                <ErpTable minWidth="min-w-[36rem]">
                  <ErpTableHead>
                    <tr>
                      <th className="pb-2 text-left">Account</th>
                      <th className="pb-2 text-left">Party</th>
                      <th className="pb-2 text-left">Instrument</th>
                      <th className="pb-2 text-right">Debit</th>
                      <th className="pb-2 text-right">Credit</th>
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody>
                    {voucher.lines.map((l) => (
                      <tr key={l.lineNo} className="align-top">
                        <td className="py-1">
                          <span className="font-mono text-[10px] text-[var(--muted)]">{l.accountCode}</span>{" "}
                          {l.accountName}
                          {l.narration && l.narration !== voucher.narration ? (
                            <span className="block text-[11px] text-[var(--muted)]">{l.narration}</span>
                          ) : null}
                        </td>
                        <td className="py-1 text-xs">{l.partyName || "—"}</td>
                        <td className="py-1 text-xs">
                          {[l.instrumentMode, l.instrumentRef].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {l.debitPaise ? formatInr(l.debitPaise) : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {l.creditPaise ? formatInr(l.creditPaise) : "—"}
                        </td>
                      </tr>
                    ))}
                    <tr className="font-bold">
                      <td colSpan={3} className="py-1.5 text-right">Totals</td>
                      <td className="py-1.5 text-right tabular-nums">{formatInr(dr)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatInr(cr)}</td>
                    </tr>
                  </ErpTableBody>
                </ErpTable>
              </div>

              {shown.length > 0 ? (
                <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                  {shown.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={
                        a.tone === "danger"
                          ? "rounded-lg border border-[var(--danger)] px-3 py-1.5 text-xs font-bold text-[var(--danger)]"
                          : BTN_OUTLINE
                      }
                      onClick={() => a.onSelect(voucher)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * The vouchers behind one figure — a day-sheet head over a range. Each row
 * opens the voucher.
 */
export function VoucherListDialog({
  title,
  subtitle,
  entries,
  onClose,
}: {
  title: string;
  subtitle?: string;
  entries: { voucherId: string; voucherNo: string; date: string; narration: string; paise: number; note?: string }[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState<VoucherRef | null>(null);
  const total = entries.reduce((n, e) => n + e.paise, 0);
  return (
    <>
      <Dialog open={!open} onOpenChange={(next) => !next && onClose()}>
        <DialogPopup className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
            <div>
              <h3 className="text-base font-bold text-[var(--brand-deep)]">{title}</h3>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                {subtitle ? `${subtitle} · ` : ""}
                {entries.length} entr{entries.length === 1 ? "y" : "ies"} · {formatInr(total)}
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-[var(--muted)]" aria-label="Close">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="overflow-x-auto p-4">
            <ErpTable minWidth="min-w-[32rem]">
              <ErpTableHead>
                <tr>
                  <th className="pb-2 text-left">Date</th>
                  <th className="pb-2 text-left">Voucher</th>
                  <th className="pb-2 text-left">Narration</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {entries.map((e, i) => {
                  const p = rowOpenProps(
                    () => setOpen({ voucherId: e.voucherId, voucherNo: e.voucherNo }),
                    `Open voucher ${e.voucherNo}`,
                  );
                  return (
                    <tr key={`${e.voucherId}:${i}`} {...p}>
                      <td className="py-1 whitespace-nowrap">{e.date}</td>
                      <td className="py-1 font-mono text-xs">{e.voucherNo}</td>
                      <td className="py-1 text-xs text-[var(--muted)]">
                        {e.narration || "—"}
                        {e.note ? (
                          <span className="block font-semibold text-[var(--warning)]">{e.note}</span>
                        ) : null}
                      </td>
                      <td className="py-1 text-right tabular-nums">{formatInr(e.paise)}</td>
                    </tr>
                  );
                })}
              </ErpTableBody>
            </ErpTable>
          </div>
        </DialogPopup>
      </Dialog>
      {open ? <VoucherDetailDialog target={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
