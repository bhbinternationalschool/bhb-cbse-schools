"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bus } from "lucide-react";
import { HoldStatusBanner, PrincipalHoldOverrideDialog } from "@/components/fees/PrincipalHoldOverrideDialog";
import { StudentHitsFilterExport } from "@/components/reports/StudentHitsFilterExport";
import { useDemoSession } from "@/components/shell/SessionContext";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import {
  BoardingPanel,
  CompliancePanel,
  DealersPanel,
  FinancePanel,
  LiveMapPanel,
  ServicePanel,
} from "@/components/transport/TransportFleetPanels";
import { FleetEdgeEventsPanel } from "@/components/transport/FleetEdgeEventsPanel";
import { FleetDashboard } from "@/components/transport/FleetDashboard";
import {
  FleetPanel,
  FuelPanel,
  RoutesPanel,
} from "@/components/transport/TransportOpsPanels";
import { TransportPlannerPanel } from "@/components/transport/TransportPlannerPanel";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpTableShell } from "@/components/ui/erp-roster";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { formatInr, searchFeeStudents, type StudentSearchHit } from "@/lib/fees";
import { checkHold, type HoldCheck } from "@/lib/holds";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { formatRouteCrew, staffAssignedToRoute } from "@/lib/staffResolve";
import {
  assignStudentToRoute,
  computeTransportPeriodDues,
  endTransportAssignment,
  expectedMonthlyFeePaise,
  listActiveRiders,
  listActiveRoutes,
  loadTransport,
  seedTransportIfEmpty,
  upsertFleetVehicle,
  type TransportState,
} from "@/lib/transport";
import {
  TRANSPORT_REPORT_CATEGORIES,
  TRANSPORT_REPORTS,
  runTransportReport,
  type TransportReportFormat,
} from "@/lib/transportReportCatalog";

type TransportTab =
  | "dashboard"
  | "planner"
  | "riders"
  | "routes"
  | "fleet"
  | "fuel"
  | "dealers"
  | "finance"
  | "service"
  | "board"
  | "compliance"
  | "live"
  | "fleetDashboard"
  | "reports";

const TABS: ModuleTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy" },
  { id: "planner", label: "Planner", tone: "teal" },
  { id: "riders", label: "Riders", tone: "navy" },
  { id: "routes", label: "Routes", tone: "teal" },
  { id: "fleet", label: "Fleet", tone: "slate" },
  { id: "fuel", label: "Fuel", tone: "amber" },
  { id: "dealers", label: "Dealers", tone: "violet" },
  { id: "finance", label: "Finance", tone: "green" },
  { id: "service", label: "Service", tone: "coral" },
  { id: "board", label: "Boarding", tone: "sky" },
  { id: "compliance", label: "Compliance", tone: "rose" },
  { id: "live", label: "Live", tone: "teal" },
  { id: "fleetDashboard", label: "Fleet Dashboard", tone: "amber" },
  { id: "reports", label: "Reports", tone: "navy" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function TransportWorkspace() {
  const session = useDemoSession();
  const [tab, setTab] = useState<TransportTab>("dashboard");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: TransportTab[] = [
      "dashboard",
      "planner",
      "riders",
      "routes",
      "fleet",
      "fuel",
      "dealers",
      "finance",
      "service",
      "board",
      "compliance",
      "live",
      "fleetDashboard",
      "reports",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as TransportTab);
  }, []);
  const [state, setState] = useState<TransportState | null>(null);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [hits, setHits] = useState<StudentSearchHit[]>([]);
  const [selected, setSelected] = useState<StudentSearchHit | null>(null);
  const [routeId, setRouteId] = useState("");
  const [stopId, setStopId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso);
  const [feeOverride, setFeeOverride] = useState("");
  const [feeOverrideReason, setFeeOverrideReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [holdCheck, setHoldCheck] = useState<HoldCheck | null>(null);
  const [holdDialog, setHoldDialog] = useState(false);

  function flash(message: string) {
    setNotice(message);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function refreshHolds(studentId?: string) {
    setHoldCheck(studentId ? checkHold(studentId, "HOLD_TRANSPORT") : null);
  }

  function refresh() {
    try {
      const transport = seedTransportIfEmpty();
      setState(transport);
      setMasters(loadMasters());
      setSis(loadSis());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load transport";
      setError(msg);
      // Avoid infinite “Loading transport…” if seed/load throws
      setState((prev) => prev ?? loadTransport());
      try {
        setMasters(loadMasters());
      } catch {
        /* ignore */
      }
      try {
        setSis(loadSis());
      } catch {
        /* ignore */
      }
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const { ensureTransportHydrated } = await import(
        "@/lib/transportPersistence"
      );
      await ensureTransportHydrated();
      refresh();
    })();
  }, []);

  useEffect(() => {
    if (!sis || !masters) return;
    setHits(
      searchFeeStudents(query, sis, masters, undefined, {
        classId,
        sectionId,
      }),
    );
  }, [query, classId, sectionId, sis, masters]);

  useEffect(() => {
    refreshHolds(selected?.student.id);
  }, [selected?.student.id, state]);

  const classOptions = useMemo(
    () => masters?.classes.filter((row) => row.isActive) ?? [],
    [masters],
  );
  const sectionOptions = useMemo(
    () =>
      masters?.sections.filter(
        (row) => row.isActive && row.classId === classId,
      ) ?? [],
    [masters, classId],
  );

  useEffect(() => {
    if (sectionId && !sectionOptions.some((row) => row.id === sectionId)) {
      setSectionId("");
    }
  }, [sectionId, sectionOptions]);

  const routes = useMemo(() => (state ? listActiveRoutes(state) : []), [state]);
  const riders = useMemo(() => (state ? listActiveRiders(state) : []), [state]);
  const selectedRoute = routes.find((route) => route.id === routeId) ?? null;
  const selectedStop =
    selectedRoute?.stops.find((stop) => stop.id === stopId) ?? null;

  useEffect(() => {
    if (!selectedRoute) {
      setStopId("");
    } else if (!selectedRoute.stops.some((stop) => stop.id === stopId)) {
      setStopId(selectedRoute.stops[0]?.id ?? "");
    }
  }, [selectedRoute, stopId]);

  const expectedFeePaise =
    state && selectedRoute
      ? expectedMonthlyFeePaise(
          selectedRoute,
          selectedStop ?? undefined,
          state.feePolicy,
        )
      : 0;
  const overridePaise = feeOverride.trim()
    ? Math.round((Number(feeOverride) || 0) * 100)
    : 0;
  const proposedFeePaise = overridePaise > 0 ? overridePaise : expectedFeePaise;
  const existingDues = useMemo(() => {
    if (!state || !selected) return [];
    return computeTransportPeriodDues(selected.student.id, {
      academicYearCode: selected.student.academicYearCode || DEFAULT_AY,
      asOf: todayIso(),
      includeFuture: true,
      state,
    });
  }, [selected, state]);

  function onAssign() {
    if (!selected) {
      setError("Pick a student first");
      return;
    }
    if (!routeId || !stopId) {
      setError("Select route and stop");
      return;
    }
    const hold = checkHold(selected.student.id, "HOLD_TRANSPORT");
    setHoldCheck(hold);
    if (!hold.allowed) {
      setHoldDialog(true);
      setError(hold.message);
      return;
    }
    if (
      overridePaise > 0 &&
      overridePaise !== expectedFeePaise &&
      !feeOverrideReason.trim()
    ) {
      setError("Enter a reason when overriding the expected monthly fee");
      return;
    }
    const result = assignStudentToRoute({
      studentId: selected.student.id,
      householdId: selected.student.householdId,
      routeId,
      stopId,
      effectiveFrom,
      academicYearCode: selected.student.academicYearCode || DEFAULT_AY,
      monthlyFeePaise: overridePaise > 0 ? overridePaise : undefined,
      feeOverrideReason: feeOverrideReason.trim(),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    flash(
      `Assigned ${selected.student.fullName} to ${selectedRoute?.code ?? "route"} — monthly dues are available in Fee Take`,
    );
    setSelected(null);
    setQuery("");
    setFeeOverride("");
    setFeeOverrideReason("");
    refresh();
  }

  const commonPanelProps = {
    onRefresh: refresh,
    onFlash: flash,
    onError: (message: string) => {
      setError(message);
      setNotice(null);
    },
  };

  return (
    <ErpWorkspaceShell
      title="Transport"
      subtitle="Riders, routes, fleet operations, boarding, compliance, and transport finance in one workspace."
      icon={<Bus className="size-6" aria-hidden />}
      error={error}
      notice={notice}
      actions={
        <Link
          href="/fees"
          className="btn-accent rounded-lg px-3 py-1.5 text-sm font-semibold"
        >
          Open Fee Take
        </Link>
      }
    >
      <ModuleTabs
        items={TABS}
        value={tab}
        onChange={(id) => setTab(id as TransportTab)}
        aria-label="Transport workspace"
        size="md"
      />

      {!state ? (
        <p className="mt-6 text-sm text-[var(--muted)]">Loading transport…</p>
      ) : (
        <>
          {tab === "dashboard" ? (
            <ModuleDashboardHost
              moduleId="transport"
              onNavigateTab={(t) => setTab(t as TransportTab)}
            />
          ) : null}
          {tab === "planner" ? (
            <TransportPlannerPanel
              state={state}
              masters={masters}
              sis={sis}
              academicYearCode={session.academicYearCode}
              onRefresh={refresh}
              onSisRefresh={() => setSis(loadSis())}
              onFlash={flash}
              onError={setError}
            />
          ) : null}
          {tab === "riders" ? (
            <RidersPanel
              state={state}
              masters={masters}
              sis={sis}
              sessionName={session.fullName}
              query={query}
              setQuery={setQuery}
              classId={classId}
              setClassId={setClassId}
              sectionId={sectionId}
              setSectionId={setSectionId}
              classOptions={classOptions}
              sectionOptions={sectionOptions}
              hits={hits}
              selected={selected}
              setSelected={setSelected}
              holdCheck={holdCheck}
              setHoldDialog={setHoldDialog}
              routes={routes}
              routeId={routeId}
              setRouteId={setRouteId}
              selectedRoute={selectedRoute}
              stopId={stopId}
              setStopId={setStopId}
              effectiveFrom={effectiveFrom}
              setEffectiveFrom={setEffectiveFrom}
              feeOverride={feeOverride}
              setFeeOverride={setFeeOverride}
              feeOverrideReason={feeOverrideReason}
              setFeeOverrideReason={setFeeOverrideReason}
              expectedFeePaise={expectedFeePaise}
              proposedFeePaise={proposedFeePaise}
              existingDues={existingDues}
              riders={riders}
              onAssign={onAssign}
              onRefresh={refresh}
              onFlash={flash}
              onNotice={setNotice}
            />
          ) : null}
          {tab === "routes" ? (
            <RoutesPanel
              state={state}
              vehicles={state.vehicles}
              {...commonPanelProps}
            />
          ) : null}
          {tab === "fleet" ? (
            <FleetPanel
              state={state}
              masters={masters}
              upsertVehicle={upsertFleetVehicle}
              {...commonPanelProps}
            />
          ) : null}
          {tab === "fuel" ? (
            <FuelPanel state={state} {...commonPanelProps} />
          ) : null}
          {tab === "dealers" ? (
            <DealersPanel state={state} {...commonPanelProps} />
          ) : null}
          {tab === "finance" ? (
            <FinancePanel state={state} {...commonPanelProps} />
          ) : null}
          {tab === "service" ? (
            <ServicePanel
              state={state}
              sessionName={session.fullName}
              {...commonPanelProps}
            />
          ) : null}
          {tab === "board" ? (
            <BoardingPanel
              state={state}
              sis={sis}
              masters={masters}
              {...commonPanelProps}
            />
          ) : null}
          {tab === "compliance" ? (
            <CompliancePanel
              state={state}
              sis={sis}
              onRefresh={refresh}
              onFlash={flash}
            />
          ) : null}
          {tab === "live" ? (
            <>
              <LiveMapPanel
                state={state}
                sis={sis}
                masters={masters}
                academicYearCode={session.academicYearCode}
                {...commonPanelProps}
              />
              <FleetEdgeEventsPanel />
            </>
          ) : null}
          {tab === "fleetDashboard" ? <FleetDashboard /> : null}
          {tab === "reports" ? (
            <ReportsPanel
              state={state}
              masters={masters}
              sis={sis}
              onFlash={flash}
              onError={setError}
            />
          ) : null}
        </>
      )}

      {holdDialog && selected && holdCheck && !holdCheck.allowed ? (
        <PrincipalHoldOverrideDialog
          studentId={selected.student.id}
          studentName={selected.student.fullName}
          holdCode="HOLD_TRANSPORT"
          block={holdCheck}
          overriddenBy={session.fullName}
          onClose={() => setHoldDialog(false)}
          onGranted={() => {
            setHoldDialog(false);
            refreshHolds(selected.student.id);
            flash("Transport hold unlocked — you can assign now");
          }}
        />
      ) : null}
    </ErpWorkspaceShell>
  );
}

type RidersPanelProps = {
  state: TransportState;
  masters: MastersState | null;
  sis: SisState | null;
  sessionName: string;
  query: string;
  setQuery: (value: string) => void;
  classId: string;
  setClassId: (value: string) => void;
  sectionId: string;
  setSectionId: (value: string) => void;
  classOptions: MastersState["classes"];
  sectionOptions: MastersState["sections"];
  hits: StudentSearchHit[];
  selected: StudentSearchHit | null;
  setSelected: (value: StudentSearchHit | null) => void;
  holdCheck: HoldCheck | null;
  setHoldDialog: (value: boolean) => void;
  routes: ReturnType<typeof listActiveRoutes>;
  routeId: string;
  setRouteId: (value: string) => void;
  selectedRoute: ReturnType<typeof listActiveRoutes>[number] | null;
  stopId: string;
  setStopId: (value: string) => void;
  effectiveFrom: string;
  setEffectiveFrom: (value: string) => void;
  feeOverride: string;
  setFeeOverride: (value: string) => void;
  feeOverrideReason: string;
  setFeeOverrideReason: (value: string) => void;
  expectedFeePaise: number;
  proposedFeePaise: number;
  existingDues: ReturnType<typeof computeTransportPeriodDues>;
  riders: ReturnType<typeof listActiveRiders>;
  onAssign: () => void;
  onRefresh: () => void;
  onFlash: (message: string) => void;
  onNotice: (message: string | null) => void;
};

function RidersPanel(props: RidersPanelProps) {
  const {
    masters,
    sis,
    sessionName,
    query,
    setQuery,
    classId,
    setClassId,
    sectionId,
    setSectionId,
    classOptions,
    sectionOptions,
    hits,
    selected,
    setSelected,
    holdCheck,
    setHoldDialog,
    routes,
    routeId,
    setRouteId,
    selectedRoute,
    stopId,
    setStopId,
    effectiveFrom,
    setEffectiveFrom,
    feeOverride,
    setFeeOverride,
    feeOverrideReason,
    setFeeOverrideReason,
    expectedFeePaise,
    proposedFeePaise,
    existingDues,
    riders,
    onAssign,
    onRefresh,
    onFlash,
    onNotice,
  } = props;

  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
      <div className="space-y-4">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Assign rider
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Operator: {sessionName} · or use{" "}
            <button
              type="button"
              className="font-semibold text-[var(--brand-mid)] underline"
              onClick={() => onNotice("Open the Planner tab for SIS route suggestions")}
            >
              Planner
            </button>{" "}
            for auto-suggest
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)]">
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Find student
              </span>
              <input
                className="field"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected(null);
                }}
                placeholder="Name, admission no, or mobile…"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Class
              </span>
              <select
                className="field !py-1.5"
                value={classId}
                onChange={(event) => {
                  setClassId(event.target.value);
                  setSectionId("");
                  setSelected(null);
                }}
              >
                <option value="">All classes</option>
                {classOptions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Section
              </span>
              <select
                className="field !py-1.5"
                value={sectionId}
                disabled={!classId}
                onChange={(event) => {
                  setSectionId(event.target.value);
                  setSelected(null);
                }}
              >
                <option value="">
                  {classId ? "All sections" : "Pick class first"}
                </option>
                {sectionOptions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-2 flex justify-end">
            <StudentHitsFilterExport
              title="Transport · student search"
              hits={hits}
              query={query}
              classLabel={classOptions.find((row) => row.id === classId)?.name}
              sectionLabel={
                sectionOptions.find((row) => row.id === sectionId)?.name
              }
              onMessage={(message) => {
                onNotice(message);
                window.setTimeout(() => onNotice(null), 2200);
              }}
            />
          </div>

          {!selected && (query.trim() || classId || sectionId) ? (
            <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
              {hits.length === 0 ? (
                <li className="rounded-lg bg-[var(--surface-sunken)] px-3 py-3 text-sm text-[var(--muted)]">
                  No students match.
                </li>
              ) : (
                hits.slice(0, 12).map((hit) => (
                  <li key={hit.student.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-left hover:bg-[rgba(197,160,40,0.08)]"
                      onClick={() => {
                        setSelected(hit);
                        setQuery(hit.student.fullName);
                      }}
                    >
                      <div className="text-sm font-semibold text-[var(--brand-deep)]">
                        <StudentNameLabel student={hit.student} />
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {hit.classLabel} · open dues {formatInr(hit.balancePaise)}
                      </div>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}

          {selected ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-sunken)] px-3 py-2">
                <div className="text-sm text-[var(--brand-deep)]">
                  <strong>{selected.student.fullName}</strong>
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {selected.student.admissionNo} · {selected.classLabel}
                  </span>
                </div>
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--brand-mid)]"
                  onClick={() => {
                    setSelected(null);
                    setQuery("");
                  }}
                >
                  Change
                </button>
              </div>
              <HoldStatusBanner
                check={holdCheck}
                onOverride={() => setHoldDialog(true)}
              />
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Route
              </span>
              <select
                className="field !py-1.5"
                value={routeId}
                onChange={(event) => setRouteId(event.target.value)}
              >
                <option value="">Select route…</option>
                {routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.code} · {route.name} · {route.busNo}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Stop
              </span>
              <select
                className="field !py-1.5"
                value={stopId}
                disabled={!selectedRoute}
                onChange={(event) => setStopId(event.target.value)}
              >
                <option value="">
                  {selectedRoute ? "Select stop…" : "Pick route first"}
                </option>
                {selectedRoute?.stops.map((stop) => (
                  <option key={stop.id} value={stop.id}>
                    {stop.sequence}. {stop.name}
                    {stop.distanceKm ? ` · ${stop.distanceKm} km` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Effective from
              </span>
              <input
                className="field !py-1.5"
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Fee override ₹/month
              </span>
              <input
                className="field !py-1.5"
                inputMode="decimal"
                value={feeOverride}
                onChange={(event) => setFeeOverride(event.target.value)}
                placeholder={
                  expectedFeePaise
                    ? `Expected ${formatInr(expectedFeePaise)}`
                    : "Use route policy"
                }
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Override reason
              </span>
              <input
                className="field !py-1.5"
                value={feeOverrideReason}
                onChange={(event) => setFeeOverrideReason(event.target.value)}
                placeholder="Required when fee differs"
              />
            </label>
          </div>

          {selected && selectedRoute && stopId ? (
            <div className="mt-3 rounded-lg border border-[rgba(15,118,110,0.2)] bg-[rgba(15,118,110,0.06)] px-3 py-2 text-xs">
              <div className="font-bold text-[#0f766e]">Dues preview</div>
              <div className="mt-1 text-[var(--brand-deep)]">
                New monthly charge: {formatInr(proposedFeePaise)} · expected{" "}
                {formatInr(expectedFeePaise)} · starts {effectiveFrom}
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                Existing assignment dues in this session: {existingDues.length}
                {existingDues.length
                  ? ` · ${formatInr(existingDues.reduce((sum, due) => sum + due.amountPaise, 0))}`
                  : ""}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            className="mt-4 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-50"
            disabled={!selected || !routeId || !stopId}
            onClick={onAssign}
          >
            Assign to route
          </button>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Active riders
          </h2>
          {riders.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted)]">
              No active assignments yet.
            </p>
          ) : (
            <ErpTableShell className="mt-2">
              <ul className="max-h-96 divide-y divide-[var(--border)] overflow-y-auto">
              {riders.map((assignment) => {
                const student = sis?.students.find(
                  (row) => row.id === assignment.studentId,
                );
                const fee =
                  assignment.monthlyFeePaise > 0
                    ? assignment.monthlyFeePaise
                    : assignment.route
                      ? expectedMonthlyFeePaise(
                          assignment.route,
                          assignment.route.stops.find(
                            (stop) => stop.id === assignment.stopId,
                          ),
                          props.state.feePolicy,
                        )
                      : 0;
                return (
                  <li
                    key={assignment.id}
                    className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5"
                  >
                    <div>
                      <div className="text-sm font-semibold text-[var(--brand-deep)]">
                        {student?.fullName ?? assignment.studentId}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {assignment.route?.code} · {assignment.route?.busNo} ·{" "}
                        {assignment.stopName} · from {assignment.effectiveFrom}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {formatInr(fee)}/month
                        {assignment.feeOverrideReason
                          ? ` · override: ${assignment.feeOverrideReason}`
                          : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-[var(--danger)]"
                      onClick={() => {
                        const end = todayIso();
                        if (
                          !window.confirm(
                            `End transport for ${student?.fullName ?? "student"} from ${end}?`,
                          )
                        ) {
                          return;
                        }
                        endTransportAssignment(assignment.id, end);
                        onRefresh();
                        onFlash("Assignment ended");
                      }}
                    >
                      End
                    </button>
                  </li>
                );
              })}
              </ul>
            </ErpTableShell>
          )}
        </section>
      </div>

      <section className="h-fit rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Routes snapshot
        </h2>
        <ul className="mt-2 space-y-3">
          {routes.map((route) => {
            const crew = masters
              ? formatRouteCrew(staffAssignedToRoute(masters, route.id))
              : "";
            return (
              <li
                key={route.id}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-[var(--brand-deep)]">
                      {route.code} · {route.name}
                    </div>
                    <div className="text-[11px] text-[var(--muted)]">
                      {route.busNo}
                      {route.vehicleReg ? ` · ${route.vehicleReg}` : ""}
                    </div>
                  </div>
                  <div className="text-sm font-bold text-[var(--brand-deep)]">
                    {formatInr(route.monthlyFeePaise)}
                    <span className="text-[10px] font-normal text-[var(--muted)]">
                      /mo
                    </span>
                  </div>
                </div>
                <div className="mt-1 text-[11px] font-medium text-[var(--brand-deep)]">
                  {crew || "No driver / attendant mapped — set in Staff → Duties"}
                </div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">
                  {riders.filter((row) => row.routeId === route.id).length} riders
                  · {route.stops.map((stop) => stop.name).join(" → ")}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function ReportsPanel({
  state,
  masters,
  sis,
  onFlash,
  onError,
}: {
  state: TransportState;
  masters: MastersState | null;
  sis: SisState | null;
  onFlash: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [date, setDate] = useState(todayIso);
  const [routeId, setRouteId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [format, setFormat] = useState<TransportReportFormat>("excel");

  function run(id: (typeof TRANSPORT_REPORTS)[number]["id"]) {
    const result = runTransportReport(id, {
      date,
      routeId: routeId || undefined,
      vehicleId: vehicleId || undefined,
      format,
      transport: state,
      masters: masters ?? undefined,
      sis: sis ?? undefined,
    });
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onFlash(result.message);
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Report date
          </span>
          <input
            className="field !py-1.5"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Route
          </span>
          <select
            className="field !py-1.5"
            value={routeId}
            onChange={(event) => setRouteId(event.target.value)}
          >
            <option value="">All routes</option>
            {listActiveRoutes(state).map((route) => (
              <option key={route.id} value={route.id}>
                {route.code} · {route.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Vehicle
          </span>
          <select
            className="field !py-1.5"
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
          >
            <option value="">All vehicles</option>
            {state.vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.registrationNo} · {vehicle.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Format
          </span>
          <select
            className="field !py-1.5"
            value={format}
            onChange={(event) =>
              setFormat(event.target.value as TransportReportFormat)
            }
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {TRANSPORT_REPORT_CATEGORIES.map((category) => (
          <section
            key={category.id}
            className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]"
          >
            <h2
              className={`${category.headerClass} px-4 py-3 text-sm font-bold text-white`}
            >
              {category.title}
            </h2>
            <ul className="divide-y divide-[var(--border)] px-4">
              {TRANSPORT_REPORTS.filter(
                (report) => report.category === category.id,
              ).map((report) => (
                <li
                  key={report.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-[var(--brand-deep)]">
                      {report.label}
                    </div>
                    {report.hint ? (
                      <div className="text-[10px] text-[var(--muted)]">
                        {report.hint}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--brand-deep)]"
                    onClick={() => run(report.id)}
                  >
                    Run
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
