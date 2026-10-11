"use client";

/**
 * Read-only entrance test badge on a lead's CRM record.
 *
 * Reads /api/admissions/entrance-test?view=lead — the lead itself is not
 * loaded, changed or saved by this, so the leads desk behaves exactly as it
 * did. Shows nothing when the child is on no test; says so plainly when the
 * record could not be read (never "no test" for "don't know").
 */

import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import { formatTestDate, type EntranceResultStatus } from "@/lib/admissionEntranceTest";
import { EntranceStatusChip } from "@/components/admissions/EntranceTestPanel";

type Rec = {
  candidateId: string;
  sessionId: string;
  sessionName: string;
  testDate: string;
  rollNo: string;
  absent: boolean;
  resultStatus: EntranceResultStatus;
  percent: number | null;
};

export function LeadEntranceTestBadge({
  leadId,
  onOpen,
}: {
  leadId: string;
  /** Opens Admissions → Entrance test on this sitting; omitted = no link (no access). */
  onOpen?: (sessionId: string) => void;
}) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; records: Rec[] }>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/admissions/entrance-test?view=lead&leadId=${encodeURIComponent(leadId)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; records?: Rec[] };
        if (cancelled) return;
        if (!res.ok || !body.ok || !Array.isArray(body.records)) setState({ status: "error" });
        else setState({ status: "ready", records: body.records });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (state.status === "loading") return null;
  if (state.status === "error") {
    return (
      <p className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--muted)]">
        Entrance test: could not check right now.
      </p>
    );
  }
  if (state.records.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs">
      <GraduationCap className="size-4 text-[var(--brand-deep)]" aria-hidden />
      <span className="font-semibold text-[var(--brand-deep)]">Entrance test</span>
      {state.records.map((r) => (
        <span key={r.candidateId} className="inline-flex flex-wrap items-center gap-1.5">
          {onOpen ? (
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => onOpen(r.sessionId)}>
              {r.sessionName || "Test"} · {formatTestDate(r.testDate, "en")}
            </button>
          ) : (
            <span className="font-medium">{r.sessionName || "Test"} · {formatTestDate(r.testDate, "en")}</span>
          )}
          <span className="text-[var(--muted)]">roll {r.rollNo}{r.percent !== null ? ` · ${r.percent}%` : ""}</span>
          <EntranceStatusChip status={r.resultStatus || (r.absent ? "absent" : "")} />
        </span>
      ))}
    </div>
  );
}
