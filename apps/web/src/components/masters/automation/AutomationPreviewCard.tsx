"use client";

import { useState } from "react";
import type { AutomationRecipient, AutomationSendResult } from "@/lib/automation";
import { formatInr } from "@/lib/masters";
import type { PreviewResult } from "./useAutomationDesk";
import { autoBtnOutline } from "./automationUi";

export function maskMobile(m: string): string {
  const d = (m || "").replace(/\D/g, "");
  if (d.length < 6) return d || "—";
  return `${d.slice(0, 2)}••••${d.slice(-4)}`;
}

/** The families a rule would message — shared by the preview and the approval card. */
export function RecipientList({
  recipients,
  results,
  limit = 12,
}: {
  recipients: AutomationRecipient[];
  results?: AutomationSendResult[];
  limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? recipients : recipients.slice(0, limit);
  const byMobile = new Map((results || []).map((r) => [r.mobile, r]));
  return (
    <div>
      <ul className="divide-y divide-[var(--border)] text-[11px]">
        {rows.map((r, i) => {
          const res = byMobile.get(r.mobile);
          return (
            <li key={`${r.mobile}_${i}`} className="flex flex-wrap items-center justify-between gap-x-3 py-1">
              <span className="min-w-0">
                <span className="font-semibold text-[var(--brand-deep)]">
                  {r.studentName || r.mobile}
                </span>
                {r.classLabel ? <span className="text-[var(--muted)]"> · {r.classLabel}</span> : null}
                <span className="text-[var(--muted)]"> · {maskMobile(r.mobile)}</span>
                {r.language ? <span className="text-[var(--muted)]"> · {r.language.toUpperCase()}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                {r.amountPaise != null ? (
                  <span className="font-semibold">{formatInr(r.amountPaise)}</span>
                ) : null}
                {res ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      res.ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                    }`}
                    title={res.error || ""}
                  >
                    {res.ok ? "sent" : "failed"}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {recipients.length > limit ? (
        <button
          type="button"
          className="mt-1 text-[11px] font-semibold text-[var(--brand-deep)] underline"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show fewer" : `Show all ${recipients.length}`}
        </button>
      ) : null}
    </div>
  );
}

export function AutomationPreviewCard({
  preview,
  onIgnoreCap,
}: {
  preview: PreviewResult;
  onIgnoreCap: () => void;
}) {
  if (preview.loading) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-[11px] text-[var(--muted)]">
        Building today&apos;s list from the fee desk…
      </div>
    );
  }
  const p = preview.preview;
  if (!p) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-800">
        {preview.error || "Preview failed"}
      </div>
    );
  }
  if (!p.supported) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900">
        <p className="font-semibold">Cannot build this audience</p>
        <p className="mt-1">{p.reason}</p>
      </div>
    );
  }
  if (!p.templateReady) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900">
        <p className="font-semibold">Template not ready</p>
        <p className="mt-1">{p.templateError}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 space-y-2">
      <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
        Who gets it right now
      </p>
      <p className="text-[11px] text-[var(--muted)]">{p.audienceNote}</p>
      {p.previewBody ? (
        <pre className="whitespace-pre-wrap rounded-lg bg-[var(--surface-sunken)] p-2 text-[11px]">
          {p.previewBody}
        </pre>
      ) : null}
      {p.recipients.length ? (
        <RecipientList recipients={p.recipients} />
      ) : (
        <p className="text-[11px] text-[var(--muted)]">Nobody would be messaged right now.</p>
      )}
      {p.skipped.some((s) => /reminded in the last/.test(s.reason)) ? (
        <button type="button" className={autoBtnOutline} onClick={onIgnoreCap}>
          Show families held back by the weekly cap too
        </button>
      ) : null}
    </div>
  );
}
