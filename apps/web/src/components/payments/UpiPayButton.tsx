"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Smartphone, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { field } from "@/components/ui/erp-ui";
import { asMobile, buildUpiPayLink, isVpa, type UpiProof, type UpiProofCheck } from "@/lib/upiPay";

/**
 * "Pay by UPI" for any payment the ERP records (director, 7 Oct 2026).
 *
 *   1. Opens the person's UPI app with payee, amount and a note filled in —
 *      on a phone the app itself, on a computer a QR code to scan with GPay.
 *   2. The person pays with their own PIN.
 *   3. They upload the app's success screenshot; the server reads the UTR,
 *      amount, date and payee (api/payments/upi-proof) and checks them. Only
 *      a screenshot that fits — or a UTR the person types and confirms —
 *      fills the screen's UTR, through `onPaid`.
 *
 * Nothing is saved here: the screen that hosts the button saves as usual.
 */

export type UpiPaid = { utr: string; paidOn: string; payeeVpa: string; fromScreenshot: boolean };

function todayIst(): string {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function UpiPayButton({
  payeeName,
  payeeVpa = "",
  payeeMobile = "",
  amountPaise,
  note,
  earliest,
  onPaid,
  label = "Pay by UPI",
  disabled,
}: {
  payeeName: string;
  payeeVpa?: string;
  payeeMobile?: string;
  amountPaise: number;
  note: string;
  /** Earliest sensible payment date (e.g. the salary month's first day). */
  earliest?: string;
  onPaid: (paid: UpiPaid) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [vpa, setVpa] = useState(payeeVpa);
  const [memo, setMemo] = useState(note);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ proof: UpiProof; check: UpiProofCheck } | null>(null);
  const [typedUtr, setTypedUtr] = useState("");
  const [typedDate, setTypedDate] = useState(todayIst());

  const onPhone = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobile = asMobile(payeeMobile);

  const link = useMemo(() => {
    if (!isVpa(vpa) || !(amountPaise > 0)) return "";
    try {
      return buildUpiPayLink({ payeeVpa: vpa, payeeName, amountPaise, note: memo });
    } catch {
      return "";
    }
  }, [vpa, payeeName, amountPaise, memo]);

  useEffect(() => {
    if (!open || onPhone || !link) {
      setQr("");
      return;
    }
    let live = true;
    void QRCode.toDataURL(link, { width: 220, margin: 1 }).then((d) => {
      if (live) setQr(d);
    });
    return () => {
      live = false;
    };
  }, [open, onPhone, link]);

  function reset() {
    setVpa(payeeVpa);
    setMemo(note);
    setError(null);
    setResult(null);
    setTypedUtr("");
    setTypedDate(todayIst());
  }

  async function readScreenshot(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => reject(new Error("Could not open the image"));
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/payments/upi-proof", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: dataUrl,
          mimeType: file.type || "image/png",
          expected: { amountPaise, payeeVpa: isVpa(vpa) ? vpa : "", payeeName, earliest },
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; proof?: UpiProof; check?: UpiProofCheck }
        | null;
      if (!res.ok || !body?.ok || !body.proof || !body.check) {
        setError(body?.error || "Could not read the screenshot. Type the UTR instead.");
        return;
      }
      setResult({ proof: body.proof, check: body.check });
      if (body.proof.utr) setTypedUtr(body.proof.utr);
      if (body.proof.paidOn) setTypedDate(body.proof.paidOn);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the screenshot.");
    } finally {
      setBusy(false);
    }
  }

  function finish(fromScreenshot: boolean) {
    const utr = typedUtr.replace(/\D/g, "");
    if (!/^\d{12}$/.test(utr)) {
      setError("A UPI reference (UTR) is 12 digits.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(typedDate) || typedDate > todayIst()) {
      setError("Enter the date it was paid (not in the future).");
      return;
    }
    onPaid({ utr, paidOn: typedDate, payeeVpa: isVpa(vpa) ? vpa.trim() : "", fromScreenshot });
    setOpen(false);
    reset();
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || !(amountPaise > 0)}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Smartphone className="h-3.5 w-3.5" /> {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) reset();
          setOpen(next);
        }}
      >
        <DialogPopup size="md">
          <DialogHeader>
            <DialogTitle>
              Pay {inr(amountPaise)} to {payeeName || "—"}
            </DialogTitle>
            <DialogDescription>
              Pay in your UPI app with your own PIN, then upload the success screenshot — the UTR fills in by itself.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Their UPI ID</span>
              <input
                className={field}
                value={vpa}
                onChange={(e) => setVpa(e.target.value.trim())}
                placeholder={mobile ? `e.g. ${mobile}@ybl — ask them, or see their GPay` : "name@bank"}
              />
              {!isVpa(vpa) ? (
                <span className="mt-1 block text-[11px] text-amber-800">
                  A UPI ID looks like name@bank{mobile ? ` (their number is ${mobile})` : ""}. Without it the app cannot be opened —
                  you can still pay by hand and upload the screenshot below.
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Note on the payment</span>
              <input className={field} value={memo} maxLength={50} onChange={(e) => setMemo(e.target.value)} />
            </label>

            {link ? (
              onPhone ? (
                <a
                  href={link}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-3 text-base font-bold text-white"
                >
                  <Smartphone className="h-4 w-4" /> Open GPay / UPI app
                </a>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3">
                  {qr ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qr} alt="UPI QR code for this payment" width={160} height={160} className="rounded-lg bg-white p-1" />
                  ) : (
                    <div className="h-40 w-40" />
                  )}
                  <p className="text-[12px] text-[var(--muted)]">
                    Scan with GPay on your phone (Scan QR). The name, amount and note are filled in — check them and pay with
                    your PIN. If GPay clears the amount, type {inr(amountPaise)}.
                  </p>
                </div>
              )
            ) : null}

            <div className="rounded-xl border border-dashed border-[var(--border)] p-3">
              <label className="flex cursor-pointer items-center gap-2 font-semibold text-[var(--brand-deep)]">
                <Upload className="h-4 w-4" />
                {busy ? "Reading the screenshot…" : "Upload the payment screenshot"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void readScreenshot(f);
                  }}
                />
              </label>
              {result ? (
                <div className="mt-2 space-y-1 text-[12px]">
                  <p>
                    Read: UTR <b>{result.proof.utr || "—"}</b> · {result.proof.amountPaise ? inr(result.proof.amountPaise) : "no amount"} ·{" "}
                    {result.proof.paidOn || "no date"} · to {result.proof.payeeVpa || result.proof.payeeName || "—"}
                  </p>
                  {result.check.problems.map((p) => (
                    <p key={p} className="font-semibold text-red-700">✗ {p}</p>
                  ))}
                  {result.check.notes.map((n) => (
                    <p key={n} className="text-amber-800">! {n}</p>
                  ))}
                  {result.check.ok ? <p className="font-semibold text-emerald-700">✓ The screenshot fits this payment.</p> : null}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">UTR (12 digits)</span>
                <input
                  className={field}
                  inputMode="numeric"
                  value={typedUtr}
                  onChange={(e) => setTypedUtr(e.target.value.replace(/\D/g, "").slice(0, 12))}
                />
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Paid on</span>
                <input className={field} type="date" value={typedDate} max={todayIst()} onChange={(e) => setTypedDate(e.target.value)} />
              </label>
            </div>
            {error ? <p className="font-semibold text-red-700">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            {result?.check.ok ? (
              <Button type="button" onClick={() => finish(true)}>
                Use this UTR
              </Button>
            ) : (
              <Button
                type="button"
                disabled={!/^\d{12}$/.test(typedUtr)}
                onClick={() => {
                  if (window.confirm(`Record UTR ${typedUtr} for ${inr(amountPaise)} to ${payeeName}? Check it against your UPI app.`)) {
                    finish(false);
                  }
                }}
              >
                Use typed UTR
              </Button>
            )}
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
