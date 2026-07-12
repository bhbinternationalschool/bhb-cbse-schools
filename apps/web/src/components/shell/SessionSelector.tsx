"use client";

import { useRouter } from "next/navigation";
import { ACADEMIC_YEARS } from "@/lib/types";

export function SessionSelector({ currentCode }: { currentCode: string }) {
  const router = useRouter();

  async function onChange(code: string) {
    await fetch("/api/session/ay", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ academicYearCode: code }),
    });
    router.refresh();
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-[var(--muted)] sm:inline">Session</span>
      <select
        value={currentCode}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[rgba(11,61,74,0.15)] bg-white/90 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
        aria-label="Academic session"
      >
        {ACADEMIC_YEARS.map((ay) => (
          <option key={ay.code} value={ay.code}>
            {ay.label}
            {ay.status === "current" ? " · Current" : ""}
            {ay.status === "closed" ? " · Closed" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
