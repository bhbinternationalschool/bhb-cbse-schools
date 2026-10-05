"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { TENANT } from "@/lib/types";

const TOKEN_KEY = "bhb_punch_screen_token";

type Code = { code: string; expiresAt: number; windowMs: number; now: number; label: string; windowEnd?: string };
type Closed = { closed: true; now: number; label: string; windowStart: string; windowEnd: string; opensToday: boolean; reason: string };

function readToken(): string {
  try {
    // Handed over in the URL hash by "Open QR screen here" (never sent to
    // the server in a request line), then kept on this device.
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("k");
    if (fromHash) {
      window.localStorage.setItem(TOKEN_KEY, fromHash);
      history.replaceState(null, "", window.location.pathname);
      return fromHash;
    }
    return window.localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * The office QR screen. Shows the six-digit punch code as a QR (a link to
 * /punch?c=…) and in large type, and swaps it every 30 seconds in step with
 * the server's clock. Keeps the screen awake where the browser allows.
 */
export function PunchScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Code | null>(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const skew = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  /** The screen's latest position — sent with every code request. */
  const where = useRef<{ lat: number; lng: number; accuracyM: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  /** The server's refusal while this screen is outside the school. */
  const [outside, setOutside] = useState<string | null>(null);
  /** Outside the gate's hours: a clock and when it opens, no code. */
  const [closed, setClosed] = useState<Closed | null>(null);
  /** Pairing (no sign-in on the gate phone): the office's one-time code. */
  const [pairCode, setPairCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  async function pair() {
    const here = where.current;
    if (!here) {
      setPairError(geoError || "Waiting for this phone's location — allow location and try again.");
      return;
    }
    setPairing(true);
    setPairError(null);
    try {
      const res = await fetch("/api/public/punch-screen/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pairCode, lat: here.lat, lng: here.lng, acc: Math.round(here.accuracyM) }),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; token?: string; error?: string } | null;
      if (!res.ok || !body?.ok || !body.token) {
        setPairError(body?.error || "Could not pair — try again.");
        return;
      }
      try {
        window.localStorage.setItem(TOKEN_KEY, body.token);
      } catch {
        /* the screen still runs this session */
      }
      setOff(false);
      setToken(body.token);
    } catch {
      setPairError("No internet — connect this phone and try again.");
    } finally {
      setPairing(false);
    }
  }

  // The punch QR is shown only inside the school (director, 3 Oct 2026), so
  // the screen keeps telling the server where it is.
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError("This browser cannot share its location — the punch QR needs it.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        where.current = { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy };
        setGeoError(null);
      },
      (e) =>
        setGeoError(
          e.code === e.PERMISSION_DENIED
            ? "Location is blocked for this screen. Allow location in the browser — the punch QR is shown only inside the school."
            : "Waiting for this device's location…",
        ),
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => setToken(readToken()), []);

  const load = useCallback(async () => {
    if (!token) return;
    window.clearTimeout(timer.current);
    const here = where.current;
    if (!here) {
      // No position yet — ask again shortly, never without one.
      timer.current = window.setTimeout(() => void load(), 2_000);
      return;
    }
    try {
      const q = new URLSearchParams({
        lat: String(here.lat),
        lng: String(here.lng),
        acc: String(Math.round(here.accuracyM)),
      });
      const res = await fetch(`/api/public/punch-screen?${q.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.status === 401) {
        setOff(true);
        return;
      }
      if (res.status === 403) {
        const why = (await res.json().catch(() => null)) as { error?: string } | null;
        setOutside(why?.error || "The punch QR is shown only inside the school.");
        setData(null);
        setQr("");
        timer.current = window.setTimeout(() => void load(), 30_000);
        return;
      }
      setOutside(null);
      const raw = (await res.json()) as (Code | Closed) & { ok?: boolean };
      if (!res.ok || !raw.ok) throw new Error("bad");
      if ("closed" in raw && raw.closed) {
        skew.current = raw.now - Date.now();
        setClosed(raw);
        setData(null);
        setQr("");
        setError(null);
        // Check again every 30 s, so it opens on time by itself.
        timer.current = window.setTimeout(() => void load(), 30_000);
        return;
      }
      setClosed(null);
      const body = raw as Code;
      skew.current = body.now - Date.now();
      setData(body);
      setError(null);
      const link = `${window.location.origin}/punch?c=${body.code}`;
      setQr(await QRCode.toDataURL(link, { width: 640, margin: 1, errorCorrectionLevel: "M" }));
      // Fetch the next code just after this one expires (server time).
      const wait = Math.max(500, body.expiresAt - body.now + 300);
      timer.current = window.setTimeout(() => void load(), wait);
    } catch {
      setError("No connection — the code will return when the internet does.");
      timer.current = window.setTimeout(() => void load(), 5_000);
    }
  }, [token]);

  useEffect(() => {
    void load();
    return () => window.clearTimeout(timer.current);
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);

  // Keep the tablet's screen on while this page is open.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<typeof lock> } };
    const ask = () => void nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => {
      document.removeEventListener("visibilitychange", ask);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  // Always black on white, whatever the ERP theme: a dark-mode QR scans badly.
  const wrap = "flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-6 text-center";
  const paper = { background: "#ffffff", color: "#0f172a" } as const;

  if (token === null) return <main style={paper} className={wrap} />;
  if (!token || off) {
    return (
      <main style={paper} className={wrap}>
        <h1 className="text-2xl font-bold">Switch this phone on as the punch QR screen</h1>
        <p className="max-w-md" style={{ color: "#475569" }}>
          In the ERP on the office phone or computer: Attendance → Staff → Manage → <b>Pair a gate screen</b>. Type
          the 6-digit code it shows here. Nobody signs in on this phone.
        </p>
        <p className="max-w-md text-sm" style={{ color: "#64748b" }}>
          ऑफ़िस के ERP में “Pair a gate screen” दबाएँ और दिखा 6 अंकों का कोड यहाँ लिखें।
        </p>
        <input
          className="w-56 rounded-xl border px-3 py-3 text-center font-mono text-3xl tracking-[0.3em]"
          style={{ borderColor: "#cbd5e1", color: "#0f172a", background: "#ffffff" }}
          inputMode="numeric"
          maxLength={7}
          placeholder="000000"
          value={pairCode}
          onChange={(e) => setPairCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          aria-label="Pairing code"
        />
        <button
          type="button"
          disabled={pairing || pairCode.length !== 6}
          onClick={() => void pair()}
          className="min-h-12 w-56 rounded-xl px-4 text-lg font-bold text-white disabled:opacity-40"
          style={{ background: "#0f172a" }}
        >
          {pairing ? "Pairing…" : "Pair this phone"}
        </button>
        {pairError ? <p className="max-w-md text-sm font-semibold" style={{ color: "#dc2626" }}>{pairError}</p> : null}
        {geoError ? <p className="max-w-md text-sm" style={{ color: "#64748b" }}>{geoError}</p> : null}
      </main>
    );
  }

  if (outside || (geoError && !data)) {
    return (
      <main style={paper} className={wrap}>
        <h1 className="text-2xl font-bold">Punch QR not available here</h1>
        <p className="max-w-md" style={{ color: "#475569" }}>{outside || geoError}</p>
        <p className="max-w-md text-sm" style={{ color: "#64748b" }}>
          हाज़िरी का QR केवल स्कूल परिसर के अंदर दिखता है। · This screen checks again every 30 seconds.
        </p>
      </main>
    );
  }

  if (closed) {
    const t = new Date(now + skew.current).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
    });
    return (
      <main style={paper} className={wrap}>
        <p className="text-lg font-semibold" style={{ color: "#334155" }}>{TENANT.shortName} · Staff attendance</p>
        <p className="font-mono text-7xl font-bold sm:text-8xl">{t}</p>
        <h1 className="text-2xl font-bold">
          {closed.reason === "day_off"
            ? "No punching today"
            : closed.opensToday
              ? `Punch QR opens at ${closed.windowStart}`
              : "Punching has closed for today"}
        </h1>
        <p className="max-w-md" style={{ color: "#475569" }}>
          Open {closed.windowStart}–{closed.windowEnd} IST on working days · हाज़िरी का QR {closed.windowStart} से{" "}
          {closed.windowEnd} बजे तक खुलता है।
        </p>
        <p className="text-sm" style={{ color: "#64748b" }}>This screen opens by itself — leave it on.</p>
      </main>
    );
  }

  const serverNow = now + skew.current;
  const left = data ? Math.max(0, Math.ceil((data.expiresAt - serverNow) / 1000)) : 0;
  const pct = data ? Math.max(0, Math.min(100, ((data.expiresAt - serverNow) / data.windowMs) * 100)) : 0;
  const clock = new Date(serverNow).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <main style={paper} className={wrap}>
      <p className="text-lg font-semibold" style={{ color: "#334155" }}>{TENANT.shortName} · Staff attendance</p>
      <p className="text-sm" style={{ color: "#64748b" }}>
        Scan with your own phone to punch IN / OUT · अपने फ़ोन से स्कैन करके हाज़िरी लगाएँ
      </p>
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="Punch QR code" className="aspect-square w-[min(70vw,60vh)] max-w-[640px]" />
      ) : (
        <div className="aspect-square w-[min(70vw,60vh)] max-w-[640px] animate-pulse rounded-xl" style={{ background: "#f1f5f9" }} />
      )}
      <p className="font-mono text-6xl font-bold tracking-[0.3em] sm:text-7xl">
        {data ? `${data.code.slice(0, 3)} ${data.code.slice(3)}` : "··· ···"}
      </p>
      <div className="h-2 w-[min(70vw,60vh)] max-w-[640px] overflow-hidden rounded-full" style={{ background: "#e2e8f0" }}>
        <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${pct}%`, background: "#059669" }} />
      </div>
      <p className="text-sm" style={{ color: "#64748b" }}>
        New code in {left}s · {clock} IST · WhatsApp: <b>IN {data?.code ?? "······"}</b>
      </p>
      {error ? <p className="text-sm font-semibold" style={{ color: "#dc2626" }}>{error}</p> : null}
    </main>
  );
}
