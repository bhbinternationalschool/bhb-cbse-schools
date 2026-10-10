"use client";

/**
 * Compliance facts — infrastructure, safety certificates, teacher-training
 * log, committees. What CBSE MPD / affiliation / inspection formats ask
 * for and no other module holds. Feeds the compliance-narrative preset in
 * the Document maker.
 */

import { useEffect, useState } from "react";
import {
  loadComplianceFacts,
  saveComplianceFacts,
  type ComplianceFactsState,
  type ComplianceInfra,
} from "@/lib/complianceFacts";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";

const inp = "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm";

function nid(p: string) {
  return `${p}_${Math.random().toString(36).slice(2, 10)}`;
}

export function ComplianceFactsPanel({ canEdit }: { canEdit: boolean }) {
  const [state, setState] = useState<ComplianceFactsState>(() => loadComplianceFacts());
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useModuleStateHydration("compliance_facts", () => {
    if (!dirty) setState(loadComplianceFacts());
  });
  useEffect(() => {
    const t = notice ? window.setTimeout(() => setNotice(null), 2500) : null;
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [notice]);

  function patchInfra(p: Partial<ComplianceInfra>) {
    setState((s) => ({ ...s, infra: { ...s.infra, ...p } }));
    setDirty(true);
  }
  function save() {
    const next = saveComplianceFacts(state);
    setState(next);
    setDirty(false);
    setNotice("Compliance facts saved");
  }

  const i = state.infra;
  const numField = (label: string, key: keyof ComplianceInfra) => (
    <label className="block text-xs text-[var(--muted)]">
      {label}
      <input
        type="number"
        min={0}
        className={`${inp} mt-0.5`}
        disabled={!canEdit}
        value={Number(i[key]) || 0}
        onChange={(e) => patchInfra({ [key]: Math.max(0, Number(e.target.value) || 0) } as Partial<ComplianceInfra>)}
      />
    </label>
  );
  const dateField = (label: string, key: keyof ComplianceInfra) => (
    <label className="block text-xs text-[var(--muted)]">
      {label}
      <input
        type="date"
        className={`${inp} mt-0.5`}
        disabled={!canEdit}
        value={String(i[key] || "")}
        onChange={(e) => patchInfra({ [key]: e.target.value } as Partial<ComplianceInfra>)}
      />
    </label>
  );
  const boolField = (label: string, key: keyof ComplianceInfra) => (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" disabled={!canEdit} checked={!!i[key]} onChange={(e) => patchInfra({ [key]: e.target.checked } as Partial<ComplianceInfra>)} />
      {label}
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-[var(--muted)]">
          Figures CBSE MPD / affiliation / inspection formats ask for. Used by Document maker → Compliance narrative
          (&ldquo;Insert school facts&rdquo;). Enter only what is true on record.
        </p>
        {canEdit ? (
          <button
            type="button"
            className="ml-auto rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            disabled={!dirty}
            onClick={save}
          >
            Save facts
          </button>
        ) : null}
        {notice ? <span className="text-xs text-[var(--success)]">{notice}</span> : null}
        {state.updatedAt ? <span className="text-[11px] text-[var(--muted)]">Last saved {state.updatedAt.slice(0, 16).replace("T", " ")}</span> : null}
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Infrastructure</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {numField("Classrooms", "classrooms")}
          {numField("Library books", "libraryBooks")}
          {numField("Library computers", "libraryComputers")}
          {numField("Playground (sq m)", "playgroundSqm")}
          {numField("Toilets — boys", "toiletsBoys")}
          {numField("Toilets — girls", "toiletsGirls")}
          {numField("Toilets — CWSN", "toiletsCwsn")}
          {numField("CCTV cameras", "cctvCameras")}
          {numField("School vehicles", "transportVehicles")}
          <label className="block text-xs text-[var(--muted)]">
            Drinking water
            <input className={`${inp} mt-0.5`} disabled={!canEdit} value={i.drinkingWater} onChange={(e) => patchInfra({ drinkingWater: e.target.value })} placeholder="RO + cooler on each floor" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          <span className="text-xs text-[var(--muted)]">Labs:</span>
          {(["physics", "chemistry", "biology", "computer", "maths", "composite"] as const).map((k) => (
            <label key={k} className="inline-flex items-center gap-1.5 text-sm capitalize">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={i.labs[k]}
                onChange={(e) => patchInfra({ labs: { ...i.labs, [k]: e.target.checked } })}
              />
              {k}
            </label>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-4">
          {boolField("Ramps & railings (CWSN)", "rampsAndRails")}
          {boolField("Medical room", "medicalRoom")}
          {boolField("Counsellor available", "counsellorAvailable")}
        </div>
        <label className="mt-3 block text-xs text-[var(--muted)]">
          Note
          <textarea className={`${inp} mt-0.5 min-h-[56px]`} disabled={!canEdit} value={i.note} onChange={(e) => patchInfra({ note: e.target.value })} />
        </label>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Safety certificates · valid till</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {dateField("Fire NOC", "fireNocValidTill")}
          {dateField("Building safety", "buildingSafetyValidTill")}
          {dateField("Health & sanitation", "healthSanitationValidTill")}
          {dateField("Drinking water test", "drinkingWaterTestValidTill")}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Teacher training log</h3>
          {canEdit ? (
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold"
              onClick={() => {
                setState((s) => ({
                  ...s,
                  trainings: [
                    { id: nid("trn"), date: new Date().toISOString().slice(0, 10), title: "", provider: "", hours: 0, participants: 0, who: "", note: "" },
                    ...s.trainings,
                  ],
                }));
                setDirty(true);
              }}
            >
              + Training
            </button>
          ) : null}
        </div>
        {state.trainings.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">No trainings recorded yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {state.trainings.map((t) => (
              <div key={t.id} className="grid gap-2 rounded-lg border border-[var(--border)] p-2 sm:grid-cols-[130px_1fr_1fr_80px_90px_auto]">
                <input type="date" className={inp} disabled={!canEdit} value={t.date} onChange={(e) => { setState((s) => ({ ...s, trainings: s.trainings.map((x) => (x.id === t.id ? { ...x, date: e.target.value } : x)) })); setDirty(true); }} />
                <input className={inp} placeholder="Title (e.g. CBSE Competency-based assessment)" disabled={!canEdit} value={t.title} onChange={(e) => { setState((s) => ({ ...s, trainings: s.trainings.map((x) => (x.id === t.id ? { ...x, title: e.target.value } : x)) })); setDirty(true); }} />
                <input className={inp} placeholder="Provider (CBSE CoE / DIKSHA / in-house)" disabled={!canEdit} value={t.provider} onChange={(e) => { setState((s) => ({ ...s, trainings: s.trainings.map((x) => (x.id === t.id ? { ...x, provider: e.target.value } : x)) })); setDirty(true); }} />
                <input type="number" min={0} className={inp} placeholder="Hours" disabled={!canEdit} value={t.hours || ""} onChange={(e) => { setState((s) => ({ ...s, trainings: s.trainings.map((x) => (x.id === t.id ? { ...x, hours: Number(e.target.value) || 0 } : x)) })); setDirty(true); }} />
                <input type="number" min={0} className={inp} placeholder="People" disabled={!canEdit} value={t.participants || ""} onChange={(e) => { setState((s) => ({ ...s, trainings: s.trainings.map((x) => (x.id === t.id ? { ...x, participants: Number(e.target.value) || 0 } : x)) })); setDirty(true); }} />
                {canEdit ? (
                  <button type="button" className="text-xs text-[var(--danger)]" onClick={() => { setState((s) => ({ ...s, trainings: s.trainings.filter((x) => x.id !== t.id) })); setDirty(true); }}>
                    ✕
                  </button>
                ) : <span />}
                <input className={`${inp} sm:col-span-6`} placeholder="Who attended (names / departments) · note" disabled={!canEdit} value={t.who} onChange={(e) => { setState((s) => ({ ...s, trainings: s.trainings.map((x) => (x.id === t.id ? { ...x, who: e.target.value } : x)) })); setDirty(true); }} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Committees (SMC, PTA, POCSO, anti-bullying, grievance…)</h3>
          {canEdit ? (
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold"
              onClick={() => {
                setState((s) => ({ ...s, committees: [...s.committees, { id: nid("cmt"), name: "", members: "", lastMeetingOn: "", note: "" }] }));
                setDirty(true);
              }}
            >
              + Committee
            </button>
          ) : null}
        </div>
        {state.committees.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">No committees recorded yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {state.committees.map((c) => (
              <div key={c.id} className="grid gap-2 rounded-lg border border-[var(--border)] p-2 sm:grid-cols-[1fr_2fr_140px_auto]">
                <input className={inp} placeholder="Committee" disabled={!canEdit} value={c.name} onChange={(e) => { setState((s) => ({ ...s, committees: s.committees.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) })); setDirty(true); }} />
                <input className={inp} placeholder="Members" disabled={!canEdit} value={c.members} onChange={(e) => { setState((s) => ({ ...s, committees: s.committees.map((x) => (x.id === c.id ? { ...x, members: e.target.value } : x)) })); setDirty(true); }} />
                <input type="date" className={inp} disabled={!canEdit} value={c.lastMeetingOn} onChange={(e) => { setState((s) => ({ ...s, committees: s.committees.map((x) => (x.id === c.id ? { ...x, lastMeetingOn: e.target.value } : x)) })); setDirty(true); }} />
                {canEdit ? (
                  <button type="button" className="text-xs text-[var(--danger)]" onClick={() => { setState((s) => ({ ...s, committees: s.committees.filter((x) => x.id !== c.id) })); setDirty(true); }}>
                    ✕
                  </button>
                ) : <span />}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
