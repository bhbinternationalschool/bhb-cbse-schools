"use client";

import { useState } from "react";
import {
  MastersTableCard,
  MastersTablesRow,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import type { MastersState } from "@/lib/masters";
import {
  normalizeStatutoryConfig,
  type StatutoryEstablishmentConfig,
  type StatutoryPenaltySlab,
} from "@/lib/foundationMasters";

type Commit = (s: MastersState, msg?: string) => void;

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className || ""}`}>
      <span className="mb-1 block text-[11px] text-[var(--muted)]">{label}</span>
      <input
        className="field !py-1.5"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function SlabEditor({
  label,
  slabs,
  onChange,
}: {
  label: string;
  slabs: StatutoryPenaltySlab[];
  onChange: (next: StatutoryPenaltySlab[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-[var(--brand-deep)]">{label}</span>
        <button
          type="button"
          className="text-[11px] font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
          onClick={() =>
            onChange([...slabs, { maxDelayDays: 30, ratePctPerAnnum: 5 }])
          }
        >
          + Add slab
        </button>
      </div>
      <div className="space-y-1.5">
        {slabs.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--muted)]">Up to</span>
            <input
              type="number"
              className="field !py-1 !w-24 text-xs"
              value={s.maxDelayDays}
              onChange={(e) =>
                onChange(
                  slabs.map((x, j) =>
                    j === i ? { ...x, maxDelayDays: Number(e.target.value) || 0 } : x,
                  ),
                )
              }
            />
            <span className="text-[11px] text-[var(--muted)]">days overdue →</span>
            <input
              type="number"
              step="0.1"
              className="field !py-1 !w-20 text-xs"
              value={s.ratePctPerAnnum}
              onChange={(e) =>
                onChange(
                  slabs.map((x, j) =>
                    j === i
                      ? { ...x, ratePctPerAnnum: Number(e.target.value) || 0 }
                      : x,
                  ),
                )
              }
            />
            <span className="text-[11px] text-[var(--muted)]">% p.a.</span>
            <button
              type="button"
              className="ml-auto text-[11px] font-medium text-[#b42318]"
              onClick={() => onChange(slabs.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Establishment-level EPF/ESIC identity, rates, and estimated-penalty config. */
export function StatutoryConfigPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const config = normalizeStatutoryConfig(state.statutoryConfig);
  const [draft, setDraft] = useState<StatutoryEstablishmentConfig>(config);

  function set<K extends keyof StatutoryEstablishmentConfig>(
    key: K,
    value: StatutoryEstablishmentConfig[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setPenalty<K extends keyof StatutoryEstablishmentConfig["penalty"]>(
    key: K,
    value: StatutoryEstablishmentConfig["penalty"][K],
  ) {
    setDraft((d) => ({ ...d, penalty: { ...d.penalty, [key]: value } }));
  }

  return (
    <div className="space-y-6">
      <MastersTablesRow>
        <MastersTableCard title="EPF">
          <dl className="divide-y divide-[rgba(32,48,80,0.08)] text-sm">
            {(
              [
                ["Establishment ID", draft.epfEstablishmentId || "—"],
                ["LIN", draft.epfLin || "—"],
                ["Contribution rate", `${draft.epfContributionRatePct}%`],
                ["Wage ceiling", draft.applyEpfWageCeiling ? `₹${draft.epfWageCeiling}` : "Not applied"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 px-4 py-2.5">
                <dt className="text-[11px] text-[var(--muted)]">{k}</dt>
                <dd className="text-right font-medium text-[var(--brand-deep)]">{v}</dd>
              </div>
            ))}
          </dl>
        </MastersTableCard>
        <MastersTableCard title="ESIC">
          <dl className="divide-y divide-[rgba(32,48,80,0.08)] text-sm">
            {(
              [
                ["Employer code", draft.esicEmployerCode || "—"],
                ["Wage ceiling", `₹${draft.esicWageCeiling}`],
                ["Employee rate", `${draft.esicEmployeeRatePct}%`],
                ["Employer rate", `${draft.esicEmployerRatePct}%`],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 px-4 py-2.5">
                <dt className="text-[11px] text-[var(--muted)]">{k}</dt>
                <dd className="text-right font-medium text-[var(--brand-deep)]">{v}</dd>
              </div>
            ))}
          </dl>
        </MastersTableCard>
      </MastersTablesRow>

      <MastersWorkCard
        title="Statutory setup (EPF / ESIC)"
        hint="Establishment identity, rates, wage ceilings, and estimated late-payment penalty slabs. Rates are editable because EPFO/ESIC revise them by circular — figures computed from these are estimates, not the authority's final levy."
      >
        <div className="space-y-5">
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">EPF</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Establishment ID" value={draft.epfEstablishmentId} onChange={(v) => set("epfEstablishmentId", v)} />
              <Field label="LIN" value={draft.epfLin} onChange={(v) => set("epfLin", v)} />
              <Field label="Contribution rate (%)" type="number" value={String(draft.epfContributionRatePct)} onChange={(v) => set("epfContributionRatePct", Number(v) || 0)} />
              <Field label="Wage ceiling (₹)" type="number" value={String(draft.epfWageCeiling)} onChange={(v) => set("epfWageCeiling", Number(v) || 0)} />
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={draft.applyEpfWageCeiling}
                  onChange={(e) => set("applyEpfWageCeiling", e.target.checked)}
                />
                <span className="text-[11px] text-[var(--muted)]">
                  Apply the wage ceiling when splitting EPS/EDLI (recommended)
                </span>
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">ESIC</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Employer code" value={draft.esicEmployerCode} onChange={(v) => set("esicEmployerCode", v)} />
              <Field label="Wage ceiling (₹)" type="number" value={String(draft.esicWageCeiling)} onChange={(v) => set("esicWageCeiling", Number(v) || 0)} />
              <Field label="Employee rate (%)" type="number" value={String(draft.esicEmployeeRatePct)} onChange={(v) => set("esicEmployeeRatePct", Number(v) || 0)} />
              <Field label="Employer rate (%)" type="number" value={String(draft.esicEmployerRatePct)} onChange={(v) => set("esicEmployerRatePct", Number(v) || 0)} />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Estimated penalty — EPF
            </h3>
            <Field
              label="Interest rate (% p.a.)"
              type="number"
              value={String(draft.penalty.interestRatePctPerAnnum)}
              onChange={(v) => setPenalty("interestRatePctPerAnnum", Number(v) || 0)}
              className="max-w-xs"
            />
            <SlabEditor
              label="Damages slabs (by days overdue)"
              slabs={draft.penalty.damageSlabs}
              onChange={(next) => setPenalty("damageSlabs", next)}
            />
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Estimated penalty — ESIC
            </h3>
            <Field
              label="Interest rate (% p.a.)"
              type="number"
              value={String(draft.penalty.esicInterestRatePctPerAnnum)}
              onChange={(v) => setPenalty("esicInterestRatePctPerAnnum", Number(v) || 0)}
              className="max-w-xs"
            />
            <SlabEditor
              label="Damages slabs (by days overdue)"
              slabs={draft.penalty.esicDamageSlabs}
              onChange={(next) => setPenalty("esicDamageSlabs", next)}
            />
          </section>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Circular reference note
            </span>
            <textarea
              className="field !h-16 w-full !py-1.5"
              value={draft.penalty.circularNote}
              onChange={(e) => setPenalty("circularNote", e.target.value)}
              placeholder="As per EPFO/ESIC circular dated …"
            />
          </label>

          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-sm font-semibold text-white"
            onClick={() =>
              commit(
                { ...state, statutoryConfig: normalizeStatutoryConfig(draft) },
                "Statutory setup saved",
              )
            }
          >
            Save statutory setup
          </button>
        </div>
      </MastersWorkCard>
    </div>
  );
}
