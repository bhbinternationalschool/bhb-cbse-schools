"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listSessionYearOptions,
  type SessionYearOption,
} from "@/lib/masters";
import { WORKSPACE_AY_ALIGNED_KEY } from "@/lib/workspaceSession";

export function SessionSelector({ currentCode }: { currentCode: string }) {
  const router = useRouter();
  const [years, setYears] = useState<SessionYearOption[]>([]);

  useEffect(() => {
    function refresh() {
      setYears(listSessionYearOptions());
    }
    refresh();
    window.addEventListener("bhb-masters-updated", refresh);
    window.addEventListener("bhb-desk-hydrated", refresh);
    window.addEventListener("bhb-desk-synced", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("bhb-masters-updated", refresh);
      window.removeEventListener("bhb-desk-hydrated", refresh);
      window.removeEventListener("bhb-desk-synced", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [currentCode]);

  async function onChange(code: string) {
    await fetch("/api/session/ay", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ academicYearCode: code }),
    });
    sessionStorage.setItem(WORKSPACE_AY_ALIGNED_KEY, "1");
    router.refresh();
  }

  const baseOptions =
    years.length > 0
      ? years
      : [{ code: currentCode, label: currentCode, status: "current" as const }];

  // currentCode is the server-aligned, authoritative session year — always
  // trust and display it. `years` is a separate, client-side cache
  // (listSessionYearOptions() reading local Masters) that can briefly lag
  // behind the session cookie; falling back to "whichever year that cache
  // happens to have marked current" when currentCode isn't in it is what
  // made the selector flash a DIFFERENT year while every year-scoped query
  // on the page kept correctly using currentCode. If the cache doesn't
  // have it yet, show it anyway rather than swap to something else.
  const options = baseOptions.some((y) => y.code === currentCode)
    ? baseOptions
    : [
        { code: currentCode, label: currentCode, status: "current" as const },
        ...baseOptions,
      ];

  const value = currentCode;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-[var(--muted)] sm:inline">Session</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[rgba(11,61,74,0.15)] bg-[var(--card)]/90 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
        aria-label="Academic session"
      >
        {options.map((ay) => (
          <option key={ay.code} value={ay.code}>
            {ay.label}
            {ay.status === "current" ? " · Current" : ""}
            {ay.status === "closed" ? " · Closed" : ""}
            {ay.status === "upcoming" ? " · Upcoming" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
