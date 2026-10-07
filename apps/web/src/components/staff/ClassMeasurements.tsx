"use client";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ageYears, checkMeasurement } from "@/lib/studentMeasurements";

export type MeasureRow = {
  id: string;
  revisionAt: string;
  fields: Record<string, string>;
  measure: { heightCm: string; weightKg: string; measuredOn: string };
};

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function dmy(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * My class → Height & weight. The class teacher measures each child with a
 * tape and a scale and types the figures here, one list for the whole class,
 * one Save. The UDISE robot then fills them on the portal from the ERP.
 * Figures are measured, never estimated (director, 7 Oct 2026).
 */
export function ClassMeasurements({ rows, onSaved }: { rows: MeasureRow[]; onSaved: () => void }) {
  const today = istToday();
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<Record<string, { h: string; w: string }>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, { h: r.measure.heightCm, w: r.measure.weightKg }])),
  );
  const [result, setResult] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const state = useMemo(
    () =>
      rows.map((r) => {
        const d = draft[r.id] ?? { h: "", w: "" };
        const dirty = d.h.trim() !== r.measure.heightCm || d.w.trim() !== r.measure.weightKg;
        const check = checkMeasurement(d.h, d.w);
        return { r, d, dirty, check };
      }),
    [rows, draft],
  );
  const toSave = state.filter((x) => x.dirty && x.check.ok && (x.d.h.trim() || x.d.w.trim()));
  const withErrors = state.filter((x) => x.dirty && !x.check.ok).length;
  const measured = rows.filter((r) => r.measure.heightCm && r.measure.weightKg).length;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/staff/class-measurements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          measuredOn: date,
          rows: toSave.map((x) => ({ id: x.r.id, revisionAt: x.r.revisionAt, heightCm: x.d.h, weightKg: x.d.w })),
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: { saved: number; results: { id: string; ok: boolean; error?: string }[] };
        error?: { message?: string } | string;
      } | null;
      if (!res.ok || !body?.ok || !body.data) {
        const err = typeof body?.error === "string" ? body.error : body?.error?.message;
        setMsg({ ok: false, text: err || `Not saved (server said ${res.status})` });
        return;
      }
      const next: Record<string, { ok: boolean; text: string }> = {};
      for (const x of body.data.results) next[x.id] = { ok: x.ok, text: x.ok ? "Saved" : x.error || "Not saved" };
      setResult(next);
      const failed = body.data.results.length - body.data.saved;
      setMsg({
        ok: failed === 0,
        text: failed ? `Saved ${body.data.saved}; ${failed} not saved — see the red notes` : `Saved ${body.data.saved} child${body.data.saved === 1 ? "" : "ren"}`,
      });
      if (body.data.saved) onSaved();
    } catch {
      setMsg({ ok: false, text: "Could not reach the school server — nothing lost, press Save again" });
    } finally {
      setBusy(false);
    }
  }

  const box = "field !py-2 w-full text-right tabular-nums";
  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
        <p className="font-semibold text-[var(--brand-deep)]">
          Measured: {measured} of {rows.length}
        </p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Measure each child — height in cm with shoes off, weight in kg — and type it here. Please measure; don&apos;t
          guess from age. These go to the child&apos;s record and to UDISE+.
        </p>
        <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-[var(--muted)]">
          Measured on
          <input type="date" className="field !w-auto !py-1.5" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </label>
      </div>

      <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <li className="grid grid-cols-[1fr_5rem_5rem] gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
          <span>Child</span>
          <span className="text-right">Height cm</span>
          <span className="text-right">Weight kg</span>
        </li>
        {state.map(({ r, d, dirty, check }) => {
          const age = ageYears(r.fields.dob || "", today);
          const res = result[r.id];
          return (
            <li key={r.id} className="px-3 py-2">
              <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[var(--brand-deep)]">
                    {r.fields.rollNo ? `${r.fields.rollNo}. ` : ""}
                    {r.fields.fullName}
                  </span>
                  <span className="block text-[11px] text-[var(--muted)]">
                    {age !== null ? `${age} y` : "age —"}
                    {r.measure.measuredOn ? ` · last ${dmy(r.measure.measuredOn)}` : ""}
                  </span>
                </span>
                <input
                  className={box}
                  inputMode="decimal"
                  aria-label={`${r.fields.fullName} height in cm`}
                  placeholder="cm"
                  value={d.h}
                  onChange={(e) => setDraft((x) => ({ ...x, [r.id]: { ...d, h: e.target.value } }))}
                />
                <input
                  className={box}
                  inputMode="decimal"
                  aria-label={`${r.fields.fullName} weight in kg`}
                  placeholder="kg"
                  value={d.w}
                  onChange={(e) => setDraft((x) => ({ ...x, [r.id]: { ...d, w: e.target.value } }))}
                />
              </div>
              {dirty && !check.ok ? (
                <p className="mt-1 text-[11px] text-[var(--danger)]">{check.error}</p>
              ) : res && !dirty ? (
                <p className={`mt-1 flex items-center gap-1 text-[11px] ${res.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                  {res.ok ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : null}
                  {res.text}
                </p>
              ) : res && !res.ok ? (
                <p className="mt-1 text-[11px] text-[var(--danger)]">{res.text}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-24 z-10 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-sm">
        <button
          type="button"
          disabled={busy || toSave.length === 0}
          onClick={() => void save()}
          className="min-h-11 w-full rounded-xl bg-[var(--primary)] px-3 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-40"
        >
          {busy ? "Saving…" : toSave.length ? `Save ${toSave.length} child${toSave.length === 1 ? "" : "ren"}` : "Nothing new to save"}
        </button>
        {withErrors ? (
          <p className="mt-1 text-center text-[11px] text-[var(--danger)]">
            {withErrors} child{withErrors === 1 ? "" : "ren"} with a figure to fix — not included
          </p>
        ) : null}
        {msg ? (
          <p className={`mt-1 text-center text-[11px] ${msg.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</p>
        ) : null}
      </div>
    </div>
  );
}
