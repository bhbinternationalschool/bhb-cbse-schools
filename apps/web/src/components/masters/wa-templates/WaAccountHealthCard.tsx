"use client";

import { useEffect, useState } from "react";
import { waBtnOutline } from "./waTemplateUi";

type SetupReport = {
  ok: boolean;
  outboundConfigured: boolean;
  phoneHealth: {
    displayNumber: string | null;
    verifiedName: string | null;
    status: string | null;
    canSendMessage: boolean;
    qualityRating: string | null;
  };
  approvedTemplateCount: number | null;
  issues: string[];
  fixes: string[];
};

function qualityTone(rating: string | null): "good" | "warn" | "danger" | "muted" {
  if (rating === "GREEN") return "good";
  if (rating === "YELLOW") return "warn";
  if (rating === "RED") return "danger";
  return "muted";
}

const TONE_CLASS: Record<string, string> = {
  good: "bg-[rgba(21,128,61,0.1)] text-[var(--success)]",
  warn: "bg-[rgba(180,131,0,0.12)] text-[#8a6400]",
  danger: "bg-[rgba(180,35,24,0.1)] text-[var(--danger)]",
  muted: "bg-[var(--surface-sunken)] text-[var(--muted)]",
};

/** Live WhatsApp Business account status — quality rating, verification,
 * and any setup issues Meta's Graph API surfaces. Nothing here is stored
 * locally; every load is a fresh check against Meta. */
export function WaAccountHealthCard() {
  const [report, setReport] = useState<SetupReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wa/setup");
      const json = (await res.json()) as SetupReport & { error?: string };
      if (!res.ok) {
        setError(json.error || "Could not load WhatsApp account status");
        return;
      }
      setReport(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const tone = qualityTone(report?.phoneHealth.qualityRating ?? null);

  return (
    <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          WhatsApp account health
        </h3>
        <button
          type="button"
          className={waBtnOutline}
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="mt-2 text-[12px] text-[var(--danger)]">{error}</p>
      ) : !report ? (
        <p className="mt-2 text-[12px] text-[var(--muted)]">
          {loading ? "Checking with Meta…" : "No data yet."}
        </p>
      ) : !report.outboundConfigured ? (
        <p className="mt-2 text-[12px] text-[var(--muted)]">
          WhatsApp sending isn&apos;t configured on this server.
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[tone]}`}
              title="Meta's messaging quality signal for this number"
            >
              Quality: {report.phoneHealth.qualityRating || "unknown"}
            </span>
            <span className="text-[var(--muted)]">
              {report.phoneHealth.displayNumber || "—"} ·{" "}
              {report.phoneHealth.verifiedName || "unverified name"} ·{" "}
              {report.phoneHealth.status || "unknown status"}
            </span>
            {report.approvedTemplateCount != null ? (
              <span className="text-[var(--muted)]">
                · {report.approvedTemplateCount} approved template(s)
              </span>
            ) : null}
          </div>

          {report.issues.length > 0 ? (
            <ul className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
              {report.issues.map((issue, i) => (
                <li key={issue} className="text-[11px]">
                  <span className="font-semibold text-[var(--danger)]">
                    {issue}
                  </span>
                  {report.fixes[i] ? (
                    <span className="text-[var(--muted)]"> — {report.fixes[i]}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-[var(--success)]">
              No setup issues detected.
            </p>
          )}
        </>
      )}
    </div>
  );
}
