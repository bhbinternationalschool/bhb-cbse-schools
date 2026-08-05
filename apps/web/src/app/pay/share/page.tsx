"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  buildSchoolUpiPayUri,
  resolveSchoolCollectionsUpi,
} from "@/lib/admissions";
import { formatInr, loadMasters } from "@/lib/masters";
import {
  decodePaymentSharePayload,
  getPaymentLink,
  type PaymentLink,
  type PaymentSharePayload,
} from "@/lib/payments";
import { TENANT } from "@/lib/types";

type ServerLink = Pick<
  PaymentLink,
  | "id"
  | "code"
  | "status"
  | "amountPaise"
  | "studentName"
  | "classLabel"
  | "expiresOn"
  | "receiptNo"
  | "upiRef"
  | "lines"
  | "gatewayCheckoutUrl"
  | "gatewayMode"
>;

function payloadFromServerLink(
  link: ServerLink,
  schoolName: string,
  upiVpa: string,
  upiUri?: string,
): PaymentSharePayload {
  return {
    v: 1,
    linkId: link.id,
    code: link.code,
    studentName: link.studentName,
    classLabel: link.classLabel,
    amountPaise: link.amountPaise,
    expiresOn: link.expiresOn,
    schoolName,
    lines: link.lines,
    upiVpa,
    upiUri,
    note: "",
  };
}

export default function PaySharePage() {
  const [payload, setPayload] = useState<PaymentSharePayload | null>(null);
  const [serverLink, setServerLink] = useState<ServerLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [done, setDone] = useState<{
    receiptNo: string;
    upiRef: string;
  } | null>(null);

  const razorpayMode = !!serverLink?.gatewayCheckoutUrl;

  const refreshPaidStatus = useCallback(async (linkId: string, code?: string) => {
    const q = new URLSearchParams({ linkId });
    if (code) q.set("code", code);
    const res = await fetch(`/api/payments/parent-pay?${q.toString()}`);
    if (!res.ok) return false;
    const json = (await res.json()) as { link?: ServerLink };
    const link = json.link;
    if (!link) return false;
    setServerLink(link);
    if (link.status === "paid" && link.receiptNo) {
      setDone({
        receiptNo: link.receiptNo,
        upiRef: link.upiRef || "—",
      });
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryLinkId = params.get("linkId") || "";
    const queryCode = params.get("code") || "";
    const raw = window.location.hash.replace(/^#/, "");

    async function bootstrap() {
      if (queryLinkId) {
        const ok = await refreshPaidStatus(queryLinkId, queryCode || undefined);
        if (ok) return;
        const q = new URLSearchParams({ linkId: queryLinkId });
        if (queryCode) q.set("code", queryCode);
        const res = await fetch(`/api/payments/parent-pay?${q.toString()}`);
        if (!res.ok) {
          setError("Could not open this payment link. Ask the school to resend.");
          return;
        }
        const json = (await res.json()) as { link?: ServerLink };
        const link = json.link;
        if (!link) {
          setError("Payment link not found.");
          return;
        }
        setServerLink(link);
        const masters = loadMasters();
        const upi = resolveSchoolCollectionsUpi(masters);
        const upiUri = buildSchoolUpiPayUri({
          vpa: upi.vpa,
          payeeName: upi.payeeName,
          amountPaise: link.amountPaise,
          note: `Fees ${link.code}`,
        });
        setPayload(
          payloadFromServerLink(link, TENANT.nameDisplay, upi.vpa, upiUri),
        );
        return;
      }

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

      void refreshPaidStatus(decoded.linkId, decoded.code).then(async (paid) => {
        if (paid) return;
        const q = new URLSearchParams({
          linkId: decoded.linkId,
          code: decoded.code,
        });
        const res = await fetch(`/api/payments/parent-pay?${q.toString()}`);
        if (!res.ok) return;
        const json = (await res.json()) as { link?: ServerLink };
        if (json.link) setServerLink(json.link);
      });
    }

    void bootstrap();
  }, [refreshPaidStatus]);

  useEffect(() => {
    if (!payload || done || razorpayMode) {
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
  }, [payload, done, razorpayMode]);

  useEffect(() => {
    if (!payload || done || !razorpayMode) return;
    const id = window.setInterval(() => {
      void refreshPaidStatus(payload.linkId);
    }, 4000);
    return () => window.clearInterval(id);
  }, [payload, done, razorpayMode, refreshPaidStatus]);

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
          code: payload.code,
          sendWhatsApp: true,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        receiptNo?: string;
        link?: { upiRef?: string };
      };
      if (!res.ok) {
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
            {razorpayMode ? " · Razorpay auto-receipt" : ""}
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
            {razorpayMode && serverLink?.gatewayCheckoutUrl ? (
              <div className="mt-5 space-y-3">
                <a
                  href={serverLink.gatewayCheckoutUrl}
                  className="btn-accent flex w-full items-center justify-center rounded-xl px-4 py-3.5 text-sm font-extrabold"
                >
                  Pay {formatInr(payload.amountPaise)} via Razorpay
                </a>
                <p className="text-center text-[10px] leading-relaxed text-[var(--muted)]">
                  UPI / card / netbanking. Ledger &amp; WhatsApp receipt update
                  automatically — no confirm button needed.
                </p>
              </div>
            ) : (
              <>
                <div className="mt-5 rounded-xl bg-[rgba(32,48,80,0.04)] px-4 py-3 text-center">
                  <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
                    Pay with Google Pay / UPI
                  </p>
                  <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                    GPay · PhonePe · Paytm — amount prefilled
                  </p>
                  <p className="mt-2 font-mono text-sm font-bold text-[var(--brand-deep)]">
                    {payload.upiVpa}
                  </p>
                  {qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrDataUrl}
                      alt="GPay / UPI payment QR"
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
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1a73e8] px-4 py-2.5 text-[12px] font-bold text-white"
                    >
                      Open Google Pay / UPI
                    </a>
                  ) : null}
                </div>

                {error ? (
                  <p className="mt-3 text-center text-sm text-[#dc2626]">
                    {error}
                  </p>
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
                      ? "Confirming…"
                      : `I paid in GPay / UPI — confirm ${formatInr(payload.amountPaise)}`}
                  </button>
                )}
                <p className="mt-3 text-center text-[10px] leading-relaxed text-[var(--muted)]">
                  Step 1: Scan QR or tap &quot;Open Google Pay / UPI&quot; and
                  complete payment. Step 2: Tap confirm above — receipt is sent
                  on WhatsApp and the fee ledger updates. Office can also verify
                  UTR under Fee Take → Pay links.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
