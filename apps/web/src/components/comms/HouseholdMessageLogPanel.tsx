"use client";

import { useState } from "react";
import { field } from "@/components/ui/erp-ui";

type LogEntry = {
  id: string;
  channel: "wa" | "app_chat";
  direction: "out" | "in";
  purpose: string;
  via: string;
  templateName: string;
  preview: string;
  status: "sent" | "failed";
  error: string | null;
  by: string;
  at: string;
};

const CHANNEL_LABEL: Record<LogEntry["channel"], string> = {
  wa: "WhatsApp",
  app_chat: "In-app chat",
};

export function HouseholdMessageLogPanel() {
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);

  async function search() {
    const m = mobile.replace(/\D/g, "");
    if (m.length < 10) {
      setError("Enter a 10-digit mobile number");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/comms/household-log?mobile=${encodeURIComponent(m)}`,
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        householdId?: string | null;
        entries?: LogEntry[];
      };
      if (!res.ok || !json.ok) {
        setError(json.error || "Search failed");
        setEntries(null);
        return;
      }
      setHouseholdId(json.householdId ?? null);
      setEntries(json.entries || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[var(--muted)]">
        One household&apos;s cross-channel message history — &ldquo;what did we
        send this family?&rdquo; Covers WhatsApp (fee reminders, duty/
        substitution notify, admission campaigns, broadcasts) and in-app
        staff↔parent chat. <span className="text-amber-800">IVRS and email
        are not tracked yet</span> — IVRS has no call history stored anywhere
        in this system today, and email has no provider configured.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${field} max-w-xs`}
          placeholder="Guardian mobile (10 digit)"
          inputMode="numeric"
          value={mobile}
          onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
        />
        <button
          type="button"
          disabled={loading}
          className="rounded-lg bg-[var(--primary)] px-3 py-2 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
          onClick={() => void search()}
        >
          {loading ? "Searching…" : "Search"}
        </button>
        {householdId ? (
          <span className="text-[11px] text-[var(--muted)]">
            Household {householdId}
          </span>
        ) : entries ? (
          <span className="text-[11px] text-amber-800">
            No SIS household matched this mobile — showing WhatsApp sends by
            mobile only.
          </span>
        ) : null}
      </div>

      {error ? <p className="text-[12px] text-[var(--danger)]">{error}</p> : null}

      {entries ? (
        entries.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
            No messages found for this number yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-[var(--brand-deep)]">
                    {CHANNEL_LABEL[e.channel]}
                    {e.channel === "wa" ? ` · ${e.purpose}` : ""}
                    {e.direction === "in" ? " · inbound" : " · outbound"}
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">
                    {e.at.slice(0, 16).replace("T", " ")}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--ink)]">
                  {e.preview || (e.templateName ? `Template: ${e.templateName}` : "—")}
                </p>
                {e.status === "failed" ? (
                  <p className="mt-1 text-[10px] text-[var(--danger)]">
                    Failed{e.error ? ` — ${e.error}` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
