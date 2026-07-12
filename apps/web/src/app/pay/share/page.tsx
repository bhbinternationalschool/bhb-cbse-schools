"use client";

import { useEffect, useMemo, useState } from "react";
import { formatInr } from "@/lib/fees";
import {
  decodePaymentSharePayload,
  getPaymentLink,
  payPaymentLinkDemo,
  type PaymentSharePayload,
} from "@/lib/payments";
import { TENANT } from "@/lib/types";

export default function PaySharePage() {
  const [payload, setPayload] = useState<PaymentSharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<{
    receiptNo: string;
    upiRef: string;
  } | null>(null);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) {
      setError("This payment link is incomplete.");
      return;
    }
    const decoded = decodePaymentSharePayload(decodeURIComponent(raw));
    if (!decoded) {
      setError("Could not open this payment link. Ask the school to resend.");
      return;
    }
    setPayload(decoded);

    const live = getPaymentLink(decoded.linkId);
    if (live?.status === "paid" && live.receiptNo) {
      setDone({
        receiptNo: live.receiptNo,
        upiRef: live.upiRef || "—",
      });
    }
  }, []);

  const expired = useMemo(() => {
    if (!payload) return false;
    return payload.expiresOn < new Date().toISOString().slice(0, 10);
  }, [payload]);

  function onPay() {
    if (!payload || paying) return;
    setPaying(true);
    setError(null);
    const result = payPaymentLinkDemo(payload.linkId);
    setPaying(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone({
      receiptNo: result.receiptNo,
      upiRef: result.link.upiRef,
    });
  }

  if (error && !payload) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="font-brand-name text-lg text-[var(--brand-deep)]">
          {TENANT.shortName}
        </p>
        <p className="mt-4 text-sm text-[var(--muted)]">{error}</p>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-[var(--muted)]">
        Opening payment link…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-8 sm:py-12">
      <p className="text-center font-brand-name text-base text-[var(--brand-deep)]">
        {payload.schoolName || TENANT.nameDisplay}
      </p>
      <p className="mt-1 text-center text-xs text-[var(--muted)]">
        Fee payment · {payload.code}
      </p>

      <div className="mt-6 rounded-2xl border border-[rgba(32,48,80,0.12)] bg-white p-5 shadow-[0_12px_40px_rgba(32,48,80,0.08)]">
        <div className="text-center">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            {payload.studentName}
          </p>
          {payload.classLabel ? (
            <p className="text-xs text-[var(--muted)]">{payload.classLabel}</p>
          ) : null}
          <p className="mt-4 text-[11px] uppercase tracking-wide text-[var(--muted)]">
            Amount due
          </p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums text-[var(--brand-deep)]">
            {formatInr(payload.amountPaise)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Valid till {payload.expiresOn}
          </p>
        </div>

        <ul className="mt-5 max-h-48 space-y-1.5 overflow-y-auto border-t border-[rgba(32,48,80,0.08)] pt-4 text-left text-sm">
          {payload.lines.map((line) => (
            <li
              key={line.dueKey}
              className="flex items-start justify-between gap-2"
            >
              <span className="min-w-0 text-[var(--brand-deep)]">
                <span className="font-medium">{line.label}</span>
                {line.studentName && line.studentName !== payload.studentName ? (
                  <span className="block text-[10px] text-[var(--muted)]">
                    {line.studentName}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-[var(--brand-deep)]">
                {formatInr(line.amountPaise)}
              </span>
            </li>
          ))}
        </ul>

        {done ? (
          <div className="mt-6 rounded-xl bg-[rgba(22,163,74,0.1)] px-4 py-4 text-center">
            <p className="text-sm font-bold text-[#15803d]">Payment received</p>
            <p className="mt-1 text-xs text-[var(--brand-deep)]">
              Receipt {done.receiptNo}
            </p>
            <p className="mt-0.5 text-[10px] text-[var(--muted)]">
              UTR {done.upiRef}
            </p>
            <p className="mt-3 text-[11px] text-[var(--muted)]">
              Keep this confirmation. School ledger is updated when paid from
              the same browser as Fee Take (demo).
            </p>
          </div>
        ) : (
          <>
            <div className="mt-5 rounded-xl bg-[rgba(32,48,80,0.04)] px-4 py-3 text-center">
              <p className="text-[11px] text-[var(--muted)]">Pay to UPI ID</p>
              <p className="mt-1 font-mono text-sm font-bold text-[var(--brand-deep)]">
                {payload.upiVpa}
              </p>
              <div
                className="mx-auto mt-3 flex h-28 w-28 items-center justify-center rounded-lg border-2 border-dashed border-[rgba(32,48,80,0.2)] bg-white text-[10px] text-[var(--muted)]"
                aria-hidden
              >
                Demo QR
              </div>
            </div>

            {error ? (
              <p className="mt-3 text-center text-sm text-[#dc2626]">{error}</p>
            ) : null}
            {expired ? (
              <p className="mt-3 text-center text-sm text-[#b45309]">
                This link has expired. Ask the school for a new one.
              </p>
            ) : (
              <button
                type="button"
                className="btn-accent mt-5 w-full rounded-xl px-4 py-3.5 text-sm font-extrabold disabled:opacity-60"
                disabled={paying}
                onClick={onPay}
              >
                {paying
                  ? "Processing…"
                  : `Pay ${formatInr(payload.amountPaise)} (demo UPI)`}
              </button>
            )}
            <p className="mt-3 text-center text-[10px] leading-relaxed text-[var(--muted)]">
              Demo only — no real money moves. Production will use Razorpay /
              UPI intent. Counter can also confirm the UTR under Fee Take → Pay
              links.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
