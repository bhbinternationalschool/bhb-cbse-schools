"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  buildSchoolUpiPayUri,
  resolveSchoolCollectionsUpi,
} from "@/lib/admissions";
import { formatInr, loadMasters } from "@/lib/masters";
import {
  decodePaymentSharePayload,
  getPaymentLink,
  type PaymentSharePayload,
} from "@/lib/payments";
import { TENANT } from "@/lib/types";

export default function PaySharePage() {
  const [payload, setPayload] = useState<PaymentSharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
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
      return;
    }

    // Fallback: check server mirror (WhatsApp-created links)
    void fetch(`/api/payments/parent-pay?linkId=${encodeURIComponent(decoded.linkId)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as {
          link?: { status?: string; receiptNo?: string | null; upiRef?: string };
        };
        if (json.link?.status === "paid" && json.link.receiptNo) {
          setDone({
            receiptNo: json.link.receiptNo,
            upiRef: json.link.upiRef || "—",
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!payload || done) {
      setQrDataUrl(null);
      return;
    }
    const masters = loadMasters();
    const upi = resolveSchoolCollectionsUpi(masters);
    const uri =
      payload.upiUri ||
      buildSchoolUpiPayUri({
        vpa: payload.upiVpa || upi.vpa,
        payeeName: upi.payeeName,
        amountPaise: payload.amountPaise,
        note: `Fees ${payload.code}`,
      });
    let cancelled = false;
    void QRCode.toDataURL(uri, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [payload, done]);

  const expired = useMemo(() => {
    if (!payload) return false;
    return payload.expiresOn < new Date().toISOString().slice(0, 10);
  }, [payload]);

  const upiDeepLink = useMemo(() => {
    if (!payload) return "";
    const masters = loadMasters();
    const upi = resolveSchoolCollectionsUpi(masters);
    return (
      payload.upiUri ||
      buildSchoolUpiPayUri({
        vpa: payload.upiVpa || upi.vpa,
        payeeName: upi.payeeName,
        amountPaise: payload.amountPaise,
        note: `Fees ${payload.code}`,
      })
    );
  }, [payload]);

  async function onPay() {
    if (!payload || paying) return;
    setPaying(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/parent-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkId: payload.linkId,
          sendWhatsApp: true,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        receiptNo?: string;
        link?: { upiRef?: string };
      };
      if (!res.ok) {
        // Fall back to local demo pay if server mirror missing this link
        const { payPaymentLinkDemo } = await import("@/lib/payments");
        const local = payPaymentLinkDemo(payload.linkId);
        if (!local.ok) {
          setError(json.error || local.error);
          return;
        }
        setDone({
          receiptNo: local.receiptNo,
          upiRef: local.link.upiRef,
        });
        return;
      }
      setDone({
        receiptNo: json.receiptNo || "—",
        upiRef: json.link?.upiRef || "—",
      });
    } finally {
      setPaying(false);
    }
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
              Fee ledger updated. Receipt is also sent on WhatsApp when Business
              API is configured.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-5 rounded-xl bg-[rgba(32,48,80,0.04)] px-4 py-3 text-center">
              <p className="text-[11px] text-[var(--muted)]">Scan UPI QR</p>
              <p className="mt-1 font-mono text-sm font-bold text-[var(--brand-deep)]">
                {payload.upiVpa}
              </p>
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="UPI payment QR"
                  className="mx-auto mt-3 h-40 w-40 rounded-lg border border-[rgba(32,48,80,0.12)] bg-white p-1"
                />
              ) : (
                <div className="mx-auto mt-3 flex h-40 w-40 items-center justify-center rounded-lg border border-dashed border-[rgba(32,48,80,0.2)] text-[10px] text-[var(--muted)]">
                  Preparing QR…
                </div>
              )}
              {upiDeepLink ? (
                <a
                  href={upiDeepLink}
                  className="mt-3 inline-block text-[12px] font-semibold text-[#0f766e] underline"
                >
                  Open in UPI app
                </a>
              ) : null}
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
                onClick={() => void onPay()}
              >
                {paying
                  ? "Confirming payment…"
                  : `Confirm paid ${formatInr(payload.amountPaise)}`}
              </button>
            )}
            <p className="mt-3 text-center text-[10px] leading-relaxed text-[var(--muted)]">
              Scan QR or open UPI, then tap Confirm so the school ledger and
              receipt update. Counter can also confirm the UTR under Fee Take →
              Pay links.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
