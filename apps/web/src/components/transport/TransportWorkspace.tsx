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
import { FleetEdgeReport } from "@/components/transport/FleetEdgeReport";
import { hasPermission } from "@/lib/rbac";
import {
  FleetPanel,
  FuelPanel,
  RoutesPanel,
} from "@/components/transport/TransportOpsPanels";
import {
  FleetRosterPanel,
  type RiderAction,
} from "@/components/transport/FleetRosterPanel";
import { ClassTransportPanel } from "@/components/transport/ClassTransportPanel";
import { FleetEdgeStatusStrip } from "@/components/transport/FleetEdgeStatusStrip";
import { StaffRiderPanel } from "@/components/transport/StaffRiderPanel";
import { StopLinkRepairPanel } from "@/components/transport/StopLinkRepairPanel";
import { TransportAmendDialog } from "@/components/transport/TransportAmendDialog";
import { NearestStopPicker } from "@/components/transport/NearestStopPicker";
import { StudentVillageStopPicker } from "@/components/transport/StudentVillageStopPicker";
import { householdHasGeo } from "@/lib/mapsGeocode";
import {
  checkTransportStartMonth,
  monthLabel,
} from "@/lib/transportStartMonth";
import { TransportPlannerPanel } from "@/components/transport/TransportPlannerPanel";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpTableShell } from "@/components/ui/erp-roster";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import {
  computeStudentDues,
  formatInr,
  loadFees,
  searchFeeStudents,
  type FeeDueLine,
  type StudentSearchHit,
} from "@/lib/fees";
import { checkHold, type HoldCheck } from "@/lib/holds";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { formatRouteCrew, staffAssignedToRoute } from "@/lib/staffResolve";
import {
  assignStudentToRoute,
  computeTransportPeriodDues,
  endTransportAssignment,
  overlappingAssignments,
  setAssignmentServiceMode,
  setBoardingSuspended,
  type TransportAssignment,
  serviceModeLabel,
  type TransportServiceMode,
  applyServiceMode,
  expectedMonthlyFeeDetail,
  expectedMonthlyFeePaise,
  listActiveRiders,
  listActiveRoutes,
  loadTransport,
  migrateDemoFleetToReal,
  seedTransportIfEmpty,
  upsertFleetVehicle,
  type TransportState,
} from "@/lib/transport";
import {
  buildStudentTransportProfiles,
  findSiblingTransportGaps,
  type SiblingTransportGap,
} from "@/lib/transportPlanner";
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
  | "rosters"
  | "classRosters"
  | "staffRiders"
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
  { id: "rosters", label: "Riders by bus", tone: "sky" },
  { id: "classRosters", label: "By class", tone: "sky" },
  { id: "staffRiders", label: "Staff riders", tone: "sky" },
  { id: "routes", label: "Routes", tone: "teal" },
  { id: "fleet", label: "Fleet", tone: "slate" },
  { id: "fuel", label: "Fuel", tone: "amber" },
  { id: "dealers", label: "Dealers", tone: "violet" },
  { id: "finance", label: "Finance", tone: "green" },
  { id: "service", label: "Service", tone: "coral" },
  { id: "board", label: "Boarding", tone: "sky" },
  { id: "compliance", label: "Compliance", tone: "rose" },
  { id: "live", label: "Live", tone: "teal" },
  { id: "fleetDashboard", label: "Fleet Edge report", tone: "amber" },
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
      "rosters",
      "classRosters",
      "staffRiders",
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
  const [serviceMode, setServiceMode] =
    useState<TransportServiceMode>("both");
  const [feeOverride, setFeeOverride] = useState("");
  const [feeOverrideReason, setFeeOverrideReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [repairingStopLinks, setRepairingStopLinks] = useState(false);
  const [rosterEditing, setRosterEditing] = useState<{
    assignment: TransportAssignment;
    studentName: string;
    dues: FeeDueLine[];
  } | null>(null);
  const [holdCheck, setHoldCheck] = useState<HoldCheck | null>(null);
  const [holdDialog, setHoldDialog] = useState(false);

  /**
   * The roster's per-rider buttons.
   *
   * Suspend, resume and take-off-bus are done here because they are one
   * decision each and the office is already looking at the rider. Changing a
   * stop or a fee is not — it needs the amendment dialog with the student's
   * dues in front of it — so those hand off to the Riders tab with that child
   * already found, rather than opening a second, thinner editor that could
   * disagree with the first.
   */
  function handleRiderAction(
    action: RiderAction,
    rider: { studentId: string; fullName: string; boardingSuspended: boolean },
  ) {
    // The roster cannot render without state, so this is belt and braces —
    // but acting on a desk that has not loaded would silently do nothing.
    if (!state) {
      setNotice("Transport data has not loaded yet — try again in a moment");
      return;
    }

    if (action === "suspend" || action === "resume") {
      const want = action === "suspend";
      const asg = state.assignments.find(
        (a) => a.studentId === rider.studentId && a.effectiveTo == null,
      );
      if (!asg) {
        setNotice(`No live assignment found for ${rider.fullName}`);
        return;
      }
      const ok = setBoardingSuspended(asg.id, want);
      refresh();
      flash(
        ok
          ? `${rider.fullName} — boarding ${want ? "suspended" : "resumed"}`
          : `Could not update ${rider.fullName}`,
      );
      return;
    }

    if (action === "service-mode") {
      const asg = state.assignments.find(
        (a) => a.studentId === rider.studentId && a.effectiveTo == null,
      );
      if (!asg) {
        setNotice(`No live assignment found for ${rider.fullName}`);
        return;
      }
      const now = asg.serviceMode ?? "both";
      const next = now === "both" ? "pickup" : "both";
      const yes = window.confirm(
        next === "both"
          ? `Put ${rider.fullName} back on both trips?\n\nTheir monthly fee returns to the full amount from the next uncollected month.`
          : `Change ${rider.fullName} to pick-up only?\n\nHalf the service, half the fee — from the next uncollected month. If they have already paid a full month and this should apply mid-month, use Edit instead so the paid months keep the fee they were collected at.`,
      );
      if (!yes) return;
      const ok = setAssignmentServiceMode(asg.id, next);
      refresh();
      flash(
        ok
          ? `${rider.fullName} — ${next === "both" ? "both trips, full fee" : "pick-up only, half fee"}`
          : `Could not update ${rider.fullName}`,
      );
      return;
    }

    if (action === "end") {
      // Taking a child off a bus stops their billing and removes them from
      // the driver's list, so it asks first and says what the effect is.
      const yes = window.confirm(
        `Take ${rider.fullName} off this bus?\n\nTheir transport billing stops and they disappear from the driver's list from today. Their fee history is kept.`,
      );
      if (!yes) return;
      const asg = state.assignments.find(
        (a) => a.studentId === rider.studentId && a.effectiveTo == null,
      );
      if (!asg) {
        setNotice(`No live assignment found for ${rider.fullName}`);
        return;
      }
      const r = endTransportAssignment(asg.id, new Date().toISOString().slice(0, 10));
      refresh();
      flash(r ? `${rider.fullName} taken off the bus` : `Could not update ${rider.fullName}`);
      return;
    }

    // edit / change-stop — open the amendment dialog on this rider. It is the
    // same editor the Riders tab uses, deliberately: route, stop, fee and the
    // month a change may land in all interact, and a second thinner editor
    // here could quietly disagree with the one next door.
    const asg = state.assignments.find(
      (a) => a.studentId === rider.studentId && a.effectiveTo == null,
    );
    if (!asg) {
      setNotice(`No live assignment found for ${rider.fullName}`);
      return;
    }
    const student = sis?.students.find((st) => st.id === rider.studentId) ?? null;
    let dues: FeeDueLine[] = [];
    if (student && masters) {
      try {
        // Which months are already paid decides when a change may land, so
        // the ledger is read now rather than assumed.
        dues = computeStudentDues(student, masters, loadFees(), {
          includeFuture: true,
          includePaid: true,
        });
      } catch {
        dues = [];
      }
    }
    setRosterEditing({
      assignment: asg,
      studentName: rider.fullName,
      dues,
    });
  }

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
      migrateDemoFleetToReal();
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
      // Transport is meaningless without the roster and the class masters: a
      // rider row falls back to the raw student id when SIS is missing, and
      // every per-bus roster reports zero. Hydrating only the transport desk
      // meant landing straight on /transport in a cold browser showed student
      // codes and empty buses while the assignments were perfectly fine.
      //
      // The staff roster is a fourth hydrate, not part of masters: staff is
      // stripped out of the masters blob and lives in sis_staff. Without it
      // the fleet form's driver picker comes up empty and says nobody on the
      // payroll drives — a blank presented as a fact.
      const [
        { ensureTransportHydrated },
        { ensureSisHydrated },
        { ensureMastersHydrated },
        { ensureStaffHydrated },
        { withHydrationSlot },
      ] = await Promise.all([
        import("@/lib/transportPersistence"),
        import("@/lib/sisPersistence"),
        import("@/lib/mastersPersistence"),
        import("@/lib/staffPersistence"),
        import("@/lib/deskHydrateGuard"),
      ]);
      await Promise.all([
        withHydrationSlot(() => ensureTransportHydrated()),
        withHydrationSlot(() => ensureSisHydrated()),
        withHydrationSlot(() => ensureMastersHydrated()),
        withHydrationSlot(() => ensureStaffHydrated()),
      ]);
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

  const feeDetail =
    state && selectedRoute
      ? expectedMonthlyFeeDetail(
          selectedRoute,
          selectedStop ?? undefined,
          state.feePolicy,
        )
      : null;
  const expectedFeePaise = feeDetail?.paise ?? 0;
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

  // The student's own session year, falling back to the workspace's selected
  // year rather than a hardcoded constant.
  const selectedAy =
    selected?.student.academicYearCode || session.academicYearCode;

  function onAssign(alsoStudentIds: string[] = []) {
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
    // A stop the policy cannot price must not be billed on a guess. An
    // explicit override is still allowed — somebody has then decided.
    if (feeDetail && !feeDetail.ok && overridePaise <= 0) {
      setError(feeDetail.reason ?? "This stop has no fee yet");
      return;
    }
    // Never bill transport before the child joined, or through a month the
    // school is shut. Checked here rather than only in the UI hint, so a
    // stale form state cannot slip a bad start date through.
    const startCheck = checkTransportStartMonth({
      effectiveFrom,
      joinedOn: selected.student.joinedOn,
      academicYearCode: selectedAy,
      masters,
    });
    if (!startCheck.ok) {
      setError(startCheck.reason);
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
      serviceMode,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Siblings ride the same bus from the same stop on the same terms. Each is
    // written through the same guarded path, so a hold or a start-date rule
    // still applies per child rather than being waived by the bulk action.
    const alsoDone: string[] = [];
    const alsoFailed: string[] = [];
    for (const id of alsoStudentIds) {
      const sib = sis?.students.find((x) => x.id === id);
      if (!sib) continue;
      const sibCheck = checkTransportStartMonth({
        effectiveFrom,
        joinedOn: sib.joinedOn,
        academicYearCode: sib.academicYearCode || selectedAy,
        masters,
      });
      if (!sibCheck.ok) {
        alsoFailed.push(`${sib.fullName}: ${sibCheck.reason}`);
        continue;
      }
      const r = assignStudentToRoute({
        studentId: sib.id,
        householdId: sib.householdId,
        routeId,
        stopId,
        effectiveFrom,
        academicYearCode: sib.academicYearCode || selectedAy,
        monthlyFeePaise: overridePaise > 0 ? overridePaise : undefined,
        feeOverrideReason: feeOverrideReason.trim(),
        serviceMode,
      });
      if (r.ok) alsoDone.push(sib.fullName);
      else alsoFailed.push(`${sib.fullName}: ${r.error}`);
    }

    flash(
      `Assigned ${[selected.student.fullName, ...alsoDone].join(", ")} to ${selectedRoute?.code ?? "route"} — monthly dues are available in Fee Take`,
    );
    // Partial success is reported, never swallowed: the clerk must know which
    // sibling did not go on.
    if (alsoFailed.length) setError(alsoFailed.join(" · "));
    setSelected(null);
    setQuery("");
    setFeeOverride("");
    setFeeOverrideReason("");
    setServiceMode("both");
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
              canEdit={hasPermission(session, masters, "transport", "edit")}
              state={state}
              masters={masters}
              sis={sis}
              sessionName={session.fullName}
              academicYearCode={selectedAy}
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
              serviceMode={serviceMode}
              setServiceMode={setServiceMode}
              feeOverride={feeOverride}
              setFeeOverride={setFeeOverride}
              feeOverrideReason={feeOverrideReason}
              setFeeOverrideReason={setFeeOverrideReason}
              expectedFeePaise={expectedFeePaise}
              feeDetail={feeDetail}
              proposedFeePaise={proposedFeePaise}
              existingDues={existingDues}
              riders={riders}
              onAssign={onAssign}
              onRefresh={refresh}
              onFlash={flash}
              onNotice={setNotice}
            />
          ) : null}
          {tab === "rosters" ? (
            repairingStopLinks ? (
              <StopLinkRepairPanel
                state={state}
                masters={masters}
                sis={sis}
                academicYearCode={session.academicYearCode}
                onDone={() => {
                  setRepairingStopLinks(false);
                  refresh();
                }}
              />
            ) : (
              <FleetRosterPanel
                state={state}
                masters={masters}
                sis={sis}
                academicYearCode={session.academicYearCode}
                onRepairStopLinks={() => setRepairingStopLinks(true)}
                onRiderAction={handleRiderAction}
              />
            )
          ) : null}
          {rosterEditing ? (
            <TransportAmendDialog
              assignment={rosterEditing.assignment}
              studentName={rosterEditing.studentName}
              academicYearCode={session.academicYearCode}
              state={state}
              dues={rosterEditing.dues}
              onClose={() => setRosterEditing(null)}
              onDone={(message) => {
                setRosterEditing(null);
                refresh();
                flash(message);
              }}
            />
          ) : null}
          {tab === "classRosters" ? (
            <ClassTransportPanel
              state={state}
              masters={masters}
              sis={sis}
              academicYearCode={session.academicYearCode}
            />
          ) : null}
          {tab === "staffRiders" ? (
            <StaffRiderPanel
              state={state}
              masters={masters}
              academicYearCode={session.academicYearCode}
              onRefresh={refresh}
              onFlash={flash}
              onError={setNotice}
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
            <div className="mt-4 space-y-4">
              <FleetEdgeStatusStrip vehicles={state.vehicles} variant="fleet" />
            </div>
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
              <div className="mt-4">
                <FleetEdgeStatusStrip vehicles={state.vehicles} variant="live" />
              </div>
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
          {tab === "fleetDashboard" ? (
            <FleetEdgeReport canEdit={hasPermission(session, masters, "transport", "edit")} />
          ) : null}
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
  academicYearCode: string;
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
  serviceMode: TransportServiceMode;
  setServiceMode: (v: TransportServiceMode) => void;
  feeOverride: string;
  setFeeOverride: (value: string) => void;
  feeOverrideReason: string;
  setFeeOverrideReason: (value: string) => void;
  expectedFeePaise: number;
  feeDetail: ReturnType<typeof expectedMonthlyFeeDetail> | null;
  proposedFeePaise: number;
  existingDues: ReturnType<typeof computeTransportPeriodDues>;
  riders: ReturnType<typeof listActiveRiders>;
  onAssign: (alsoStudentIds?: string[]) => void;
  onRefresh: () => void;
  onFlash: (message: string) => void;
  onNotice: (message: string | null) => void;
  /** Passed down rather than re-derived: `session` lives in the workspace. */
  canEdit: boolean;
};

function RidersPanel(props: RidersPanelProps) {
  const {
    state,
    masters,
    sis,
    sessionName,
    academicYearCode,
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
    serviceMode,
    setServiceMode,
    feeOverride,
    setFeeOverride,
    feeOverrideReason,
    setFeeOverrideReason,
    expectedFeePaise,
    feeDetail,
    proposedFeePaise,
    existingDues,
    riders,
    onAssign,
    onRefresh,
    onFlash,
    onNotice,
  } = props;

  // Split the search hits by whether the child is already on a bus. Showing one
  // undifferentiated list meant the clerk could pick a rider who was already
  // assigned and only find out at save time.
  const { unassignedHits, assignedHits } = useMemo(() => {
    const byStudent = new Map(riders.map((a) => [a.studentId, a]));
    const free: StudentSearchHit[] = [];
    const taken: { hit: StudentSearchHit; routeLabel: string }[] = [];
    for (const hit of hits) {
      const asg = byStudent.get(hit.student.id);
      if (!asg) {
        free.push(hit);
        continue;
      }
      const route = routes.find((r) => r.id === asg.routeId);
      const stop = route?.stops.find((st) => st.id === asg.stopId);
      taken.push({
        hit,
        routeLabel:
          [route?.busNo || route?.code, stop?.name]
            .filter(Boolean)
            .join(" · ") || "a bus",
      });
    }
    return { unassignedHits: free, assignedHits: taken };
  }, [hits, riders, routes]);

  const [amending, setAmending] = useState<{
    assignment: (typeof riders)[number];
    studentName: string;
    dues: FeeDueLine[];
  } | null>(null);

  // Siblings on the same household who do not already ride. Transport is bought
  // per family far more often than per child, and assigning them one at a time
  // is how a sibling ends up on a different bus from their brother.
  const householdSiblings = useMemo(() => {
    if (!selected || !sis) return [];
    const hh = selected.student.householdId;
    if (!hh) return [];
    const riding = new Set(riders.map((a) => a.studentId));
    return sis.students.filter(
      (st) =>
        st.householdId === hh &&
        st.id !== selected.student.id &&
        st.status === "active" &&
        st.academicYearCode === academicYearCode &&
        !riding.has(st.id),
    );
  }, [selected, sis, riders, academicYearCode]);

  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());

  // A new child clears the previous family's ticks — carrying them over would
  // assign the wrong household on the next click.
  useEffect(() => {
    setBulkIds(new Set());
  }, [selected?.student.id]);

  // The child's home, when the school has geocoded it. Null rather than a
  // guess — the picker says so and offers a locality search instead.
  const selectedHome = useMemo(() => {
    if (!selected || !sis) return null;
    const hh = sis.households.find((h) => h.id === selected.student.householdId);
    if (!hh || !householdHasGeo(hh)) return null;
    return { lat: hh.geoLat as number, lng: hh.geoLng as number };
  }, [selected, sis]);

  // Same check the assign handler runs, surfaced while the clerk is still
  // choosing the date rather than after they click.
  const startCheck = useMemo(() => {
    if (!selected || !effectiveFrom) return null;
    return checkTransportStartMonth({
      effectiveFrom,
      joinedOn: selected.student.joinedOn,
      academicYearCode,
      masters,
    });
  }, [selected, effectiveFrom, masters, academicYearCode]);

  const siblingGaps = useMemo(() => {
    if (!sis || !masters) return [];
    const profiles = buildStudentTransportProfiles(sis, masters, state);
    // The household carries a guardian name; the father's name lives on the
    // student. Prefer the guardian, fall back to any sibling's father.
    const labels = new Map(
      sis.households.map((h) => [h.id, h.guardianName || ""]),
    );
    for (const st of sis.students) {
      if (!st.householdId || labels.get(st.householdId)) continue;
      if (st.fatherName) labels.set(st.householdId, st.fatherName);
    }
    return findSiblingTransportGaps(profiles, state, labels);
  }, [sis, masters, state]);

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
            <div className="mt-2 max-h-60 space-y-2 overflow-y-auto">
              {hits.length === 0 ? (
                <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-3 text-sm text-[var(--muted)]">
                  No students match.
                </p>
              ) : (
                <>
                  <PickerGroup
                    heading="Not on any bus"
                    count={unassignedHits.length}
                    tone="open"
                  >
                    {unassignedHits.length === 0 ? (
                      <li className="px-3 py-2 text-[11px] text-[var(--muted)]">
                        Every match is already assigned.
                      </li>
                    ) : (
                      unassignedHits.slice(0, 12).map((hit) => (
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
                              {hit.classLabel}
                              {hit.student.fatherName
                                ? ` · F/O ${hit.student.fatherName}`
                                : ""}{" "}
                              · open dues {formatInr(hit.balancePaise)}
                            </div>
                          </button>
                        </li>
                      ))
                    )}
                  </PickerGroup>

                  {assignedHits.length > 0 ? (
                    <PickerGroup
                      heading="Already on a bus"
                      count={assignedHits.length}
                      tone="done"
                    >
                      {assignedHits.slice(0, 12).map(({ hit, routeLabel }) => (
                        <li key={hit.student.id}>
                          {/*
                            Shown but not selectable. Hiding these outright made
                            the clerk retype the name wondering why the search
                            "lost" the child; naming the bus answers it.
                          */}
                          <div
                            className="w-full cursor-not-allowed rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-left opacity-70"
                            aria-disabled="true"
                          >
                            <div className="text-sm font-semibold text-[var(--muted)]">
                              <StudentNameLabel student={hit.student} />
                            </div>
                            <div className="text-[11px] text-[var(--muted)]">
                              {hit.classLabel}
                              {hit.student.fatherName
                                ? ` · F/O ${hit.student.fatherName}`
                                : ""}{" "}
                              · on {routeLabel}
                            </div>
                          </div>
                        </li>
                      ))}
                    </PickerGroup>
                  ) : null}
                </>
              )}
            </div>
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

          {selected ? (
            <div className="mt-3 space-y-3">
              {/*
                The village comes from SIS, so arranging transport does not
                begin by asking where the child lives when the office already
                knows. The map opens ON that village, which is the difference
                between moving a pin 200 m and hunting for Varanasi first.
              */}
              <StudentVillageStopPicker
                studentId={selected.student.id}
                studentLabel={selected.student.fullName}
                canEdit={props.canEdit}
              />
              <NearestStopPicker
                state={state}
                home={selectedHome}
                selectedStopId={stopId}
                onPick={({ routeId: r, stopId: st }) => {
                  setRouteId(r);
                  setStopId(st);
                }}
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
                aria-invalid={startCheck && !startCheck.ok ? true : undefined}
              />
              {startCheck && !startCheck.ok ? (
                <span className="mt-1 block text-[11px] font-semibold text-[var(--danger)]">
                  {startCheck.reason}
                </span>
              ) : selected?.student.joinedOn ? (
                <span className="mt-1 block text-[10px] text-[var(--muted)]">
                  Admitted {monthLabel(selected.student.joinedOn.slice(0, 7))}
                </span>
              ) : null}
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Service
              </span>
              <select
                className="field !py-1.5"
                value={serviceMode}
                onChange={(e) =>
                  setServiceMode(e.target.value as TransportServiceMode)
                }
              >
                <option value="both">Both ways</option>
                <option value="pickup">Pick-up only (half fee)</option>
                <option value="drop">Drop only (half fee)</option>
              </select>
              {serviceMode !== "both" && proposedFeePaise > 0 ? (
                <span className="mt-1 block text-[10px] text-[var(--muted)]">
                  {formatInr(proposedFeePaise)} full ·{" "}
                  <strong className="text-[var(--ink)]">
                    {formatInr(applyServiceMode(proposedFeePaise, serviceMode))}
                  </strong>{" "}
                  billed
                </span>
              ) : null}
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

          {feeDetail && !feeDetail.ok ? (
            <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-[11px] font-semibold text-[var(--danger)]">
              {feeDetail.reason}
            </p>
          ) : feeDetail?.warning ? (
            <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--brand-mid)_45%,transparent)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-mid)]">
              {feeDetail.warning}
            </p>
          ) : null}

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

          {selected && householdSiblings.length > 0 ? (
            <div className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--brand-mid)_45%,transparent)] bg-[var(--card)] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[12px] font-bold text-[var(--brand-deep)]">
                  Same family, not yet on a bus
                </p>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[var(--brand-mid)] underline"
                  onClick={() =>
                    setBulkIds((cur) =>
                      cur.size === householdSiblings.length
                        ? new Set()
                        : new Set(householdSiblings.map((x) => x.id)),
                    )
                  }
                >
                  {bulkIds.size === householdSiblings.length
                    ? "Clear all"
                    : "Select all"}
                </button>
              </div>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                Ticked children go on the same bus, stop, start date and fee.
              </p>
              <ul className="mt-2 space-y-1">
                {householdSiblings.map((sib) => (
                  <li key={sib.id}>
                    <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                      <input
                        type="checkbox"
                        checked={bulkIds.has(sib.id)}
                        onChange={(e) =>
                          setBulkIds((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(sib.id);
                            else next.delete(sib.id);
                            return next;
                          })
                        }
                      />
                      <span className="font-semibold text-[var(--brand-deep)]">
                        {sib.fullName}
                      </span>
                      <span className="text-[var(--muted)]">
                        {sib.admissionNo}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <button
            type="button"
            className="mt-4 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-50"
            disabled={!selected || !routeId || !stopId}
            onClick={() => onAssign(Array.from(bulkIds))}
          >
            {bulkIds.size > 0
              ? `Assign ${bulkIds.size + 1} children to route`
              : "Assign to route"}
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
                        {student?.fullName ?? (
                          // A raw stu_ id on screen reads as data corruption.
                          // It is almost always the roster not being loaded.
                          <span className="text-[var(--muted)]">
                            {sis
                              ? `Not in ${academicYearCode} roster (${assignment.studentId})`
                              : "Loading student…"}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {assignment.route?.code} · {assignment.route?.busNo} ·{" "}
                        {assignment.stopName} · from {assignment.effectiveFrom}
                      </div>
                      {/* An overlapping row means this rider has more than one
                          assignment covering the same months. Billing keeps only
                          the newest, so the family is not charged twice — but the
                          extra row is a data fault the office should clear. */}
                      {overlappingAssignments(assignment.studentId, {
                        academicYearCode,
                        state: props.state,
                      }).length > 0 ? (
                        <div className="mt-0.5 inline-block rounded bg-[rgba(197,160,40,0.16)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-deep)]">
                          Overlapping assignment — only the newest is billed; end
                          or correct the older one
                        </div>
                      ) : null}
                      <div className="text-[10px] text-[var(--muted)]">
                        {formatInr(applyServiceMode(fee, assignment.serviceMode))}/month
                        {assignment.serviceMode &&
                        assignment.serviceMode !== "both"
                          ? ` · ${serviceModeLabel(assignment.serviceMode)}`
                          : ""}
                        {assignment.feeOverrideReason
                          ? ` · override: ${assignment.feeOverrideReason}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-[var(--brand-mid)]"
                      onClick={() => {
                        // Which months are already paid decides when the change
                        // may land, so the ledger is read at open time.
                        let dues: FeeDueLine[] = [];
                        if (student && masters) {
                          try {
                            dues = computeStudentDues(
                              student,
                              masters,
                              loadFees(),
                              { includeFuture: true, includePaid: true },
                            );
                          } catch {
                            dues = [];
                          }
                        }
                        setAmending({
                          assignment,
                          studentName: student?.fullName ?? "this student",
                          dues,
                        });
                      }}
                    >
                      Change
                    </button>
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
                    </div>
                  </li>
                );
              })}
              </ul>
            </ErpTableShell>
          )}
        </section>
      </div>

      <div className="h-fit space-y-4">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
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

      <SiblingGapsCard gaps={siblingGaps} />
      </div>

      {amending ? (
        <TransportAmendDialog
          assignment={amending.assignment}
          studentName={amending.studentName}
          academicYearCode={academicYearCode}
          state={state}
          dues={amending.dues}
          onClose={() => setAmending(null)}
          onDone={(message) => {
            setAmending(null);
            onRefresh();
            onFlash(message);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Households split between riding and not riding. Two audiences in one list:
 * siblings on different buses is a mistake to correct, siblings left off the
 * bus is transport revenue nobody has asked the family about.
 */
function SiblingGapsCard({ gaps }: { gaps: SiblingTransportGap[] }) {
  const [showAll, setShowAll] = useState(false);
  if (gaps.length === 0) return null;
  const shown = showAll ? gaps : gaps.slice(0, 6);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="text-sm font-bold text-[var(--brand-deep)]">
        Siblings not on the bus
      </h2>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
        {gaps.length} famil{gaps.length === 1 ? "y has" : "ies have"} one child
        riding and another not.
      </p>
      <ul className="mt-2 space-y-2">
        {shown.map((gap) => (
          <li
            key={gap.householdId}
            className={`rounded-lg border px-3 py-2 ${
              gap.splitAcrossRoutes
                ? "border-[rgba(180,69,58,0.4)] bg-[rgba(180,69,58,0.06)]"
                : "border-[var(--border)]"
            }`}
          >
            {gap.splitAcrossRoutes ? (
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--danger)]">
                Siblings on different buses — check this
              </p>
            ) : null}
            {gap.householdLabel ? (
              <p className="text-xs font-bold text-[var(--brand-deep)]">
                {gap.householdLabel}
              </p>
            ) : null}
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Riding:{" "}
              {gap.riders
                .map((r) => `${r.fullName} (${r.classLabel}, ${r.routeLabel})`)
                .join(" · ")}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-[var(--ink)]">
              Not riding:{" "}
              {gap.nonRiders
                .map((r) => `${r.fullName} (${r.classLabel})`)
                .join(" · ")}
            </p>
          </li>
        ))}
      </ul>
      {gaps.length > shown.length || showAll ? (
        <button
          type="button"
          className="mt-2 text-[11px] font-semibold text-[var(--brand-mid)] underline"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show fewer" : `Show all ${gaps.length}`}
        </button>
      ) : null}
    </section>
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

/** Headed, counted group inside the rider search results. */
function PickerGroup({
  heading,
  count,
  tone,
  children,
}: {
  heading: string;
  count: number;
  tone: "open" | "done";
  children: React.ReactNode;
}) {
  return (
    <div>
      <p
        className={`sticky top-0 z-[1] flex items-center justify-between rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
          tone === "open"
            ? "bg-[rgba(197,160,40,0.16)] text-[var(--brand-deep)]"
            : "bg-[var(--surface-sunken)] text-[var(--muted)]"
        }`}
      >
        <span>{heading}</span>
        <span className="tabular-nums">{count}</span>
      </p>
      <ul className="mt-1 space-y-1">{children}</ul>
    </div>
  );
}
