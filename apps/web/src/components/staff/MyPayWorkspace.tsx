"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import type { CalendarCounts, CalendarDay, CalendarDayKind } from "@/lib/staffMonthCalendar";

/**
 * My pay & attendance — every member of staff, their own records only:
 * a month calendar of their attendance (coloured, counted the way payroll
 * counts), their payslips with every deduction, and their advances.
 * Director, 2026-09-29.
 */

type Tab = "attendance" | "leave" | "payslips" | "advances";

const KIND_STYLE: Record<CalendarDayKind, { cell: string; name: string }> = {
  present: { cell: "bg-[var(--success-soft)] text-[var(--success)]", name: "Present" },
  late: { cell: "bg-[var(--warning-soft)] text-[var(--warning)]", name: "Late" },
  half_day: { cell: "bg-[var(--info-soft)] text-[var(--info)]", name: "Half day" },
  absent: { cell: "bg-[var(--danger-soft)] text-[var(--danger)]", name: "Absent" },
  not_marked: { cell: "border border-dashed border-[var(--danger)] text-[var(--danger)]", name: "Not marked" },
  leave: { cell: "bg-[var(--surface-sunken)] text-[var(--tone-violet)] font-bold", name: "Leave" },
  holiday: { cell: "bg-[var(--surface-sunken)] text-[var(--muted)]", name: "Holiday" },
  unpaid_holiday: { cell: "bg-[var(--surface-sunken)] text-[var(--danger)]", name: "Unpaid holiday" },
  exempt: { cell: "bg-[var(--success-soft)] text-[var(--success)]", name: "No attendance kept" },
  future: { cell: "text-[var(--muted)] opacity-50", name: "" },
};

const inr = (n: number) =>
  `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function getJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: { message?: string } } | null;
    if (!res.ok || !body?.ok) return { ok: false, error: body?.error?.message || `Could not load (server said ${res.status})` };
    return { ok: true, data: body.data as T };
  } catch {
    return { ok: false, error: "Could not reach the school server" };
  }
}

export function MyPayWorkspace() {
  const [tab, setTab] = useState<Tab>("attendance");
  return (
    <ErpWorkspaceShell
      title="My pay & attendance"
      subtitle="Your own attendance, payslips and advances."
      icon={<Wallet className="size-6" aria-hidden />}
    >
      <ModuleTabs
        aria-label="My pay and attendance"
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        items={[
          { id: "attendance", label: "Attendance", tone: "teal" },
          { id: "leave", label: "Leave", tone: "violet" },
          { id: "payslips", label: "Payslips", tone: "navy" },
          { id: "advances", label: "Advances", tone: "amber" },
        ]}
      />
      <div className="mt-4">
        {tab === "attendance" ? <MyAttendance /> : null}
        {tab === "leave" ? <MyLeave /> : null}
        {tab === "payslips" ? <MyPayslips /> : null}
        {tab === "advances" ? <MyAdvances /> : null}
      </div>
    </ErpWorkspaceShell>
  );
}

function MyAttendance() {
  const [month, setMonth] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7),
  );
  const [data, setData] = useState<{ days: CalendarDay[]; counts: CalendarCounts; exempt: boolean; today: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<CalendarDay | null>(null);

  const load = useCallback(async (m: string) => {
    setData(null);
    setError(null);
    setPicked(null);
    const r = await getJson<{ days: CalendarDay[]; counts: CalendarCounts; exempt: boolean; today: string }>(
      `/api/v1/staff/my-attendance?month=${m}`,
    );
    if (r.ok) setData(r.data);
    else setError(r.error);
  }, []);

  useEffect(() => {
    void load(month);
  }, [month, load]);

  const firstDow = data?.days[0] ? new Date(`${data.days[0].date}T00:00:00Z`).getUTCDay() : 0;
  const c = data?.counts;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)]" aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="flex items-center gap-2 text-sm font-bold text-[var(--brand-deep)]">
          <CalendarDays className="h-4 w-4" /> {monthLabel(month)}
        </p>
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)]" aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {error ? <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-[var(--muted)]">Loading…</p> : null}

      {data && c ? (
        <>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { n: c.present, label: "Present", cls: "text-[var(--success)]" },
              { n: c.late, label: "Late", cls: "text-[var(--warning)]" },
              { n: c.halfDay, label: "Half day", cls: "text-[var(--info)]" },
              { n: c.leave, label: "Leave", cls: "text-[var(--tone-violet)]" },
              { n: c.absent, label: "Absent", cls: "text-[var(--danger)]" },
              { n: c.notMarked, label: "Not marked", cls: "text-[var(--danger)]" },
              { n: c.holidays, label: "Holidays", cls: "text-[var(--muted)]" },
              { n: c.lwpDays, label: "Loss-of-pay days", cls: "text-[var(--danger)]" },
            ].map((x) => (
              <div key={x.label} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2">
                <p className={`text-lg font-bold ${x.cls}`}>{x.n}</p>
                <p className="text-[10px] text-[var(--muted)]">{x.label}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2">
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-[var(--muted)]">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {Array.from({ length: firstDow }, (_, i) => <span key={`b${i}`} />)}
              {data.days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setPicked(d)}
                  title={d.label}
                  className={`flex aspect-square flex-col items-center justify-center rounded-lg text-xs ${KIND_STYLE[d.kind].cell} ${
                    d.date === data.today ? "ring-2 ring-[var(--brand-gold)]" : ""
                  }`}
                >
                  <span className="font-bold">{Number(d.date.slice(8))}</span>
                  {d.kind !== "future" ? (
                    <span className="text-[8px] leading-none">{KIND_STYLE[d.kind].name.split(" ")[0]}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {picked ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm">
              <p className="font-semibold text-[var(--brand-deep)]">
                {new Date(`${picked.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
              </p>
              <p className="text-[var(--muted)]">
                {picked.label || "—"}
                {picked.inTime ? ` · In ${picked.inTime}` : ""}
                {picked.outTime ? ` · Out ${picked.outTime}` : ""}
                {picked.way ? ` · ${picked.way}` : ""}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 text-[10px]">
            {(["present", "late", "half_day", "leave", "absent", "not_marked", "holiday"] as CalendarDayKind[]).map((k) => (
              <span key={k} className={`rounded-md px-2 py-0.5 ${KIND_STYLE[k].cell}`}>{KIND_STYLE[k].name}</span>
            ))}
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            {data.exempt
              ? "You are not required to keep attendance, so days without a register count as present."
              : "“Not marked” means no attendance was recorded that working day — payroll counts it as absent. Punch in every day, or ask the office to correct it before the payroll run."}
          </p>
        </>
      ) : null}
    </div>
  );
}

type Slip = {
  runId: string;
  month: string;
  status: string;
  daysPresent: number;
  daysAbsent: number;
  daysHalf: number;
  daysLeavePaid: number;
  daysLwp: number;
  daysHoliday: number;
  gross: number;
  totalDeductions: number;
  netPay: number;
  amountPayable: number;
  onHold: boolean;
  holdNote: string;
  paymentDate: string;
  paymentModeLabel: string;
  earnings: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
  bonus: number;
};

function MyPayslips() {
  const [data, setData] = useState<{ slips: Slip[]; preparing: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void getJson<{ slips: Slip[]; preparing: number }>("/api/v1/staff/payslips").then((r) =>
      r.ok ? setData(r.data) : setError(r.error),
    );
  }, []);
  if (error) return <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>;
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  return (
    <div className="space-y-2">
      {data.preparing > 0 ? (
        <p className="text-xs text-[var(--muted)]">{data.preparing} payslip(s) are being prepared and will appear once approved.</p>
      ) : null}
      {data.slips.length === 0 ? <p className="text-sm text-[var(--muted)]">No payslips yet.</p> : null}
      {data.slips.map((s) => (
        <div key={s.runId} className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <button type="button" onClick={() => setOpen(open === s.runId ? null : s.runId)} className="flex w-full items-center justify-between px-3 py-2.5 text-left">
            <span>
              <span className="block text-sm font-bold text-[var(--brand-deep)]">{monthLabel(s.month)}</span>
              <span className="block text-[11px] text-[var(--muted)]">
                Gross {inr(s.gross)} · Deductions {inr(s.totalDeductions)} · {s.status}
              </span>
            </span>
            <span className="text-right">
              <span className="block text-base font-bold text-[var(--success)]">{inr(s.amountPayable || s.netPay)}</span>
              <span className="block text-[10px] text-[var(--muted)]">{s.onHold ? "On hold" : "Net pay"}</span>
            </span>
          </button>
          {open === s.runId ? (
            <div className="space-y-2 border-t border-[var(--border)] px-3 py-2 text-sm">
              <p className="text-[11px] text-[var(--muted)]">
                Present {s.daysPresent} · Half day {s.daysHalf} · Paid leave {s.daysLeavePaid} · Absent {s.daysAbsent} · Loss of pay {s.daysLwp} · Holidays {s.daysHoliday}
              </p>
              <div>
                <p className="text-xs font-bold uppercase text-[var(--muted)]">Earnings</p>
                {s.earnings.map((e) => (
                  <p key={e.name} className="flex justify-between"><span>{e.name}</span><span>{inr(e.amount)}</span></p>
                ))}
                {s.bonus > 0 ? <p className="flex justify-between"><span>Bonus</span><span>{inr(s.bonus)}</span></p> : null}
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-[var(--muted)]">Deductions</p>
                {s.deductions.length === 0 ? <p className="text-[var(--muted)]">None</p> : null}
                {s.deductions.map((d) => (
                  <p key={d.name} className="flex justify-between text-[var(--danger)]"><span>{d.name}</span><span>− {inr(d.amount)}</span></p>
                ))}
              </div>
              {s.holdNote ? <p className="text-xs text-[var(--warning)]">{s.holdNote}</p> : null}
              {s.paymentDate ? (
                <p className="text-xs text-[var(--muted)]">Paid {s.paymentDate}{s.paymentModeLabel ? ` · ${s.paymentModeLabel}` : ""}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

type Advance = {
  id: string;
  amount: number;
  givenDate: string;
  note: string;
  status: string;
  recovered: number;
  outstanding: number;
  recoveries: { month: string; method: string; amount: number; recoveredAt: string; note: string }[];
};

function MyAdvances() {
  const [data, setData] = useState<{ outstanding: number; advances: Advance[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getJson<{ outstanding: number; advances: Advance[] }>("/api/v1/staff/my-advances").then((r) =>
      r.ok ? setData(r.data) : setError(r.error),
    );
  }, []);
  if (error) return <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>;
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-center">
        <p className="text-xl font-bold text-[var(--brand-deep)]">{inr(data.outstanding)}</p>
        <p className="text-[11px] text-[var(--muted)]">Outstanding advance</p>
      </div>
      {data.advances.length === 0 ? <p className="text-sm text-[var(--muted)]">No advances taken.</p> : null}
      {data.advances.map((a) => (
        <div key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm">
          <p className="flex justify-between font-semibold text-[var(--brand-deep)]">
            <span>{a.givenDate} · {inr(a.amount)}</span>
            <span className={a.outstanding > 0 ? "text-[var(--danger)]" : "text-[var(--success)]"}>
              {a.outstanding > 0 ? `${inr(a.outstanding)} due` : "Cleared"}
            </span>
          </p>
          {a.note ? <p className="text-[11px] text-[var(--muted)]">{a.note}</p> : null}
          {a.recoveries.length ? (
            <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
              {a.recoveries.map((r, i) => (
                <li key={i} className="flex justify-between">
                  <span>{r.method === "salary" ? `From salary ${r.month ? monthLabel(r.month) : ""}` : `Returned ${r.recoveredAt?.slice(0, 10) || ""}`}</span>
                  <span>− {inr(r.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-[var(--muted)]">Nothing recovered yet</p>
          )}
        </div>
      ))}
    </div>
  );
}

type LeaveData = {
  autoApprove: boolean;
  balances: { typeCode: string; typeName: string; allotted: number; used: number; remaining: number }[];
  requests: {
    id: string;
    typeName: string;
    fromDate: string;
    toDate: string;
    days: number;
    halfDay: boolean;
    reason: string;
    status: string;
    statusLabel: string;
  }[];
};

/**
 * My leave — balances, apply, withdraw a pending request. Everything goes
 * through /api/v1/staff/leave* (the server uses the login's own staff id);
 * the browser's HR desk needs staff.edit to save, which staff do not have.
 */
function MyLeave() {
  const [data, setData] = useState<LeaveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [form, setForm] = useState({ typeCode: "", fromDate: today, toDate: today, halfDay: false, reason: "" });

  const load = useCallback(async () => {
    const r = await getJson<LeaveData>("/api/v1/staff/leave");
    if (r.ok) {
      setData(r.data);
      setError(null);
      setForm((f) => (f.typeCode ? f : { ...f, typeCode: r.data.balances[0]?.typeCode || "" }));
    } else setError(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function post(url: string, body: unknown, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
      if (!res.ok || !j?.ok) {
        setMsg({ ok: false, text: j?.error?.message || "Not saved — please try again." });
        return;
      }
      setMsg({ ok: true, text: okText });
      await load();
    } catch {
      setMsg({ ok: false, text: "Not saved — could not reach the school server." });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>;
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  const input = "field mt-1 !py-2 w-full";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        {data.balances.map((b) => (
          <div key={b.typeCode} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2">
            <p className="text-lg font-bold text-[var(--brand-deep)]">{b.remaining}</p>
            <p className="text-[10px] text-[var(--muted)]">{b.typeName} left (of {b.allotted})</p>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Apply for leave</p>
        {msg ? (
          <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>{msg.text}</p>
        ) : null}
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Type
          <select className={input} value={form.typeCode} onChange={(e) => setForm({ ...form, typeCode: e.target.value })}>
            {data.balances.map((b) => <option key={b.typeCode} value={b.typeCode}>{b.typeName}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            From
            <input className={input} type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: e.target.value > form.toDate ? e.target.value : form.toDate })} />
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            To
            <input className={input} type="date" value={form.halfDay ? form.fromDate : form.toDate} disabled={form.halfDay} onChange={(e) => setForm({ ...form, toDate: e.target.value })} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
          <input type="checkbox" checked={form.halfDay} onChange={(e) => setForm({ ...form, halfDay: e.target.checked })} /> Half day
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Reason
          <input className={input} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </label>
        <button
          type="button"
          disabled={busy || !form.typeCode}
          onClick={() => void post("/api/v1/staff/leave/apply", form, data.autoApprove ? "Leave applied and approved" : "Leave applied — waiting for approval")}
          className="min-h-10 w-full rounded-xl bg-[var(--primary)] px-3 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-40"
        >
          {busy ? "Sending…" : "Apply"}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">My requests</p>
        {data.requests.length === 0 ? <p className="text-sm text-[var(--muted)]">No leave requests yet.</p> : null}
        {data.requests.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block font-semibold text-[var(--brand-deep)]">
                {r.typeName} · {r.fromDate}{r.toDate !== r.fromDate ? ` → ${r.toDate}` : ""} · {r.days} day{r.days === 1 ? "" : "s"}
              </span>
              <span className="block text-[11px] text-[var(--muted)]">{r.statusLabel}{r.reason ? ` · ${r.reason}` : ""}</span>
            </span>
            {r.status === "pending" ? (
              <button type="button" disabled={busy} onClick={() => void post("/api/v1/staff/leave/withdraw", { id: r.id }, "Request withdrawn")} className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--brand-deep)]">
                Withdraw
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
