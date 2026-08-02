"use client";

import { useEffect } from "react";
import { detectMobileAppShell, detectPwaStandalone } from "@/lib/pwaStandalone";

/** Adds document classes for PWA / mobile app CSS hooks. */
export function PwaStandaloneProvider() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    function apply() {
      const standalone = detectPwaStandalone();
      const mobileApp = detectMobileAppShell();
      root.classList.toggle("bhb-pwa-standalone", standalone);
      root.classList.toggle("bhb-mobile-app", mobileApp);
      body.classList.toggle("bhb-pwa-standalone", standalone);
      body.classList.toggle("bhb-mobile-app", mobileApp);
    }

    apply();
    const mq = window.matchMedia("(max-width: 768px)");
    mq.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
      root.classList.remove("bhb-pwa-standalone", "bhb-mobile-app");
      body.classList.remove("bhb-pwa-standalone", "bhb-mobile-app");
    };
  }, []);

  return null;
}
