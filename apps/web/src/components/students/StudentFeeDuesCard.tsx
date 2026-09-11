"use client";

/**
 * What this child still owes, on the child's own page.
 *
 * The profile answered every question about a student except the one the
 * office is asked at the gate: "kitna baaki hai?". Finding out meant leaving
 * the record, opening Fee Take, and searching the same child again — so the
 * clerk either did not bother or quoted a figure from memory.
 *
 * Only OPEN dues are listed. A paid line is history and belongs in the
 * ledger; this card is the amount somebody has to collect. Overdue is split
 * out from not-yet-due, because "₹18,400 outstanding" and "₹18,400 overdue"
 * are two very different conversations with a parent.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IndianRupee, ReceiptText } from "lucide-react";
import { istDateString } from "@bhb/time";
import {
  computeStudentDues,
  formatInr,
  loadFees,
  openFeeDues,
  type FeeDueLine,
  type FeesState,
} from "@/lib/fees";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, normalizeStudent, type SisStudent } from "@/lib/sis";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; student: SisStudent; fees: FeesState; masters: MastersState }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export function StudentFeeDuesCard({ studentId }: { studentId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { ensureSisHydrated } = await import("@/lib/sisPersistence");
        const { ensureFeesHydrated } = await import("@/lib/feesPersistence");
        const { hydrateFeesStore } = await import("@/lib/fees");
        const { withHydrationSlot } = await import("@/lib/deskHydrateGuard");
        await Promise.all([
          withHydrationSlot(() => ensureSisHydrated()),
          withHydrationSlot(() => ensureFeesHydrated()),
        ]);
        await hydrateFeesStore();
        if (!alive) return;
        const raw = loadSis().students.find((s) => s.id === studentId);
        if (!raw) {
          setLoad({ kind: "missing" });
          return;
        }
        setLoad({
          kind: "ready",
          student: normalizeStudent(raw),
          fees: loadFees(),
          masters: loadMasters(),
        });
      } catch (e) {
        if (!alive) return;
        // A failed read is NOT "nothing owed". Say the figure is unknown
        // rather than print a zero somebody might quote to a parent.
        setLoad({
          kind: "error",
          message: e instanceof Error ? e.message : "Could not read fee dues",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [studentId]);

  const summary = useMemo(() => {
    if (load.kind !== "ready") return null;
    const today = istDateString();
    const open = openFeeDues(
      computeStudentDues(load.student, load.masters, load.fees, {
        includePaid: false,
        /*
          Up to the running month only.

          With the default (`includeFuture: true`) this card would add up
          every month the session will EVER bill — the same mistake that
          once put ₹1,38,525 on a payment QR for a ₹5,000 receipt. A clerk
          reads a figure off a profile and says it out loud to a parent, so
          it has to be what the family owes today, not what they will owe
          by March.
        */
        includeFuture: false,
        // A student who has left can still owe money, and this card is
        // exactly where that is noticed.
        includeInactive: true,
      }),
    );
    const overdue: FeeDueLine[] = [];
    const upcoming: FeeDueLine[] = [];
    for (const l of open) {
      if (l.dueOn && l.dueOn <= today) overdue.push(l);
      else upcoming.push(l);
    }
    const sum = (rows: FeeDueLine[]) =>
      rows.reduce((s, r) => s + r.balancePaise, 0);
    const byDue = (a: FeeDueLine, b: FeeDueLine) =>
      (a.dueOn || "9999-12-31").localeCompare(b.dueOn || "9999-12-31") ||
      a.dueKey.localeCompare(b.dueKey);
    return {
      rows: [...overdue.sort(byDue), ...upcoming.sort(byDue)],
      overdueKeys: new Set(overdue.map((l) => l.dueKey)),
      overduePaise: sum(overdue),
      upcomingPaise: sum(upcoming),
      totalPaise: sum(open),
      oldest: overdue.sort(byDue)[0]?.dueOn || "",
    };
  }, [load]);

  if (load.kind === "missing") return null;

  const collectHref =
    load.kind === "ready"
      ? `/fees?q=${encodeURIComponent(load.student.admissionNo || load.student.fullName)}`
      : "/fees";

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
        <IndianRupee className="size-4 text-[var(--brand-deep)]" aria-hidden />
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Pending fee dues
        </h2>
        <Link
          href={collectHref}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-bold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
        >
          <ReceiptText className="size-3.5" aria-hidden />
          Collect fee
        </Link>
      </div>

      {load.kind === "loading" ? (
        <p className="px-3 py-3 text-xs text-[var(--muted)]">Reading dues…</p>
      ) : null}

      {load.kind === "error" ? (
        <p className="px-3 py-3 text-xs font-semibold text-[var(--danger)]">
          Dues could not be read — {load.message}. This is not a zero balance;
          check on the fee counter.
        </p>
      ) : null}

      {summary ? (
        summary.totalPaise === 0 ? (
          <p className="px-3 py-3 text-xs font-bold text-[var(--success,#16794f)]">
            No pending dues up to this month.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 divide-x divide-[var(--border)] border-b border-[var(--border)]">
              <Stat
                label="Outstanding"
                value={formatInr(summary.totalPaise)}
                strong
              />
              <Stat
                label="Overdue"
                value={formatInr(summary.overduePaise)}
                tone={summary.overduePaise > 0 ? "danger" : undefined}
                hint={
                  summary.oldest ? `oldest due ${summary.oldest}` : undefined
                }
              />
              <Stat
                label="Due later this month"
                value={formatInr(summary.upcomingPaise)}
              />
            </div>
            <p className="border-b border-[var(--border)] px-3 py-1 text-[10px] text-[var(--muted)]">
              Billed up to this month. Later months of the session are not
              counted here — the fee counter shows the full year.
            </p>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-[var(--surface-sunken)] text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-1.5 font-bold">Head</th>
                    <th className="px-3 py-1.5 font-bold">Due on</th>
                    <th className="px-3 py-1.5 text-right font-bold">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((l) => {
                    const late = summary.overdueKeys.has(l.dueKey);
                    return (
                      <tr
                        key={l.dueKey}
                        className="border-t border-[var(--border)]"
                      >
                        <td className="px-3 py-1.5 text-[var(--brand-deep)]">
                          {l.label || l.feeHeadName}
                          {late ? (
                            <span className="ml-1.5 rounded bg-[var(--danger-soft)] px-1 py-0.5 text-[9px] font-bold uppercase text-[var(--danger)]">
                              overdue
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 tabular-nums text-[var(--muted)]">
                          {l.dueOn || "—"}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right font-bold tabular-nums ${
                            late ? "text-[var(--danger)]" : ""
                          }`}
                        >
                          {formatInr(l.balancePaise)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger";
  strong?: boolean;
}) {
  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p
        className={`tabular-nums ${strong ? "text-base font-extrabold" : "text-sm font-bold"} ${
          tone === "danger" ? "text-[var(--danger)]" : "text-[var(--brand-deep)]"
        }`}
      >
        {value}
      </p>
      {hint ? (
        <p className="text-[10px] text-[var(--muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
