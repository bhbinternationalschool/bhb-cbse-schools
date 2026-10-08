"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AttendanceStatus } from "@/lib/attendance";
import type { MonthDay, MonthStudent } from "@/lib/attendanceMonthRegister";

type Section = { classId: string; sectionId: string; label: string };
type View = {
  academicYearCode: string;
  today: string;
  months: string[];
  canEdit: boolean;
  month: string;
  days: MonthDay[];
  students: MonthStudent[];
};
type Cell = AttendanceStatus | "";

const CYCLE: Cell[] = ["", "P", "A", "L", "HD", "LE"];
const TONE: Record<string, string> = {
  P: "bg-[rgba(21,128,61,0.14)] text-[var(--success)]",
  A: "bg-[var(--danger-soft)] text-[var(--danger)]",
  L: "bg-[rgba(197,160,40,0.2)] text-[var(--brand-deep)]",
  HD: "bg-[rgba(56,72,112,0.14)] text-[var(--brand-deep)]",
  LE: "bg-[var(--surface-sunken)] text-[var(--muted)]",
};
const WD = ["S", "M", "T", "W", "T", "F", "S"];
const weight = (s: Cell) => (s === "P" || s === "L" ? 1 : s === "HD" ? 0.5 : 0);

function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Attendance → Month register (director, 8 Oct 2026): a class teacher fills
 * the whole month at once — every child × every working day — including
 * past days, and saves it in one go. Holidays come from Masters; a child is
 * markable from the working day after admission; working and present days
 * show per child for the month and the session.
 */
export function MonthRegisterPanel({ sections }: { sections: Section[] }) {
  const [pick, setPick] = useState<Section | null>(sections[0] ?? null);
  const [month, setMonth] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<string, Cell>>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!pick && sections[0]) setPick(sections[0]);
  }, [sections, pick]);

  const changedCount = useMemo(
    () => Object.values(edits).reduce((n, day) => n + Object.keys(day).length, 0),
    [edits],
  );

  const load = useCallback(async () => {
    if (!pick) return;
    setBusy(true);
    try {
      const q = new URLSearchParams({ classId: pick.classId, sectionId: pick.sectionId });
      if (month) q.set("month", month);
      const res = await fetch(`/api/v1/attendance/month?${q}`, { cache: "no-store" });
      // v1 routes answer {ok, data} / {ok:false, error:{message}}.
      const body = (await res.json()) as { ok?: boolean; data?: View; error?: { message?: string } | string };
      if (!res.ok || !body.data) {
        const e = typeof body.error === "string" ? body.error : body.error?.message;
        throw new Error(e || `HTTP ${res.status}`);
      }
      setView(body.data);
      if (!month) setMonth(body.data.month);
      setEdits({});
    } catch (e) {
      setView(null);
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not load the month" });
    } finally {
      setBusy(false);
    }
  }, [pick, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const guard = (fn: () => void) => {
    if (changedCount && !window.confirm(`${changedCount} change(s) not saved. Leave without saving?`)) return;
    setMsg(null);
    fn();
  };

  const valueOf = (stu: MonthStudent, date: string): Cell => {
    const e = edits[date]?.[stu.id];
    return e !== undefined ? e : (stu.marks[date] ?? "");
  };
  const markable = (stu: MonthStudent, d: MonthDay) => !!view?.canEdit && d.working && !d.future && d.date >= stu.startsOn;

  const setCell = (stu: MonthStudent, date: string, next: Cell) => {
    setEdits((prev) => {
      const day = { ...(prev[date] ?? {}) };
      if (next === (stu.marks[date] ?? "")) delete day[stu.id];
      else day[stu.id] = next;
      const out = { ...prev, [date]: day };
      if (Object.keys(day).length === 0) delete out[date];
      return out;
    });
  };

  const cycle = (stu: MonthStudent, d: MonthDay) => {
    if (!markable(stu, d)) return;
    const cur = valueOf(stu, d.date);
    setCell(stu, d.date, CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length]);
  };

  /** Every still-blank markable cell in a day (or the whole month) → P. */
  const fillPresent = (only?: MonthDay) => {
    if (!view) return;
    const days = only ? [only] : view.days;
    setEdits((prev) => {
      const out = { ...prev };
      for (const d of days) {
        const day = { ...(out[d.date] ?? {}) };
        for (const s of view.students) {
          if (!markable(s, d)) continue;
          const cur = day[s.id] !== undefined ? day[s.id] : (s.marks[d.date] ?? "");
          if (cur === "") day[s.id] = "P";
        }
        if (Object.keys(day).length) out[d.date] = day;
      }
      return out;
    });
  };

  async function save() {
    if (!view || !pick || !changedCount) return;
    setBusy(true);
    setMsg(null);
    try {
      const days = Object.entries(edits).map(([date, byStu]) => ({
        date,
        marks: Object.entries(byStu).map(([studentId, status]) => ({ studentId, status })),
      }));
      const res = await fetch("/api/v1/attendance/month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: pick.classId, sectionId: pick.sectionId, month: view.month, days }),
      });
      const env = (await res.json()) as { data?: { saved?: string[]; refused?: string[]; failed?: string[] }; error?: { message?: string } | string };
      if (!res.ok || !env.data) {
        const e = typeof env.error === "string" ? env.error : env.error?.message;
        throw new Error(e || `HTTP ${res.status}`);
      }
      const body = env.data;
      const saved = body.saved?.length ?? 0;
      const problems = [...(body.refused ?? []), ...(body.failed ?? [])];
      setMsg({
        ok: problems.length === 0,
        text:
          `Saved ${saved} day(s).` +
          (problems.length ? ` Not saved: ${problems.slice(0, 4).join("; ")}${problems.length > 4 ? ` (+${problems.length - 4} more)` : ""}` : ""),
      });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Not saved" });
    } finally {
      setBusy(false);
    }
  }

  if (!sections.length) {
    return <p className="mt-4 text-sm text-[var(--muted)]">No class to show — you are not a class teacher of any section this session.</p>;
  }

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">Month register</h2>
          <p className="text-[11px] text-[var(--muted)]">
            Fill a whole month at once, past days included. Tap a box to change it: blank → P → A → L (late) → HD (half day) → LE (leave). Grey columns are holidays from
            Masters; “–” is before the child&apos;s admission (marking starts the working day after).
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-[var(--muted)]">Class</span>
            <select
              className="field !py-1.5"
              value={pick ? `${pick.classId}|${pick.sectionId}` : ""}
              onChange={(e) => {
                const next = sections.find((s) => `${s.classId}|${s.sectionId}` === e.target.value) ?? null;
                guard(() => setPick(next));
              }}
            >
              {sections.map((s) => (
                <option key={`${s.classId}|${s.sectionId}`} value={`${s.classId}|${s.sectionId}`}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-[var(--muted)]">Month</span>
            <select className="field !py-1.5" value={month} onChange={(e) => { const v = e.target.value; guard(() => setMonth(v)); }}>
              {(view?.months ?? (month ? [month] : [])).map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {view && !view.canEdit ? (
        <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted)]">
          View only — the class teacher (or the office) fills this class&apos;s month register.
        </p>
      ) : null}

      {view?.canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]" disabled={busy} onClick={() => fillPresent()}>
            Mark all blank days Present
          </button>
          <span className="text-[11px] text-[var(--muted)]">then tap the absentees. Tap a date to fill just that day.</span>
          <button
            type="button"
            className="ml-auto rounded-lg bg-[var(--primary)] px-4 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            disabled={busy || changedCount === 0}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : changedCount ? `Save ${changedCount} change(s)` : "Saved"}
          </button>
        </div>
      ) : null}
      {msg ? <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-[rgba(21,128,61,0.08)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>{msg.text}</p> : null}

      {view ? (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-[var(--border)]">
          <table className="border-separate border-spacing-0 text-[11px]">
            <thead className="sticky top-0 z-20 bg-[var(--card)]">
              <tr>
                <th className="sticky left-0 z-30 min-w-[11rem] border-b border-[var(--border)] bg-[var(--card)] px-2 py-1 text-left">Student</th>
                {view.days.map((d) => {
                  const wd = new Date(`${d.date}T12:00:00Z`).getUTCDay();
                  const can = !!view.canEdit && d.working && !d.future;
                  return (
                    <th
                      key={d.date}
                      title={d.working ? (d.half ? `Half day — ${d.label}` : can ? "Tap to mark blanks Present for this day" : "") : d.label}
                      className={`w-8 border-b border-[var(--border)] px-0.5 py-1 text-center font-semibold ${d.working ? "" : "bg-[var(--surface-sunken)] text-[var(--muted)]"} ${d.date === view.today ? "text-[var(--accent,#C5A028)]" : ""}`}
                    >
                      <button type="button" disabled={!can} onClick={() => fillPresent(d)} className="w-full disabled:cursor-default">
                        <span className="block">{Number(d.date.slice(8))}</span>
                        <span className="block font-normal text-[var(--muted)]">{d.working ? WD[wd] : "H"}</span>
                      </button>
                    </th>
                  );
                })}
                <th className="border-b border-l border-[var(--border)] px-2 py-1 text-center" title="This month: present / working days">Month P/W</th>
                <th className="border-b border-[var(--border)] px-2 py-1 text-center" title="Session so far (as saved): present / working days">Session P/W</th>
                <th className="border-b border-[var(--border)] px-2 py-1 text-center">%</th>
              </tr>
            </thead>
            <tbody>
              {view.students.map((s) => {
                let mw = 0;
                let mp = 0;
                for (const d of view.days) {
                  if (!d.working || d.future || d.date < s.startsOn) continue;
                  mw += 1;
                  mp += weight(valueOf(s, d.date));
                }
                return (
                  <tr key={s.id}>
                    <td className="sticky left-0 z-10 border-b border-[var(--border)] bg-[var(--card)] px-2 py-1">
                      <span className="font-semibold text-[var(--brand-deep)]">{s.rollNo ? `${s.rollNo}. ` : ""}{s.name}</span>
                      {s.joinedOn && s.startsOn > (view.days[0]?.date ?? "") ? (
                        <span className="block text-[10px] text-[var(--muted)]">admitted {s.joinedOn}</span>
                      ) : null}
                    </td>
                    {view.days.map((d) => {
                      const v = valueOf(s, d.date);
                      const edited = edits[d.date]?.[s.id] !== undefined;
                      if (!d.working) return <td key={d.date} className="border-b border-[var(--border)] bg-[var(--surface-sunken)]" />;
                      if (d.date < s.startsOn) return <td key={d.date} className="border-b border-[var(--border)] text-center text-[var(--muted)]" title={`Admitted ${s.joinedOn}`}>–</td>;
                      return (
                        <td key={d.date} className="border-b border-[var(--border)] p-0.5 text-center">
                          <button
                            type="button"
                            disabled={!markable(s, d)}
                            onClick={() => cycle(s, d)}
                            aria-label={`${s.name} ${d.date}: ${v || "not marked"}`}
                            className={`h-7 w-7 rounded text-[10px] font-bold ${v ? TONE[v] : "border border-dashed border-[var(--border)]"} ${edited ? "ring-2 ring-[var(--accent,#C5A028)]" : ""} disabled:opacity-60`}
                          >
                            {v}
                          </button>
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-[var(--border)] px-2 text-center font-semibold">{mp}/{mw}</td>
                    <td className="border-b border-[var(--border)] px-2 text-center">{s.session.presentDays}/{s.session.workingDays}</td>
                    <td className="border-b border-[var(--border)] px-2 text-center">
                      {s.session.percent === null ? "—" : `${s.session.percent}%`}
                      {s.session.unmarkedDays ? <span className="block text-[10px] text-[var(--danger)]">{s.session.unmarkedDays} unmarked</span> : null}
                    </td>
                  </tr>
                );
              })}
              {view.students.length === 0 ? (
                <tr>
                  <td colSpan={view.days.length + 4} className="px-3 py-6 text-center text-[var(--muted)]">No active students in this class.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : busy ? (
        <p className="text-xs text-[var(--muted)]">Loading…</p>
      ) : null}
    </div>
  );
}
