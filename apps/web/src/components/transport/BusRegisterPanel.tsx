"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DraftDateInput } from "@/components/ui/draft-inputs";
import { Bus } from "lucide-react";
import { BusRegisterReports } from "@/components/transport/BusRegisterReports";
import { BusRunMarker } from "@/components/transport/BusRunMarker";
import { VehicleLogBook } from "@/components/transport/VehicleLogBook";
import { RowActionMenu } from "@/components/ui/erp-grid";
import { ErpMetricCard, ErpMetricGrid, ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import {
  EXCEPTION_LABEL,
  istDate,
  type BoardingException,
  type RegisterTrip,
  type RunCounts,
} from "@/lib/transportBoardingLog";
import { registerGet, regBtn, regBtnOutline, regField } from "@/lib/transportRegisterClient";

type RunRow = {
  routeId: string;
  trip: RegisterTrip;
  shiftId: string;
  name: string;
  departTime: string;
  routeName: string;
  busNo: string;
  vehicleId: string;
  vehicleName: string;
  counts: RunCounts;
  unresolved: number;
};

type RunsView = {
  date: string;
  today: string;
  fleetWide: boolean;
  unlinked: boolean;
  classesKnown: boolean;
  runs: RunRow[];
};

type ExceptionsView = {
  date: string;
  classRegister: "ok" | "unavailable";
  sectionsWithoutRegister: number | null;
  riderSections: number;
  unchecked: number;
  exceptions: (BoardingException & { routeName: string })[];
};

type SubTab = "runs" | "logbook" | "reports";

/**
 * Transport → Bus register. Built to be used on a phone (staff use the web
 * ERP on phones): today's runs, the tap-per-child list for a run, the
 * driver's log book, and the monthly reports. Every figure is server truth —
 * nothing here is kept in the browser.
 */
export function BusRegisterPanel() {
  const today = istDate();
  const [sub, setSub] = useState<SubTab>("runs");
  const [date, setDate] = useState(today);
  const [open, setOpen] = useState<{ routeId: string; trip: RegisterTrip; shiftId: string } | null>(null);

  return (
    <section className="mt-4 space-y-3">
      <ModuleTabs
        items={[
          { id: "runs", label: "Runs & marking", tone: "sky" },
          { id: "logbook", label: "Log book", tone: "amber" },
          { id: "reports", label: "Reports", tone: "navy" },
        ]}
        value={sub}
        onChange={(id) => {
          setSub(id as SubTab);
          setOpen(null);
        }}
        aria-label="Bus register"
        size="md"
      />
      {sub === "runs" ? (
        open ? (
          <BusRunMarker
            key={`${date}:${open.routeId}:${open.trip}`}
            date={date}
            routeId={open.routeId}
            trip={open.trip}
            shiftId={open.shiftId}
            onBack={() => setOpen(null)}
          />
        ) : (
          <RunsToday date={date} onDate={setDate} onOpen={setOpen} />
        )
      ) : null}
      {sub === "logbook" ? <VehicleLogBook initialDate={today} /> : null}
      {sub === "reports" ? <BusRegisterReports initialMonth={today.slice(0, 7)} /> : null}
    </section>
  );
}

/**
 * /transport/register — the same register on its own page, without the
 * transport desk behind it, so it opens fast on a driver's phone.
 */
export function BusRegisterWorkspace() {
  return (
    <ErpWorkspaceShell
      title="Bus register"
      subtitle="Mark each child on and off the bus, keep the vehicle log book, and see the monthly reports."
      icon={<Bus className="size-6" aria-hidden />}
      actions={
        <Link href="/transport" className={regBtnOutline}>
          Transport
        </Link>
      }
    >
      <BusRegisterPanel />
    </ErpWorkspaceShell>
  );
}

function RunsToday({
  date,
  onDate,
  onOpen,
}: {
  date: string;
  onDate: (d: string) => void;
  onOpen: (r: { routeId: string; trip: RegisterTrip; shiftId: string }) => void;
}) {
  const [view, setView] = useState<RunsView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setView(await registerGet<RunsView>(`/api/v1/transport/register/runs?date=${date}`));
    } catch (e) {
      setView(null);
      setError(e instanceof Error ? e.message : "Could not load the runs");
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = (view?.runs ?? []).reduce(
    (t, r) => ({
      riders: t.riders + r.counts.riders,
      rode: t.rode + r.counts.boarded + r.counts.dropped,
      not: t.not + r.counts.notBoarded,
      unmarked: t.unmarked + r.counts.unmarked,
    }),
    { riders: 0, rode: 0, not: 0, unmarked: 0 },
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-semibold text-[var(--brand-deep)]" htmlFor="register-date">
          Day
        </label>
        {/* Each day loads from the server: only a whole date does, and an
            emptied box keeps the day shown (never a snap mid-typing). */}
        <DraftDateInput
          id="register-date"
          className={regField}
          value={date}
          max={view?.today}
          allowEmpty={false}
          onCommit={onDate}
        />
        <button type="button" className={regBtnOutline} onClick={() => void load()}>
          Reload
        </button>
      </div>

      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          Could not load the runs: {error}
        </p>
      ) : null}
      {!view && !error ? <p className="text-sm text-[var(--muted)]">Loading…</p> : null}
      {view?.unlinked ? (
        <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
          You are not linked to a bus yet. Ask the office to add you under Staff → Duties (vehicle), or as the
          vehicle&apos;s driver in Transport → Fleet.
        </p>
      ) : null}

      {view && view.fleetWide && view.runs.length > 0 ? (
        <ErpMetricGrid>
          <ErpMetricCard title="Rider-trips today" value={totals.riders} tone="navy" hint="Every child on every run" />
          <ErpMetricCard title="Rode" value={totals.rode} tone="green" hint="Boarded or dropped" />
          <ErpMetricCard title="Not boarded" value={totals.not} tone="rose" />
          <ErpMetricCard title="Not marked yet" value={totals.unmarked} tone="amber" hint="Not absent — nobody has tapped" />
        </ErpMetricGrid>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {view?.runs.map((r) => {
          const done = r.counts.riders - r.counts.unmarked;
          return (
            <div
              key={`${r.routeId}:${r.trip}:${r.shiftId}`}
              className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-[var(--shadow-1)]"
            >
              <div className="flex items-baseline gap-2">
                <p className="min-w-0 flex-1 truncate text-base font-bold text-[var(--brand-deep)]">{r.routeName}</p>
                <span className="rounded-md bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-black uppercase text-[var(--muted)]">
                  {r.trip === "AM" ? "Pick-up" : "Drop"}
                </span>
              </div>
              <p className="text-xs text-[var(--muted)]">
                {r.name}
                {r.departTime ? ` · ${r.departTime}` : ""}
                {r.vehicleName ? ` · ${r.vehicleName}` : ""}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]" aria-hidden>
                <div
                  className="h-full bg-[var(--success)]"
                  style={{ width: r.counts.riders ? `${Math.round((done / r.counts.riders) * 100)}%` : "0%" }}
                />
              </div>
              <p className="mt-1 text-xs">
                <span className="font-semibold text-[var(--success)]">{r.counts.boarded + r.counts.dropped} rode</span>
                {" · "}
                <span className="font-semibold text-[var(--danger)]">{r.counts.notBoarded} not</span>
                {" · "}
                <span className="text-[var(--muted)]">
                  {r.counts.unmarked} not marked of {r.counts.riders}
                </span>
              </p>
              {r.unresolved ? (
                <p className="mt-1 text-[11px] text-[var(--warning)]">
                  {r.unresolved} child{r.unresolved === 1 ? "" : "ren"} whose run is not worked out — listed on every run.
                </p>
              ) : null}
              <button
                type="button"
                className={`${regBtn} mt-2 w-full`}
                onClick={() => onOpen({ routeId: r.routeId, trip: r.trip, shiftId: r.shiftId })}
              >
                Open list
              </button>
            </div>
          );
        })}
      </div>
      {view && !view.unlinked && view.runs.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No runs on this day.</p>
      ) : null}

      {view?.fleetWide ? <ExceptionList date={date} onOpen={onOpen} /> : null}
    </div>
  );
}

function ExceptionList({
  date,
  onOpen,
}: {
  date: string;
  onOpen: (r: { routeId: string; trip: RegisterTrip; shiftId: string }) => void;
}) {
  const [view, setView] = useState<ExceptionsView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setView(await registerGet<ExceptionsView>(`/api/v1/transport/register/exceptions?date=${date}`));
    } catch (e) {
      setView(null);
      setError(e instanceof Error ? e.message : "Could not load the exceptions");
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  type Row = ExceptionsView["exceptions"][number];
  const statusWord = (s: Row["amStatus"]) =>
    s === "boarded" ? "Boarded" : s === "dropped" ? "Dropped" : s === "not_boarded" ? "Not boarded" : "Not marked";
  const classWord = (m: Row["classMark"]) =>
    m === "P" ? "Present" : m === "A" ? "Absent" : m === "L" ? "Late" : m === "HD" ? "Half day" : m === "LE" ? "Leave" : "No mark";

  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Bus register vs class register</h3>
        <button type="button" className="text-xs font-semibold text-[var(--info)] underline" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">Could not load: {error}</p>
      ) : null}
      {view?.classRegister === "unavailable" ? (
        <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
          The class register could not be read, so only the bus-only check (came by bus, not on the drop) is shown.
        </p>
      ) : null}
      {view && view.sectionsWithoutRegister ? (
        <p className="text-xs text-[var(--muted)]">
          Class attendance not taken today for {view.sectionsWithoutRegister} of {view.riderSections} sections with
          riders — those children cannot be checked
          {view.unchecked ? ` (${view.unchecked} marked on the bus, unchecked)` : ""}. Nobody is called absent for it.
        </p>
      ) : null}
      {view && view.exceptions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No disagreements found among the marks made so far.</p>
      ) : null}
      {view && view.exceptions.length > 0 ? (
        <ErpTableShell density="compact" className="overflow-x-auto" exportAs={`bus-register-exceptions-${date}`}>
          <ErpTable minWidth="min-w-[760px]">
            <ErpTableHead>
              <tr>
                <th className="px-2 py-2">Child</th>
                <th className="px-2 py-2">What disagrees</th>
                <th className="px-2 py-2">Route · stop</th>
                <th className="px-2 py-2">Morning bus</th>
                <th className="px-2 py-2">Drop</th>
                <th className="px-2 py-2">Class</th>
                <th className="px-2 py-2" aria-label="Actions" />
              </tr>
            </ErpTableHead>
            <ErpTableBody zebra>
              {view.exceptions.map((e) => (
                <tr key={`${e.kind}:${e.routeId}:${e.studentId}`}>
                  <td className="px-2 py-1.5">
                    <span className="font-semibold">{e.fullName || e.studentId}</span>
                    <span className="block text-[11px] text-[var(--muted)]">{e.className}</span>
                  </td>
                  <td className={`px-2 py-1.5 ${e.kind === "boarded_absent" ? "font-semibold text-[var(--danger)]" : ""}`}>
                    {EXCEPTION_LABEL[e.kind]}
                  </td>
                  <td className="px-2 py-1.5">
                    {e.routeName}
                    {e.stopName ? ` · ${e.stopName}` : ""}
                  </td>
                  <td className="px-2 py-1.5">{statusWord(e.amStatus)}</td>
                  <td className="px-2 py-1.5">{statusWord(e.pmStatus)}</td>
                  <td className="px-2 py-1.5">{classWord(e.classMark)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <RowActionMenu
                      row={e}
                      actions={[
                        { id: "am", label: "Open the morning list", onSelect: (r) => onOpen({ routeId: r.routeId, trip: "AM", shiftId: "" }) },
                        { id: "pm", label: "Open the drop list", onSelect: (r) => onOpen({ routeId: r.routeId, trip: "PM", shiftId: "" }) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      ) : null}
    </div>
  );
}
