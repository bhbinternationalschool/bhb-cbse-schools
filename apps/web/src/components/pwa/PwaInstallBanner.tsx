"use client";

import { useEffect, useState } from "react";
import {
  pwaDismissKey,
  pwaManifestHref,
  type PwaAppId,
} from "@/lib/pwaApps";
import { TENANT } from "@/lib/types";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Props = {
  appId: PwaAppId;
  title: string;
  subtitle: string;
  iosHint: string;
  className?: string;
  compact?: boolean;
};

export function PwaInstallBanner({
  appId,
  title,
  subtitle,
  iosHint,
  className = "",
  compact = false,
}: Props) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [showIosHint, setShowIosHint] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const dismissKey = pwaDismissKey(appId);
    try {
      setDismissed(localStorage.getItem(dismissKey) === "1");
    } catch {
      setDismissed(false);
    }

    const href = pwaManifestHref(appId);
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      document.head.appendChild(link);
    }
    if (link.getAttribute("href") !== href) {
      link.setAttribute("href", href);
    }

    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
      return;
    }

    const isIos =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !(window as Window & { MSStream?: unknown }).MSStream;

    if (isIos) {
      const standalone = ("standalone" in navigator &&
        (navigator as Navigator & { standalone?: boolean }).standalone) as
        | boolean
        | undefined;
      if (!standalone) setShowIosHint(true);
    }

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register(`/sw.js?app=${appId}`, { scope: "/" })
        .catch(() => navigator.serviceWorker.register("/sw.js", { scope: "/" }))
        .catch(() => null);
    }

    function onBip(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setDismissed(false);
    }

    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, [appId]);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(pwaDismissKey(appId), "1");
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    if (choice.outcome === "accepted") setInstalled(true);
    dismiss();
  }

  if (installed) return null;

  const wrap = compact
    ? "px-3 py-1"
    : "mx-auto max-w-lg px-4 pb-2";

  if (showIosHint && !dismissed) {
    return (
      <div className={`${wrap} ${className}`}>
        <div className="flex items-start gap-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white px-3 py-2.5 shadow-sm">
          <img
            src={TENANT.logoCrestUrl}
            alt=""
            className="mt-0.5 h-10 w-10 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
              Install on iPhone / iPad
            </p>
            <p className="mt-0.5 text-[10px] leading-snug text-[var(--muted)]">
              Share → <strong>Add to Home Screen</strong>. {iosHint}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 text-[10px] text-[var(--muted)]"
            onClick={dismiss}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  if (!deferred || dismissed) return null;

  return (
    <div className={`${wrap} ${className}`}>
      <div
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 shadow-md"
        style={{
          background: `linear-gradient(135deg, ${TENANT.primaryColor}, ${TENANT.primaryMid})`,
        }}
      >
        <img
          src={TENANT.logoCrestUrl}
          alt=""
          className="h-11 w-11 rounded-lg bg-white/10"
        />
        <div className="min-w-0 flex-1 text-white">
          <p className="text-[12px] font-bold">{title}</p>
          <p className="text-[10px] text-white/80">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void install()}
          className="shrink-0 rounded-lg bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-bold text-[var(--brand-deep)]"
        >
          Install
        </button>
        <button
          type="button"
          className="shrink-0 text-[10px] text-white/70"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
