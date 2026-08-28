"use client";

import { useEffect } from "react";
import { loadMasters } from "@/lib/masters";

/**
 * Point the browser tab at the school's own mark.
 *
 * The shipped app/favicon.ico is already the school crest, so the tab is
 * right before any JS runs — this only takes over when Masters carries an
 * uploaded favicon or logo of its own.
 *
 * Every icon link is rewritten, not just the first: Next emits several
 * (favicon.ico plus the metadata icons) and a browser is free to pick any of
 * them, so leaving one behind means the old mark can still win. The stale
 * links are removed and a fresh one appended, because browsers routinely
 * ignore an href changed in place on an existing icon link.
 */
export function SchoolFavicon() {
  useEffect(() => {
    function apply() {
      const profile = loadMasters().schoolProfile;
      const url = profile.faviconUrl?.trim() || profile.logoUrl?.trim();
      if (!url) return;

      const links = Array.from(
        document.querySelectorAll<HTMLLinkElement>(
          "link[rel~='icon'], link[rel='shortcut icon']",
        ),
      );
      // Nothing to do when this exact mark is already on the tab, or the
      // masters-updated event would rewrite the head on every save.
      if (links.length === 1 && links[0].getAttribute("href") === url) return;
      links.forEach((l) => l.remove());

      const link = document.createElement("link");
      link.rel = "icon";
      link.href = url;
      document.head.appendChild(link);
    }
    apply();
    // Next re-injects its own metadata icon links after this effect runs, so
    // a single pass leaves the static icon last and it can win. Re-assert a
    // couple of times; the guard above makes each repeat a no-op once ours
    // is the only icon link left.
    const retries = [300, 1500].map((ms) => window.setTimeout(apply, ms));
    window.addEventListener("bhb-desk-hydrated", apply);
    window.addEventListener("bhb-masters-updated", apply);
    return () => {
      retries.forEach(window.clearTimeout);
      window.removeEventListener("bhb-desk-hydrated", apply);
      window.removeEventListener("bhb-masters-updated", apply);
    };
  }, []);
  return null;
}
