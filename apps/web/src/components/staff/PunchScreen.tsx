"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { TENANT } from "@/lib/types";

const TOKEN_KEY = "bhb_punch_screen_token";

type Code = { code: string; expiresAt: number; windowMs: number; now: number; label: string };

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

  useEffect(() => setToken(readToken()), []);

  const load = useCallback(async () => {
    if (!token) return;
    window.clearTimeout(timer.current);
    try {
      const res = await fetch("/api/public/punch-screen", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.status === 401) {
        setOff(true);
        return;
      }
      const body = (await res.json()) as Code & { ok?: boolean };
      if (!res.ok || !body.ok) throw new Error("bad");
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
        <h1 className="text-2xl font-bold">This screen is not switched on</h1>
        <p className="max-w-md" style={{ color: "#475569" }}>
          In the ERP, open Attendance → Staff → Punch phones & QR screens, and tap “Open QR screen on this device”
          on this tablet or computer.
        </p>
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
