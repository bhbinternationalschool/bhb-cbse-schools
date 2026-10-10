"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ASSISTANCE_LABEL,
  emptyFinanceYear,
  financeTotal,
  normalizeFinanceYear,
  type AssistanceSource,
  type FinanceYear,
} from "@/lib/udiseSchoolFinance";

const ENDPOINT = "/api/v1/udise/robot/school-finance";

/** "2026-27" session → "2025-26", the year UDISE+ 1(c) asks about. */
function lastYear(): string {
  const d = new Date();
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start - 1}-${String(start % 100).padStart(2, "0")}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const inr = (v: string) => (v ? `₹${Number(v).toLocaleString("en-IN")}` : "—");

/**
 * Students → UDISE+ → the figures for UDISE+ School Profile 1(c) "Receipts
 * and Expenditure" (previous year). Typed once from the audited accounts /
 * ITR-7 — the ERP's own books do not hold a complete 2025-26 — confirmed by
 * a named person; the robot fills the portal from them.
 */
export function UdiseSchoolFinanceCard() {
  const [year, setYear] = useState(lastYear());
  const [years, setYears] = useState<Record<string, FinanceYear>>({});
  const [draft, setDraft] = useState<FinanceYear>(emptyFinanceYear());
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        const body = (await res.json()) as { ok: boolean; error?: string; years?: Record<string, FinanceYear> };
        if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setYears(body.years || {});
        setState("ready");
      } catch (e) {
        setState("error");
        setMsg(e instanceof Error ? e.message : "Could not load");
      }
    })();
  }, []);

  useEffect(() => {
    setDraft(years[year] ? normalizeFinanceYear(years[year]) : emptyFinanceYear());
  }, [year, years]);

  const saved = years[year];
  const total = useMemo(() => financeTotal(normalizeFinanceYear(draft)), [draft]);
  const set = (patch: Partial<FinanceYear>) => setDraft((d) => ({ ...d, ...patch }));
  const setA = (k: AssistanceSource, patch: Partial<FinanceYear["assistance"][AssistanceSource]>) =>
    setDraft((d) => ({ ...d, assistance: { ...d.assistance, [k]: { ...d.assistance[k], ...patch } } }));

  async function save() {
    setState("saving");
    setMsg("");
    try {
      const res = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, figures: draft }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string; years?: Record<string, FinanceYear> };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setYears(body.years || {});
      setMsg("Saved and confirmed. The robot uses these on UDISE+ → School Profile → 1.59 to 1.62.");
    } catch (e) {
      setMsg(`Not saved: ${e instanceof Error ? e.message : "try again"}`);
    } finally {
      setState("ready");
    }
  }

  const box = "field !py-1.5 w-full text-right tabular-nums";
  const heads: { k: "maintenance" | "teachers" | "construction" | "others"; label: string }[] = [
    { k: "maintenance", label: "Maintenance / housekeeping" },
    { k: "teachers", label: "Teachers (salaries)" },
    { k: "construction", label: "Construction works" },
    { k: "others", label: "Others" },
  ];
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="UDISE receipts and expenditure">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Robot — UDISE+ 1(c) receipts &amp; expenditure</h3>
        <label className="text-xs text-[var(--muted)]">
          Financial year{" "}
          <select className="field !w-auto !py-1" value={year} onChange={(e) => setYear(e.target.value)}>
            {[lastYear(), ...Object.keys(years)]
              .filter((v, i, a) => a.indexOf(v) === i)
              .sort()
              .reverse()
              .map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        UDISE+ asks for the previous year&apos;s spending and any outside help. Take the figures from the <strong>audited accounts / ITR-7</strong>{" "}
        — the ERP&apos;s own books do not hold a complete {year}. Once confirmed, the robot fills these boxes on the portal (outlined, for you to
        check and Save).
        {saved?.confirmedAt ? ` Confirmed by ${saved.confirmedBy}, ${when(saved.confirmedAt)}.` : " Not confirmed yet."}
      </p>
      {state === "error" ? (
        <p className="mt-2 text-xs text-[var(--danger)]">{msg}</p>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {heads.map((h) => (
              <label key={h.k} className="block text-[11px] font-semibold text-[var(--muted)]">
                {h.label} (₹)
                <input className={box} inputMode="numeric" value={draft[h.k]} onChange={(e) => set({ [h.k]: e.target.value } as Partial<FinanceYear>)} />
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-[var(--brand-deep)]">Total expenditure: {inr(total)}</p>
          <p className="mt-3 text-[11px] font-semibold text-[var(--muted)]">Financial assistance received in {year}</p>
          <div className="mt-1 space-y-1.5">
            {(Object.keys(ASSISTANCE_LABEL) as AssistanceSource[]).map((k) => {
              const a = draft.assistance[k];
              return (
                <div key={k} className="grid grid-cols-[1fr_6rem] gap-2 sm:grid-cols-[12rem_6rem_1fr_8rem]">
                  <span className="self-center text-xs">{ASSISTANCE_LABEL[k]}</span>
                  <select
                    className="field !py-1"
                    value={a.received === null ? "" : a.received ? "yes" : "no"}
                    onChange={(e) => setA(k, { received: e.target.value === "" ? null : e.target.value === "yes" })}
                    aria-label={`${ASSISTANCE_LABEL[k]} received?`}
                  >
                    <option value="">—</option>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                  {a.received ? (
                    <>
                      <input className="field !py-1" placeholder="Name" value={a.name} onChange={(e) => setA(k, { name: e.target.value })} />
                      <input className={box} placeholder="₹" inputMode="numeric" value={a.amount} onChange={(e) => setA(k, { amount: e.target.value })} />
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
          <label className="mt-3 block text-[11px] font-semibold text-[var(--muted)]">
            Source of these figures
            <input className="field !py-1.5 w-full" placeholder="e.g. Audited accounts FY 2025-26 (ITR-7)" value={draft.source} onChange={(e) => set({ source: e.target.value })} />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={state !== "ready"} onClick={() => void save()}>
              {state === "saving" ? "Saving…" : `Confirm ${year} figures`}
            </button>
            {msg ? <span className="text-xs text-[var(--muted)]">{msg}</span> : null}
          </div>
        </>
      )}
    </section>
  );
}
