"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * AI replies a parent objected to.
 *
 * Google Play requires an app with generative AI to let users report
 * offensive output AND to act on what they report. The app files it; this
 * is where somebody at the school reads it and closes it. Without this
 * panel the reporting button would be a gesture.
 *
 * Everything shown here — the question, the reply, the parent's words — is
 * untrusted text written by a parent or produced by a model. It is rendered
 * as plain content and never treated as an instruction.
 */

type Report = {
  id: string;
  generationId: string;
  route: string;
  studentId: string;
  reportedBy: string;
  category: string;
  reason: string;
  question: string;
  reply: string;
  status: "open" | "reviewed" | "dismissed";
  createdAt: string;
  reviewedBy: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  wrong: "Wrong answer",
  inappropriate: "Inappropriate",
  confusing: "Confusing",
  other: "Reported",
};

function when(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      }).format(d);
}

export function AiReportsPanel({ readOnly }: { readOnly: boolean }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/ai/content-reports?status=${showAll ? "all" : "open"}`,
        { cache: "no-store" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Failed (${res.status})`);
      setReports((body.reports ?? []) as Report[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    void load();
  }, [load]);

  async function close(id: string, status: "reviewed" | "dismissed") {
    setBusy(id);
    try {
      const res = await fetch("/api/ai/content-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed (${res.status})`);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)]">
          Replies from the AI tutor that a parent flagged. Read what was said,
          then close the report.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          <span>Include closed</span>
        </label>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          Loading…
        </p>
      ) : reports.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          {showAll
            ? "No AI replies have been reported."
            : "Nothing open. Tick “Include closed” to see past reports."}
        </p>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                  {CATEGORY_LABEL[r.category] ?? "Reported"}
                </span>
                <span className="text-[var(--muted)]">
                  {r.reportedBy || "A parent"} · {when(r.createdAt)}
                </span>
                {r.status !== "open" ? (
                  <span className="text-[11px] text-[var(--muted)]">
                    — {r.status}
                    {r.reviewedBy ? ` by ${r.reviewedBy}` : ""}
                  </span>
                ) : null}
              </div>

              {r.reason ? (
                <p className="mt-2 text-sm font-medium">“{r.reason}”</p>
              ) : null}

              {r.question ? (
                <p className="mt-3 text-[13px] text-[var(--muted)]">
                  <span className="font-medium">Asked:</span> {r.question}
                </p>
              ) : null}

              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--bg)] p-3 text-[13px]">
                {r.reply}
              </p>

              {r.status === "open" && !readOnly ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => void close(r.id, "reviewed")}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Mark reviewed
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => void close(r.id, "dismissed")}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
