"use client";

import { useEffect, useState } from "react";
import { qrDataUrlFor } from "@/lib/pdfQr";
import { visitorPurposeLabel, type VisitorEntry } from "@/lib/visitors";
import { TENANT } from "@/lib/types";

/** Single ad-hoc pass, not a batch — HTML + window.print(), mirrors
 * CertificateSheet.tsx's printCertificate() exactly. */
export function printVisitorPass(visitorId: string) {
  const sheet = document.getElementById(`visitor-pass-${visitorId}`);
  if (!sheet) {
    window.print();
    return;
  }
  document.body.classList.add("printing-visitor-pass");
  sheet.classList.add("print-target");
  const cleanup = () => {
    document.body.classList.remove("printing-visitor-pass");
    sheet.classList.remove("print-target");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 1000);
}

export function VisitorPassSheet({ entry }: { entry: VisitorEntry }) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void qrDataUrlFor(entry.qrPayload).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.qrPayload]);

  return (
    <div
      id={`visitor-pass-${entry.id}`}
      className="visitor-pass-sheet relative mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-[rgba(32,48,80,0.18)] bg-white p-5 text-[var(--brand-deep)]"
    >
      <header className="border-b-2 border-[var(--brand-gold)] pb-2 text-center">
        <p className="font-brand-name text-sm tracking-[0.12em]">{TENANT.nameDisplay}</p>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          {TENANT.city}, {TENANT.state}
        </p>
        <div className="mt-2 inline-block rounded bg-[var(--brand-deep)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white">
          Visitor pass
        </div>
      </header>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="space-y-2 text-sm">
          <div>
            <p className="text-[10px] uppercase text-[var(--muted)]">Visitor · विज़िटर</p>
            <p className="font-bold">{entry.visitorName}</p>
            {entry.visitorNo ? <p className="font-mono text-lg font-black tracking-wide">{entry.visitorNo}</p> : null}
          </div>
          <div>
            <p className="text-[10px] uppercase text-[var(--muted)]">Purpose</p>
            <p className="font-semibold">{visitorPurposeLabel(entry.purpose)}</p>
          </div>
          {entry.personToMeet ? (
            <div>
              <p className="text-[10px] uppercase text-[var(--muted)]">Meeting</p>
              <p className="font-semibold">{entry.personToMeet}</p>
            </div>
          ) : null}
          <div>
            <p className="text-[10px] uppercase text-[var(--muted)]">Check-in · आने का समय</p>
            <p className="font-semibold">{new Date(entry.inTime).toLocaleString()}</p>
          </div>
        </div>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="Visitor QR" className="h-24 w-24 shrink-0" />
        ) : (
          <div className="h-24 w-24 shrink-0 rounded bg-[var(--surface-sunken)]" />
        )}
      </div>

      <p className="mt-4 text-center text-[10px] text-[var(--muted)]">
        Please wear this pass visibly at all times on campus and return it at the gate on exit.
      </p>
    </div>
  );
}
