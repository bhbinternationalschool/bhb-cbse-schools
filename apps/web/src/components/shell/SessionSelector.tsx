"use client";

import { useRouter } from "next/navigation";
import { WORKSPACE_AY_ALIGNED_KEY } from "@/lib/workspaceSession";
import { useAcademicYears } from "./useAcademicYears";

export function SessionSelector({ currentCode }: { currentCode: string }) {
  const router = useRouter();
  // The masters view's academic years (data-layer 2.3a): a Masters change
  // reaches the selector through the versions poll, not a page-copy event.
  const { years } = useAcademicYears();

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
  // trust and display it. `years` is the masters view's answer (empty until
  // it arrives) and can briefly lag
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
