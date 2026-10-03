"use client";

import { useCallback, useEffect, useState } from "react";

type Device = {
  id: string;
  staff_id: string;
  staffName: string;
  status: "active" | "pending";
  label: string;
  created_at: string;
  decided_by: string;
  last_used_at: string | null;
  attempts?: { kind: "in" | "out"; at: string }[];
};
type Screen = { id: string; label: string; created_by: string; created_at: string; last_seen_at: string | null };
type Data = { devices: Device[]; screens: Screen[]; staffWithoutPhone: { id: string; name: string }[] };

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const triedText = (d: Device) =>
  (d.attempts ?? []).map((a) => `${a.kind.toUpperCase()} ${hhmm(a.at)}`).join(", ");

const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

/**
 * Office: whose phone punches for whom, phones waiting for approval, and the
 * QR screens (30 Sep 2026). A staff member's first punch registers their
 * phone; a punch from any other phone lands here as "waiting".
 */
export function PunchPhonesPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("Office tablet");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/staff/attendance/punch-devices", { cache: "no-store" }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; data?: Data; error?: { message?: string } } | null;
    if (!res?.ok || !body?.ok || !body.data) {
      setError(body?.error?.message || "Could not load punch phones");
      return;
    }
    setError(null);
    setData(body.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(payload: Record<string, string | number>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return null;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/staff/attendance/punch-devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: { token?: string; recorded?: { kind: string; time: string; ok: boolean; note?: string }[] };
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message || "Not saved");
        return null;
      }
      const rec = body.data?.recorded ?? [];
      setNotice(
        rec.length
          ? rec
              .map((x) => `${x.kind.toUpperCase()} ${x.time} ${x.ok ? "recorded" : `NOT recorded — ${x.note || "mark it by hand"}`}`)
              .join(" · ")
          : null,
      );
      await load();
      return body.data ?? {};
    } finally {
      setBusy(false);
    }
  }

  async function openScreenHere() {
    // Only inside the school: the server checks this device's location.
    const { readDeviceLocation } = await import("@/lib/deviceLocation");
    const here = await readDeviceLocation();
    if ("error" in here) {
      setError(here.error);
      return;
    }
    const r = await act({ action: "screen_create", label, lat: here.lat, lng: here.lng, accuracyM: here.accuracyM });
    if (r?.token) window.location.href = `/punch-screen#k=${r.token}`;
  }

  if (!data) {
    return <p className="text-sm text-[var(--muted)]">{error || "Loading punch phones…"}</p>;
  }
  const pending = data.devices.filter((d) => d.status === "pending");
  const active = data.devices.filter((d) => d.status === "active");
  const btn = "rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-40";

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Punch phones & QR screens</h3>
        <p className="text-xs text-[var(--muted)]">
          Staff punch by scanning the QR on an office screen with their own phone. Their first punch registers that phone;
          any other phone must be approved here. One phone can never punch for two people.
        </p>
      </div>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">Approved · {notice}</p> : null}

      <section className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">QR screens</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Name
            <input className="field mt-1 !py-1.5" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <button type="button" disabled={busy} onClick={() => void openScreenHere()} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-40">
            Open QR screen on this device
          </button>
        </div>
        {data.screens.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {s.label} <span className="text-xs text-[var(--muted)]">· by {s.created_by} · last seen {day(s.last_seen_at)}</span>
            </span>
            <button type="button" className={btn} disabled={busy} onClick={() => void act({ action: "screen_revoke", id: s.id }, `Switch off “${s.label}”?`)}>
              Switch off
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Waiting for approval ({pending.length})</p>
        {pending.length === 0 ? <p className="text-xs text-[var(--muted)]">None.</p> : null}
        {pending.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--warning-soft,rgba(245,158,11,0.1))] px-3 py-2 text-sm">
            <span>
              <b>{d.staffName}</b> · {d.label || "unknown phone"}
              <span className="block text-xs text-[var(--muted)]">
                asked {day(d.created_at)} — replaces their current phone
                {triedText(d) ? ` · tried to punch today: ${triedText(d)} (recorded at those times on Approve)` : ""}
              </span>
            </span>
            <span className="flex gap-2">
              <button type="button" className={btn} disabled={busy} onClick={() =>
                  void act(
                    { action: "approve", id: d.id },
                    `Make this ${d.staffName}'s punch phone? Their old phone stops working.` +
                      (triedText(d) ? `\n\nTheir punch ${triedText(d)} will be recorded at that time.` : ""),
                  )
                }>
                Approve
              </button>
              <button type="button" className={btn} disabled={busy} onClick={() => void act({ action: "reject", id: d.id })}>
                Reject
              </button>
            </span>
          </div>
        ))}
      </section>

      <section className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Registered phones ({active.length})</p>
        {active.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2 border-b border-[var(--border)] py-1.5 text-sm last:border-0">
            <span>
              {d.staffName} <span className="text-xs text-[var(--muted)]">· {d.label || "phone"} · last punch {day(d.last_used_at)}</span>
            </span>
            <button type="button" className={btn} disabled={busy} onClick={() => void act({ action: "reset", id: d.id }, `Reset ${d.staffName}'s phone? Their next punch (from any phone) registers a new one.`)}>
              Reset
            </button>
          </div>
        ))}
        {data.staffWithoutPhone.length ? (
          <p className="pt-1 text-xs text-[var(--muted)]">
            No phone yet ({data.staffWithoutPhone.length}): {data.staffWithoutPhone.map((s) => s.name).join(", ")}
          </p>
        ) : null}
      </section>
    </div>
  );
}
