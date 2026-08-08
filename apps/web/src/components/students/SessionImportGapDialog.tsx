"use client";

import { useEffect, useMemo, useState } from "react";
import type { MastersState } from "@/lib/masters";
import {
  applySessionGapActions,
  type SessionGapAction,
  type SessionGapRow,
} from "@/lib/studentImport";
import type { SisState } from "@/lib/sis";

type Props = {
  masters: MastersState;
  sis: SisState;
  priorSession: string;
  targetSession: string;
  missing: SessionGapRow[];
  onClose: () => void;
  onApplied: (next: SisState, message: string) => void;
};

function classLabel(
  classId: string,
  sectionId: string,
  masters: MastersState,
): string {
  const cls = masters.classes.find((c) => c.id === classId)?.name ?? "—";
  const sec = masters.sections.find((s) => s.id === sectionId)?.name ?? "";
  return sec ? `${cls}-${sec}` : cls;
}

export function SessionImportGapDialog({
  masters,
  sis,
  priorSession,
  targetSession,
  missing,
  onClose,
  onApplied,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [choices, setChoices] = useState<Record<string, SessionGapAction>>(
    () =>
      Object.fromEntries(missing.map((m) => [m.studentId, "leave" as const])),
  );
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    let inactive = 0;
    let promote = 0;
    let leave = 0;
    for (const a of Object.values(choices)) {
      if (a === "inactive") inactive += 1;
      else if (a === "promote") promote += 1;
      else leave += 1;
    }
    return { inactive, promote, leave };
  }, [choices]);

  function setAll(action: SessionGapAction) {
    setChoices(
      Object.fromEntries(missing.map((m) => [m.studentId, action])),
    );
  }

  function setOne(id: string, action: SessionGapAction) {
    setChoices((prev) => ({ ...prev, [id]: action }));
  }

  function apply() {
    setBusy(true);
    try {
      const result = applySessionGapActions(sis, masters, {
        targetSession,
        choices,
      });
      onApplied(
        result.state,
        [
          result.inactivated
            ? `Marked ${result.inactivated} inactive in ${priorSession}`
            : "",
          result.promoted
            ? `Promoted ${result.promoted} into ${targetSession}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ") || "No gap actions applied",
      );
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(32,48,80,0.45)] p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-gap-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white shadow-lg">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3">
          <h2
            id="session-gap-title"
            className="text-sm font-semibold text-[var(--brand-deep)]"
          >
            Not in {targetSession} upload — {missing.length} from{" "}
            {priorSession}
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
            These students were active in {priorSession} but missing from the
            file you just imported. Choose{" "}
            <strong className="font-medium text-[var(--brand-deep)]">
              Inactive
            </strong>{" "}
            (left / TC / not continuing) or{" "}
            <strong className="font-medium text-[var(--brand-deep)]">
              Promote
            </strong>{" "}
            into {targetSession}, or leave unchanged.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-[rgba(32,48,80,0.06)] px-4 py-2">
          <button
            type="button"
            className="rounded-md border border-[rgba(32,48,80,0.15)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
            onClick={() => setAll("inactive")}
          >
            All inactive
          </button>
          <button
            type="button"
            className="rounded-md border border-[rgba(32,48,80,0.15)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
            onClick={() => setAll("promote")}
          >
            All promote
          </button>
          <button
            type="button"
            className="rounded-md border border-[rgba(32,48,80,0.15)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)]"
            onClick={() => setAll("leave")}
          >
            Clear choices
          </button>
          <span className="self-center text-[11px] text-[var(--muted)]">
            {counts.inactive} inactive · {counts.promote} promote ·{" "}
            {counts.leave} leave
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-2 sm:px-4">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-2 py-2 font-semibold">Student</th>
                <th className="px-2 py-2 font-semibold">Class</th>
                <th className="px-2 py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {missing.map((row) => {
                const action = choices[row.studentId] ?? "leave";
                return (
                  <tr
                    key={row.studentId}
                    className="border-t border-[rgba(32,48,80,0.06)]"
                  >
                    <td className="px-2 py-2 align-top">
                      <div className="font-medium text-[var(--brand-deep)]">
                        {row.fullName}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {row.admissionNo}
                        {row.rollNo ? ` · Roll ${row.rollNo}` : ""}
                      </div>
                    </td>
                    <td className="px-2 py-2 align-top text-[var(--muted)]">
                      {classLabel(row.classId, row.sectionId, masters)}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <div className="flex flex-wrap gap-1">
                        {(
                          [
                            ["leave", "Leave"],
                            ["inactive", "Inactive"],
                            ["promote", "Promote"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setOne(row.studentId, value)}
                            className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                              action === value
                                ? value === "inactive"
                                  ? "bg-red-800 text-white"
                                  : value === "promote"
                                    ? "bg-[var(--brand-deep)] text-white"
                                    : "bg-[rgba(32,48,80,0.12)] text-[var(--brand-deep)]"
                                : "border border-[rgba(32,48,80,0.12)] text-[var(--muted)]"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[rgba(32,48,80,0.08)] px-4 py-3">
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-2 text-xs font-semibold text-[var(--muted)]"
            onClick={onClose}
            disabled={busy}
          >
            Skip for now
          </button>
          <button
            type="button"
            className="btn-accent rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-40"
            disabled={busy || (counts.inactive === 0 && counts.promote === 0)}
            onClick={apply}
          >
            {busy ? "Saving…" : "Apply choices"}
          </button>
        </div>
      </div>
    </div>
  );
}
