"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listSessionYearOptions,
  type SessionYearOption,
} from "@/lib/masters";

export function SessionSelector({ currentCode }: { currentCode: string }) {
  const router = useRouter();
  const [years, setYears] = useState<SessionYearOption[]>([]);

  useEffect(() => {
    setYears(listSessionYearOptions());
  }, [currentCode]);

  async function onChange(code: string) {
    await fetch("/api/session/ay", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ academicYearCode: code }),
    });
    router.refresh();
  }

  const options =
    years.length > 0
      ? years
      : [{ code: currentCode, label: currentCode, status: "current" as const }];

  const value = options.some((y) => y.code === currentCode)
    ? currentCode
    : (options.find((y) => y.status === "current")?.code ?? options[0]!.code);

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-[var(--muted)] sm:inline">Session</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[rgba(11,61,74,0.15)] bg-white/90 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
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
