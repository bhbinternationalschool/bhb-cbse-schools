"use client";

import { useEffect, useState } from "react";
import { RemoveControl } from "@/components/masters/RemoveControl";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import {
  checkLeaveTypeRemoval,
  describeLeaveRules,
  loadStaffHr,
  removeLeaveType,
  upsertLeaveType,
  type LeaveType,
  type StaffHrState,
} from "@/lib/staffHr";

export function StaffLeaveTypesPanel() {
  const [hr, setHr] = useState<StaffHrState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [paid, setPaid] = useState(true);
  const [days, setDays] = useState("12");
  const [maxPerMonth, setMaxPerMonth] = useState("0");
  const [maxPerRequest, setMaxPerRequest] = useState("0");
  const [maxCarry, setMaxCarry] = useState("0");

  function reload() {
    setHr(loadStaffHr());
  }

  useEffect(() => {
    reload();
  }, []);

  function flash(msg: string, isErr = false) {
    if (isErr) {
      setError(msg);
      setNotice(null);
    } else {
      setNotice(msg);
      setError(null);
    }
    window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, 2600);
  }

  function resetForm() {
    setEditingCode(null);
    setCode("");
    setName("");
    setPaid(true);
    setDays("12");
    setMaxPerMonth("0");
    setMaxPerRequest("0");
    setMaxCarry("0");
  }

  function startEdit(t: LeaveType) {
    setEditingCode(t.code);
    setCode(t.code);
    setName(t.name);
    setPaid(t.paid);
    setDays(String(t.defaultDaysPerYear));
    setMaxPerMonth(String(t.maxDaysPerMonth));
    setMaxPerRequest(String(t.maxDaysPerRequest));
    setMaxCarry(String(t.maxCarryForward));
  }

  function onSave() {
    const result = upsertLeaveType({
      code,
      name,
      paid,
      defaultDaysPerYear: Number(days) || 0,
      maxDaysPerMonth: Number(maxPerMonth) || 0,
      maxDaysPerRequest: Number(maxPerRequest) || 0,
      maxCarryForward: Number(maxCarry) || 0,
      previousCode: editingCode ?? undefined,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    setHr(result.state);
    flash(
      editingCode
        ? `Updated ${code.toUpperCase()}`
        : `Added ${code.toUpperCase()}`,
    );
    resetForm();
  }

  function onRemove(typeCode: string) {
    const result = removeLeaveType(typeCode);
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    setHr(result.state);
    if (editingCode === typeCode) resetForm();
    flash(`Removed ${typeCode}`);
  }

  if (!hr) {
    return <p className="text-sm text-[var(--muted)]">Loading leave types…</p>;
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-lg bg-[#fee2e2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <MastersTableCard title="Leave types & adjustment rules">
          <ul className="divide-y divide-[var(--border)]">
            {hr.leaveTypes.map((t) => (
              <li
                key={t.code}
                className="flex items-start justify-between gap-2 px-4 py-2.5 text-sm"
              >
                <div>
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {t.code}
                  </span>{" "}
                  {t.name}
                  <div className="text-[11px] text-[var(--muted)]">
                    {t.defaultDaysPerYear} days/year
                    {t.paid ? "" : " · unpaid"}
                  </div>
                  <div className="text-[11px] font-medium text-[var(--brand-mid)]">
                    Rules: {describeLeaveRules(t)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    className="text-xs font-medium text-[var(--brand-mid)]"
                    onClick={() => startEdit(t)}
                  >
                    Edit
                  </button>
                  <RemoveControl
                    compact
                    check={checkLeaveTypeRemoval(hr, t.code)}
                    onRemove={() => onRemove(t.code)}
                  />
                </div>
              </li>
            ))}
            {hr.leaveTypes.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                No leave types defined yet
              </li>
            ) : null}
          </ul>
        </MastersTableCard>

        <MastersWorkCard
          title={editingCode ? `Edit ${editingCode}` : "Add leave type"}
          hint="Adjustment rules: 0 = no limit. Example: CL max 1 day/month."
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                className="field !py-1.5 w-24"
                placeholder="Code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={12}
                disabled={!!editingCode}
                title={
                  editingCode
                    ? "Code locked while editing (delete & re-add to change)"
                    : undefined
                }
              />
              <input
                className="field !py-1.5 min-w-[8rem] flex-1"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="field !py-1.5 w-24"
                type="number"
                min={0}
                step={0.5}
                placeholder="Days/yr"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                title="Allotted days per academic year"
              />
              <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-deep)]">
                <input
                  type="checkbox"
                  checked={paid}
                  onChange={(e) => setPaid(e.target.checked)}
                />
                Paid
              </label>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Adjustment rules
              </p>
              <div className="flex flex-wrap gap-2">
                <label className="block text-xs">
                  <span className="mb-1 block text-[var(--muted)]">
                    Max days / month
                  </span>
                  <input
                    className="field !py-1.5 w-28"
                    type="number"
                    min={0}
                    step={0.5}
                    value={maxPerMonth}
                    onChange={(e) => setMaxPerMonth(e.target.value)}
                  />
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-[var(--muted)]">
                    Max days / application
                  </span>
                  <input
                    className="field !py-1.5 w-28"
                    type="number"
                    min={0}
                    step={0.5}
                    value={maxPerRequest}
                    onChange={(e) => setMaxPerRequest(e.target.value)}
                  />
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-[var(--muted)]">
                    Max carry-forward
                  </span>
                  <input
                    className="field !py-1.5 w-28"
                    type="number"
                    min={0}
                    step={0.5}
                    value={maxCarry}
                    onChange={(e) => setMaxCarry(e.target.value)}
                    title="Unused days that may roll into next AY (EL typically 15)"
                  />
                </label>
              </div>
              <p className="mt-2 text-[10px] text-[var(--muted)]">
                Enforced on Staff → Leave apply and approve. Pending + approved
                count toward the monthly cap. Carry-forward runs from Leave →
                balances tools.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
                onClick={onSave}
              >
                {editingCode ? "Save" : "Add"}
              </button>
              {editingCode ? (
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
                  onClick={resetForm}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </MastersWorkCard>
      </div>
    </div>
  );
}
