"use client";

import { useCallback, useEffect, useState } from "react";
import {
  normalizeReminderSettings,
  REMINDER_RULE_LABELS,
  REMINDER_RULES,
  type ReminderRule,
  type ReminderSettings,
} from "@/lib/staffReminders";

const WHAT: Record<ReminderRule, string> = {
  punch: "Staff who should punch and have not (not exempt, on leave, outdoor duty or a holiday)",
  register: "Class teachers whose register is not taken — the co-ordinator or substitute when the teacher is away",
  homework: "Teachers who had a period today by the published timetable and posted no homework for it",
  marks: "Subject teachers with marks to enter, daily from the days before an exam's “marks due by” date",
  approvals: "Whoever must decide leave, verify documents, or act on a complaint or request",
};

/**
 * Staff → Dashboard → Work reminders (director, 29 Oct 2026). The times each
 * personal reminder goes out (lib/staffReminders). Read and saved on the
 * server at once, over the copy this screen loaded (409 when someone else
 * saved meanwhile) — no browser copy.
 */
export function StaffRemindersPanel({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [base, setBase] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff/reminders/settings", { cache: "no-store" });
      const body = (await res.json()) as { ok: boolean; error?: string; settings?: unknown; updatedAt?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setSettings(normalizeReminderSettings(body.settings));
      setBase(body.updatedAt ?? "");
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the reminder settings");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/staff/reminders/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings, baseUpdatedAt: base }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string; updatedAt?: string; settings?: unknown };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setSettings(normalizeReminderSettings(body.settings));
      setBase(body.updatedAt ?? "");
      setMsg({ ok: true, text: "Saved" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Not saved" });
    } finally {
      setBusy(false);
    }
  }

  const setRule = (rule: ReminderRule, patch: Partial<ReminderSettings["rules"][ReminderRule]>) =>
    setSettings((s) => (s ? { ...s, rules: { ...s.rules, [rule]: { ...s.rules[rule], ...patch } } } : s));

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="Work reminders">
      <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Work reminders</h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Each member of staff is reminded in the staff app — the bell and their phone — of their own pending work, once a
        day. WhatsApp only for staff the app cannot reach. Each person&apos;s quiet hours and muted topics apply.
      </p>
      {err ? (
        <p className="mt-2 text-xs text-[var(--danger)]">
          {err}{" "}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : null}
      {settings ? (
        <>
          <label className="mt-3 flex items-center gap-2 text-sm text-[var(--brand-deep)]">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={!canEdit}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
            />
            Send work reminders
          </label>
          <ul className="mt-3 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {REMINDER_RULES.map((rule) => (
              <li key={rule} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <label className="flex min-w-[9rem] items-center gap-2 font-medium text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    checked={settings.rules[rule].enabled}
                    disabled={!canEdit}
                    onChange={(e) => setRule(rule, { enabled: e.target.checked })}
                  />
                  {REMINDER_RULE_LABELS[rule]}
                </label>
                <input
                  type="time"
                  aria-label={`${REMINDER_RULE_LABELS[rule]} time`}
                  className="field !w-28 !py-1"
                  value={settings.rules[rule].at}
                  disabled={!canEdit}
                  onChange={(e) => e.target.value && setRule(rule, { at: e.target.value })}
                />
                <span className="basis-full text-xs text-[var(--muted)] sm:basis-auto sm:flex-1">{WHAT[rule]}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--brand-deep)]">
            <label className="flex items-center gap-2">
              Marks: from
              <input
                type="number"
                min={0}
                max={14}
                className="field !w-16 !py-1"
                value={settings.marksLeadDays}
                disabled={!canEdit}
                onChange={(e) => setSettings({ ...settings, marksLeadDays: Number(e.target.value) || 0 })}
              />
              days before
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.whatsappFallback}
                disabled={!canEdit}
                onChange={(e) => setSettings({ ...settings, whatsappFallback: e.target.checked })}
              />
              WhatsApp when the app has not been used for
              <input
                type="number"
                min={1}
                max={30}
                className="field !w-16 !py-1"
                value={settings.appInactiveDays}
                disabled={!canEdit}
                onChange={(e) => setSettings({ ...settings, appInactiveDays: Number(e.target.value) || 1 })}
              />
              days
            </label>
          </div>
          {canEdit ? (
            <div className="mt-3 flex items-center gap-3">
              <button type="button" className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50" disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save reminder times"}
              </button>
              {msg ? <span className={`text-xs ${msg.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</span> : null}
            </div>
          ) : null}
        </>
      ) : !err ? (
        <p className="mt-2 text-xs text-[var(--muted)]">Loading…</p>
      ) : null}
    </section>
  );
}
