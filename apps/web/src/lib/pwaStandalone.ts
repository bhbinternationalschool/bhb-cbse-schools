"use client";

import { useEffect, useState } from "react";

/** True when installed to home screen (PWA standalone). */
export function detectPwaStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return !!nav.standalone;
}

/** Mobile viewport or installed PWA — use app shell (bottom nav, compact chrome). */
export function detectMobileAppShell(): boolean {
  if (typeof window === "undefined") return false;
  if (detectPwaStandalone()) return true;
  return window.matchMedia("(max-width: 768px)").matches;
}

export function useMobileAppShell(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const update = () => setOn(detectMobileAppShell());
    update();
    const mq = window.matchMedia("(max-width: 768px)");
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return on;
}

export function usePwaStandalone(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(detectPwaStandalone());
  }, []);
  return on;
}
