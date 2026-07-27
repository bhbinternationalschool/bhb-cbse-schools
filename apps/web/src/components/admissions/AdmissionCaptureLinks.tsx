"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  DIGITAL_CAPTURE_SOURCES,
  publicEnquiryAbsoluteUrl,
  publicPortalOrigin,
  publicRegisterAbsoluteUrl,
  sourceLabel,
  type AdmissionSource,
} from "@/lib/admissions";

type LinkKind = "enquiry" | "register";

export function AdmissionCaptureLinks() {
  const [kind, setKind] = useState<LinkKind>("enquiry");
  const [active, setActive] = useState<AdmissionSource>("website");
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const url = useMemo(() => {
    if (kind === "register") {
      return publicRegisterAbsoluteUrl(
        active === "social" ? "wa_share" : active,
      );
    }
    return publicEnquiryAbsoluteUrl(active);
  }, [kind, active]);
  const portalHost = publicPortalOrigin().replace(/^https?:\/\//, "");

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void QRCode.toDataURL(url, {
      width: 200,
      margin: 1,
      color: { dark: "#203050", light: "#ffffff" },
    }).then((data) => {
      if (!cancelled) setQr(data);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[var(--muted)]">
        <strong className="text-[var(--brand-deep)]">Enquiry</strong> = lead
        capture only.{" "}
        <strong className="text-[var(--brand-deep)]">Register + pay</strong> =
        family self-registration with per-child fee (lands in Registration
        queue). Share via{" "}
        <strong className="text-[var(--brand-deep)]">{portalHost}</strong> or WA
        campaigns.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setKind("enquiry")}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
            kind === "enquiry"
              ? "bg-[var(--brand-deep)] text-white"
              : "border border-[rgba(32,48,80,0.15)] bg-white text-[var(--brand-deep)]"
          }`}
        >
          Enquiry form
        </button>
        <button
          type="button"
          onClick={() => setKind("register")}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
            kind === "register"
              ? "bg-[#0f766e] text-white"
              : "border border-[rgba(32,48,80,0.15)] bg-white text-[var(--brand-deep)]"
          }`}
        >
          Register + pay
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {DIGITAL_CAPTURE_SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setActive(s)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
              active === s
                ? "bg-[var(--brand-deep)] text-white"
                : "border border-[rgba(32,48,80,0.15)] bg-white text-[var(--brand-deep)]"
            }`}
          >
            {sourceLabel(s)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt={`QR for ${kind} on ${portalHost}`}
            className="h-[140px] w-[140px] rounded-lg border border-[rgba(32,48,80,0.1)]"
          />
        ) : (
          <div className="flex h-[140px] w-[140px] items-center justify-center rounded-lg bg-[rgba(32,48,80,0.04)] text-[11px] text-[var(--muted)]">
            QR…
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] font-semibold uppercase text-[var(--muted)]">
            {kind === "register" ? "Register + pay" : "Enquiry"} ·{" "}
            {sourceLabel(active)} · {portalHost}
          </p>
          <p className="break-all font-mono text-[12px] text-[var(--brand-deep)]">
            {url}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyLink()}
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)]"
            >
              Open
            </a>
            {qr ? (
              <a
                href={qr}
                download={`bhb-${kind}-${active}.png`}
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)]"
              >
                Download QR
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
