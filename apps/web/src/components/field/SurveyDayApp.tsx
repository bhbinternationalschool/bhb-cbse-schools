"use client";

/**
 * The field surveyor's day on their own phone (director, 5 Oct 2026):
 * register the phone once, then Start → families → Break / Resume → End.
 * Every step is signed by this phone's key and carries its live GPS; the
 * server (/api/public/survey-day) decides. Works without an ERP login — an
 * outside surveyor has none — and for staff on the phone they punch with.
 */

import { useCallback, useEffect, useState } from "react";
import { signWithDeviceKey } from "@/lib/punchClient";
import { formatWorked, surveyMessage } from "@/lib/surveyDay";

type Status = {
  member: { name: string; startMode: "school" | "field"; kind: "staff" | "external" };
  day: {
    status: "active" | "on_break" | "ended";
    beatId: string;
    startedAt: string;
    endedAt: string | null;
    breaks: number;
    workedMs: number;
  } | null;
  captures: { enquiryNo: string; childName: string; at: string }[];
  beats: { id: string; name: string; area: string }[];
  classes: { id: string; name: string }[];
};

type View =
  | { kind: "loading" }
  | { kind: "pair"; note?: string }
  | { kind: "blocked"; message: string }
  | { kind: "ready"; status: Status };

const inp = "w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-base";
const big = "w-full rounded-2xl py-4 text-base font-semibold text-white disabled:opacity-40";

type Fix = { lat: number; lng: number; accuracyM: number };

/** A FRESH fix — never one the browser cached a minute ago. */
function liveFix(): Promise<Fix | { error: string }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ error: "This browser cannot share its location." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      (e) =>
        resolve({
          error:
            e.code === e.PERMISSION_DENIED
              ? "Location is blocked for this page. Allow location in the browser settings, then try again."
              : "Could not get your location. Turn on GPS and try again.",
        }),
      { enableHighAccuracy: true, timeout: 25_000, maximumAge: 0 },
    );
  });
}

async function send(
  action: string,
  extra: string,
  payload: Record<string, unknown>,
  withFix: boolean,
): Promise<{ ok: true; data: Status & { enquiryNo?: string; duplicate?: boolean } } | { ok: false; error: string; reason?: string }> {
  let geo: Fix | undefined;
  if (withFix) {
    const f = await liveFix();
    if ("error" in f) return { ok: false, error: f.error };
    geo = f;
  }
  const ts = Date.now();
  const signed = await signWithDeviceKey(surveyMessage({ action, extra, ts }));
  if ("error" in signed) return { ok: false, error: signed.error };
  try {
    const res = await fetch("/api/public/survey-day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        ...payload,
        ...(geo ? { geo } : {}),
        device: { jwk: signed.jwk, signature: signed.signature, ts, label: signed.label },
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      data?: Status & { enquiryNo?: string; duplicate?: boolean };
      error?: { message?: string; details?: { reason?: string } };
    } | null;
    if (!res.ok || !body?.ok || !body.data) {
      return {
        ok: false,
        error: body?.error?.message || "Not saved — please try again.",
        reason: body?.error?.details?.reason,
      };
    }
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, error: "Not saved — could not reach the school server." };
  }
}

const emptyFamily = {
  childName: "",
  guardianName: "",
  mobile: "",
  classSoughtId: "",
  ageYearsApprox: "",
  locality: "",
  note: "",
  parentConsent: false,
};

export function SurveyDayApp({ embedded = false }: { embedded?: boolean }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState("");
  const [beatId, setBeatId] = useState("");
  const [gateCode, setGateCode] = useState("");
  const [family, setFamily] = useState(emptyFamily);

  const load = useCallback(async () => {
    const r = await send("status", "", {}, false);
    if (r.ok) {
      setView({ kind: "ready", status: r.data });
      return;
    }
    if (r.reason === "not_registered") setView({ kind: "pair" });
    else if (r.reason === "not_on_team") setView({ kind: "blocked", message: r.error });
    else setView({ kind: "blocked", message: r.error });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function step(action: string, extra = "", payload: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    setNotice(null);
    const r = await send(action, extra, payload, action !== "pair");
    setBusy("");
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    if (action === "pair") {
      setNotice("This phone is now registered to you.");
      await load();
      return r.data;
    }
    setView({ kind: "ready", status: r.data });
    return r.data;
  }

  const wrap = embedded ? "space-y-4" : "mx-auto flex min-h-screen max-w-md flex-col gap-4 px-4 py-6";

  if (view.kind === "loading") {
    return <div className={wrap}><p className="text-sm text-[var(--muted)]">Checking this phone…</p></div>;
  }

  if (view.kind === "blocked") {
    return (
      <div className={wrap}>
        <h1 className="text-xl font-semibold text-[var(--brand-deep)]">Field survey</h1>
        <p className="rounded-xl bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">{view.message}</p>
        <button type="button" className="text-sm underline" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  if (view.kind === "pair") {
    return (
      <div className={wrap}>
        <h1 className="text-xl font-semibold text-[var(--brand-deep)]">Register this phone</h1>
        <p className="text-sm text-[var(--muted)]">
          Ask the office for your 6-digit code (Admissions → Field survey → Team → Pair phone). It works once, for 10
          minutes, and makes this phone yours for the survey. Only this phone will work for you after that.
        </p>
        <input
          className={`${inp} text-center font-mono text-2xl tracking-[0.4em]`}
          inputMode="numeric"
          maxLength={6}
          placeholder="••••••"
          value={pairCode}
          onChange={(e) => setPairCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
        {error ? <p className="rounded-xl bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
        <button
          type="button"
          disabled={pairCode.length !== 6 || !!busy}
          className={`${big} bg-[var(--brand-deep)]`}
          onClick={() => void step("pair", pairCode, { code: pairCode })}
        >
          {busy ? "Registering…" : "Register this phone"}
        </button>
        <p className="text-xs text-[var(--muted)]">
          School staff: you can also punch IN once at the gate with this phone — that registers it too.
        </p>
      </div>
    );
  }

  const s = view.status;
  const day = s.day;
  const beatName = s.beats.find((b) => b.id === day?.beatId)?.name || "";

  return (
    <div className={wrap}>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Field survey · {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </p>
        <h1 className="text-xl font-semibold text-[var(--brand-deep)]">{s.member.name}</h1>
        <p className="text-xs text-[var(--muted)]">
          {s.member.startMode === "school" ? "Starts at school (gate QR)" : "Starts in the field"}
          {s.member.kind === "external" ? " · outside surveyor" : ""}
        </p>
      </div>

      {notice ? <p className="rounded-xl bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">{notice}</p> : null}
      {error ? <p className="rounded-xl bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}

      {!day ? (
        <section className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[var(--muted)]">Beat (area) for today</span>
            <select className={inp} value={beatId} onChange={(e) => setBeatId(e.target.value)}>
              <option value="">Select beat…</option>
              {s.beats.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.area ? ` · ${b.area}` : ""}
                </option>
              ))}
            </select>
          </label>
          {s.member.startMode === "school" ? (
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-[var(--muted)]">6-digit code on the gate QR screen</span>
              <input
                className={`${inp} text-center font-mono text-2xl tracking-[0.4em]`}
                inputMode="numeric"
                maxLength={6}
                value={gateCode}
                onChange={(e) => setGateCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </label>
          ) : null}
          <button
            type="button"
            disabled={!beatId || (s.member.startMode === "school" && gateCode.length !== 6) || !!busy}
            className={`${big} bg-[var(--success)]`}
            onClick={() => void step("start", gateCode, { beatId, code: gateCode })}
          >
            {busy === "start" ? "Getting your location…" : "Start survey"}
          </button>
          <p className="text-center text-xs text-[var(--muted)]">
            Your live location is recorded at every step. Fake-location apps are refused.
          </p>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-xs text-[var(--muted)]">
              {beatName || "Beat"} ·{" "}
              {day.status === "active" ? "working" : day.status === "on_break" ? "on break" : "ended"}
              {day.breaks ? ` · ${day.breaks} break${day.breaks === 1 ? "" : "s"}` : ""}
            </p>
            <p className="mt-1 text-3xl font-semibold text-[var(--brand-deep)]">{formatWorked(day.workedMs)}</p>
            <p className="text-xs text-[var(--muted)]">
              Started {new Date(day.startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              {day.endedAt
                ? ` · ended ${new Date(day.endedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
              {" · "}
              {s.captures.length} famil{s.captures.length === 1 ? "y" : "ies"}
            </p>
          </div>
          {day.status !== "ended" ? (
            <div className="grid grid-cols-2 gap-2">
              {day.status === "active" ? (
                <button
                  type="button"
                  disabled={!!busy}
                  className="rounded-2xl border border-[var(--border)] py-3 text-sm font-semibold"
                  onClick={() => void step("break")}
                >
                  {busy === "break" ? "…" : "Break"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!!busy}
                  className="rounded-2xl bg-[var(--success)] py-3 text-sm font-semibold text-white"
                  onClick={() => void step("resume")}
                >
                  {busy === "resume" ? "…" : "Resume"}
                </button>
              )}
              <button
                type="button"
                disabled={!!busy}
                className="rounded-2xl bg-[var(--danger)] py-3 text-sm font-semibold text-white"
                onClick={() => {
                  if (window.confirm("End today's survey? You cannot start again today.")) void step("end");
                }}
              >
                {busy === "end" ? "…" : "End survey"}
              </button>
            </div>
          ) : null}
        </section>
      )}

      {day?.status === "active" ? (
        <section className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="text-sm font-semibold text-[var(--brand-deep)]">Record a family</h2>
          <input className={inp} placeholder="Child's name *" value={family.childName} onChange={(e) => setFamily({ ...family, childName: e.target.value })} />
          <input className={inp} placeholder="Parent's name *" value={family.guardianName} onChange={(e) => setFamily({ ...family, guardianName: e.target.value })} />
          <input
            className={inp}
            placeholder="Parent's mobile *"
            inputMode="numeric"
            maxLength={10}
            value={family.mobile}
            onChange={(e) => setFamily({ ...family, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })}
          />
          <div className="grid grid-cols-2 gap-2">
            <select className={inp} value={family.classSoughtId} onChange={(e) => setFamily({ ...family, classSoughtId: e.target.value })}>
              <option value="">Class wanted</option>
              {s.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              className={inp}
              placeholder="Age (years)"
              inputMode="numeric"
              value={family.ageYearsApprox}
              onChange={(e) => setFamily({ ...family, ageYearsApprox: e.target.value.replace(/\D/g, "").slice(0, 2) })}
            />
          </div>
          <input className={inp} placeholder="Village / locality" value={family.locality} onChange={(e) => setFamily({ ...family, locality: e.target.value })} />
          <input className={inp} placeholder="Note (optional)" value={family.note} onChange={(e) => setFamily({ ...family, note: e.target.value })} />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={family.parentConsent}
              onChange={(e) => setFamily({ ...family, parentConsent: e.target.checked })}
            />
            <span>The parent agreed to share these details with the school.</span>
          </label>
          <button
            type="button"
            disabled={!!busy || !family.parentConsent}
            className={`${big} bg-[var(--brand-deep)]`}
            onClick={async () => {
              const ref = `sv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
              const r = await step("capture", ref, {
                family: { ...family, ageYearsApprox: Number(family.ageYearsApprox) || 0, clientRef: ref },
              });
              if (r) {
                setNotice(`Saved ${family.childName}${r.enquiryNo ? ` · ${r.enquiryNo}` : ""} with your location.`);
                setFamily({ ...emptyFamily, locality: family.locality });
              }
            }}
          >
            {busy === "capture" ? "Saving…" : "Save family"}
          </button>
        </section>
      ) : null}

      {s.captures.length ? (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold text-[var(--brand-deep)]">Today&apos;s families ({s.captures.length})</h2>
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--card)] text-sm">
            {s.captures
              .slice()
              .reverse()
              .map((c) => (
                <li key={c.enquiryNo + c.at} className="flex justify-between gap-2 px-3 py-2">
                  <span className="truncate">{c.childName}</span>
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {new Date(c.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
