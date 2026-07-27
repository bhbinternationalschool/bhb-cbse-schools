"use client";

import { useEffect, useState } from "react";
import { MastersWorkCard } from "@/components/masters/MastersLayout";
import {
  loadStaffHr,
  normalizeLeaveSettings,
  saveLeaveSettings,
  type StaffHrState,
} from "@/lib/staffHr";

export function LeaveApprovalSettingsPanel() {
  const [hr, setHr] = useState<StaffHrState | null>(null);
  const [lateMinutes, setLateMinutes] = useState("15");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    const state = loadStaffHr();
    setHr(state);
    setLateMinutes(
      String(normalizeLeaveSettings(state.leaveSettings).gracePeriodMinutes),
    );
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
    }, 2400);
  }

  function setFlag(
    key: "autoApproveLeaves" | "twoLevelApproval",
    value: boolean,
  ) {
    const next = saveLeaveSettings({ [key]: value });
    setHr(next);
    flash("Leave settings saved");
  }

  function saveLateMinutes(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(lateMinutes);
    if (!Number.isFinite(n) || n < 0) {
      flash("Enter a valid number of minutes (0 or more)", true);
      return;
    }
    if (n > 240) {
      flash("Late duration cannot exceed 240 minutes", true);
      return;
    }
    const next = saveLeaveSettings({ gracePeriodMinutes: Math.round(n) });
    setHr(next);
    setLateMinutes(
      String(normalizeLeaveSettings(next.leaveSettings).gracePeriodMinutes),
    );
    flash("Late duration saved");
  }

  if (!hr) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading leave settings…</p>
    );
  }

  const settings = normalizeLeaveSettings(hr.leaveSettings);

  return (
    <MastersWorkCard
      title="Leave settings"
      hint="Auto-approval, two-level flow, and how many minutes after start count as late."
    >
      {error ? (
        <p className="mb-3 rounded-lg bg-[#fee2e2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-3 rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <div className="space-y-4">
        <RuleRow
          rule="Rule 1"
          label="Auto approve leaves"
          enabled={settings.autoApproveLeaves}
          onEnable={() => setFlag("autoApproveLeaves", true)}
          onDisable={() => setFlag("autoApproveLeaves", false)}
        />
        <RuleRow
          rule="Rule 2"
          label="2 level approval"
          enabled={settings.twoLevelApproval}
          onEnable={() => setFlag("twoLevelApproval", true)}
          onDisable={() => setFlag("twoLevelApproval", false)}
          disabledHint={
            settings.autoApproveLeaves
              ? "Ignored while auto-approve is enabled"
              : undefined
          }
        />

        <div className="border-b border-[rgba(32,48,80,0.08)] pb-3 last:border-0 last:pb-0">
          <div className="mb-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
              Rule 3
            </div>
            <div className="text-sm font-semibold text-[var(--brand-deep)]">
              Enter the duration (in minutes) that is considered late.
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              Punch-in within this many minutes after school start is still
              present; beyond that is marked late. Also softens leave half-day
              time cutoffs. 0 = any minute after start is late.
            </div>
          </div>
          <form
            onSubmit={saveLateMinutes}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Minutes
              </span>
              <input
                type="number"
                min={0}
                max={240}
                step={1}
                className="field !py-1.5 w-28"
                value={lateMinutes}
                onChange={(e) => setLateMinutes(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-xs font-bold text-white"
            >
              Save
            </button>
          </form>
        </div>
      </div>
    </MastersWorkCard>
  );
}

function RuleRow({
  rule,
  label,
  enabled,
  onEnable,
  onDisable,
  disabledHint,
}: {
  rule: string;
  label: string;
  enabled: boolean;
  onEnable: () => void;
  onDisable: () => void;
  disabledHint?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(32,48,80,0.08)] pb-3 last:border-0 last:pb-0">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
          {rule}
        </div>
        <div className="text-sm font-semibold text-[var(--brand-deep)]">
          {label}
        </div>
        {disabledHint ? (
          <div className="text-[11px] text-[var(--muted)]">{disabledHint}</div>
        ) : (
          <div className="text-[11px] text-[var(--muted)]">
            {enabled ? "Enabled" : "Disabled"}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
            enabled
              ? "bg-[var(--brand-deep)] text-white"
              : "border border-[rgba(32,48,80,0.15)] text-[var(--brand-deep)]"
          }`}
          onClick={onEnable}
        >
          Enable
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
            !enabled
              ? "bg-[var(--brand-deep)] text-white"
              : "border border-[rgba(32,48,80,0.15)] text-[var(--brand-deep)]"
          }`}
          onClick={onDisable}
        >
          Disable
        </button>
      </div>
    </div>
  );
}
