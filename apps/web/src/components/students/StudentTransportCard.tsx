"use client";

/**
 * Which bus this child takes, and whether they have been taking it.
 *
 * The transport desk answers "who is on route 3"; the profile has to answer
 * the opposite question, which is the one the office is asked when a parent
 * rings about a missed pickup or when a transfer certificate closes a seat.
 *
 * Renders nothing for a child with no seat and no bus history — most of the
 * school walks in, and an empty transport card on every profile is furniture.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bus, OctagonAlert, ShieldAlert } from "lucide-react";
import { formatInr } from "@/lib/masters";
import { loadSis, normalizeStudent, type SisStudent } from "@/lib/sis";
import { loadTransport, type TransportState } from "@/lib/transport";
import {
  studentTransportRecord,
  transportRecordIsEmpty,
} from "@/lib/studentTransport";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; student: SisStudent; transport: TransportState }
  | { kind: "missing" }
  | { kind: "error"; message: string };

const EVENT_PREVIEW = 8;

export function StudentTransportCard({ studentId }: { studentId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { ensureSisHydrated } = await import("@/lib/sisPersistence");
        const { ensureTransportHydrated } = await import(
          "@/lib/transportPersistence"
        );
        const { withHydrationSlot } = await import("@/lib/deskHydrateGuard");
        await Promise.all([
          withHydrationSlot(() => ensureSisHydrated()),
          withHydrationSlot(() => ensureTransportHydrated()),
        ]);
        if (!alive) return;
        const raw = loadSis().students.find((s) => s.id === studentId);
        if (!raw) {
          setLoad({ kind: "missing" });
          return;
        }
        setLoad({
          kind: "ready",
          student: normalizeStudent(raw),
          transport: loadTransport(),
        });
      } catch (e) {
        if (!alive) return;
        setLoad({
          kind: "error",
          message: e instanceof Error ? e.message : "Could not read transport",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [studentId]);

  const record = useMemo(() => {
    if (load.kind !== "ready") return null;
    return studentTransportRecord(load.transport, load.student);
  }, [load]);

  // Nothing to show, and nothing worth saying: no seat, no history.
  if (load.kind === "missing") return null;
  if (load.kind === "loading") return null;
  if (record && transportRecordIsEmpty(record)) return null;

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
        <Bus className="size-4 text-[var(--brand-deep)]" aria-hidden />
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          School transport
        </h2>
        <Link
          href="/transport"
          className="ml-auto rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-bold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
        >
          Transport desk
        </Link>
      </div>

      {load.kind === "error" ? (
        <p className="px-3 py-3 text-xs font-semibold text-[var(--danger)]">
          Transport could not be read — {load.message}. Check the Transport
          desk before telling a parent anything about the bus.
        </p>
      ) : null}

      {record?.seat ? (
        <>
          {record.seat.suspended ? (
            <p className="flex items-center gap-1.5 border-b border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-1.5 text-[11px] font-bold text-[var(--danger)]">
              <OctagonAlert className="size-3.5" aria-hidden />
              Boarding suspended — this child is still on the route list but
              must NOT be let on the bus.
            </p>
          ) : null}
          {!record.seat.current ? (
            <p className="border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-1.5 text-[11px] font-semibold text-[var(--muted)]">
              Seat closed
              {record.seat.assignment.effectiveTo
                ? ` on ${record.seat.assignment.effectiveTo}`
                : ""}{" "}
              — shown because the child did use the bus this session.
            </p>
          ) : null}

          <div className="grid grid-cols-2 divide-x divide-[var(--border)] border-b border-[var(--border)] sm:grid-cols-4">
            <Stat
              label="Route"
              value={record.seat.routeCode || record.seat.routeName}
              hint={record.seat.routeName}
              strong
            />
            <Stat label="Stop" value={record.seat.stopName} />
            <Stat
              label="Service"
              value={record.seat.serviceLabel}
              hint={record.seat.busNo || undefined}
            />
            <Stat
              label="Monthly fee"
              value={
                record.seat.monthlyFeePaise > 0
                  ? formatInr(record.seat.monthlyFeePaise)
                  : "not priced"
              }
              hint={
                record.seat.monthlyFeePaise > 0
                  ? record.seat.assignment.monthlyFeePaise > 0
                    ? "override on this seat"
                    : "stop price"
                  : "nobody has priced this stop — not free"
              }
            />
          </div>
        </>
      ) : null}

      {record && record.marked > 0 ? (
        <>
          {record.unauthorized > 0 ? (
            <p className="flex items-center gap-1.5 border-b border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-1.5 text-[11px] font-bold text-[var(--danger)]">
              <ShieldAlert className="size-3.5" aria-hidden />
              {record.unauthorized} unauthorised boarding
              {record.unauthorized === 1 ? "" : "s"} on record — a child on a
              bus that was not theirs.
            </p>
          ) : null}
          <div className="grid grid-cols-3 divide-x divide-[var(--border)] border-b border-[var(--border)]">
            <Stat
              label="Boarded"
              value={
                record.boardedRate === null ? "—" : `${record.boardedRate}%`
              }
              hint={`${record.boarded} of ${record.marked} marked trips`}
            />
            <Stat label="Marked absent" value={String(record.absent)} />
            <Stat
              label="Last on the bus"
              value={record.lastSeenOnBus || "—"}
            />
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {record.events.slice(0, EVENT_PREVIEW).map((e) => (
              <li
                key={`${e.date}-${e.trip}`}
                className="flex flex-wrap items-center gap-x-2 px-3 py-1.5 text-[11px]"
              >
                <span className="tabular-nums text-[var(--muted)]">
                  {e.date}
                </span>
                <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted)]">
                  {e.trip}
                </span>
                {e.note ? (
                  <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--muted)]">
                    {e.note}
                  </span>
                ) : null}
                <span
                  className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    e.status === "boarded"
                      ? "bg-[var(--success-soft,rgba(22,132,80,0.16))] text-[var(--success,#16794f)]"
                      : e.status === "absent"
                        ? "bg-[rgba(197,160,40,0.22)] text-[#7a5c00]"
                        : "bg-[var(--danger-soft)] text-[var(--danger)]"
                  }`}
                >
                  {e.status === "unauthorized" ? "unauthorised" : e.status}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-[var(--border)] px-3 py-1 text-[10px] text-[var(--muted)]">
            Only trips the attendant marked are counted. A day with no entry is
            a register nobody filled, not a child who missed the bus.
          </p>
        </>
      ) : null}

      {record?.seat && record.marked === 0 ? (
        <p className="px-3 py-2 text-[11px] text-[var(--muted)]">
          No boarding marked on this seat yet.
        </p>
      ) : null}

      {record && record.past.length > 0 ? (
        <p className="border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--muted)]">
          Earlier this session:{" "}
          {record.past
            .map(
              (s) =>
                `${s.routeCode || s.routeName} · ${s.stopName}${
                  s.assignment.effectiveTo
                    ? ` (to ${s.assignment.effectiveTo})`
                    : ""
                }`,
            )
            .join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p
        className={`text-[var(--brand-deep)] ${strong ? "text-sm font-extrabold" : "text-[12px] font-bold"}`}
      >
        {value}
      </p>
      {hint ? <p className="text-[10px] text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}
