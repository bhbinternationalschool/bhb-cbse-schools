"use client";

import { useMemo, useState } from "react";
import { formatInr } from "@/lib/fees";
import type { MastersState } from "@/lib/masters";
import type { SisState } from "@/lib/sis";
import type { TransportState } from "@/lib/transport";
import { buildStudentTransportProfiles } from "@/lib/transportPlanner";
import {
  findBrokenStopLinks,
  relinkStopGroup,
  suggestStopsForGroup,
  type BrokenStopGroup,
} from "@/lib/transportStopLinks";

/**
 * Repair broken stop links, one group at a time.
 *
 * The riders sharing an orphaned stop id were standing at the same real stop.
 * That grouping survived and is the only hard evidence left — which stop it
 * was did not, and nothing here pretends otherwise. Each group is presented
 * with what IS known (how many riders, what they pay, where their families
 * live) and a ranked list of candidates with the reasoning shown, so the
 * office decides and the screen explains.
 *
 * Nothing is auto-applied. This data has been lost once already; a bulk
 * "best guess" would write inferred stops into billing records that nobody
 * checked, and the wrong stop is worse than a visibly missing one — it looks
 * settled.
 */
export function StopLinkRepairPanel({
  state,
  masters,
  sis,
  academicYearCode,
  onDone,
}: {
  state: TransportState;
  masters: MastersState | null;
  sis: SisState | null;
  academicYearCode: string;
  onDone: () => void;
}) {
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<Record<string, string>>({});

  const report = useMemo(() => {
    if (!sis || !masters) return null;
    const profiles = buildStudentTransportProfiles(
      sis,
      masters,
      state,
      academicYearCode,
    );
    return findBrokenStopLinks(state, profiles);
  }, [state, sis, masters, academicYearCode]);

  const nameById = useMemo(
    () => new Map((sis?.students ?? []).map((s) => [s.id, s.fullName])),
    [sis],
  );

  if (!sis || !masters) {
    return (
      <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
        Waiting for the student roster. Repairs need it — the households&rsquo;
        locations are what rank the suggestions.
      </p>
    );
  }

  if (!report || report.groups.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm font-semibold text-[var(--success)]">
          Every rider resolves to a real stop.
        </p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          {report?.ridersHealthy ?? 0} live assignments checked.
        </p>
        <button
          type="button"
          className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
          onClick={onDone}
        >
          Back to riders by bus
        </button>
      </div>
    );
  }

  function apply(group: BrokenStopGroup, key: string) {
    setError("");
    setFlash("");
    const toStopId = choice[key];
    if (!toStopId) {
      setError("Pick a stop for this group first");
      return;
    }
    const r = relinkStopGroup({
      routeId: group.routeId,
      orphanStopId: group.orphanStopId,
      toStopId,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setFlash(
      `${r.relinked} rider${r.relinked === 1 ? "" : "s"} relinked. Their fee was left exactly as it was — check the shortfall column now that a distance exists.`,
    );
    setChoice((c) => {
      const next = { ...c };
      delete next[key];
      return next;
    });
  }

  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Repair stop links
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {report.ridersAffected} rider
              {report.ridersAffected === 1 ? "" : "s"} across{" "}
              {report.routesAffected} bus
              {report.routesAffected === 1 ? "" : "es"}, in{" "}
              {report.groups.length} group
              {report.groups.length === 1 ? "" : "s"} ·{" "}
              {report.ridersHealthy} rider
              {report.ridersHealthy === 1 ? "" : "s"} already fine
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
            onClick={onDone}
          >
            Back to riders by bus
          </button>
        </div>
        <p className="mt-3 text-[11px] text-[var(--muted)]">
          The riders in each group were at the same stop — that much survived.
          Which stop it was did not, so pick it. Suggestions are ranked by how
          near the stop is to where these families actually live and whether
          its price matches what they already pay; both reasons are shown.
          Fees are never changed by a repair.
        </p>
        {flash ? (
          <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--success)_45%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--ink)]">
            {flash}
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-[11px] font-semibold text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </section>

      {report.groups.map((g) => {
        const key = `${g.routeId}::${g.orphanStopId}`;
        const route = state.routes.find((r) => r.id === g.routeId);
        const candidates = route ? suggestStopsForGroup(g, route) : [];
        const names = g.studentIds
          .map((id) => nameById.get(id) || id)
          .slice(0, 6);
        return (
          <section
            key={key}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                {g.routeLabel}
              </h3>
              <span className="text-[11px] font-semibold text-[var(--ink)]">
                {g.riderCount} rider{g.riderCount === 1 ? "" : "s"}
              </span>
              <span className="text-[11px] text-[var(--muted)]">
                {g.feesPaise.length
                  ? `paying ${g.feesPaise.map((f) => formatInr(f)).join(" / ")}`
                  : "no fee set"}
                {" · "}
                {g.geoCount} of {g.riderCount} household
                {g.riderCount === 1 ? "" : "s"} pinned
              </span>
            </div>

            <p className="mt-1 text-[11px] text-[var(--muted)]">
              {names.join(", ")}
              {g.studentIds.length > names.length
                ? ` and ${g.studentIds.length - names.length} more`
                : ""}
            </p>

            {g.centroid ? (
              <a
                className="mt-1 inline-block text-[11px] font-semibold text-[var(--brand-mid)] underline"
                target="_blank"
                rel="noreferrer"
                href={`https://www.google.com/maps?q=${g.centroid.lat},${g.centroid.lng}`}
              >
                📍 where these families live
              </a>
            ) : (
              <p className="mt-1 text-[11px] text-[var(--warning)]">
                No household is pinned, so suggestions below are ordered by
                price alone — worth checking against the register.
              </p>
            )}

            <div className="mt-3 grid gap-2">
              {candidates.length === 0 ? (
                <p className="text-[11px] text-[var(--danger)]">
                  This route has no stops to link to. Add them first.
                </p>
              ) : (
                candidates.map((c, i) => (
                  <label
                    key={c.stop.id}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] hover:bg-[var(--surface-sunken)]"
                  >
                    <input
                      type="radio"
                      name={key}
                      className="mt-0.5"
                      checked={choice[key] === c.stop.id}
                      onChange={() =>
                        setChoice((prev) => ({ ...prev, [key]: c.stop.id }))
                      }
                    />
                    <span className="min-w-0">
                      <span className="font-semibold text-[var(--ink)]">
                        {c.stop.name}
                      </span>
                      {i === 0 ? (
                        <span className="ml-1 rounded bg-[var(--surface-sunken)] px-1 text-[9px] font-bold uppercase text-[var(--muted)]">
                          best match
                        </span>
                      ) : null}
                      <span className="ml-2 text-[var(--muted)]">
                        {c.reason}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>

            <button
              type="button"
              className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-bold text-[var(--primary-foreground)] disabled:opacity-50"
              disabled={!choice[key]}
              onClick={() => apply(g, key)}
            >
              Link {g.riderCount} rider{g.riderCount === 1 ? "" : "s"} to this
              stop
            </button>
          </section>
        );
      })}
    </div>
  );
}
