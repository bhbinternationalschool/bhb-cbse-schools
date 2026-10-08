"use client";

import { useMemo, useState } from "react";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";
import { RowActionMenu } from "@/components/ui/erp-grid";
import type { StaffRecord } from "@/lib/foundationMasters";
import {
  changeLeaveAllotment,
  remainingBalance,
  type LeaveAllotmentChange,
  type LeaveAllotmentMode,
  type StaffHrState,
} from "@/lib/staffHr";

const MODES: { id: LeaveAllotmentMode; label: string }[] = [
  { id: "set", label: "Set to" },
  { id: "add", label: "Add" },
  { id: "remove", label: "Remove" },
];

/** "+2", "−1", "set 10" — how a change reads in the record. */
export function allotmentChangeLabel(c: Pick<LeaveAllotmentChange, "mode" | "days" | "before" | "after">): string {
  const delta = c.after - c.before;
  const signed = `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
  return c.mode === "set" ? `set to ${c.after} (${signed})` : signed;
}

/**
 * Staff → Leave → Allot leave (director, 8 Oct 2026): how many days of each
 * leave type each person gets this session — set for one or many at once,
 * or add / remove days — and the record of every change.
 */
export function LeaveAllotmentPanel({
  ay,
  hr,
  roster,
  by,
  onChanged,
}: {
  ay: string;
  hr: StaffHrState;
  roster: StaffRecord[];
  by: string;
  onChanged: (next: StaffHrState, message: string) => void;
}) {
  const types = hr.leaveTypes.filter((t) => t.paid);
  const [typeCode, setTypeCode] = useState(types[0]?.code ?? "CL");
  const [mode, setMode] = useState<LeaveAllotmentMode>("set");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [logStaff, setLogStaff] = useState("");

  const balanceOf = (staffId: string, code: string) =>
    hr.leaveBalances.find((b) => b.staffId === staffId && b.typeCode === code && b.academicYearCode === ay);
  const type = hr.leaveTypes.find((t) => t.code === typeCode);

  const sort = useTableSort(
    roster,
    {
      staff: (s) => s.fullName,
      allotted: (s) => balanceOf(s.id, typeCode)?.allotted ?? type?.defaultDaysPerYear ?? 0,
      left: (s) => {
        const b = balanceOf(s.id, typeCode);
        return b ? remainingBalance(b) : type?.defaultDaysPerYear ?? 0;
      },
    },
    "staff",
    "asc",
  );

  const log = useMemo(
    () =>
      (hr.leaveAllotmentLog ?? [])
        .filter((c) => c.academicYearCode === ay && (!logStaff || c.staffId === logStaff))
        .sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
    [hr.leaveAllotmentLog, ay, logStaff],
  );
  const nameOf = (id: string) => {
    const s = roster.find((x) => x.id === id);
    return s ? `${s.empCode} · ${s.fullName}` : id;
  };

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function apply() {
    setErr("");
    const n = Number(days);
    const label = mode === "set" ? `set ${typeCode} to ${n} days` : `${mode} ${n} ${typeCode} day(s)`;
    if (selected.size > 1 && !window.confirm(`${label[0].toUpperCase()}${label.slice(1)} for ${selected.size} staff?`)) return;
    const res = changeLeaveAllotment({
      staffIds: [...selected],
      typeCode,
      academicYearCode: ay,
      mode,
      days: days.trim() === "" ? NaN : n,
      reason,
      changedBy: by,
      staff: roster,
    });
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setSelected(new Set());
    setDays("");
    setReason("");
    onChanged(res.state, `${typeCode} allotment changed for ${res.changes.length} staff — recorded below`);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">Allot leave · {ay}</h2>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Tick staff, choose the leave type, then set their days (e.g. 10 for one person, 8 for another), or add or remove days. Every change is
          recorded below with who made it and why. Nobody can be left with less leave than they have already taken.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-[var(--muted)]">Leave type</span>
            <select className="field !py-1.5" value={typeCode} onChange={(e) => setTypeCode(e.target.value)}>
              {types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.code} — {t.name}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs">
            <span className="mb-1 block text-[var(--muted)]">Change</span>
            <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={mode === m.id}
                  className={`px-3 py-1.5 text-xs font-semibold ${mode === m.id ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--brand-deep)]"}`}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <label className="text-xs">
            <span className="mb-1 block text-[var(--muted)]">Days</span>
            <input className="field !py-1.5 w-24" type="number" min={0} step={0.5} inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label className="min-w-[14rem] flex-1 text-xs">
            <span className="mb-1 block text-[var(--muted)]">Reason (goes in the record)</span>
            <input className="field !py-1.5 w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Senior teachers get 10 CL from 2026-27" />
          </label>
          <button
            type="button"
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            disabled={selected.size === 0 || days.trim() === "" || !reason.trim()}
            onClick={apply}
          >
            Apply to selected ({selected.size})
          </button>
        </div>
        {err ? <p className="mt-2 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs font-medium text-[var(--danger)]">{err}</p> : null}

        <div className="mt-3 flex items-center gap-2 text-xs">
          <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1 font-semibold text-[var(--brand-deep)]" onClick={() => setSelected(selected.size === roster.length ? new Set() : new Set(roster.map((s) => s.id)))}>
            {selected.size === roster.length ? "Unselect all" : "Select all"}
          </button>
          <span className="text-[var(--muted)]">Allotted / taken / left for this session; the default for a new person is {type?.defaultDaysPerYear ?? 0} {typeCode}.</span>
        </div>
        <div className="mt-2 max-h-[min(55vh,460px)] overflow-auto">
          <ErpTable>
            <ErpTableHead sticky>
              <tr>
                <th className="w-10 px-3 py-2" />
                <ErpSortTh sort={sort} field="staff">Staff</ErpSortTh>
                {hr.leaveTypes.map((t) => (
                  <th key={t.code} className={`px-3 py-2 text-center ${t.code === typeCode ? "text-[var(--brand-deep)]" : ""}`}>
                    {t.code}
                  </th>
                ))}
                <th className="w-10 px-2 py-2" aria-label="Actions" />
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {sort.rows.map((s) => (
                <tr key={s.id} className={selected.has(s.id) ? "bg-[var(--surface-sunken)]" : ""}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.fullName}`} />
                  </td>
                  <td className="px-3 py-2 font-medium text-[var(--brand-deep)]">
                    {s.empCode} · {s.fullName}
                  </td>
                  {hr.leaveTypes.map((t) => {
                    const b = balanceOf(s.id, t.code);
                    const allotted = b?.allotted ?? t.defaultDaysPerYear;
                    return (
                      <td key={t.code} className={`px-3 py-2 text-center text-xs ${t.code === typeCode ? "font-semibold" : "text-[var(--muted)]"}`}>
                        {allotted + (b?.carriedForward ?? 0)} / {b?.used ?? 0} / {b ? remainingBalance(b) : allotted}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right">
                    <RowActionMenu
                      row={s}
                      label={`${s.fullName} actions`}
                      actions={[
                        { id: "only", label: "Select only this person", onSelect: (x) => setSelected(new Set([x.id])) },
                        { id: "record", label: "Show this person's record", onSelect: (x) => setLogStaff(x.id) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Allotment record · {ay}</h3>
          <select className="field !py-1 text-xs" value={logStaff} onChange={(e) => setLogStaff(e.target.value)} aria-label="Filter record by staff">
            <option value="">All staff</option>
            {roster.map((s) => (
              <option key={s.id} value={s.id}>
                {s.empCode} · {s.fullName}
              </option>
            ))}
          </select>
        </div>
        {log.length ? (
          <div className="mt-2 max-h-[min(50vh,420px)] overflow-auto">
            <ErpTable>
              <ErpTableHead sticky>
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Staff</th>
                  <th className="px-3 py-2">Leave</th>
                  <th className="px-3 py-2">Change</th>
                  <th className="px-3 py-2 text-center">Before → after</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">By</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {log.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{new Date(c.changedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="px-3 py-2 text-xs font-medium text-[var(--brand-deep)]">{nameOf(c.staffId)}</td>
                    <td className="px-3 py-2 text-xs">{c.typeCode}</td>
                    <td className={`px-3 py-2 text-xs font-semibold ${c.after > c.before ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{allotmentChangeLabel(c)}</td>
                    <td className="px-3 py-2 text-center text-xs">
                      {c.before} → {c.after}
                    </td>
                    <td className="px-3 py-2 text-xs">{c.reason}</td>
                    <td className="px-3 py-2 text-xs text-[var(--muted)]">{c.changedBy}</td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--muted)]">No allotment changes recorded{logStaff ? " for this person" : ""} this session yet.</p>
        )}
      </div>
    </div>
  );
}
