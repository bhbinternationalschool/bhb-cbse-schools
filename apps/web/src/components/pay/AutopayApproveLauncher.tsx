"use client";

import Script from "next/script";
import { useCallback, useState } from "react";

type CashfreeSubsSdk = {
  subscriptionsCheckout: (opts: { subsSessionId: string; redirectTarget: "_self" }) => Promise<{
    error?: { message?: string };
  } | void>;
};

/**
 * Opens Cashfree's mandate approval for one family. Unlike a payment, this
 * does not start on its own: the parent should read the limit and the terms
 * on the page first, then tap.
 */
export function AutopayApproveLauncher({
  sessionId,
  mode,
  limitLabel,
}: {
  sessionId: string;
  mode: "sandbox" | "production";
  limitLabel: string;
}) {
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    const factory = (window as unknown as { Cashfree?: (o: { mode: "sandbox" | "production" }) => CashfreeSubsSdk }).Cashfree;
    if (!factory) {
      setError("The approval page could not load. Check your connection and try again.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await factory({ mode }).subscriptionsCheckout({ subsSessionId: sessionId, redirectTarget: "_self" });
      if (res && res.error) {
        setError(res.error.message || "Could not open the approval page.");
        setStarting(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the approval page.");
      setStarting(false);
    }
  }, [mode, sessionId]);

  return (
    <div className="mt-8">
      <Script
        src="https://sdk.cashfree.com/js/v3/cashfree.js"
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
        onError={() => setError("The approval page could not load. Check your connection and try again.")}
      />
      <button
        type="button"
        disabled={!ready || starting}
        onClick={() => void start()}
        className="w-full rounded-xl bg-[var(--primary)] px-5 py-3.5 text-[15px] font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
      >
        {starting ? "Opening secure page…" : `Approve auto-pay (up to ${limitLabel})`}
      </button>
      <p className="mt-3 text-xs text-[var(--muted)]">
        {ready
          ? "You will approve it on Cashfree's secure page with your UPI PIN, net banking or debit card. A ₹1 check may be taken and is refunded."
          : "Loading secure page…"}
      </p>
      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
