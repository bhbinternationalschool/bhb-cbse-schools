"use client";

// ratchet-allow: grids_without_row_menu — read-only monthly reports; the rows have no per-row action, Export data is the action.

import { useCallback, useEffect, useState } from "react";
import { ExportMenu } from "@/components/ui/erp-grid";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { monthCell, type BoardingMonthRow, type VehicleMonthRow } from "@/lib/transportBoardingLog";
import { registerGet, regBtnOutline, regField, rupees } from "@/lib/transportRegisterClient";

type BoardingMonth = {
  month: string;
  dates: string[];
  fleetWide: boolean;
  routes: { id: string; name: string }[];
  rows: BoardingMonthRow[];
};

type VehicleMonth = { month: string; fleetWide: boolean; rows: VehicleMonthRow[] };

/**
 * The two monthly reports the old ERP had: boarding attendance per child
 * (B = boarded, D = dropped, N = not boarded, – = not marked; morning/afternoon)
 * and vehicle km & fuel with ₹/km.
 */
export function BusRegisterReports({ initialMonth }: { initialMonth: string }) {
  const [kind, setKind] = useState<"boarding" | "vehicles">("boarding");
  const [month, setMonth] = useState(initialMonth);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ModuleTabs
          items={[
            { id: "boarding", label: "Boarding by child", tone: "sky" },
            { id: "vehicles", label: "Vehicle km & fuel", tone: "amber" },
          ]}
          value={kind}
          onChange={(id) => setKind(id as "boarding" | "vehicles")}
          aria-label="Report"
          size="md"
        />
        <input
          type="month"
          aria-label="Month"
          className={regField}
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </div>
      {kind === "boarding" ? <BoardingMonthReport month={month} /> : <VehicleMonthReport month={month} />}
    </section>
  );
}

function BoardingMonthReport({ month }: { month: string }) {
  const [routeId, setRouteId] = useState("");
  const [allRoutes, setAllRoutes] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<BoardingMonth | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setError("");
    setData(null);
    try {
      const q = new URLSearchParams({ month });
      if (routeId) q.set("routeId", routeId);
      const d = await registerGet<BoardingMonth>(`/api/v1/transport/register/month?${q}`);
      setData(d);
      if (!routeId) setAllRoutes(d.routes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the report");
    }
  }, [month, routeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const day = (d: string) => d.slice(8);
  const columns = [
    { key: "fullName", header: "Child", width: 1.6 },
    { key: "className", header: "Class", width: 0.6 },
    { key: "routeName", header: "Route", width: 0.9 },
    { key: "amRidden", header: "Mornings", width: 0.6, align: "right" as const },
    { key: "pmRidden", header: "Afternoons", width: 0.6, align: "right" as const },
    { key: "notBoarded", header: "Not boarded", width: 0.6, align: "right" as const },
    { key: "daysRidden", header: "Days ridden", width: 0.6, align: "right" as const },
    ...(data?.dates ?? []).map((d) => ({ key: d, header: day(d), width: 0.35 })),
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Route" className={regField} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
          <option value="">All my routes</option>
          {allRoutes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <button type="button" className={regBtnOutline} onClick={() => void load()}>
          Reload
        </button>
        {data ? (
          <ExportMenu
            className="ml-auto"
            title="Transport attendance"
            subtitle={`Month ${month} · B boarded, D dropped, N not boarded, – not marked (morning/afternoon)`}
            columns={columns}
            fileBaseName={`transport-attendance-${month}`}
            onMessage={setMsg}
            rows={() =>
              data.rows.map((r) => ({
                fullName: r.fullName || r.studentId,
                className: r.className,
                routeName: r.routeName,
                amRidden: r.amRidden,
                pmRidden: r.pmRidden,
                notBoarded: r.notBoarded,
                daysRidden: r.daysRidden,
                ...Object.fromEntries(data.dates.map((d) => [d, monthCell(r.days[d])])),
              }))
            }
          />
        ) : null}
      </div>
      {msg ? <p className="text-xs text-[var(--muted)]">{msg}</p> : null}
      {error ? <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">Could not load: {error}</p> : null}
      {!data && !error ? <p className="text-sm text-[var(--muted)]">Loading…</p> : null}
      {data ? (
        <p className="text-xs text-[var(--muted)]">
          Each day shows morning/afternoon: B boarded · D dropped · N not boarded · – not marked. A blank day means
          nothing was marked — not that the child was absent.
        </p>
      ) : null}
      {data && data.rows.length === 0 ? <p className="text-sm text-[var(--muted)]">No riders in this month.</p> : null}
      {data && data.rows.length > 0 ? (
        <ErpTableShell density="compact" className="overflow-x-auto">
          <ErpTable minWidth="min-w-[1100px]">
            <ErpTableHead>
              <tr>
                <th className="sticky left-0 bg-[var(--surface-sunken)] px-2 py-2">Child</th>
                <th className="px-2 py-2">Class</th>
                <th className="px-2 py-2">Route</th>
                <th className="px-2 py-2 text-right">AM</th>
                <th className="px-2 py-2 text-right">PM</th>
                <th className="px-2 py-2 text-right">Not</th>
                <th className="px-2 py-2 text-right">Days</th>
                {data.dates.map((d) => (
                  <th key={d} className="px-1 py-2 text-center">
                    {day(d)}
                  </th>
                ))}
              </tr>
            </ErpTableHead>
            <ErpTableBody zebra>
              {data.rows.map((r) => (
                <tr key={r.studentId}>
                  <td className="sticky left-0 bg-[var(--card)] px-2 py-1.5 font-semibold">{r.fullName || r.studentId}</td>
                  <td className="px-2 py-1.5">{r.className}</td>
                  <td className="px-2 py-1.5">{r.routeName}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.amRidden}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.pmRidden}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.notBoarded}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.daysRidden}</td>
                  {data.dates.map((d) => (
                    <td key={d} className="px-1 py-1.5 text-center text-[11px] tabular-nums">
                      {monthCell(r.days[d])}
                    </td>
                  ))}
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      ) : null}
    </div>
  );
}

function VehicleMonthReport({ month }: { month: string }) {
  const [data, setData] = useState<VehicleMonth | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setError("");
    setData(null);
    try {
      setData(await registerGet<VehicleMonth>(`/api/v1/transport/logbook/month?month=${month}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the report");
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const fuel = (r: VehicleMonthRow) =>
    [r.litres ? `${r.litres} L` : "", r.kg ? `${r.kg} kg` : ""].filter(Boolean).join(" + ") || "—";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={regBtnOutline} onClick={() => void load()}>
          Reload
        </button>
        {data ? (
          <ExportMenu
            className="ml-auto"
            title="Vehicle km & fuel"
            subtitle={`Month ${month}`}
            fileBaseName={`vehicle-km-fuel-${month}`}
            onMessage={setMsg}
            columns={[
              { key: "name", header: "Vehicle", width: 1.4 },
              { key: "registrationNo", header: "Registration", width: 1 },
              { key: "daysLogged", header: "Days logged", width: 0.6, align: "right" },
              { key: "km", header: "Km", width: 0.6, align: "right" },
              { key: "gpsDays", header: "GPS days", width: 0.6, align: "right" },
              { key: "typedDays", header: "Typed days", width: 0.6, align: "right" },
              { key: "problemDays", header: "Incomplete days", width: 0.7, align: "right" },
              { key: "fuel", header: "Fuel", width: 0.8 },
              { key: "amount", header: "Fuel ₹", width: 0.7, align: "right" },
              { key: "perKm", header: "₹/km", width: 0.6, align: "right" },
            ]}
            rows={() =>
              data.rows.map((r) => ({
                name: r.name,
                registrationNo: r.registrationNo,
                daysLogged: r.daysLogged,
                km: r.km,
                gpsDays: r.gpsDays,
                typedDays: r.typedDays,
                problemDays: r.problemDays,
                fuel: fuel(r),
                amount: r.amountPaise / 100,
                perKm: r.rupeesPerKm ?? "",
              }))
            }
          />
        ) : null}
      </div>
      {msg ? <p className="text-xs text-[var(--muted)]">{msg}</p> : null}
      {error ? <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">Could not load: {error}</p> : null}
      {!data && !error ? <p className="text-sm text-[var(--muted)]">Loading…</p> : null}
      {data ? (
        <p className="text-xs text-[var(--muted)]">
          Km counts only days with both readings and the end above the start; other logged days are shown as incomplete.
          ₹/km is fuel money ÷ counted km, blank when no km counted.
        </p>
      ) : null}
      {data && data.rows.length > 0 ? (
        <ErpTableShell density="compact" className="overflow-x-auto">
          <ErpTable minWidth="min-w-[860px]">
            <ErpTableHead>
              <tr>
                <th className="px-2 py-2">Vehicle</th>
                <th className="px-2 py-2 text-right">Days logged</th>
                <th className="px-2 py-2 text-right">Km</th>
                <th className="px-2 py-2 text-right">GPS / typed days</th>
                <th className="px-2 py-2 text-right">Incomplete</th>
                <th className="px-2 py-2">Fuel</th>
                <th className="px-2 py-2 text-right">Fuel ₹</th>
                <th className="px-2 py-2 text-right">₹/km</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody zebra>
              {data.rows.map((r) => (
                <tr key={r.vehicleId}>
                  <td className="px-2 py-1.5">
                    <span className="font-semibold">{r.name}</span>
                    <span className="block text-[11px] text-[var(--muted)]">{r.registrationNo}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.daysLogged}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.km}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.gpsDays} / {r.typedDays}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.problemDays || ""}</td>
                  <td className="px-2 py-1.5">{fuel(r)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{rupees(r.amountPaise)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.rupeesPerKm == null ? "—" : `₹${r.rupeesPerKm}`}</td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      ) : null}
    </div>
  );
}
