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
 *
 * Boarding history is the bus register (v2, server truth) for this month and
 * last month, read from /api/v1/transport/register/month?studentId=. The seat
 * itself still comes from the transport desk.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bus, OctagonAlert } from "lucide-react";
import { formatInr } from "@/lib/masters";
import { loadSis, normalizeStudent, type SisStudent } from "@/lib/sis";
import { loadTransport, type TransportState } from "@/lib/transport";
import {
  studentTransportRecord,
  transportRecordIsEmpty,
  type StudentRegisterDays,
} from "@/lib/studentTransport";
import { istDate, STATUS_LABEL, type BoardingMonthRow } from "@/lib/transportBoardingLog";
import { RegisterCallError, registerGet } from "@/lib/transportRegisterClient";

type RegisterLoad =
  | { kind: "loading" }
  | { kind: "ok"; register: StudentRegisterDays }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1));
  return d.toISOString().slice(0, 7);
}

/** This month and last month of the bus register, for one child. */
async function loadStudentRegister(studentId: string): Promise<StudentRegisterDays> {
  const today = istDate();
  const months = [previousMonth(today.slice(0, 7)), today.slice(0, 7)];
  const reads = await Promise.all(
    months.map((m) =>
      registerGet<{ rows: BoardingMonthRow[] }>(
        `/api/v1/transport/register/month?month=${m}&studentId=${encodeURIComponent(studentId)}`,
      ),
    ),
  );
  const days: StudentRegisterDays["days"] = {};
  for (const read of reads) {
    for (const row of read.rows ?? []) {
      if (row.studentId !== studentId) continue;
      Object.assign(days, row.days);
    }
  }
  return { from: `${months[0]}-01`, to: today, days };
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; student: SisStudent; transport: TransportState }
  | { kind: "missing" }
  | { kind: "error"; message: string };

const EVENT_PREVIEW = 8;

export function StudentTransportCard({ studentId }: { studentId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [reg, setReg] = useState<RegisterLoad>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setReg({ kind: "loading" });
    loadStudentRegister(studentId)
      .then((register) => {
        if (alive) setReg({ kind: "ok", register });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof RegisterCallError && e.status === 403) setReg({ kind: "forbidden" });
        else setReg({ kind: "error", message: e instanceof Error ? e.message : "Could not read the bus register" });
      });
    return () => {
      alive = false;
    };
  }, [studentId]);

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
    return studentTransportRecord(load.transport, load.student, {
      register: reg.kind === "ok" ? reg.register : null,
    });
  }, [load, reg]);

  // Nothing to show, and nothing worth saying: no seat, no history. A
  // register that failed to read is not "no history" — the card stays.
  if (load.kind === "missing") return null;
  if (load.kind === "loading") return null;
  if (record && transportRecordIsEmpty(record) && reg.kind !== "error") return null;

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

      {reg.kind === "loading" && record?.seat ? (
        <p className="px-3 py-2 text-[11px] text-[var(--muted)]">
          Reading the bus register…
        </p>
      ) : null}
      {reg.kind === "forbidden" && record?.seat ? (
        <p className="px-3 py-2 text-[11px] text-[var(--muted)]">
          Boarding history is on the bus register, which needs transport
          access.
        </p>
      ) : null}
      {reg.kind === "error" ? (
        <p className="px-3 py-2 text-[11px] font-semibold text-[var(--danger)]">
          Bus register could not be read — {reg.message}. Boarding is not
          known; check the Bus register before telling a parent anything.
        </p>
      ) : null}

      {record && record.registerRead && record.marked > 0 ? (
        <>
          <div className="grid grid-cols-3 divide-x divide-[var(--border)] border-b border-[var(--border)]">
            <Stat
              label="Rode"
              value={
                record.boardedRate === null ? "—" : `${record.boardedRate}%`
              }
              hint={`${record.boarded} of ${record.marked} marked trips`}
            />
            <Stat label="Not boarded" value={String(record.notBoarded)} />
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
                <span
                  className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    e.status === "not_boarded"
                      ? "bg-[rgba(197,160,40,0.22)] text-[#7a5c00]"
                      : "bg-[var(--success-soft,rgba(22,132,80,0.16))] text-[var(--success,#16794f)]"
                  }`}
                >
                  {STATUS_LABEL[e.status]}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-[var(--border)] px-3 py-1 text-[10px] text-[var(--muted)]">
            Bus register, {record.registerFrom} to {record.registerTo}. Only
            trips the attendant marked are counted — a trip with no mark is a
            register nobody filled, not a child who missed the bus. Unauthorised
            boarding is not recorded by the register.
          </p>
        </>
      ) : null}

      {record?.seat && record.registerRead && record.marked === 0 ? (
        <p className="px-3 py-2 text-[11px] text-[var(--muted)]">
          No boarding marked on the bus register since {record.registerFrom}.
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
