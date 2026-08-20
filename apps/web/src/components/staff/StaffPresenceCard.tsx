"use client";

/**
 * Staff-side location sharing — the card each staff member uses on their
 * own phone. First use shows the consent text; then "Start sharing" keeps
 * the page awake (screen wake-lock) and sends a GPS ping every few minutes
 * during school timing. The badge always shows what is being shared.
 * Closing the page / turning location off stops pings — which the school
 * treats as "location off" during school timing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";

type PingResp = { ok?: boolean; error?: string; needsConsent?: boolean; inside?: boolean; distanceM?: number; tracking?: boolean };

export function StaffPresenceCard() {
  const [cfg, setCfg] = useState<{ enabled: boolean; tracking: boolean; pingIntervalMin: number; window: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    fetch("/api/staff-geo/ping")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setCfg(j))
      .catch(() => {});
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendPing = useCallback((consent: boolean) => {
    if (!("geolocation" in navigator)) {
      setError("This phone/browser has no location support");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void fetch("/api/staff-geo/ping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy || 0), consent, device: navigator.userAgent.slice(0, 100) }),
        })
          .then((r) => r.json() as Promise<PingResp>)
          .then((j) => {
            if (j.needsConsent) {
              setNeedsConsent(true);
              stop();
              return;
            }
            if (!j.ok) {
              setError(j.error || "Ping failed");
              return;
            }
            setError(null);
            setNeedsConsent(false);
            setStatus(`${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · ${j.inside ? "on premises" : `${j.distanceM} m from campus`}${j.tracking ? "" : " · outside school timing (not evaluated)"}`);
          })
          .catch(() => setError("Network error — will retry"));
      },
      (err) => setError(err.code === 1 ? "Location permission denied — allow location for this site in phone settings" : "Could not read location — will retry"),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  }, []);

  function stop() {
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
    setSharing(false);
  }

  async function start(consent: boolean) {
    setError(null);
    setSharing(true);
    sendPing(consent);
    const mins = cfg?.pingIntervalMin || 5;
    timer.current = window.setInterval(() => sendPing(false), mins * 60_000);
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      if (nav.wakeLock) wakeLock.current = await nav.wakeLock.request("screen");
    } catch {
      /* wake lock optional */
    }
  }

  if (cfg && !cfg.enabled) return null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <MapPin className={`h-4 w-4 ${sharing ? "text-[var(--success)]" : "text-[var(--muted)]"}`} />
        <p className="text-sm font-semibold">School presence (GPS)</p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${sharing ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--surface-sunken)] text-[var(--muted)]"}`}>
          {sharing ? "SHARING LOCATION" : "not sharing"}
        </span>
        {cfg ? <span className="ml-auto text-[10px] text-[var(--muted)]">School timing {cfg.window}</span> : null}
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        Keep this page open during school hours. Your location is checked against the school campus only; the school stores your latest position and any incident — not a movement trail. Closing the page or switching location off during school timing raises an alert to the management.
      </p>
      {needsConsent ? (
        <div className="mt-2 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-2 text-[11px]">
          <p className="font-semibold">Consent</p>
          <p>
            I agree that the school may receive my phone&apos;s location during school timing on working days to confirm presence on campus, and may alert the management when I am off campus or my location is unavailable. I can stop sharing any time; incidents are visible to me.
          </p>
          <button type="button" className="mt-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold text-[var(--primary-foreground)]" onClick={() => void start(true)}>
            I agree — start sharing
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!sharing ? (
            <button type="button" className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]" onClick={() => void start(false)}>
              Start sharing
            </button>
          ) : (
            <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" onClick={stop}>
              Stop
            </button>
          )}
          {status ? <span className="text-[11px] text-[var(--muted)]">Last sent {status}</span> : null}
        </div>
      )}
      {error ? <p className="mt-1 text-[11px] font-semibold text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
