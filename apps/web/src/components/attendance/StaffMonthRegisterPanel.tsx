"use client";
// ratchet-allow: grids_without_row_menu — a month register: a row is a person's month, each cell a day, not a record to act on

import { useEffect, useMemo, useState } from "react";
import { QueryError } from "@/components/data/QueryError";
import { SchoolLetterhead } from "@/components/shared/SchoolLetterhead";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";
import { ExportMenu } from "@/components/ui/erp-grid";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";
import { ErpQueryError, useErpQuery } from "@/lib/data/client/hooks";
import { punchWayLabel } from "@/lib/staffAttendance";
import {
  leaveTypeCodes,
  STAFF_MARK_LABEL,
  staffCellText,
  staffLeaveBalanceExport,
  staffLeaveMonthExport,
  staffMonthRegisterExport,
  type StaffMonthCell,
  type StaffMonthDay,
  type StaffMonthRow,
  type StaffMonthView,
} from "@/lib/staffMonthRegister";

export type StaffMonthAnswer = StaffMonthView & {
  months: string[];
  /** The owner — the only person who may change the register. */
  canEdit: boolean;
  scope: "school" | "self";
};

/** The erp_versions keys this answer is built from: a moved one refetches it. */
const DESKS = ["staff_attendance", "staff_hr", "masters"] as const;

function parseAnswer(data: unknown): StaffMonthAnswer {
  const d = data as Partial<StaffMonthAnswer> | null;
  if (!d || !Array.isArray(d.days) || !Array.isArray(d.staff) || !Array.isArray(d.leaves) || !Array.isArray(d.balances)) {
    throw new ErpQueryError(502, "The month register came back incomplete");
  }
  return d as StaffMonthAnswer;
}

const TONE: Record<string, string> = {
  P: "bg-[rgba(21,128,61,0.14)] text-[var(--success)]",
  A: "bg-[var(--danger-soft)] text-[var(--danger)]",
  L: "bg-[rgba(197,160,40,0.22)] text-[var(--brand-deep)]",
  HD: "bg-[rgba(56,72,112,0.14)] text-[var(--brand-deep)]",
  LE: "bg-[rgba(124,58,237,0.14)] text-[var(--tone-violet)]",
};

/** One or two letters under a mark: how it was taken. */
const WAY_SHORT: Record<string, string> = {
  self: "S",
  printed_qr: "Q",
  whatsapp: "W",
  direct: "D",
  manual: "M",
  adjusted: "Aj",
  leave_sync: "Lv",
  rule: "R",
  survey: "Sv",
  outdoor: "O",
  rfid: "RF",
  biometric: "B",
};
const WD = ["S", "M", "T", "W", "T", "F", "S"];

function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  if (!y || !mo) return m;
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

function cellTitle(r: StaffMonthRow, d: StaffMonthDay, c: StaffMonthCell | undefined): string {
  const day = (r.stream === "teaching" ? d.teaching : d.nonTeaching);
  const parts = [`${r.name} · ${d.date}`];
  if (day.off) parts.push(day.label || "Holiday");
  if (!c || c.outside) {
    if (c?.outside) parts.push("Not in service");
    return parts.join(" · ");
  }
  if (c.s) parts.push(STAFF_MARK_LABEL[c.s] + (c.leaveType ? ` (${c.leaveType})` : ""));
  else if (c.fromLeave) parts.push(`Half-day leave (${c.leaveType}) — no punch saved`);
  else if (!d.future && !day.off) parts.push("Not marked");
  if (c.fromLeave && c.s) parts.push("from approved leave");
  if (c.extra) parts.push("worked on a holiday (extra day)");
  if (c.inTime) parts.push(`In ${c.inTime}`);
  if (c.outTime) parts.push(`Out ${c.outTime}`);
  if (c.way) parts.push(punchWayLabel(c.way));
  if (c.note) parts.push(c.note);
  return parts.join(" · ");
}

/** Print just the sheet, landscape, on the school letterhead. */
function printSheet(): void {
  const style = document.createElement("style");
  style.textContent = "@media print { @page { size: A4 landscape; margin: 6mm; } }";
  document.head.appendChild(style);
  document.body.classList.add("printing-staff-register");
  const done = () => {
    document.body.classList.remove("printing-staff-register");
    style.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  // Some browsers return from print() before afterprint; never leave the page hidden.
  window.setTimeout(done, 1500);
}

/**
 * Attendance → Staff → Month register / Leave this month (director,
 * 15 Oct 2026). Read-only for everyone: the owner changes marks on the day
 * register (Manage), which only the owner can save.
 */
export function StaffMonthRegisterPanel({ mode }: { mode: "register" | "leave" }) {
  // TODO(#671): use components/ui/month-range-filter.tsx (the shared month /
  // range picker) once #671 is merged; a plain month input until then.
  const [month, setMonth] = useState("");
  const path = `/api/v1/attendance/staff-month${month ? `?month=${month}` : ""}`;
  const q = useErpQuery<StaffMonthAnswer>(["staff-month", month || "current"], path, { desk: [...DESKS], parse: parseAnswer });
  const view = q.data;
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!month && view?.month) setMonth(view.month);
  }, [month, view?.month]);

  const codes = useMemo(() => (view ? leaveTypeCodes(view) : []), [view]);
  const sort = useTableSort(
    view?.staff ?? [],
    {
      code: (r) => r.empCode,
      name: (r) => r.name,
      present: (r) => r.totals.present,
      absent: (r) => r.totals.A,
      late: (r) => r.totals.L,
    },
    "code",
  );

  if (q.error) {
    return <QueryError what="the staff month register" error={q.error} retry={() => q.refetch()} />;
  }
  if (!view) return <p className="text-sm text-[var(--muted)]">Loading the month…</p>;

  const title = mode === "register" ? "Staff attendance register" : "Staff leave";
  const subtitle = `${monthLabel(view.month)} · Session ${view.academicYearCode}`;
  const legend =
    "P present · A absent · L late (came late, counted present) · HD half day · CL / ML / LWP … on leave of that type · shaded = holiday or Sunday · – not in service";

  return (
    <div className="space-y-3" data-testid={mode === "register" ? "staff-month-register" : "staff-month-leave"}>
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 print:hidden">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            {mode === "register" ? "Month register" : "Leave this month"}
          </h2>
          <p className="text-[11px] text-[var(--muted)]">
            {mode === "register"
              ? "Every member of staff, every day of the month, as the register holds it — with the month's totals."
              : "Each approved leave that falls in the month, and every balance as it stands at month end."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-[var(--muted)]">Month</span>
            <input
              type="month"
              aria-label="Month"
              className="field !py-1.5"
              value={month}
              min={view.months[view.months.length - 1]}
              max={view.months[0]}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
            onClick={printSheet}
          >
            Print
          </button>
          {mode === "register" ? (
            <ExportMenu
              title={`${title} — ${monthLabel(view.month)}`}
              subtitle={`Session ${view.academicYearCode} · ${legend}`}
              fileBaseName={`staff_attendance_register_${view.month}`}
              columns={staffMonthRegisterExport(view, []).columns}
              rows={() => staffMonthRegisterExport(view, sort.rows).rows}
              onMessage={(m) => setMsg(`Exported ${m}`)}
            />
          ) : null}
        </div>
      </div>

      <p
        data-testid="staff-register-edit-rule"
        className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted)] print:hidden"
      >
        {view.canEdit
          ? "You are the owner: change a day's marks on the Manage tab (date picker → Save). Nobody else can change this register."
          : "View only — only the owner can change the staff attendance register."}
        {view.scope === "self" ? " You see your own attendance." : ""}
      </p>
      {msg ? <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--brand-deep)] print:hidden">{msg}</p> : null}

      <div className="staff-register-sheet print-target space-y-2">
        <SchoolLetterhead printOnly title={title} subtitle={subtitle} />
        {mode === "register" ? (
          <>
            <p className="text-[11px] text-[var(--muted)]">{legend}. Under a mark: how it was taken — S self, Q gate QR, W WhatsApp GPS, D direct, M manual, Lv leave, Sv survey, O outdoor.</p>
            <div
              className="max-h-[70vh] max-w-full overflow-auto rounded-lg border border-[var(--border)] [-webkit-overflow-scrolling:touch] print:max-h-none print:overflow-visible print:border-0"
              tabIndex={0}
              aria-label="Staff month register — scroll sideways for more days"
            >
              <ErpTable minWidth="min-w-full" className="w-max border-separate border-spacing-0 text-[11px] print:text-[8px]">
                <thead className="sticky top-0 z-20 bg-[var(--card)]">
                  <tr>
                    <ErpSortTh sort={sort} field="name" className="sticky left-0 z-30 w-[8rem] min-w-[8rem] border-b border-[var(--border)] bg-[var(--card)] px-2 py-1 text-left text-[10px] sm:min-w-[12rem]">
                      Staff
                    </ErpSortTh>
                    {view.days.map((d) => {
                      const off = d.teaching.off && d.nonTeaching.off;
                      const part = d.teaching.off !== d.nonTeaching.off;
                      return (
                        <th
                          key={d.date}
                          title={off ? d.teaching.label : part ? `${d.teaching.off ? "Teachers" : "Non-teaching"} off — ${(d.teaching.off ? d.teaching : d.nonTeaching).label}` : d.teaching.label}
                          className={`w-8 min-w-[2rem] border-b border-[var(--border)] px-0.5 py-1 text-center font-semibold ${off ? "bg-[var(--surface-sunken)] text-[var(--muted)]" : ""} ${d.date === view.today ? "text-[var(--brand-accent)]" : ""}`}
                        >
                          <span className="block">{Number(d.date.slice(8))}</span>
                          <span className="block font-normal text-[var(--muted)]">{off ? "H" : WD[d.weekday]}</span>
                        </th>
                      );
                    })}
                    <th className="whitespace-nowrap border-b border-l border-[var(--border)] px-1.5 py-1 text-center text-[10px]" title="Working days so far this month">Work</th>
                    <ErpSortTh sort={sort} field="present" className="whitespace-nowrap border-b border-[var(--border)] px-1.5 py-1 text-center text-[10px]">Present</ErpSortTh>
                    <ErpSortTh sort={sort} field="late" className="whitespace-nowrap border-b border-[var(--border)] px-1.5 py-1 text-center text-[10px]">Late</ErpSortTh>
                    <th className="whitespace-nowrap border-b border-[var(--border)] px-1.5 py-1 text-center text-[10px]">HD</th>
                    <ErpSortTh sort={sort} field="absent" className="whitespace-nowrap border-b border-[var(--border)] px-1.5 py-1 text-center text-[10px]">Absent</ErpSortTh>
                    {codes.map((c) => (
                      <th key={c} className="whitespace-nowrap border-b border-[var(--border)] px-1.5 py-1 text-center text-[10px]" title={`Leave: ${view.leaveTypes.find((t) => t.code === c)?.name ?? c}`}>
                        {c}
                      </th>
                    ))}
                    <th className="whitespace-nowrap border-b border-[var(--border)] px-1.5 py-1 text-center text-[10px]" title="Worked on a holiday or Sunday">Extra</th>
                    <th className="whitespace-nowrap border-b border-[var(--border)] px-1.5 py-1 text-center text-[10px]" title="Working days with no mark">Unmarked</th>
                  </tr>
                </thead>
                <tbody>
                  {sort.rows.map((r) => (
                    <tr key={r.id} data-staff-id={r.id}>
                      <td className="sticky left-0 z-10 max-w-[8rem] border-b border-[var(--border)] bg-[var(--card)] px-2 py-1 leading-tight sm:max-w-none">
                        <span className="font-semibold text-[var(--brand-deep)]">{r.name}</span>
                        <span className="block text-[10px] text-[var(--muted)]">{r.empCode}{r.designation ? ` · ${r.designation}` : ""}</span>
                      </td>
                      {view.days.map((d) => {
                        const c = r.cells[d.date];
                        const off = (r.stream === "teaching" ? d.teaching : d.nonTeaching).off;
                        const text = staffCellText(c);
                        const tone = c?.s ? TONE[c.s] : c?.fromLeave ? TONE.LE : "";
                        return (
                          <td
                            key={d.date}
                            data-date={d.date}
                            title={cellTitle(r, d, c)}
                            className={`min-w-[2rem] border-b border-[var(--border)] p-0.5 text-center align-middle ${off ? "bg-[var(--surface-sunken)]" : ""}`}
                          >
                            {text ? (
                              <span className={`inline-flex min-h-6 min-w-6 flex-col items-center justify-center rounded px-0.5 text-[10px] font-bold leading-none ${tone} ${c?.extra ? "ring-1 ring-[var(--brand-accent)]" : ""}`}>
                                {text}
                                {c?.way && WAY_SHORT[c.way] ? <span className="mt-px text-[7px] font-normal opacity-70">{WAY_SHORT[c.way]}</span> : null}
                              </span>
                            ) : !d.future && !off ? (
                              <span className="text-[var(--muted)]" aria-label="not marked">·</span>
                            ) : null}
                          </td>
                        );
                      })}
                      <td className="border-b border-l border-[var(--border)] px-1.5 text-center">{r.totals.working}</td>
                      <td className="border-b border-[var(--border)] px-1.5 text-center font-semibold">{r.totals.present}</td>
                      <td className="border-b border-[var(--border)] px-1.5 text-center">{r.totals.L}</td>
                      <td className="border-b border-[var(--border)] px-1.5 text-center">{r.totals.HD}</td>
                      <td className="border-b border-[var(--border)] px-1.5 text-center">{r.totals.A}</td>
                      {codes.map((c) => (
                        <td key={c} className="border-b border-[var(--border)] px-1.5 text-center">{r.totals.leaveByType[c] ?? 0}</td>
                      ))}
                      <td className="border-b border-[var(--border)] px-1.5 text-center">{r.totals.extra}</td>
                      <td className={`border-b border-[var(--border)] px-1.5 text-center ${r.totals.unmarked ? "text-[var(--danger)]" : ""}`}>{r.totals.unmarked}</td>
                    </tr>
                  ))}
                  {view.staff.length === 0 ? (
                    <tr>
                      <td colSpan={view.days.length + 8 + codes.length} className="px-3 py-6 text-center text-[var(--muted)]">
                        No staff keep attendance this month.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </ErpTable>
            </div>
          </>
        ) : (
          <StaffLeaveMonth view={view} onMessage={setMsg} />
        )}
      </div>
    </div>
  );
}

function StaffLeaveMonth({ view, onMessage }: { view: StaffMonthAnswer; onMessage: (m: string) => void }) {
  const total = view.leaves.reduce((n, l) => n + l.daysInMonth, 0);
  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] print:border-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Leave taken in {monthLabel(view.month)}</h3>
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--muted)]" data-testid="staff-leave-total">
              {view.leaves.length} leave{view.leaves.length === 1 ? "" : "s"} · {total} day{total === 1 ? "" : "s"}
            </span>
            <span className="print:hidden">
              <ExportMenu
                compact
                title={`Staff leave — ${monthLabel(view.month)}`}
                subtitle={`Session ${view.academicYearCode} · approved leave falling in the month`}
                fileBaseName={`staff_leave_${view.month}`}
                columns={staffLeaveMonthExport(view).columns}
                rows={() => staffLeaveMonthExport(view).rows}
                formats={["xlsx", "pdf"]}
                onMessage={(m) => onMessage(`Leave list exported ${m}`)}
              />
            </span>
          </span>
        </div>
        <div className="overflow-x-auto print:overflow-visible">
          <ErpTable minWidth="min-w-[720px]" className="text-xs print:text-[9px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2">Staff</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Dates</th>
                <th className="px-3 py-2 text-right">Days in month</th>
                <th className="px-3 py-2">Approved by</th>
                <th className="px-3 py-2">Reason</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {view.leaves.map((l) => (
                <tr key={l.id} data-leave-id={l.id}>
                  <td className="px-3 py-1.5">
                    <span className="font-semibold text-[var(--brand-deep)]">{l.name}</span>
                    <span className="block text-[10px] text-[var(--muted)]">{l.empCode}</span>
                  </td>
                  <td className="px-3 py-1.5" title={l.typeName}>
                    {l.typeCode}
                    {l.halfDay ? <span className="block text-[10px] text-[var(--muted)]">half day{l.halfDaySession ? `, ${l.halfDaySession} off` : ""}</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {l.fromDate === l.toDate ? l.fromDate : `${l.fromDate} → ${l.toDate}`}
                    {l.daysInMonth !== l.days ? <span className="block text-[10px] text-[var(--muted)]">{l.days} day(s) in all</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold">{l.daysInMonth}</td>
                  <td className="px-3 py-1.5">
                    {l.approvedBy || "—"}
                    {l.approvedAt ? <span className="block text-[10px] text-[var(--muted)]">{l.approvedAt}{l.origin === "direct" ? " · entered directly" : ""}</span> : null}
                  </td>
                  <td className="max-w-[16rem] px-3 py-1.5 text-[var(--muted)]">{l.reason || "—"}</td>
                </tr>
              ))}
              {view.leaves.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-[var(--muted)]">No approved leave in this month.</td>
                </tr>
              ) : null}
            </ErpTableBody>
          </ErpTable>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] print:break-before-page print:border-0">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
          <div>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">Balances at the end of {monthLabel(view.month)}</h3>
            <p className="text-[11px] text-[var(--muted)]">Per type: taken this month · used this session up to month end · balance left (allotted + carried forward − encashed − used).</p>
          </div>
          <span className="print:hidden">
            <ExportMenu
              compact
              title={`Staff leave balances — end of ${monthLabel(view.month)}`}
              subtitle={`Session ${view.academicYearCode} · taken this month, used to date, balance`}
              fileBaseName={`staff_leave_balances_${view.month}`}
              columns={staffLeaveBalanceExport(view).columns}
              rows={() => staffLeaveBalanceExport(view).rows}
              formats={["xlsx", "pdf"]}
              onMessage={(m) => onMessage(`Balances exported ${m}`)}
            />
          </span>
        </div>
        <div className="max-h-[60vh] overflow-auto print:max-h-none print:overflow-visible">
          <ErpTable minWidth="min-w-[640px]" className="text-xs print:text-[9px]">
            <ErpTableHead sticky>
              <tr>
                <th className="px-3 py-2">Staff</th>
                {view.leaveTypes.map((t) => (
                  <th key={t.code} className="px-3 py-2 text-center" title={t.name}>
                    {t.code}
                    <span className="block text-[9px] font-normal normal-case text-[var(--muted)]">month · used · left</span>
                  </th>
                ))}
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {view.balances.map((b) => (
                <tr key={b.staffId} data-balance-staff={b.staffId}>
                  <td className="px-3 py-1.5">
                    <span className="font-semibold text-[var(--brand-deep)]">{b.name}</span>
                    <span className="block text-[10px] text-[var(--muted)]">{b.empCode}</span>
                  </td>
                  {view.leaveTypes.map((t) => {
                    const x = b.byType[t.code];
                    return (
                      <td key={t.code} className="whitespace-nowrap px-3 py-1.5 text-center" data-type={t.code}>
                        {x ? (
                          <>
                            <span className={x.inMonth ? "font-semibold text-[var(--brand-deep)]" : "text-[var(--muted)]"}>{x.inMonth}</span>
                            <span className="text-[var(--muted)]"> · {x.usedToMonthEnd} · </span>
                            <span className="font-semibold" data-balance={x.balance}>{x.balance}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </div>
      </section>
    </div>
  );
}
