"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  formatInr,
  paidByDueKey,
  loadFees,
  searchFeeStudents,
  type StudentSearchHit,
} from "@/lib/fees";
import type { MastersState } from "@/lib/masters";
import type { SisState } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import {
  DEFAULT_MAP_LAYERS,
  TransportGoogleMap,
  TransportMapLegend,
} from "@/components/transport/TransportGoogleMap";
import {
  buildTransportMapMarkers,
  type TransportMapLayers,
} from "@/lib/transportMapMarkers";
import {
  approveRepairRequest,
  completeServiceJob,
  convertRepairToJob,
  createRepairRequest,
  createVehicleLoan,
  dealerTypeLabel,
  listActiveRiders,
  listBoardingForTrip,
  listOpenPayables,
  markPayablePaid,
  openServiceJob,
  recordCertificateRenewal,
  recordEmiPayment,
  recordGpsPing,
  recordInsurancePayment,
  setBoardingSuspended,
  upsertBoardingEvent,
  upsertDealer,
  upsertInsurance,
  upsertServiceScheduleItem,
  computeTransportComplianceAlerts,
  lastGpsPingByVehicle,
  certTypeLabel,
  type BoardingTrip,
  type CertType,
  type DealerType,
  type TransportState,
} from "@/lib/transport";

export function DealersPanel({
  state,
  onRefresh,
  onFlash,
  onError,
}: {
  state: TransportState;
  onRefresh: () => void;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<DealerType>("fuel_dealer");
  const open = listOpenPayables(state);

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">Add dealer</h2>
        <div className="mt-3 grid gap-2">
          <input
            className="field !py-1.5"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="field !py-1.5"
            value={type}
            onChange={(e) => setType(e.target.value as DealerType)}
          >
            {(
              [
                "fuel_dealer",
                "workshop",
                "financier",
                "insurer",
                "rto_agent",
                "cng_cert_agency",
                "spare_parts_supplier",
              ] as DealerType[]
            ).map((t) => (
              <option key={t} value={t}>
                {dealerTypeLabel(t)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-sm font-bold text-white"
            onClick={() => {
              const r = upsertDealer({ name, type });
              if (!r.ok) {
                onError(r.error);
                return;
              }
              setName("");
              onRefresh();
              onFlash("Dealer saved");
            }}
          >
            Save
          </button>
        </div>
        <ul className="mt-4 divide-y text-sm">
          {state.dealers.map((d) => (
            <li key={d.id} className="py-2">
              <span className="font-semibold text-[var(--brand-deep)]">
                {d.name}
              </span>
              <span className="text-[11px] text-[var(--muted)]">
                {" "}
                · {dealerTypeLabel(d.type)} · {d.paymentTermsDays}d
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Open payables
        </h2>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">None open.</p>
        ) : (
          <ul className="mt-2 divide-y text-sm">
            {open.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <div className="font-semibold">
                    {state.dealers.find((d) => d.id === p.dealerId)?.name || "—"}{" "}
                    · {formatInr(p.amountPaise - p.paidPaise)}
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">
                    {p.sourceType} · due {p.dueOn} · {p.note}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[var(--brand-deep)]"
                  onClick={() => {
                    markPayablePaid(p.id);
                    onRefresh();
                    onFlash("Marked paid");
                  }}
                >
                  Mark paid
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function FinancePanel({
  state,
  onRefresh,
  onFlash,
  onError,
}: {
  state: TransportState;
  onRefresh: () => void;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [vehicleId, setVehicleId] = useState("");
  const [emiPaise, setEmiPaise] = useState("42500");
  const [tenure, setTenure] = useState("48");
  const [principal, setPrincipal] = useState("1500000");
  const [dealerId, setDealerId] = useState("");
  const [certType, setCertType] = useState<CertType>("puc");
  const [expiry, setExpiry] = useState("");
  const [fee, setFee] = useState("400");

  const dueEmis = state.emiSchedule
    .filter((e) => e.status === "due" || e.status === "overdue")
    .slice(0, 20);

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            New vehicle loan / EMI
          </h2>
          <div className="mt-2 grid gap-2">
            <select
              className="field !py-1.5"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              <option value="">Vehicle…</option>
              {state.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNo}
                </option>
              ))}
            </select>
            <select
              className="field !py-1.5"
              value={dealerId}
              onChange={(e) => setDealerId(e.target.value)}
            >
              <option value="">Financier…</option>
              {state.dealers
                .filter((d) => d.type === "financier")
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
            <input
              className="field !py-1.5"
              placeholder="Principal ₹"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
            />
            <input
              className="field !py-1.5"
              placeholder="EMI ₹"
              value={emiPaise}
              onChange={(e) => setEmiPaise(e.target.value)}
            />
            <input
              className="field !py-1.5"
              placeholder="Tenure months"
              value={tenure}
              onChange={(e) => setTenure(e.target.value)}
            />
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-sm font-bold text-white"
              onClick={() => {
                const r = createVehicleLoan({
                  vehicleId,
                  dealerId,
                  accountNo: `VL-${Date.now().toString(36)}`,
                  principalPaise: Math.round(Number(principal) * 100),
                  ratePct: 10,
                  tenureMonths: Number(tenure) || 12,
                  emiPaise: Math.round(Number(emiPaise) * 100),
                  emiDueDay: 5,
                  startDate: new Date().toISOString().slice(0, 10),
                });
                if (!r.ok) {
                  onError(r.error);
                  return;
                }
                onRefresh();
                onFlash("Loan + EMI schedule created");
              }}
            >
              Create schedule
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Certificate renewal
          </h2>
          <div className="mt-2 grid gap-2">
            <select
              className="field !py-1.5"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              <option value="">Vehicle…</option>
              {state.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNo}
                </option>
              ))}
            </select>
            <select
              className="field !py-1.5"
              value={certType}
              onChange={(e) => setCertType(e.target.value as CertType)}
            >
              {(
                [
                  "puc",
                  "fitness",
                  "permit",
                  "road_tax",
                  "cng_hydro",
                  "ais140",
                  "fire_extinguisher",
                  "insurance",
                ] as CertType[]
              ).map((t) => (
                <option key={t} value={t}>
                  {certTypeLabel(t)}
                </option>
              ))}
            </select>
            <input
              className="field !py-1.5"
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
            <input
              className="field !py-1.5"
              placeholder="Fee ₹"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
            <button
              type="button"
              className="rounded-lg border px-3 py-2 text-sm font-semibold"
              onClick={() => {
                const r = recordCertificateRenewal({
                  vehicleId,
                  certType,
                  expiryDate: expiry,
                  issuedDate: new Date().toISOString().slice(0, 10),
                  feePaise: Math.round(Number(fee || "0") * 100),
                  markPaid: true,
                });
                if (!r.ok) {
                  onError(r.error);
                  return;
                }
                onRefresh();
                onFlash("Certificate renewed");
              }}
            >
              Record renewal
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Insurance policy
          </h2>
          <button
            type="button"
            className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold"
            onClick={() => {
              const end = new Date();
              end.setFullYear(end.getFullYear() + 1);
              const r = upsertInsurance({
                vehicleId,
                policyNo: `POL-${Date.now().toString(36).toUpperCase()}`,
                periodStart: new Date().toISOString().slice(0, 10),
                periodEnd: end.toISOString().slice(0, 10),
                premiumPaise: 1850000,
                type: "comprehensive",
                dealerId,
              });
              if (!r.ok) {
                onError(r.error);
                return;
              }
              recordInsurancePayment(r.policy.id);
              onRefresh();
              onFlash("Insurance saved + premium marked");
            }}
          >
            Add sample policy + pay premium
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">EMI due</h2>
        <ul className="mt-2 max-h-[28rem] divide-y overflow-y-auto text-sm">
          {dueEmis.length === 0 ? (
            <li className="py-2 text-[var(--muted)]">No open EMIs.</li>
          ) : (
            dueEmis.map((e) => {
              const loan = state.vehicleLoans.find((l) => l.id === e.loanId);
              const veh = state.vehicles.find((v) => v.id === loan?.vehicleId);
              return (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <div>
                    <div className="font-semibold">
                      #{e.installmentNo} · {veh?.registrationNo} ·{" "}
                      {formatInr(e.amountPaise)}
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      due {e.dueOn}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[var(--brand-deep)]"
                    onClick={() => {
                      const r = recordEmiPayment(e.id);
                      if (!r.ok) {
                        onError(r.error);
                        return;
                      }
                      onRefresh();
                      onFlash("EMI recorded");
                    }}
                  >
                    Pay
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

export function ServicePanel({
  state,
  sessionName,
  onRefresh,
  onFlash,
  onError,
}: {
  state: TransportState;
  sessionName: string;
  onRefresh: () => void;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [vehicleId, setVehicleId] = useState("");
  const [title, setTitle] = useState("Engine oil change");
  const [estimate, setEstimate] = useState("5000");
  const [symptom, setSymptom] = useState("");

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Open service / repair job
        </h2>
        <div className="mt-2 grid gap-2">
          <select
            className="field !py-1.5"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="">Vehicle…</option>
            {state.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registrationNo}
              </option>
            ))}
          </select>
          <input
            className="field !py-1.5"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-sm font-bold text-white"
            onClick={() => {
              const r = openServiceJob({
                vehicleId,
                kind: "service",
                title,
                laborPaise: 150000,
                partsPaise: 80000,
              });
              if (!r.ok) {
                onError(r.error);
                return;
              }
              upsertServiceScheduleItem(vehicleId, {
                task: title,
                intervalKm: 5000,
                lastDoneOn: new Date().toISOString().slice(0, 10),
              });
              onRefresh();
              onFlash("Job opened — vehicle in workshop");
            }}
          >
            Open job
          </button>
        </div>
        <h3 className="mt-4 text-xs font-bold uppercase text-[var(--muted)]">
          Repair request
        </h3>
        <textarea
          className="field mt-1 min-h-[4rem] !py-1.5"
          placeholder="Symptom…"
          value={symptom}
          onChange={(e) => setSymptom(e.target.value)}
        />
        <input
          className="field mt-2 !py-1.5"
          placeholder="Estimate ₹"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
        />
        <button
          type="button"
          className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold"
          onClick={() => {
            const r = createRepairRequest({
              vehicleId,
              reportedBy: sessionName,
              symptom,
              estimatePaise: Math.round(Number(estimate || "0") * 100),
            });
            if (!r.ok) {
              onError(r.error);
              return;
            }
            onRefresh();
            onFlash(
              r.needsApproval
                ? "Request needs Principal approval (over threshold)"
                : "Repair request logged",
            );
          }}
        >
          Submit request
        </button>
      </div>
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Open jobs & requests
        </h2>
        <ul className="mt-2 divide-y text-sm">
          {state.serviceJobCards
            .filter((j) => j.status !== "completed" && j.status !== "cancelled")
            .map((j) => (
              <li
                key={j.id}
                className="flex items-center justify-between gap-2 py-2"
              >
                <div>
                  <div className="font-semibold">{j.title}</div>
                  <div className="text-[10px] text-[var(--muted)]">
                    {
                      state.vehicles.find((v) => v.id === j.vehicleId)
                        ?.registrationNo
                    }{" "}
                    · {j.status}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-[11px] font-semibold"
                  onClick={() => {
                    completeServiceJob(j.id);
                    onRefresh();
                    onFlash("Job completed");
                  }}
                >
                  Complete
                </button>
              </li>
            ))}
          {state.repairRequests
            .filter((r) => r.status === "open" || r.status === "approved")
            .map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <div className="font-semibold">{r.symptom}</div>
                  <div className="text-[10px] text-[var(--muted)]">
                    {r.status} · est {formatInr(r.estimatePaise)}
                  </div>
                </div>
                <div className="flex gap-2">
                  {r.status === "open" ? (
                    <button
                      type="button"
                      className="text-[11px] font-semibold"
                      onClick={() => {
                        approveRepairRequest(r.id);
                        onRefresh();
                      }}
                    >
                      Approve
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[var(--brand-deep)]"
                    onClick={() => {
                      const c = convertRepairToJob(r.id);
                      if (!c.ok) {
                        onError(c.error);
                        return;
                      }
                      onRefresh();
                      onFlash("Converted to job card");
                    }}
                  >
                    → Job
                  </button>
                </div>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

export function BoardingPanel({
  state,
  sis,
  masters,
  onRefresh,
  onFlash,
  onError,
}: {
  state: TransportState;
  sis: SisState | null;
  masters: MastersState | null;
  onRefresh: () => void;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [routeId, setRouteId] = useState("");
  const [trip, setTrip] = useState<BoardingTrip>("AM");
  const [unauthQ, setUnauthQ] = useState("");

  const riders = useMemo(
    () => listActiveRiders(state).filter((a) => !routeId || a.routeId === routeId),
    [state, routeId],
  );
  const events = listBoardingForTrip(date, routeId, trip, state);
  const eventByStudent = new Map(events.map((e) => [e.studentId, e]));

  const unauthHits =
    sis && masters && unauthQ.trim()
      ? searchFeeStudents(unauthQ, sis, masters).slice(0, 8)
      : [];

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Date</span>
          <input
            className="field !py-1.5"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Route</span>
          <select
            className="field !py-1.5"
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
          >
            <option value="">Select…</option>
            {state.routes
              .filter((r) => r.isActive)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {r.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Trip</span>
          <select
            className="field !py-1.5"
            value={trip}
            onChange={(e) => setTrip(e.target.value as BoardingTrip)}
          >
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </label>
      </div>
      {!routeId ? (
        <p className="text-sm text-[var(--muted)]">Pick a route to mark boarding.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Authorized riders
            </h2>
            <ul className="mt-2 max-h-96 divide-y overflow-y-auto text-sm">
              {riders.map((a) => {
                const st = sis?.students.find((s) => s.id === a.studentId);
                const ev = eventByStudent.get(a.studentId);
                return (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <div>
                      <div className="font-semibold">
                        {st?.fullName ?? a.studentId}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {a.stopName}
                        {a.boardingSuspended ? " · SUSPENDED" : ""}
                        {ev ? ` · ${ev.status}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="rounded border px-2 py-0.5 text-[10px] font-bold"
                        onClick={() => {
                          upsertBoardingEvent({
                            date,
                            routeId,
                            trip,
                            studentId: a.studentId,
                            status: "boarded",
                          });
                          onRefresh();
                        }}
                      >
                        Board
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-0.5 text-[10px] font-bold"
                        onClick={() => {
                          upsertBoardingEvent({
                            date,
                            routeId,
                            trip,
                            studentId: a.studentId,
                            status: "absent",
                          });
                          onRefresh();
                        }}
                      >
                        Absent
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Report unauthorized
            </h2>
            <input
              className="field mt-2 !py-1.5"
              placeholder="Search student…"
              value={unauthQ}
              onChange={(e) => setUnauthQ(e.target.value)}
            />
            <ul className="mt-2 space-y-1 text-sm">
              {unauthHits.map((h: StudentSearchHit) => (
                <li key={h.student.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg border px-3 py-2 text-left"
                    onClick={() => {
                      const r = upsertBoardingEvent({
                        date,
                        routeId,
                        trip,
                        studentId: h.student.id,
                        status: "unauthorized",
                        note: "Ghost rider",
                      });
                      if (!r.ok) {
                        onError(r.error);
                        return;
                      }
                      onRefresh();
                      onFlash(`Unauthorized: ${h.student.fullName}`);
                    }}
                  >
                    {h.student.fullName} · {h.classLabel}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export function CompliancePanel({
  state,
  sis,
  onRefresh,
  onFlash,
}: {
  state: TransportState;
  sis: SisState | null;
  onRefresh: () => void;
  onFlash: (m: string) => void;
}) {
  const alerts = useMemo(() => {
    const paid = paidByDueKey(loadFees());
    return computeTransportComplianceAlerts({
      state,
      paidByDueKey: paid,
    });
  }, [state]);

  return (
    <div className="mt-4 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Fee & boarding compliance
        </h2>
        <Link
          href="/fees"
          className="text-xs font-semibold text-[var(--brand-mid)]"
        >
          Open Fee Take
        </Link>
      </div>
      {alerts.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">No alerts.</p>
      ) : (
        <ul className="mt-3 divide-y text-sm">
          {alerts.map((a, i) => {
            const st = sis?.students.find((s) => s.id === a.studentId);
            return (
              <li
                key={`${a.code}-${a.studentId}-${i}`}
                className="flex flex-wrap items-start justify-between gap-2 py-2"
              >
                <div>
                  <div className="font-bold text-[var(--brand-deep)]">
                    {a.code}{" "}
                    <span className="text-[10px] uppercase text-[var(--muted)]">
                      {a.severity}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {st?.fullName ?? a.studentId} · {a.message}
                    {a.amountPaise ? ` · ${formatInr(a.amountPaise)}` : ""}
                  </div>
                </div>
                {a.assignmentId ? (
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[#dc2626]"
                    onClick={() => {
                      setBoardingSuspended(a.assignmentId, true);
                      onRefresh();
                      onFlash("Boarding suspended");
                    }}
                  >
                    Suspend boarding
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function LiveMapPanel({
  state,
  sis,
  masters,
  academicYearCode,
  onRefresh,
  onFlash,
  onError,
}: {
  state: TransportState;
  sis?: SisState | null;
  masters?: MastersState | null;
  academicYearCode?: string;
  onRefresh: () => void;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [vehicleId, setVehicleId] = useState("");
  const [lat, setLat] = useState(String(TENANT.schoolLat));
  const [lng, setLng] = useState(String(TENANT.schoolLng));
  const [layers, setLayers] = useState<TransportMapLayers>(DEFAULT_MAP_LAYERS);
  const last = lastGpsPingByVehicle(state);
  const onRoad = state.vehicles.filter(
    (v) => v.isActive && v.status === "active",
  );

  const layerCounts = useMemo(() => {
    const only = (key: keyof TransportMapLayers): TransportMapLayers => ({
      school: key === "school",
      stops: key === "stops",
      unassigned: key === "unassigned",
      riders: key === "riders",
      buses: key === "buses",
    });
    const countKind = (key: keyof TransportMapLayers) =>
      buildTransportMapMarkers({
        transport: state,
        sis: sis ?? null,
        masters: masters ?? null,
        academicYearCode,
        layers: only(key),
      }).length;
    return {
      school: countKind("school"),
      stops: countKind("stops"),
      unassigned: countKind("unassigned"),
      riders: countKind("riders"),
      buses: countKind("buses"),
    };
  }, [state, sis, masters, academicYearCode]);

  function toggleLayer(key: keyof TransportMapLayers) {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Live route map
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              School · route stop zones · pinned homes · bus GPS
            </p>
          </div>
          <TransportMapLegend
            layers={layers}
            onToggle={toggleLayer}
            counts={layerCounts}
          />
        </div>
        <div className="mt-3">
          <TransportGoogleMap
            transport={state}
            sis={sis ?? null}
            masters={masters ?? null}
            academicYearCode={academicYearCode}
            layers={layers}
          />
        </div>
        <p className="mt-2 text-[10px] text-[var(--muted)]">
          Orange = students without transport (need SIS address pin). Navy dots =
          stop fee zones (~distance from school). Enable{" "}
          <strong>Maps JavaScript API</strong> on your Google key.
        </p>
      </section>

    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Record GPS ping
        </h2>
        <div className="mt-2 grid gap-2">
          <select
            className="field !py-1.5"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="">Vehicle…</option>
            {onRoad.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registrationNo}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="field !py-1.5"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="Lat"
            />
            <input
              className="field !py-1.5"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="Lng"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-sm font-bold text-white"
              onClick={() => {
                const r = recordGpsPing({
                  vehicleId,
                  lat: Number(lat),
                  lng: Number(lng),
                  source: "manual",
                });
                if (!r.ok) {
                  onError(r.error);
                  return;
                }
                onRefresh();
                onFlash("Ping saved");
              }}
            >
              Save ping
            </button>
            <button
              type="button"
              className="rounded-lg border px-3 py-2 text-sm font-semibold"
              onClick={() => {
                if (!navigator.geolocation) {
                  onError("Geolocation unavailable");
                  return;
                }
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    setLat(String(pos.coords.latitude));
                    setLng(String(pos.coords.longitude));
                    const r = recordGpsPing({
                      vehicleId,
                      lat: pos.coords.latitude,
                      lng: pos.coords.longitude,
                      source: "browser",
                    });
                    if (!r.ok) {
                      onError(r.error);
                      return;
                    }
                    onRefresh();
                    onFlash("Browser location pinged");
                  },
                  () => onError("Location permission denied"),
                );
              }}
            >
              Use browser location
            </button>
          </div>
        </div>
        <ul className="mt-4 max-h-64 divide-y overflow-y-auto text-[11px]">
          {onRoad.map((v) => {
            const p = last.get(v.id);
            return (
              <li key={v.id} className="py-1.5">
                <strong>{v.registrationNo}</strong>
                {p
                  ? ` · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)} · ${p.recordedAt.slice(0, 16)}`
                  : " · no ping"}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
    </div>
  );
}
