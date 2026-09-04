"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

type CashfreeSdk = {
  checkout: (opts: { paymentSessionId: string; redirectTarget: "_self" }) => Promise<{
    error?: { message?: string };
  } | void>;
};

declare global {
  interface Window {
    Cashfree?: (opts: { mode: "sandbox" | "production" }) => CashfreeSdk;
  }
}

/**
 * Loads Cashfree's checkout script and sends the parent to the hosted
 * payment page for this order. Starts on its own once the script is
 * ready; the button is there for a blocked auto-redirect or a retry.
 */
export function CashfreeCheckoutLauncher({
  paymentSessionId,
  mode,
  amountLabel,
}: {
  paymentSessionId: string;
  mode: "sandbox" | "production";
  amountLabel: string;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const started = useRef(false);

  const start = useCallback(async () => {
    const factory = window.Cashfree;
    if (!factory) {
      setError("The payment page could not load. Check your connection and try again.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await factory({ mode }).checkout({ paymentSessionId, redirectTarget: "_self" });
      if (res && res.error) {
        setError(res.error.message || "Could not open the payment page.");
        setStarting(false);
      }
      // Otherwise the browser is navigating to Cashfree; nothing to do.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the payment page.");
      setStarting(false);
    }
  }, [mode, paymentSessionId]);

  useEffect(() => {
    if (ready && !started.current) {
      started.current = true;
      void start();
    }
  }, [ready, start]);

  return (
    <div className="mt-8">
      <Script
        src="https://sdk.cashfree.com/js/v3/cashfree.js"
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
        onError={() => setError("The payment page could not load. Check your connection and try again.")}
      />
      <button
        type="button"
        disabled={!ready || starting}
        onClick={() => void start()}
        className="w-full rounded-xl bg-[#203050] px-5 py-3.5 text-[15px] font-semibold text-white disabled:opacity-60"
      >
        {starting ? "Opening secure payment…" : `Pay ${amountLabel}`}
      </button>
      <p className="mt-3 text-xs text-[#5c6478]">
        {ready
          ? "You will be taken to Cashfree's secure page. UPI, cards and net banking are accepted."
          : "Loading secure payment…"}
      </p>
      {error ? <p className="mt-3 text-sm text-[#b42318]">{error}</p> : null}
    </div>
  );
}
