"use client";

import { useEffect, useState } from "react";
import { PARENT_APP_URL } from "@/lib/classGroupMoveNotice";
import { installPlatform } from "@/lib/installPlatform";

const DISMISS_KEY = "bhb_login_app_card_dismissed_v2";

/**
 * The login page's "get the app" card (director, 9 Oct 2026).
 *
 * It used to install ONE website icon for everyone — "BHB School app, sign
 * in as parent, staff or field" — which competed with the real apps: parents
 * have the Play Store app, staff have BHB Staff (/downloads). Now it sends
 * each to theirs. Phones only; hidden inside an installed app; dismissible.
 */
export function LoginPwaInstall() {
  const [show, setShow] = useState(false);
  // No parent app on the App Store: iPhone parents use the portal, added to
  // the Home Screen.
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const p = installPlatform(navigator.userAgent, {
      standalone:
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
      maxTouchPoints: navigator.maxTouchPoints,
    });
    if (p === "standalone" || p === "desktop") return;
    setIos(p === "ios-safari" || p === "ios-other");
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* show it */
    }
    setShow(true);
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* fine — it comes back next visit */
    }
  }

  if (!show) return null;
  return (
    <div className="fixed bottom-4 left-0 right-0 z-30 px-4">
      <div className="mx-auto flex max-w-lg items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 shadow-md">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-[var(--brand-deep)]">Get the school app / स्कूल ऐप</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={ios ? "/parent" : PARENT_APP_URL}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold text-[var(--primary-foreground)]"
            >
              {ios ? "Parents — open, then Share → Add to Home Screen" : "Parents — Google Play"}
            </a>
            <a
              href="/downloads"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)]"
            >
              Staff — BHB Staff
            </a>
          </div>
        </div>
        <button type="button" className="shrink-0 text-[11px] text-[var(--muted)]" onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}
