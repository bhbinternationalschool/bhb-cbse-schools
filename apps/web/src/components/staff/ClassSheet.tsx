"use client";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  checkSheetRow,
  EDUCATION_LEVELS,
  GROUP_KEYS,
  MOTHER_TONGUE_SUGGESTIONS,
  RELIGIONS,
  SHEET_GROUPS,
  type SheetGroup,
  type SheetValues,
} from "@/lib/classDetailsSheet";
import { BLOOD_GROUPS, normalizeBloodGroup, STUDENT_CATEGORIES } from "@/lib/sis";
import { ageYears } from "@/lib/studentMeasurements";

export type SheetRow = {
  id: string;
  revisionAt: string;
  fields: Record<string, string>;
  measure: { heightCm: string; weightKg: string; measuredOn: string };
  sheet: { fatherQualification: string; motherQualification: string; isCwsn: boolean };
};

type Draft = Required<SheetValues>;

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function dmy(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function initial(r: SheetRow): Draft {
  return {
    heightCm: r.measure.heightCm,
    weightKg: r.measure.weightKg,
    // "B(+)" from the old import shows — and is kept — as "B+".
    bloodGroup: normalizeBloodGroup(r.fields.bloodGroup || "") || r.fields.bloodGroup || "",
    motherTongue: r.fields.motherTongue || "",
    religion: r.fields.religion || "",
    category: r.fields.category || "",
    fatherQualification: r.sheet.fatherQualification,
    motherQualification: r.sheet.motherQualification,
    isCwsn: r.sheet.isCwsn,
  };
}

/** Is this group filled in for the child? */
function filled(d: Draft, g: SheetGroup): boolean {
  if (g === "measure") return !!d.heightCm && !!d.weightKg;
  if (g === "blood") return !!d.bloodGroup;
  if (g === "family") return !!d.motherTongue && !!d.religion && !!d.category;
  if (g === "education") return !!d.fatherQualification && !!d.motherQualification;
  return true; // CWSN: unticked is an answer here
}

/** Options for a select, keeping an old value the ERP already holds. */
function withCurrent(list: readonly string[], cur: string): string[] {
  return cur && !list.includes(cur) ? [cur, ...list] : [...list];
}

/**
 * My class → Class sheet. The UDISE+ details a class teacher collects for
 * the whole class in one sitting: measured height and weight, blood group,
 * mother tongue, religion, category, parents' education, CWSN. Pick the
 * columns, fill the list, one Save. The UDISE robot fills the portal from
 * these. Height and weight are measured, never estimated (director, 7 Oct 2026).
 */
export function ClassSheet({ rows, onSaved }: { rows: SheetRow[]; onSaved: () => void }) {
  const today = istToday();
  const [groups, setGroups] = useState<SheetGroup[]>(["measure", "blood"]);
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<Record<string, Draft>>(() => Object.fromEntries(rows.map((r) => [r.id, initial(r)])));
  const [result, setResult] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (g: SheetGroup) =>
    setGroups((x) => (x.includes(g) ? (x.length > 1 ? x.filter((y) => y !== g) : x) : [...x, g]));

  const state = useMemo(
    () =>
      rows.map((r) => {
        const base = initial(r);
        const d = draft[r.id] ?? base;
        const send: Record<string, unknown> = {};
        for (const g of groups) {
          const keys = GROUP_KEYS[g];
          if (!keys.some((k) => d[k] !== base[k])) continue;
          // Height and weight travel together; other keys only when changed.
          for (const k of keys) if (g === "measure" || d[k] !== base[k]) send[k] = d[k];
        }
        const dirty = Object.keys(send).length > 0;
        const check = dirty ? checkSheetRow(send, base) : ({ ok: true, values: {} } as const);
        return { r, d, send, dirty, check };
      }),
    [rows, draft, groups],
  );
  const toSave = state.filter((x) => x.dirty && x.check.ok);
  const withErrors = state.filter((x) => x.dirty && !x.check.ok).length;
  const complete = rows.filter((r) => groups.every((g) => filled(initial(r), g))).length;

  const set = (id: string, patch: Partial<Draft>) =>
    setDraft((x) => ({ ...x, [id]: { ...(x[id] as Draft), ...patch } }));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/staff/class-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          measuredOn: date,
          rows: toSave.map((x) => ({ id: x.r.id, revisionAt: x.r.revisionAt, values: x.send })),
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
        text: failed
          ? `Saved ${body.data.saved}; ${failed} not saved — see the red notes`
          : `Saved ${body.data.saved} child${body.data.saved === 1 ? "" : "ren"}`,
      });
      if (body.data.saved) onSaved();
    } catch {
      setMsg({ ok: false, text: "Could not reach the school server — nothing lost, press Save again" });
    } finally {
      setBusy(false);
    }
  }

  const box = "field !py-2 w-full";
  const label = "block text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]";
  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
        <p className="text-[11px] font-semibold text-[var(--muted)]">What are you filling today?</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {SHEET_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => toggle(g.id)}
              aria-pressed={groups.includes(g.id)}
              className={`min-h-9 rounded-full px-3 text-xs font-semibold ${
                groups.includes(g.id)
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "border border-[var(--border)] text-[var(--brand-deep)]"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--muted)]">
          {SHEET_GROUPS.filter((g) => groups.includes(g.id)).map((g) => (
            <li key={g.id}>
              <strong className="text-[var(--brand-deep)]">{g.label}:</strong> {g.hint}
            </li>
          ))}
        </ul>
        <p className="mt-2 font-semibold text-[var(--brand-deep)]">
          Complete for these columns: {complete} of {rows.length}
        </p>
        {groups.includes("measure") ? (
          <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-[var(--muted)]">
            Measured on
            <input type="date" className="field !w-auto !py-1.5" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
          </label>
        ) : null}
      </div>

      <datalist id="class-sheet-tongues">
        {MOTHER_TONGUE_SUGGESTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--card)]">
        {state.map(({ r, d, dirty, check }) => {
          const age = ageYears(r.fields.dob || "", today);
          const res = result[r.id];
          const name = r.fields.fullName;
          return (
            <li key={r.id} className="px-3 py-2.5">
              <p className="text-sm font-semibold text-[var(--brand-deep)]">
                {r.fields.rollNo ? `${r.fields.rollNo}. ` : ""}
                {name}
                <span className="ml-2 text-[11px] font-normal text-[var(--muted)]">
                  {age !== null ? `${age} y` : "age —"}
                  {groups.includes("measure") && r.measure.measuredOn ? ` · measured ${dmy(r.measure.measuredOn)}` : ""}
                </span>
              </p>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {groups.includes("measure") ? (
                  <>
                    <label className={label}>
                      Height cm
                      <input className={`${box} text-right tabular-nums`} inputMode="decimal" aria-label={`${name} height in cm`} placeholder="cm" value={d.heightCm} onChange={(e) => set(r.id, { heightCm: e.target.value })} />
                    </label>
                    <label className={label}>
                      Weight kg
                      <input className={`${box} text-right tabular-nums`} inputMode="decimal" aria-label={`${name} weight in kg`} placeholder="kg" value={d.weightKg} onChange={(e) => set(r.id, { weightKg: e.target.value })} />
                    </label>
                  </>
                ) : null}
                {groups.includes("blood") ? (
                  <label className={label}>
                    Blood group
                    <select className={box} aria-label={`${name} blood group`} value={d.bloodGroup} onChange={(e) => set(r.id, { bloodGroup: e.target.value })}>
                      {withCurrent(BLOOD_GROUPS, d.bloodGroup).map((b) => (
                        <option key={b} value={b}>
                          {b || "Not known"}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {groups.includes("family") ? (
                  <>
                    <label className={label}>
                      Mother tongue
                      <input className={box} list="class-sheet-tongues" aria-label={`${name} mother tongue`} placeholder="HINDI" value={d.motherTongue} onChange={(e) => set(r.id, { motherTongue: e.target.value.toUpperCase() })} />
                    </label>
                    <label className={label}>
                      Religion
                      <select className={box} aria-label={`${name} religion`} value={d.religion} onChange={(e) => set(r.id, { religion: e.target.value })}>
                        <option value="">—</option>
                        {withCurrent(RELIGIONS, d.religion).map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={label}>
                      Category
                      <select className={box} aria-label={`${name} category`} value={d.category} onChange={(e) => set(r.id, { category: e.target.value })}>
                        {STUDENT_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                {groups.includes("education") ? (
                  <>
                    {(["fatherQualification", "motherQualification"] as const).map((k) => (
                      <label key={k} className={`${label} col-span-2 sm:col-span-2`}>
                        {k === "fatherQualification" ? "Father's education" : "Mother's education"}
                        <select className={box} aria-label={`${name} ${k === "fatherQualification" ? "father's" : "mother's"} education`} value={d[k]} onChange={(e) => set(r.id, { [k]: e.target.value })}>
                          <option value="">Not known</option>
                          {withCurrent(EDUCATION_LEVELS, d[k]).map((x) => (
                            <option key={x} value={x}>
                              {x}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </>
                ) : null}
                {groups.includes("cwsn") ? (
                  <label className="col-span-2 flex min-h-10 items-center gap-2 text-xs text-[var(--brand-deep)]">
                    <input type="checkbox" checked={d.isCwsn} onChange={(e) => set(r.id, { isCwsn: e.target.checked })} />
                    Child with special needs (CWSN)
                  </label>
                ) : null}
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
            {withErrors} child{withErrors === 1 ? "" : "ren"} with something to fix — not included
          </p>
        ) : null}
        {msg ? <p className={`mt-1 text-center text-[11px] ${msg.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</p> : null}
      </div>
    </div>
  );
}
