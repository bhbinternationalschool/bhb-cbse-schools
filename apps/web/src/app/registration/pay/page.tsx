"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  captureRegistrationPayment,
  decodeRegistrationPayPayload,
  loadAdmissions,
  saveAdmissions,
  type RegistrationPaySharePayload,
} from "@/lib/admissions";
import { formatInr } from "@/lib/fees";
import { TENANT } from "@/lib/types";

export default function RegistrationPayPage() {
  const [payload, setPayload] = useState<RegistrationPaySharePayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [gatewayReturn, setGatewayReturn] = useState(false);

  useEffect(() => {
    setGatewayReturn(
      new URLSearchParams(window.location.search).get("cf") === "1",
    );
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) {
      setError("This payment link is incomplete.");
      return;
    }
    const decoded = decodeRegistrationPayPayload(decodeURIComponent(raw));
    if (!decoded) {
      setError("Could not open payment link. Ask the school to resend.");
      return;
    }
    setPayload(decoded);
  }, []);

  function onPay() {
    if (!payload) return;
    const state = loadAdmissions();
    const r = captureRegistrationPayment(
      state,
      payload.paymentId,
      `PARENT-${payload.code}`,
    );
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    saveAdmissions(r.state);
    setDone(r.payment.code);
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
        Opening payment…
      </main>
    );
  }

  if (gatewayReturn) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm font-semibold text-[#15803d]">Thank you</p>
        <p className="mt-2 font-mono text-lg text-[var(--brand-deep)]">
          {payload.code}
        </p>
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          If your payment went through, the school records it automatically —
          no further step needed. The school will confirm your registration.
        </p>
      </main>
    );
  }

  if (done) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm font-semibold text-[#15803d]">Payment recorded</p>
        <p className="mt-2 font-mono text-lg text-[var(--brand-deep)]">{done}</p>
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          Thank you. School will confirm registration.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <Image
        src={TENANT.logoCrestUrl}
        alt=""
        width={64}
        height={66}
        className="logo-mark object-contain"
        priority
        aria-hidden
      />
      <p className="font-brand-name mt-2 text-sm text-[var(--brand-deep)]">
        {TENANT.nameDisplay}
      </p>
      <h1 className="mt-6 text-xl font-bold text-[var(--brand-deep)]">
        Registration fee
      </h1>
      <p className="mt-1 text-[13px] text-[var(--muted)]">
        {payload.childName} · {payload.code}
      </p>
      <p className="mt-4 text-2xl font-bold text-[var(--brand-deep)]">
        {formatInr(payload.amountPaise)}
      </p>
      {error ? (
        <p className="mt-3 text-sm font-medium text-[#b42318]">{error}</p>
      ) : null}
      <button
        type="button"
        className="mt-6 w-full rounded-xl bg-[var(--brand-deep)] px-4 py-3 text-sm font-semibold text-white"
        onClick={onPay}
      >
        Pay now (demo)
      </button>
      <p className="mt-3 text-[11px] text-[var(--muted)]">
        Demo: marks fee paid in school CRM. Live UPI gateway can replace this
        step.
      </p>
    </main>
  );
}
