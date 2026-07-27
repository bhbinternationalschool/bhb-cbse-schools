"use client";

import { useEffect, useState } from "react";
import { MastersWorkCard } from "@/components/masters/MastersLayout";
import {
  loadStaffAttendance,
  normalizeAttendanceSettings,
  saveAttendanceSettings,
  type StaffAttendanceSettings,
  type StaffAttendanceState,
} from "@/lib/staffAttendance";

export function StaffAttendanceSettingsPanel() {
  const [state, setState] = useState<StaffAttendanceState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setState(loadStaffAttendance());
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2400);
  }

  function setFlag(key: keyof StaffAttendanceSettings, value: boolean) {
    const next = saveAttendanceSettings({ [key]: value });
    setState(next);
    flash("Attendance settings saved");
  }

  if (!state) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading attendance settings…</p>
    );
  }

  const settings = normalizeAttendanceSettings(state.settings);

  return (
    <MastersWorkCard
      title="Attendance settings"
      hint="Self-punch, auto rules, and syncing approved leave onto the day register."
    >
      {notice ? (
        <p className="mb-3 rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}
      <div className="space-y-4">
        <FlagRow
          rule="Rule 1"
          label="Allow staff self-punch"
          enabled={settings.allowSelfPunch}
          onEnable={() => setFlag("allowSelfPunch", true)}
          onDisable={() => setFlag("allowSelfPunch", false)}
        />
        <FlagRow
          rule="Rule 2"
          label="Auto-apply punch rules on save"
          enabled={settings.autoApplyRulesOnSave}
          onEnable={() => setFlag("autoApplyRulesOnSave", true)}
          onDisable={() => setFlag("autoApplyRulesOnSave", false)}
        />
        <FlagRow
          rule="Rule 3"
          label="Sync approved leave to attendance (LE / HD)"
          enabled={settings.syncLeaveToAttendance}
          onEnable={() => setFlag("syncLeaveToAttendance", true)}
          onDisable={() => setFlag("syncLeaveToAttendance", false)}
        />
      </div>
    </MastersWorkCard>
  );
}

function FlagRow({
  rule,
  label,
  enabled,
  onEnable,
  onDisable,
}: {
  rule: string;
  label: string;
  enabled: boolean;
  onEnable: () => void;
  onDisable: () => void;
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
        <div className="text-[11px] text-[var(--muted)]">
          {enabled ? "Enabled" : "Disabled"}
        </div>
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
