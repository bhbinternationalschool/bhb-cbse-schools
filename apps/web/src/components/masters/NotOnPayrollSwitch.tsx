"use client";

import { useState } from "react";
import {
  NOT_ON_PAYROLL_PRESETS,
  isOnPayroll,
  type NotOnPayrollFields,
} from "@/lib/payrollNotOnPayroll";

const OTHER = "__other";

/**
 * Masters → Salary setup → Assign staff: the "Not on payroll" switch for one
 * staff member. Saved on its own (not through the row's Assign), because it
 * is a yes/no about the person, not part of their salary figures.
 */
export function NotOnPayrollSwitch({
  link,
  staffName,
  onChange,
}: {
  link: (NotOnPayrollFields & { staffId: string }) | undefined;
  staffName: string;
  onChange: (on: boolean, reason: string) => void;
}) {
  const on = !isOnPayroll(link);
  const [editing, setEditing] = useState(false);
  const [preset, setPreset] = useState<string>(NOT_ON_PAYROLL_PRESETS[0]);
  const [other, setOther] = useState("");

  if (on) {
    return (
      <div className="space-y-1 text-[10px] leading-tight">
        <span className="inline-block rounded-md bg-[var(--surface-sunken)] px-1.5 py-0.5 font-semibold text-[var(--brand-deep)]">
          Not on payroll
        </span>
        {link?.notOnPayrollReason ? (
          <div className="text-[var(--muted)]">{link.notOnPayrollReason}</div>
        ) : null}
        {link?.notOnPayrollSetBy ? (
          <div className="text-[var(--muted)]">
            by {link.notOnPayrollSetBy}
            {link.notOnPayrollSetAt ? ` · ${link.notOnPayrollSetAt.slice(0, 10)}` : ""}
          </div>
        ) : null}
        <button
          type="button"
          className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
          onClick={() => {
            if (window.confirm("Put this staff member back on payroll? New salary runs will include them.")) {
              onChange(false, "");
            }
          }}
        >
          Put back on payroll
        </button>
      </div>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--brand-deep)]"
        onClick={() => setEditing(true)}
        title="Left out of every new salary run; stays active for attendance, the staff app and roles"
      >
        On payroll · mark not
      </button>
    );
  }

  const reason = preset === OTHER ? other.trim() : preset;
  return (
    <div className="space-y-1">
      <select
        aria-label={`Why ${staffName} is not on payroll`}
        className="field !py-1 text-[11px]"
        value={preset}
        onChange={(e) => setPreset(e.target.value)}
      >
        {NOT_ON_PAYROLL_PRESETS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>
      {preset === OTHER ? (
        <input
          className="field !w-36 !py-1 text-[10px]"
          placeholder="Reason (optional)"
          maxLength={120}
          value={other}
          onChange={(e) => setOther(e.target.value)}
        />
      ) : null}
      <div className="flex gap-1.5">
        <button
          type="button"
          className="rounded-lg bg-[var(--primary)] px-2 py-1 text-[10px] font-semibold text-[var(--primary-foreground)]"
          onClick={() => {
            onChange(true, reason);
            setEditing(false);
          }}
        >
          Not on payroll
        </button>
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--brand-deep)]"
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
