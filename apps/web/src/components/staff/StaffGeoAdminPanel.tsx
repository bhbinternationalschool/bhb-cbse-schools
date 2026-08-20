"use client";

/**
 * Staff → GPS presence — live board (who is on campus / outside / dark),
 * incidents with alert delivery, and the settings: geofence radius, school
 * timing, thresholds, alert recipients (owner / admin / principal),
 * exemptions, consent status. Reading the board never raises incidents —
 * only the scheduled tick does.
 */

import { useEffect, useMemo, useState } from "react";
import { MapPin, RefreshCw } from "lucide-react";
import { normalizeStaffGeoSettings, type StaffGeoConsent, type StaffGeoSettings, type StaffPresence } from "@/lib/staffGeo";
import { loadMasters } from "@/lib/masters";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";

const inp = "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm";

type BoardRow = { staffId: string; empCode: string; fullName: string; presence: StaffPresence; distanceM: number | null; minutesSincePing: number | null; consented: boolean; exempt: boolean; lastAt: string };
type Incident = { id: string; empCode: string; fullName: string; date: string; at: string; kind: string; kindLabel: string; distanceM: number | null; detail: string; alerted: boolean; alertDetail: string };

const PRESENCE_LABEL: Record<StaffPresence, { label: string; cls: string }> = {
  inside: { label: "On premises", cls: "bg-[var(--success-soft)] text-[var(--success)]" },
  outside: { label: "OUTSIDE", cls: "bg-[var(--danger)]/10 text-[var(--danger)]" },
  stale: { label: "Location dark", cls: "bg-[var(--warning-soft)] text-[var(--warning)]" },
  no_ping_yet: { label: "No signal today", cls: "bg-[var(--warning-soft)] text-[var(--warning)]" },
  not_tracked: { label: "Not tracked", cls: "bg-[var(--surface-sunken)] text-[var(--muted)]" },
};

export function StaffGeoAdminPanel({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<StaffGeoSettings | null>(null);
  const [consents, setConsents] = useState<StaffGeoConsent[]>([]);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [tracking, setTracking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const staff = useMemo(() => (loadMasters().staff ?? []).filter((s) => s.status === "active"), []);

  async function load() {
    setBusy("load");
    try {
      const [s, b] = await Promise.all([fetch("/api/staff-geo/settings").then((r) => r.json()), fetch("/api/staff-geo/board").then((r) => r.json())]);
      if (s.ok) {
        setSettings(s.settings);
        setConsents(s.consents || []);
      }
      if (b.ok) {
        setBoard(b.board || []);
        setIncidents(b.incidents || []);
        setTracking(!!b.tracking);
      }
      if (!s.ok && s.error) setError(s.error);
    } catch {
      setError("Could not load GPS presence data");
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const t = notice ? window.setTimeout(() => setNotice(null), 3500) : null;
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [notice]);

  function patch(p: Partial<StaffGeoSettings>) {
    setSettings((s) => (s ? { ...s, ...p } : s));
    setDirty(true);
  }
  async function save() {
    if (!settings) return;
    setBusy("save");
    try {
      const r = await fetch("/api/staff-geo/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const j = await r.json();
      if (!r.ok || !j.ok) return setError(j.error || "Save failed");
      setSettings(normalizeStaffGeoSettings(j.settings));
      setDirty(false);
      setNotice("Settings saved");
      void load();
    } finally {
      setBusy(null);
    }
  }

  if (!settings) return <p className="mt-4 text-sm text-[var(--muted)]">{error || "Loading…"}</p>;

  const counts = board.reduce(
    (a, r) => {
      a[r.presence] = (a[r.presence] || 0) + 1;
      return a;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="mt-4 space-y-4">
      {notice ? <p className="rounded-lg bg-[var(--success-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--success)]">{notice}</p> : null}
      {error ? <p className="rounded-lg bg-[var(--danger)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}

      {/* Live board */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <MapPin className="h-4 w-4 text-[var(--brand-deep)]" />
          <p className="text-sm font-semibold">Live board</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${settings.enabled ? (tracking ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--surface-sunken)] text-[var(--muted)]") : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}>
            {!settings.enabled ? "TRACKING OFF" : tracking ? "in school timing — evaluating" : "outside school timing"}
          </span>
          <span className="text-[11px] text-[var(--muted)]">
            {counts.inside || 0} on premises · {counts.outside || 0} outside · {(counts.stale || 0) + (counts.no_ping_yet || 0)} dark · {counts.not_tracked || 0} not tracked
          </span>
          <button type="button" disabled={busy === "load"} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50" onClick={() => void load()}>
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
        <div className="mt-2">
          <ErpTableShell>
            <ErpTable>
              <ErpTableHead>
                <tr>
                  <th className="px-2 py-2 text-left">Staff</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-right">Distance</th>
                  <th className="px-2 py-2 text-right">Last ping</th>
                  <th className="px-2 py-2 text-left">Consent</th>
                  <th className="px-2 py-2 text-left">Exempt</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {board.map((r) => {
                  const p = PRESENCE_LABEL[r.presence];
                  return (
                    <tr key={r.staffId} className="text-xs">
                      <td className="px-2 py-1.5 font-semibold">{r.fullName}<span className="ml-1 font-normal text-[var(--muted)]">{r.empCode}</span></td>
                      <td className="px-2 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.cls}`}>{p.label}</span></td>
                      <td className="px-2 py-1.5 text-right">{r.distanceM != null ? `${r.distanceM} m` : "—"}</td>
                      <td className="px-2 py-1.5 text-right">{r.minutesSincePing != null ? `${r.minutesSincePing} min ago` : r.lastAt ? new Date(r.lastAt).toLocaleDateString("en-IN") : "never"}</td>
                      <td className="px-2 py-1.5">{r.consented ? "✓" : <span className="text-[var(--warning)]">not yet</span>}</td>
                      <td className="px-2 py-1.5">
                        {canEdit ? (
                          <input
                            type="checkbox"
                            checked={settings.exemptStaffIds.includes(r.staffId)}
                            onChange={(e) => patch({ exemptStaffIds: e.target.checked ? [...settings.exemptStaffIds, r.staffId] : settings.exemptStaffIds.filter((x) => x !== r.staffId) })}
                          />
                        ) : r.exempt ? "✓" : ""}
                      </td>
                    </tr>
                  );
                })}
              </ErpTableBody>
            </ErpTable>
          </ErpTableShell>
        </div>
        <p className="mt-1 text-[10px] text-[var(--muted)]">
          Staff share location from Staff → My presence on their phone (consent recorded on first use; {consents.length} of {staff.length} consented). &ldquo;Location dark&rdquo; = app closed / location off / phone off — alerted during school timing. Evaluation and alerts run every 5 minutes on the server; this board is read-only.
        </p>
      </div>

      {/* Incidents */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-sm font-semibold">Incidents</p>
        {incidents.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--muted)]">None recorded.</p>
        ) : (
          <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto text-[11px]">
            {incidents.map((i) => (
              <li key={i.id} className={`rounded-lg border-l-4 px-2 py-1 ${i.kind === "left_premises" || i.kind === "location_off" ? "border-[var(--danger)]" : "border-[var(--success)]"}`}>
                <span className="font-semibold">{i.fullName}</span> ({i.empCode}) · {i.kindLabel} · {new Date(i.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                {i.distanceM != null ? ` · ${i.distanceM} m` : ""} — {i.detail}
                <span className={`ml-1 ${i.alerted ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>{i.alerted ? `alerted (${i.alertDetail})` : "alert not delivered"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Settings */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-sm font-semibold">Settings</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <label className="inline-flex items-center gap-2 text-xs sm:col-span-4">
            <input type="checkbox" checked={settings.enabled} disabled={!canEdit} onChange={(e) => patch({ enabled: e.target.checked })} />
            Enable staff GPS presence tracking (inform staff first — consent is asked on their phone)
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            Campus radius (m)
            <input type="number" className={`${inp} mt-0.5`} disabled={!canEdit} value={settings.radiusM} onChange={(e) => patch({ radiusM: Number(e.target.value) || 150 })} />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            GPS tolerance (m)
            <input type="number" className={`${inp} mt-0.5`} disabled={!canEdit} value={settings.toleranceM} onChange={(e) => patch({ toleranceM: Number(e.target.value) || 0 })} />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            School timing from
            <input type="time" className={`${inp} mt-0.5`} disabled={!canEdit} value={settings.startTime} onChange={(e) => patch({ startTime: e.target.value })} />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            to
            <input type="time" className={`${inp} mt-0.5`} disabled={!canEdit} value={settings.endTime} onChange={(e) => patch({ endTime: e.target.value })} />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            Ping every (min)
            <input type="number" className={`${inp} mt-0.5`} disabled={!canEdit} value={settings.pingIntervalMin} onChange={(e) => patch({ pingIntervalMin: Number(e.target.value) || 5 })} />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            &ldquo;Location off&rdquo; after (min)
            <input type="number" className={`${inp} mt-0.5`} disabled={!canEdit} value={settings.staleAfterMin} onChange={(e) => patch({ staleAfterMin: Number(e.target.value) || 20 })} />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            &ldquo;Left premises&rdquo; after (min outside)
            <input type="number" className={`${inp} mt-0.5`} disabled={!canEdit} value={settings.outsideGraceMin} onChange={(e) => patch({ outsideGraceMin: Number(e.target.value) || 10 })} />
          </label>
          <label className="inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={settings.skipAbsent} disabled={!canEdit} onChange={(e) => patch({ skipAbsent: e.target.checked })} />
            Skip staff marked absent / on leave
          </label>
          <div className="text-[11px] text-[var(--muted)]">
            Working days
            <div className="mt-1 flex gap-1">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d, i) => (
                <button key={d} type="button" disabled={!canEdit} className={`rounded-full border px-2 py-0.5 text-[10px] ${settings.workingDays.includes(i) ? "border-[var(--brand-deep)] bg-[var(--brand-deep)] text-white" : "border-[var(--border)]"}`} onClick={() => patch({ workingDays: settings.workingDays.includes(i) ? settings.workingDays.filter((x) => x !== i) : [...settings.workingDays, i].sort() })}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2">
          <p className="text-[11px] font-semibold">Alert recipients (WhatsApp) — owner, admin, principal</p>
          {settings.recipients.map((r, i) => (
            <div key={i} className="mt-1 flex gap-1">
              <input className={`${inp} !w-48`} disabled={!canEdit} value={r.name} placeholder="Name / role" onChange={(e) => patch({ recipients: settings.recipients.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input className={`${inp} !w-40`} disabled={!canEdit} value={r.mobile} placeholder="10-digit mobile" onChange={(e) => patch({ recipients: settings.recipients.map((x, j) => (j === i ? { ...x, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) } : x)) })} />
              {canEdit ? (
                <button type="button" className="text-[var(--danger)]" onClick={() => patch({ recipients: settings.recipients.filter((_, j) => j !== i) })}>
                  ×
                </button>
              ) : null}
            </div>
          ))}
          {canEdit && settings.recipients.length < 10 ? (
            <button type="button" className="mt-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold" onClick={() => patch({ recipients: [...settings.recipients, { name: "", mobile: "" }] })}>
              + Recipient
            </button>
          ) : null}
        </div>
        {canEdit ? (
          <button type="button" disabled={!dirty || busy === "save"} className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50" onClick={() => void save()}>
            Save settings
          </button>
        ) : null}
        <p className="mt-2 text-[10px] text-[var(--muted)]">
          Privacy: tracking runs only inside school timing on working days; the school stores each staff member&apos;s latest position and incidents, not a movement trail; staff consent on their own phone before the first ping and can stop sharing (which is itself flagged during school timing). Inform staff in writing before enabling — this is workplace attendance monitoring under DPDP.
        </p>
      </div>
    </div>
  );
}
