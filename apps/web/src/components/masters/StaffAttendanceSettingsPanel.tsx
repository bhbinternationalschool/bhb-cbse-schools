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

  function setNumber(key: "geofenceRadiusM" | "maxLocationAccuracyM", value: number) {
    const next = saveAttendanceSettings({ [key]: value });
    setState(next);
    flash("Geofence settings saved");
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
      hint="Self-punch, WhatsApp GPS punch, geofence, auto rules, and leave sync."
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
        <FlagRow
          rule="Rule 4"
          label="Allow WhatsApp attendance (IN/OUT + location)"
          enabled={settings.allowWhatsAppPunch}
          onEnable={() => setFlag("allowWhatsAppPunch", true)}
          onDisable={() => setFlag("allowWhatsAppPunch", false)}
        />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-4">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            Campus geofence (WhatsApp)
          </p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Teachers must share live location within radius of school coordinates.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="font-semibold text-[var(--brand-deep)]">
                Radius (metres)
              </span>
              <input
                type="number"
                min={50}
                max={500}
                className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                value={settings.geofenceRadiusM}
                onChange={(e) =>
                  setNumber(
                    "geofenceRadiusM",
                    Math.max(50, Number(e.target.value) || 150),
                  )
                }
              />
            </label>
            <label className="block text-xs">
              <span className="font-semibold text-[var(--brand-deep)]">
                Max GPS accuracy (m, 0=off)
              </span>
              <input
                type="number"
                min={0}
                max={500}
                className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                value={settings.maxLocationAccuracyM}
                onChange={(e) =>
                  setNumber(
                    "maxLocationAccuracyM",
                    Math.max(0, Number(e.target.value) || 0),
                  )
                }
              />
            </label>
          </div>
        </div>
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
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
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "border border-[var(--border)] text-[var(--brand-deep)]"
          }`}
          onClick={onEnable}
        >
          Enable
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
            !enabled
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "border border-[var(--border)] text-[var(--brand-deep)]"
          }`}
          onClick={onDisable}
        >
          Disable
        </button>
      </div>
    </div>
  );
}
