"use client";

/**
 * Closing balances — the day the book is made to agree with the money.
 *
 * The office counts the cash box, reads the bank statement, types both in, and
 * the book moves onto those figures. From the next morning every balance the
 * ERP shows is one that exists.
 *
 * Nothing posts until the difference has been shown and confirmed: a closing
 * writes off money nobody has explained, so the person doing it should see the
 * number they are writing off before they agree to it.
 */

import { useCallback, useEffect, useState } from "react";
import {
  buildClosingBalancePlan,
  parseRupeesToPaise,
  rupees,
  type ClosingBalancePlan,
} from "@/lib/ledger/closingBalance";
import type { AccountsPanelProps } from "@/components/accounts/AccountsPanels";

const CARD = "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4";
const FIELD = "w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm";
const BTN =
  "rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50";

type Position = {
  ok: boolean;
  error?: string;
  asOn: string;
  bookCashPaise: number;
  bookBankPaise: number;
  existing: { voucherId: string; voucherNo: string; narration: string; postedAt: string } | null;
};

/** The close the school is working towards, so the field opens on the right day. */
function defaultCloseDate(): string {
  const now = new Date();
  // The last day of the current month, which is what "closing day" means here.
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

export function ClosingBalancePanel({ onFlash, onError, onRefresh }: AccountsPanelProps) {
  const [asOn, setAsOn] = useState(defaultCloseDate);
  const [position, setPosition] = useState<Position | null>(null);
  const [loading, setLoading] = useState(false);
  const [cashText, setCashText] = useState("");
  const [bankText, setBankText] = useState("");
  const [confirming, setConfirming] = useState<ClosingBalancePlan | null>(null);
  const [posting, setPosting] = useState(false);

  const loadPosition = useCallback(
    async (date: string) => {
      setLoading(true);
      setConfirming(null);
      try {
        const res = await fetch("/api/ledger", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "closing-position", asOn: date }),
        });
        const json = (await res.json()) as Position;
        setPosition(json);
        if (!json.ok && json.error) onError(json.error);
      } catch {
        setPosition(null);
        onError("Could not read the book's position — try again.");
      } finally {
        setLoading(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    void loadPosition(asOn);
  }, [asOn, loadPosition]);

  const cash = parseRupeesToPaise(cashText);
  const bank = parseRupeesToPaise(bankText);
  const canPreview = position?.ok === true && !position.existing && cash.ok && bank.ok;

  function preview() {
    if (!position?.ok || !cash.ok || !bank.ok) return;
    setConfirming(
      buildClosingBalancePlan({
        asOn,
        bookCashPaise: position.bookCashPaise,
        bookBankPaise: position.bookBankPaise,
        actualCashPaise: cash.paise,
        actualBankPaise: bank.paise,
      }),
    );
  }

  async function post() {
    if (!confirming || !cash.ok || !bank.ok) return;
    setPosting(true);
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "closing-balances",
          asOn,
          actualCashPaise: cash.paise,
          actualBankPaise: bank.paise,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        voucherNo?: string;
        noChange?: boolean;
      };
      if (!json.ok) {
        onError(json.error ?? "Could not post the closing balances.");
        return;
      }
      onFlash(
        json.noChange
          ? `The book already agreed on ${asOn} — nothing posted.`
          : `Closing balances posted as ${json.voucherNo}. From the next day the book shows what you counted.`,
      );
      setConfirming(null);
      setCashText("");
      setBankText("");
      await loadPosition(asOn);
      onRefresh();
    } catch {
      onError("Could not post the closing balances — try again.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className={`${CARD} text-sm text-[var(--muted)]`}>
        On closing day, count the cash box and read the bank statement, then enter
        both here. The book is moved onto those figures, so from the next morning
        every balance the ERP shows is one that really exists. Any difference is
        posted to{" "}
        <strong className="text-[var(--brand-deep)]">
          Cash &amp; Bank Difference (unexplained)
        </strong>{" "}
        — its own expense head, not corpus, so it stays visible and someone can
        still ask what it was.
      </div>

      <div className={CARD}>
        <label className="block text-xs font-semibold text-[var(--muted)]">
          Closing date
        </label>
        <input
          type="date"
          className={`${FIELD} mt-1 max-w-xs`}
          value={asOn}
          onChange={(e) => {
            setAsOn(e.target.value);
            setCashText("");
            setBankText("");
          }}
        />
      </div>

      {loading ? (
        <div className={`${CARD} text-sm text-[var(--muted)]`}>Reading the book…</div>
      ) : position?.existing ? (
        <div className={`${CARD} text-sm`}>
          <div className="font-semibold text-[var(--brand-deep)]">
            Already closed on {asOn}
          </div>
          <div className="mt-1 text-[var(--muted)]">
            Posted as {position.existing.voucherNo} — {position.existing.narration}
          </div>
          <div className="mt-2 text-[var(--muted)]">
            To enter different figures, reverse that voucher in Vouchers first. A
            closing is not overwritten in place, so the correction stays visible in
            the book.
          </div>
        </div>
      ) : position?.ok ? (
        <>
          <div className={CARD}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Leg
                label="Cash in hand"
                bookPaise={position.bookCashPaise}
                text={cashText}
                onText={(v) => {
                  setCashText(v);
                  setConfirming(null);
                }}
                error={cashText && !cash.ok ? cash.error : ""}
              />
              <Leg
                label="Bank"
                bookPaise={position.bookBankPaise}
                text={bankText}
                onText={(v) => {
                  setBankText(v);
                  setConfirming(null);
                }}
                error={bankText && !bank.ok ? bank.error : ""}
              />
            </div>
            <button
              type="button"
              className={`${BTN} mt-4`}
              disabled={!canPreview}
              onClick={preview}
            >
              Check the difference
            </button>
          </div>

          {confirming ? (
            <div className={CARD}>
              {confirming.alreadyAgrees ? (
                <div className="text-sm">
                  <div className="font-semibold text-[var(--brand-deep)]">
                    The book already agrees
                  </div>
                  <div className="mt-1 text-[var(--muted)]">
                    Cash and bank both match what you counted. Nothing needs
                    posting — the book is already right for {asOn}.
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-sm font-semibold text-[var(--brand-deep)]">
                    What will be posted on {asOn}
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    {[confirming.cash, confirming.bank].map((l) => (
                      <div
                        key={l.accountCode}
                        className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2 last:border-0"
                      >
                        <span className="font-medium">{l.label}</span>
                        <span className="text-[var(--muted)]">
                          book {rupees(l.bookPaise)} → counted {rupees(l.actualPaise)}
                        </span>
                        <span
                          className={
                            l.differencePaise === 0
                              ? "text-[var(--muted)]"
                              : "font-semibold text-[var(--brand-deep)]"
                          }
                        >
                          {l.differencePaise === 0
                            ? "agrees"
                            : `${l.differencePaise > 0 ? "+" : ""}${rupees(l.differencePaise)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-sm">
                    {confirming.netDifferencePaise === 0 ? (
                      <span className="text-[var(--muted)]">
                        Cash and bank move in opposite directions and cancel out.
                        The totals were right; only the split between them was
                        wrong. Nothing is written off.
                      </span>
                    ) : (
                      <span>
                        <strong className="text-[var(--brand-deep)]">
                          {rupees(Math.abs(confirming.netDifferencePaise))}
                        </strong>{" "}
                        {confirming.netDifferencePaise > 0
                          ? "more money than the book knew about"
                          : "less money than the book claimed"}{" "}
                        will be written to Cash &amp; Bank Difference
                        (unexplained). Once posted this is part of the audited
                        accounts.
                      </span>
                    )}
                  </div>
                </>
              )}
              <button
                type="button"
                className={`${BTN} mt-4`}
                disabled={posting}
                onClick={() => void post()}
              >
                {posting
                  ? "Posting…"
                  : confirming.alreadyAgrees
                    ? "Record that the book agrees"
                    : "Post the closing"}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className={`${CARD} text-sm text-[var(--muted)]`}>
          {position?.error ?? "Could not read the book's position."}
        </div>
      )}
    </div>
  );
}

function Leg({
  label,
  bookPaise,
  text,
  onText,
  error,
}: {
  label: string;
  bookPaise: number;
  text: string;
  onText: (v: string) => void;
  error?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[var(--muted)]">
        {label} — counted
      </label>
      <input
        className={`${FIELD} mt-1`}
        inputMode="decimal"
        placeholder="e.g. 282000"
        value={text}
        onChange={(e) => onText(e.target.value)}
      />
      <div className="mt-1 text-[11px] text-[var(--muted)]">
        the book says {rupees(bookPaise)}
      </div>
      {error ? (
        <div className="mt-1 text-[11px] font-medium text-[var(--danger)]">{error}</div>
      ) : null}
    </div>
  );
}
