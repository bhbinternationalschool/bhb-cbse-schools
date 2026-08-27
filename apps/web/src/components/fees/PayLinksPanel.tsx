"use client";

import { useEffect, useMemo, useState } from "react";
import { formatInr } from "@/lib/fees";
import {
  applyPaymentLink,
  buildEnrichedPaymentSharePayload,
  buildPaymentShareUrl,
  cancelPaymentLink,
  composeWhatsAppPaymentLinkMessage,
  listPaymentLinks,
  loadPayments,
  openPaymentLinkCount,
  whatsAppPaymentLinkUrl,
  type PaymentLink,
} from "@/lib/payments";
import { attachGatewayCheckout } from "@/lib/paymentGatewayClient";
import { householdWhatsApp, loadSis, type SisState } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import {
  gatewayCheckoutHint,
  getPaymentGatewayConfig,
  paymentGatewayModeLabel,
} from "@/lib/paymentGateway";

export function PayLinksPanel({
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
  const [sis, setSis] = useState<SisState | null>(null);
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pg = getPaymentGatewayConfig();

  function refresh() {
    setSis(loadSis());
    setLinks(listPaymentLinks(loadPayments()));
  }

  useEffect(() => {
    refresh();
  }, [tick]);

  const visible = useMemo(() => {
    if (filter === "all") return links;
    return links.filter((l) => l.status === "open");
  }, [links, filter]);

  const openCount = openPaymentLinkCount();

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  /** Attach live gateway checkout before sharing; UPI share on failure. */
  async function ensureGateway(link: PaymentLink): Promise<PaymentLink> {
    const result = await attachGatewayCheckout(link);
    if (result.attached && !link.gatewayCheckoutUrl) refresh();
    else if (result.error) flash(`UPI link (no checkout: ${result.error})`);
    return result.link;
  }

  async function copyLink(rawLink: PaymentLink) {
    const link = await ensureGateway(rawLink);
    const payload = buildEnrichedPaymentSharePayload(link, TENANT.nameDisplay);
    const url = buildPaymentShareUrl(payload);
    void navigator.clipboard.writeText(url).then(
      () => flash("Payment link copied"),
      () => flash(url),
    );
  }

  async function shareWhatsApp(rawLink: PaymentLink) {
    const hh = sis?.households.find((h) => h.id === rawLink.householdId);
    const mobile = householdWhatsApp(hh);
    if (!mobile) {
      setError("No WhatsApp number on this household — set it on Fee Take");
      return;
    }
    const link = await ensureGateway(rawLink);
    const payload = buildEnrichedPaymentSharePayload(link, TENANT.nameDisplay);
    const url = buildPaymentShareUrl(payload);
    const msg = composeWhatsAppPaymentLinkMessage(
      link,
      url,
      TENANT.nameDisplay,
      !!link.gatewayCheckoutUrl,
    );
    window.open(whatsAppPaymentLinkUrl(mobile, msg), "_blank", "noopener");
    flash(`WhatsApp opened for ${mobile}`);
  }

  function onConfirm(link: PaymentLink) {
    const upiRef = window.prompt(
      `Confirm UPI received for ${link.code} (${formatInr(link.amountPaise)})`,
      link.upiRef || `UPI-${link.code}`,
    );
    if (upiRef == null) return;
    const result = applyPaymentLink({
      linkId: link.id,
      cashierName,
      upiRef: upiRef.trim() || undefined,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
    onChanged();
    flash(`Posted ${result.receiptNo}`);
    onOpenReceipt(result.voucherId);
  }

  function onCancel(link: PaymentLink) {
    if (!window.confirm(`Cancel payment link ${link.code}?`)) return;
    cancelPaymentLink(link.id);
    refresh();
    onChanged();
    flash("Link cancelled");
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            UPI payment links
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Create from Collect (select dues → Send UPI link). Parent pays on
            phone; confirm here if needed. Gateway:{" "}
            {paymentGatewayModeLabel(pg.mode)} — {gatewayCheckoutHint(pg.mode)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              filter === "open"
                ? "bg-[var(--brand-deep)] text-white"
                : "border border-[rgba(32,48,80,0.15)] text-[var(--brand-deep)]"
            }`}
            onClick={() => setFilter("open")}
          >
            Open{openCount > 0 ? ` (${openCount})` : ""}
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              filter === "all"
                ? "bg-[var(--brand-deep)] text-white"
                : "border border-[rgba(32,48,80,0.15)] text-[var(--brand-deep)]"
            }`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white px-4 py-10 text-center text-sm text-[var(--muted)]">
          {filter === "open"
            ? "No open payment links. Select dues on Collect and tap Send UPI link."
            : "No payment links yet."}
        </div>
      ) : (
        <ul className="divide-y divide-[rgba(32,48,80,0.08)] overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
          {visible.map((link) => (
            <li
              key={link.id}
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-[var(--brand-deep)]">
                    {link.code}
                  </span>
                  <StatusPill status={link.status} />
                  {link.gatewayCheckoutUrl ? (
                    <span className="rounded bg-[rgba(22,163,74,0.12)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#15803d]">
                      {link.gatewayMode === "razorpay" ? "Razorpay" : "Cashfree"}
                    </span>
                  ) : null}
                  <span className="text-sm font-bold tabular-nums text-[var(--brand-deep)]">
                    {formatInr(link.amountPaise)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-[var(--muted)]">
                  {link.studentName}
                  {link.classLabel ? ` · ${link.classLabel}` : ""} · expires{" "}
                  {link.expiresOn}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--muted)]">
                  {link.lines.length} line
                  {link.lines.length === 1 ? "" : "s"} · by {link.createdBy}
                  {link.receiptNo ? ` · ${link.receiptNo}` : ""}
                  {link.upiRef ? ` · ${link.upiRef}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {link.status === "open" ? (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
                      onClick={() => void copyLink(link)}
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-[#128C7E] px-2.5 py-1 text-[11px] font-bold text-white"
                      onClick={() => void shareWhatsApp(link)}
                    >
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      className="btn-accent rounded-lg px-2.5 py-1 text-[11px] font-bold"
                      onClick={() => onConfirm(link)}
                    >
                      Confirm paid
                    </button>
                    <button
                      type="button"
                      className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-[#dc2626]"
                      onClick={() => onCancel(link)}
                    >
                      Cancel
                    </button>
                  </>
                ) : link.voucherId ? (
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
                    onClick={() => onOpenReceipt(link.voucherId!)}
                  >
                    Open receipt
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: PaymentLink["status"] }) {
  const map: Record<PaymentLink["status"], string> = {
    open: "bg-[rgba(37,99,235,0.12)] text-[#1d4ed8]",
    paid: "bg-[rgba(22,163,74,0.12)] text-[#15803d]",
    cancelled: "bg-[rgba(32,48,80,0.08)] text-[var(--muted)]",
    expired: "bg-[rgba(217,119,6,0.12)] text-[#b45309]",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${map[status]}`}
    >
      {status}
    </span>
  );
}
