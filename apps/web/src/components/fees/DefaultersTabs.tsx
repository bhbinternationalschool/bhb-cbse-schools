"use client";

/**
 * The Defaulters page, in two tabs.
 *
 * The withhold policy and its approval rounds were first built as a separate
 * page at /fees/defaulter-policy — and linked from nowhere. The director went
 * to the Defaulters page, the place anyone would look, found it unchanged, and
 * rightly reported that nothing had been built. A screen nobody can reach is
 * a screen that does not exist.
 *
 * So both live here. The tab is kept in the URL (?tab=policy) so it survives a
 * refresh and can be linked to, and it is written with history.replaceState,
 * not router.replace: on this app a router navigation re-runs the page's data
 * loading, which is how the class WhatsApp screen ended up polling itself.
 */

import { useEffect, useState } from "react";
import { DefaultersPlaybook } from "@/components/fees/DefaultersPlaybook";
import { DefaulterHoldPanel } from "@/components/fees/DefaulterHoldPanel";

type Tab = "list" | "policy";

function tabFromUrl(): Tab {
  if (typeof window === "undefined") return "list";
  return new URL(window.location.href).searchParams.get("tab") === "policy"
    ? "policy"
    : "list";
}

export function DefaultersTabs() {
  // Starts on "list" for the first render so server and client agree, then
  // reads the URL. Reading it during render would mismatch hydration.
  const [tab, setTab] = useState<Tab>("list");

  useEffect(() => {
    setTab(tabFromUrl());
    const onPop = () => setTab(tabFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "policy") url.searchParams.set("tab", "policy");
    else url.searchParams.delete("tab");
    window.history.replaceState({}, "", url.toString());
  }

  const tabClass = (active: boolean) =>
    `rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
      active
        ? "bg-[var(--brand-deep)] text-white"
        : "border border-[var(--border)] bg-[var(--card)] text-[var(--brand-deep)] hover:bg-[var(--muted)]"
    }`;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Defaulters" className="flex flex-wrap gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "list"}
          className={tabClass(tab === "list")}
          onClick={() => choose("list")}
        >
          Defaulters list
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "policy"}
          className={tabClass(tab === "policy")}
          onClick={() => choose("policy")}
        >
          Withhold policy &amp; approvals
        </button>
      </div>

      {tab === "policy" ? (
        <div className="space-y-2">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
              Withhold policy &amp; approvals
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Decide what a defaulting family loses, build the list, then tick
              students in bulk to withhold or let through. Nothing is withheld
              until you press Apply.
            </p>
          </div>
          <DefaulterHoldPanel />
        </div>
      ) : (
        <DefaultersPlaybook />
      )}
    </div>
  );
}
