"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatInr, searchFeeStudents, type StudentSearchHit } from "@/lib/fees";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import {
  assignStudentToRoute,
  endTransportAssignment,
  listActiveRoutes,
  listAllAssignments,
  loadTransport,
  type TransportRoute,
} from "@/lib/transport";
import { StudentTypeBadge } from "@/components/students/StudentAvatar";
import { StudentHitsFilterExport } from "@/components/reports/StudentHitsFilterExport";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  HoldStatusBanner,
  PrincipalHoldOverrideDialog,
} from "@/components/fees/PrincipalHoldOverrideDialog";
import { checkHold, type HoldCheck } from "@/lib/holds";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function TransportWorkspace() {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [hits, setHits] = useState<StudentSearchHit[]>([]);
  const [selected, setSelected] = useState<StudentSearchHit | null>(null);
  const [routeId, setRouteId] = useState("");
  const [stopId, setStopId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso);
  const [feeOverride, setFeeOverride] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [holdCheck, setHoldCheck] = useState<HoldCheck | null>(null);
  const [holdDialog, setHoldDialog] = useState(false);

  function refreshHolds(studentId?: string) {
    if (!studentId) {
      setHoldCheck(null);
      return;
    }
    setHoldCheck(checkHold(studentId, "HOLD_TRANSPORT"));
  }

  function refresh() {
    const m = loadMasters();
    const s = loadSis();
    const t = loadTransport();
    setMasters(m);
    setSis(s);
    setRoutes(listActiveRoutes(t));
    setTick((x) => x + 1);
  }

  useEffect(() => {
    refresh();
  }, []);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive);
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    return masters.sections.filter((s) => s.classId === classId && s.isActive);
  }, [masters, classId]);

  useEffect(() => {
    if (!sectionId) return;
    if (!sectionOptions.some((s) => s.id === sectionId)) {
      setSectionId("");
    }
  }, [sectionId, sectionOptions]);

  useEffect(() => {
    if (!sis || !masters) return;
    setHits(
      searchFeeStudents(query, sis, masters, undefined, {
        classId,
        sectionId,
      }),
    );
  }, [query, classId, sectionId, sis, masters, tick]);

  useEffect(() => {
    refreshHolds(selected?.student.id);
  }, [selected?.student.id, tick]);

  const selectedRoute = routes.find((r) => r.id === routeId) ?? null;

  useEffect(() => {
    if (!selectedRoute) {
      setStopId("");
      return;
    }
    if (!selectedRoute.stops.some((st) => st.id === stopId)) {
      setStopId(selectedRoute.stops[0]?.id ?? "");
    }
  }, [selectedRoute, stopId]);

  const riders = useMemo(() => {
    void tick;
    return listAllAssignments().filter((a) => a.effectiveTo == null);
  }, [tick]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

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
    const overridePaise = feeOverride.trim()
      ? Math.round((Number(feeOverride) || 0) * 100)
      : 0;
    const result = assignStudentToRoute({
      studentId: selected.student.id,
      householdId: selected.student.householdId,
      routeId,
      stopId,
      effectiveFrom,
      academicYearCode: selected.student.academicYearCode || DEFAULT_AY,
      monthlyFeePaise: overridePaise > 0 ? overridePaise : undefined,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const route = routes.find((r) => r.id === routeId);
    flash(
      `Assigned ${selected.student.fullName} to ${route?.code ?? "route"} — monthly dues on Fee Take`,
    );
    setSelected(null);
    setQuery("");
    setFeeOverride("");
    refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
            Transport
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Assign students to bus routes — monthly transport dues appear on Fee
            Take and Manual book with route, bus, and stop.
          </p>
        </div>
        <Link
          href="/fees"
          className="btn-accent rounded-lg px-3 py-1.5 text-sm font-semibold"
        >
          Open Fee Take
        </Link>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Assign rider
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Operator: {session.fullName}
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)]">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Find student
                </span>
                <input
                  className="field"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelected(null);
                  }}
                  placeholder="Name, admission no, or mobile…"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Class
                </span>
                <select
                  className="field !py-1.5"
                  value={classId}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    setSectionId("");
                    setSelected(null);
                  }}
                >
                  <option value="">All classes</option>
                  {classOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Section
                </span>
                <select
                  className="field !py-1.5"
                  value={sectionId}
                  disabled={!classId}
                  onChange={(e) => {
                    setSectionId(e.target.value);
                    setSelected(null);
                  }}
                >
                  <option value="">
                    {classId ? "All sections" : "Pick class first"}
                  </option>
                  {sectionOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
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
                classLabel={classOptions.find((c) => c.id === classId)?.name}
                sectionLabel={sectionOptions.find((s) => s.id === sectionId)?.name}
                onMessage={(msg) => {
                  setNotice(msg);
                  window.setTimeout(() => setNotice(null), 2200);
                }}
              />
            </div>

            {!selected && (query.trim() || classId || sectionId) ? (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {hits.length === 0 ? (
                  <li className="rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-3 text-sm text-[var(--muted)]">
                    No students match.
                  </li>
                ) : (
                  hits.slice(0, 12).map((h) => (
                  <li key={h.student.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg border border-[rgba(32,48,80,0.12)] px-3 py-2 text-left hover:border-[rgba(197,160,40,0.45)] hover:bg-[rgba(197,160,40,0.08)]"
                      onClick={() => {
                        setSelected(h);
                        setQuery(h.student.fullName);
                      }}
                    >
                      <div className="text-sm font-semibold text-[var(--brand-deep)]">
                        <StudentTypeBadge type={h.student.studentType} />
                        {h.student.fullName}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {h.classLabel} · open dues {formatInr(h.balancePaise)}
                      </div>
                    </button>
                  </li>
                  ))
                )}
              </ul>
            ) : null}

            {selected ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2">
                  <div className="text-sm text-[var(--brand-deep)]">
                    <span className="font-semibold">
                      {selected.student.fullName}
                    </span>
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
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Route
                </span>
                <select
                  className="field !py-1.5"
                  value={routeId}
                  onChange={(e) => setRouteId(e.target.value)}
                >
                  <option value="">Select route…</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} · {r.name} · {r.busNo} ·{" "}
                      {formatInr(r.monthlyFeePaise)}/mo
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Stop
                </span>
                <select
                  className="field !py-1.5"
                  value={stopId}
                  onChange={(e) => setStopId(e.target.value)}
                  disabled={!selectedRoute}
                >
                  <option value="">
                    {selectedRoute ? "Select stop…" : "Pick route first"}
                  </option>
                  {selectedRoute?.stops.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.sequence}. {st.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Effective from
                </span>
                <input
                  className="field !py-1.5"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Fee override ₹/month (optional)
                </span>
                <input
                  className="field !py-1.5"
                  inputMode="decimal"
                  value={feeOverride}
                  onChange={(e) => setFeeOverride(e.target.value)}
                  placeholder={
                    selectedRoute
                      ? `Default ${formatInr(selectedRoute.monthlyFeePaise)}`
                      : "Use route fee"
                  }
                />
              </label>
            </div>

            <button
              type="button"
              className="mt-4 rounded-lg bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              disabled={!selected || !routeId || !stopId}
              onClick={onAssign}
            >
              Assign to route
            </button>
          </div>

          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Active riders
            </h2>
            {riders.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">
                No active assignments yet.
              </p>
            ) : (
              <ul className="mt-2 max-h-80 divide-y divide-[rgba(32,48,80,0.08)] overflow-y-auto">
                {riders.map((a) => {
                  const st = sis?.students.find((s) => s.id === a.studentId);
                  const fee =
                    a.monthlyFeePaise > 0
                      ? a.monthlyFeePaise
                      : (a.route?.monthlyFeePaise ?? 0);
                  return (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-start justify-between gap-2 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--brand-deep)]">
                          {st?.fullName ?? a.studentId}
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {a.route?.code} · {a.route?.busNo} · Stop {a.stopName}{" "}
                          · from {a.effectiveFrom}
                        </div>
                        <div className="text-[10px] text-[var(--muted)]">
                          {formatInr(fee)}/month
                        </div>
                      </div>
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-[#dc2626]"
                        onClick={() => {
                          const end = todayIso();
                          if (
                            !window.confirm(
                              `End transport for ${st?.fullName ?? "student"} from ${end}?`,
                            )
                          ) {
                            return;
                          }
                          endTransportAssignment(a.id, end);
                          refresh();
                          flash("Assignment ended");
                        }}
                      >
                        End
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Routes
          </h2>
          <ul className="mt-2 space-y-3">
            {routes.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-[rgba(32,48,80,0.1)] px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-[var(--brand-deep)]">
                      {r.code} · {r.name}
                    </div>
                    <div className="text-[11px] text-[var(--muted)]">
                      {r.busNo}
                      {r.vehicleReg ? ` · ${r.vehicleReg}` : ""}
                    </div>
                  </div>
                  <div className="text-sm font-bold text-[var(--brand-deep)]">
                    {formatInr(r.monthlyFeePaise)}
                    <span className="text-[10px] font-normal text-[var(--muted)]">
                      /mo
                    </span>
                  </div>
                </div>
                <ol className="mt-1 list-decimal pl-4 text-[10px] text-[var(--muted)]">
                  {r.stops.map((st) => (
                    <li key={st.id}>{st.name}</li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {holdDialog &&
      selected &&
      holdCheck &&
      !holdCheck.allowed ? (
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
    </div>
  );
}
