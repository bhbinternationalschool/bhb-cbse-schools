"use client";

import { useEffect } from "react";
import { loadMasters } from "@/lib/masters";

/** Marks the one icon link this component owns. */
const OWN_ATTR = "data-school-favicon";
/** Next's icon links are parked under this rel instead of being removed. */
const PARKED_REL = "bhb-parked-icon";

/**
 * Point the browser tab at the school's own mark.
 *
 * The shipped app/favicon.ico is already the school crest, so the tab is
 * right before any JS runs — this only takes over when Masters carries an
 * uploaded favicon or logo of its own.
 *
 * Next's icon links belong to React: they are hoisted metadata elements, and
 * React removes them itself (`node.parentNode.removeChild(node)`) whenever
 * the page's metadata is replaced — every client-side navigation, and dev
 * rebuilds. Removing one here left React holding a detached node, and the
 * next navigation threw "Cannot read properties of null (reading
 * 'removeChild')" halfway through its commit, after which every commit failed
 * the same way: the URL never changed and clicks did nothing until a reload.
 *
 * So Next's links are never removed or moved: their `rel` is switched to an
 * inert value (a browser only takes a tab icon from rel="icon") and the
 * school's mark goes in a link of our own, which React does not know about.
 * Every icon link is parked, not just the first — Next emits several and a
 * browser is free to pick any of them. A fresh link is appended rather than
 * an href changed in place, because browsers routinely ignore that.
 */
export function SchoolFavicon() {
  useEffect(() => {
    function apply() {
      const profile = loadMasters().schoolProfile;
      const url = profile.faviconUrl?.trim() || profile.logoUrl?.trim();
      if (!url) return;

      document
        .querySelectorAll<HTMLLinkElement>(
          `link[rel~='icon']:not([${OWN_ATTR}])`,
        )
        .forEach((l) => l.setAttribute("rel", PARKED_REL));

      const own = document.head.querySelector<HTMLLinkElement>(
        `link[${OWN_ATTR}]`,
      );
      // Nothing to do when this exact mark is already on the tab, or the
      // masters-updated event would rewrite the head on every save.
      if (own?.getAttribute("href") === url) return;
      own?.remove();

      const link = document.createElement("link");
      link.rel = "icon";
      link.href = url;
      link.setAttribute(OWN_ATTR, "");
      document.head.appendChild(link);
    }
    apply();
    // Next re-renders its metadata (and with it fresh icon links) on
    // refreshes and navigations, after this effect has run. Park each new
    // one as it lands; apply() only touches attributes and our own link, so
    // the observer cannot loop on itself.
    const observer = new MutationObserver((records) => {
      const iconAdded = records.some((r) =>
        Array.from(r.addedNodes).some(
          (n) =>
            n instanceof HTMLLinkElement &&
            !n.hasAttribute(OWN_ATTR) &&
            n.relList.contains("icon"),
        ),
      );
      if (iconAdded) apply();
    });
    observer.observe(document.head, { childList: true });
    window.addEventListener("bhb-desk-hydrated", apply);
    window.addEventListener("bhb-masters-updated", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("bhb-desk-hydrated", apply);
      window.removeEventListener("bhb-masters-updated", apply);
    };
  }, []);
  return null;
}
