"use client";

import { PRINT_LETTERHEAD_CSS, printLetterheadHtml } from "@/lib/printLetterheadHtml";
import { useCallback, useEffect, useRef, useState } from "react";
import { PUNCH_SCREEN_TOKEN_KEY } from "@/components/staff/PunchScreen";
import QRCode from "qrcode";

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
type PunchOptions = {
  windowStart: string;
  windowEnd: string;
  days: number[];
  printedQrEnabled: boolean;
  printedQrVersion: number;
  printedQrIssuedAt: string | null;
};
type PrintedQr = { version: number; issuedAt: string | null; link: string } | null;
type Data = {
  devices: Device[];
  screens: Screen[];
  staffWithoutPhone: { id: string; name: string }[];
  punchOptions?: PunchOptions;
  printedQr?: PrintedQr;
};

const WEEKDAYS: [number, string][] = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
];

/** A printable A4 sheet for the gate: the QR, the rules, the version. */
async function printGateQr(qr: NonNullable<PrintedQr>) {
  const img = await QRCode.toDataURL(qr.link, { width: 900, margin: 2, errorCorrectionLevel: "H" });
  const w = window.open("", "_blank");
  if (!w) return false;
  const issued = qr.issuedAt
    ? new Date(qr.issuedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })
    : "";
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Gate punch QR</title>
<style>@page{size:A4;margin:14mm}body{font-family:system-ui,sans-serif;color:#0f172a;text-align:center;margin:0}
h1{font-size:30px;margin:8px 0}h2{font-size:22px;margin:4px 0 12px;color:#334155}img{width:150mm;height:150mm}
p{font-size:16px;margin:6px 0}.small{font-size:12px;color:#64748b}${PRINT_LETTERHEAD_CSS}</style></head><body>
${printLetterheadHtml()}
<h1>Staff attendance</h1>
<h2>Scan with your OWN phone at the gate · अपने फ़ोन से गेट पर स्कैन करें</h2>
<img src="${img}" alt="Gate punch QR">
<p>Location is checked — this works only inside the school, within punching hours.</p>
<p>लोकेशन जाँची जाती है — यह केवल स्कूल परिसर में, हाज़िरी के समय में ही काम करता है।</p>
<p class="small">Printed QR · version ${qr.version}${issued ? ` · issued ${issued}` : ""} · a newer print stops this one working</p>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`);
  w.document.close();
  return true;
}

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
export function PunchPhonesPanel({ canDecidePhones }: { canDecidePhones: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("Office tablet");
  const [notice, setNotice] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const opening = useRef(false);

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

  async function act(payload: Record<string, unknown>, confirmText?: string) {
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
        data?: {
          token?: string;
          code?: string;
          expiresAt?: string;
          recorded?: { kind: string; time: string; ok: boolean; note?: string }[];
        };
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
    // One tap, one screen. Reading the location takes seconds, and every tap
    // in that wait used to register another "Office tablet" — they came in
    // pairs and threes (6–8 Oct 2026).
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    try {
      // A device that is already a screen opens as that screen. The office
      // pressed this every morning and got a new "Office tablet" each day;
      // the old ones stayed on the list as "last seen" rows that kept growing.
      // Only a key the server says is switched off (401) is replaced.
      let existing = "";
      try {
        existing = window.localStorage.getItem(PUNCH_SCREEN_TOKEN_KEY) || "";
      } catch {
        /* private mode: no saved screen */
      }
      if (existing) {
        const res = await fetch("/api/public/punch-screen", {
          headers: { Authorization: `Bearer ${existing}` },
          cache: "no-store",
        }).catch(() => null);
        if (!res || res.status !== 401) {
          window.location.href = "/punch-screen";
          return;
        }
        try {
          window.localStorage.removeItem(PUNCH_SCREEN_TOKEN_KEY);
        } catch {
          /* ignore */
        }
      }
      // Only inside the school: the server checks this device's location.
      const { readDeviceLocation } = await import("@/lib/deviceLocation");
      const here = await readDeviceLocation();
      if ("error" in here) {
        setError(here.error);
        return;
      }
      const r = await act({ action: "screen_create", label, lat: here.lat, lng: here.lng, accuracyM: here.accuracyM });
      if (r?.token) window.location.href = `/punch-screen#k=${r.token}`;
    } finally {
      opening.current = false;
      setBusy(false);
    }
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
          {canDecidePhones ? null : " Approving, rejecting or resetting a phone is for admin only — approving records the punches it tried."}
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
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const r = await act({ action: "screen_pair_start", label });
              if (r?.code && r.expiresAt) setPairing({ code: r.code, expiresAt: r.expiresAt });
            }}
            className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-40"
            title="Show a one-time code to type on the gate phone — nobody signs in on it"
          >
            Pair a gate screen
          </button>
          <button type="button" disabled={busy} onClick={() => void openScreenHere()} className={btn}>
            Open QR screen on this device
          </button>
        </div>
        {pairing ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-sm">
            <p className="text-[var(--brand-deep)]">
              On the gate phone open <b>{typeof window !== "undefined" ? window.location.host : ""}/punch-screen</b>, allow
              location, and type:
            </p>
            <p className="my-2 font-mono text-4xl font-bold tracking-[0.3em] text-[var(--brand-deep)]">
              {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
            </p>
            <p className="text-xs text-[var(--muted)]">
              Works once, until {hhmm(pairing.expiresAt)} (10 minutes), only on a phone inside the school. Five wrong tries
              cancel it. A new code cancels this one.
            </p>
          </div>
        ) : null}
        {data.screens.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {s.label}{" "}
              <span className="text-xs text-[var(--muted)]">
                · by {s.created_by} · {s.last_seen_at ? `last seen ${day(s.last_seen_at)}` : "never used — switch it off"}
              </span>
            </span>
            <button type="button" className={btn} disabled={busy} onClick={() => void act({ action: "screen_revoke", id: s.id }, `Switch off “${s.label}”?`)}>
              Switch off
            </button>
          </div>
        ))}
      </section>

      {data.punchOptions ? (
        <GateQrSection
          options={data.punchOptions}
          printed={data.printedQr ?? null}
          busy={busy}
          onSave={(patch) => act({ action: "punch_options", ...patch })}
          onNewPrint={() =>
            act(
              { action: "printed_qr_new" },
              "Make a new printed QR? Every printed copy already on the walls stops working — print and paste the new one.",
            )
          }
          onError={setError}
        />
      ) : null}

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
            {canDecidePhones ? (
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
            ) : (
              <span className="text-xs text-[var(--muted)]">Admin approves</span>
            )}
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
            {canDecidePhones ? (
              <button type="button" className={btn} disabled={busy} onClick={() => void act({ action: "reset", id: d.id }, `Reset ${d.staffName}'s phone? Their next punch (from any phone) registers a new one.`)}>
                Reset
              </button>
            ) : null}
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

/**
 * Gate punch hours and the printed backup QR (director, 5 Oct 2026). The
 * gate phone shows the QR only inside these hours and every punch outside
 * them is refused. The printed QR is the backup for when the gate phone is
 * off: own registered phone + precise GPS inside the school + these hours,
 * marked "Printed gate QR" in the register.
 */
function GateQrSection(props: {
  options: PunchOptions;
  printed: PrintedQr;
  busy: boolean;
  onSave: (patch: Partial<PunchOptions>) => Promise<unknown>;
  onNewPrint: () => Promise<unknown>;
  onError: (msg: string) => void;
}) {
  const [start, setStart] = useState(props.options.windowStart);
  const [end, setEnd] = useState(props.options.windowEnd);
  const [days, setDays] = useState<number[]>(props.options.days);
  useEffect(() => {
    setStart(props.options.windowStart);
    setEnd(props.options.windowEnd);
    setDays(props.options.days);
  }, [props.options]);
  const changed =
    start !== props.options.windowStart ||
    end !== props.options.windowEnd ||
    days.join(",") !== props.options.days.join(",");
  const btn = "rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-40";

  return (
    <section className="space-y-3 rounded-lg border border-[var(--border)] p-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Gate punch hours</p>
        <p className="text-xs text-[var(--muted)]">
          The gate phone shows the QR only in these hours (a clock otherwise) and opens by itself. Every punch outside
          them — screen, printed QR or WhatsApp — is refused.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-[var(--muted)]">
          From
          <input type="time" className="field mt-1 !py-1.5" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="text-xs font-semibold text-[var(--muted)]">
          To
          <input type="time" className="field mt-1 !py-1.5" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map(([n, label]) => (
            <label key={n} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={days.includes(n)}
                onChange={(e) => setDays((d) => (e.target.checked ? [...d, n].sort() : d.filter((x) => x !== n)))}
              />
              {label}
            </label>
          ))}
        </div>
        <button
          type="button"
          className={btn}
          disabled={props.busy || !changed}
          onClick={() => {
            if (!start || !end || end <= start) {
              props.onError("“To” must be later than “From”.");
              return;
            }
            void props.onSave({ windowStart: start, windowEnd: end, days });
          }}
        >
          Save hours
        </button>
      </div>

      <div className="border-t border-[var(--border)] pt-3">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Printed gate QR (backup)</p>
        <p className="text-xs text-[var(--muted)]">
          For when the gate phone is off. It cannot change like the screen QR, so a punch with it needs the staff
          member&apos;s own registered phone, a precise GPS fix inside the school and the hours above, and is marked
          “Printed gate QR” in the register. Make a new one every month — old prints then stop working.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={props.options.printedQrEnabled}
              disabled={props.busy}
              onChange={(e) => void props.onSave({ printedQrEnabled: e.target.checked })}
            />
            Allow punching with the printed QR
          </label>
          {props.printed ? (
            <>
              <button
                type="button"
                className={btn}
                disabled={props.busy}
                onClick={() => {
                  void printGateQr(props.printed!).then((ok) => {
                    if (!ok) props.onError("Allow pop-ups for the ERP to print the QR.");
                  });
                }}
              >
                Print gate QR
              </button>
              <button type="button" className={btn} disabled={props.busy} onClick={() => void props.onNewPrint()}>
                New printed QR (old prints stop)
              </button>
              <span className="text-xs text-[var(--muted)]">
                Version {props.printed.version}
                {props.printed.issuedAt ? ` · issued ${day(props.printed.issuedAt)}` : ""}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
