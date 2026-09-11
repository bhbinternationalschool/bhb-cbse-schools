"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "Check boarding points" — riders sitting further from their assigned stop
 * than from another stop on the same bus.
 *
 * Reads /api/transport/boarding-audit. Nothing here reassigns anybody: a
 * boarding point has reasons the ERP cannot see, so this is a list for the
 * office to work through, and it says plainly how much it actually knows.
 */

type Flag = {
  studentId: string;
  fullName: string;
  assignedStopId: string;
  nearestStopId: string;
  homeLabel: string;
  homePrecision: "village" | "pin";
  routeLabel: string;
  assignedStopName: string;
  assignedHomeKm: number;
  assignedSchoolKm: number | null;
  nearestStopName: string;
  nearestHomeKm: number;
  nearestSchoolKm: number | null;
  gapKm: number;
  feeChanges: boolean | null;
};

type Cluster = {
  stopId: string;
  stopName: string;
  routeLabel: string;
  riders: number;
  villages: string[];
};

type Audit = {
  academicYearCode: string;
  minGapKm: number;
  flags: Flag[];
  checked: number;
  skipped: { noHome: number; assignedStopUnpinned: number; noPinnedStopsOnRoute: number };
  clusters: Cluster[];
};

const chip = (tone: "warning" | "muted" | "info", text: string) => (
  <span
    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
      tone === "warning"
        ? "bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] text-[var(--ink)]"
        : tone === "info"
          ? "bg-[color-mix(in_srgb,var(--brand-deep)_12%,transparent)] text-[var(--brand-deep)]"
          : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
    }`}
  >
    {text}
  </span>
);

export function BoardingPointAuditPanel({
  academicYearCode,
  canEdit,
}: {
  academicYearCode: string;
  canEdit: boolean;
}) {
  const [data, setData] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [minGapKm, setMinGapKm] = useState(1);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/transport/boarding-audit?ay=${encodeURIComponent(academicYearCode)}&minGapKm=${minGapKm}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) setError(body?.error || "Could not run the check");
      else setData(body);
    } catch {
      setError("Could not reach the boarding-point check");
    } finally {
      setLoading(false);
    }
  }, [academicYearCode, minGapKm]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Record where a child actually boards.
   *
   * This does NOT move the assignment or change the fee — it records a fact
   * about the morning, and the office still decides the billing on Riders.
   * So pinning the stop the desk already assigned closes the row (the child
   * does board there), while pinning the nearer stop leaves it open, because
   * boarding at one stop and being billed for another is exactly the thing
   * that still needs a decision.
   */
  const pin = useCallback(
    async (studentId: string, stopId: string) => {
      setBusy(studentId);
      try {
        const res = await fetch("/api/transport/boarding-point", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, stopId }),
        });
        const body = await res.json();
        if (!res.ok) setError(body?.error || "Could not save the boarding point");
        else await load();
      } catch {
        setError("Could not save the boarding point");
      } finally {
        setBusy("");
      }
    },
    [load],
  );

  const clearPin = useCallback(
    async (studentId: string) => {
      setBusy(studentId);
      try {
        const res = await fetch(
          `/api/transport/boarding-point?studentId=${encodeURIComponent(studentId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const body = await res.json();
          setError(body?.error || "Could not clear the pin");
        } else await load();
      } catch {
        setError("Could not clear the pin");
      } finally {
        setBusy("");
      }
    },
    [load],
  );

  return (
    <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">Check boarding points</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Riders whose home is closer to a different stop on the same bus. Nothing is changed
            here — the office decides each one.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          Ignore gaps under
          <select
            value={minGapKm}
            onChange={(e) => setMinGapKm(Number(e.target.value))}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px] text-[var(--ink)]"
          >
            <option value={1}>1 km</option>
            <option value={2}>2 km</option>
            <option value={3}>3 km</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p className="mt-3 text-[11px] text-[var(--muted)]">Checking…</p>
      ) : error ? (
        <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] px-3 py-2 text-[11px] text-[var(--danger)]">
          {error}. This is not the same as every rider being correctly placed.
        </p>
      ) : !data ? null : (
        <>
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            {data.checked} rider{data.checked === 1 ? "" : "s"} checked ·{" "}
            <strong className="text-[var(--ink)]">{data.flags.length} to look at</strong>
            {data.skipped.noHome + data.skipped.assignedStopUnpinned + data.skipped.noPinnedStopsOnRoute >
            0 ? (
              <>
                {" "}
                · could not judge {data.skipped.noHome} without a village,{" "}
                {data.skipped.assignedStopUnpinned} whose stop has no map pin,{" "}
                {data.skipped.noPinnedStopsOnRoute} whose route has none
              </>
            ) : null}
          </p>

          {data.clusters.length > 0 ? (
            <div className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] p-3">
              <p className="text-[11px] font-semibold text-[var(--ink)]">
                Stops several villages have all landed on — likely a bad default in the stop
                picker, fixed once rather than per child:
              </p>
              <ul className="mt-1.5 space-y-1 text-[11px] text-[var(--muted)]">
                {data.clusters.map((c) => (
                  <li key={c.stopId}>
                    <strong className="text-[var(--ink)]">{c.stopName}</strong> ({c.routeLabel}) —{" "}
                    {c.riders} rider{c.riders === 1 ? "" : "s"} from {c.villages.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.flags.length === 0 ? (
            <p className="mt-3 text-[11px] text-[var(--success)]">
              No rider is more than {data.minGapKm} km from a nearer stop on their own bus.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.flags.map((f) => (
                <li
                  key={f.studentId}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-[11px]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[var(--ink)]">{f.fullName}</span>
                    {chip("muted", f.routeLabel)}
                    {chip("info", f.homeLabel)}
                    {f.homePrecision === "village"
                      ? chip("muted", "village centroid")
                      : chip("info", "pinned")}
                    {f.feeChanges === true ? chip("warning", "fee band changes") : null}
                    {f.feeChanges === null ? chip("muted", "fee effect unknown") : null}
                  </div>
                  <div className="mt-1 text-[var(--muted)]">
                    Boards at <strong className="text-[var(--ink)]">{f.assignedStopName}</strong>,{" "}
                    {f.assignedHomeKm} km from home
                    {f.assignedSchoolKm != null ? ` (${f.assignedSchoolKm} km from school)` : ""} ·
                    nearer: <strong className="text-[var(--ink)]">{f.nearestStopName}</strong>,{" "}
                    {f.nearestHomeKm} km
                    {f.nearestSchoolKm != null ? ` (${f.nearestSchoolKm} km from school)` : ""} ·{" "}
                    <strong className="text-[var(--ink)]">{f.gapKm} km closer</strong>
                  </div>
                  {canEdit ? (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy === f.studentId}
                        onClick={() => void pin(f.studentId, f.assignedStopId)}
                        className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--ink)] disabled:opacity-50"
                      >
                        Boards at {f.assignedStopName} — correct as is
                      </button>
                      <button
                        type="button"
                        disabled={busy === f.studentId}
                        onClick={() => void pin(f.studentId, f.nearestStopId)}
                        className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--ink)] disabled:opacity-50"
                      >
                        Actually boards at {f.nearestStopName}
                      </button>
                      {f.homePrecision === "pin" ? (
                        <button
                          type="button"
                          disabled={busy === f.studentId}
                          onClick={() => void clearPin(f.studentId)}
                          className="rounded-lg px-2 py-1 text-[10px] font-semibold text-[var(--muted)] disabled:opacity-50"
                        >
                          Clear pin
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-[10px] text-[var(--muted)]">
            Home is the census centroid of the family&apos;s village unless a boarding point has
            been pinned for that child — right village, not right doorstep, so treat anything under
            a kilometre as noise. A stop&apos;s distance from school sets the fee, so a correction
            marked &quot;fee band changes&quot; changes what the family pays.
          </p>
        </>
      )}
    </section>
  );
}
