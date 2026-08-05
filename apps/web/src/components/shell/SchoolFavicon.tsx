"use client";

import { useEffect } from "react";
import { loadMasters } from "@/lib/masters";

/** Sets document favicon from masters school profile (faviconUrl or logoUrl). */
export function SchoolFavicon() {
  useEffect(() => {
    function apply() {
      const profile = loadMasters().schoolProfile;
      const url = profile.faviconUrl?.trim() || profile.logoUrl?.trim();
      if (!url) return;
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = url;
    }
    apply();
    window.addEventListener("bhb-desk-hydrated", apply);
    window.addEventListener("bhb-masters-updated", apply);
    return () => {
      window.removeEventListener("bhb-desk-hydrated", apply);
      window.removeEventListener("bhb-masters-updated", apply);
    };
  }, []);
  return null;
}
