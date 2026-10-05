"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { submitQrPunch } from "@/lib/punchClient";

type BarcodeDetectorLike = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type BarcodeDetectorCtor = new (o: { formats: string[] }) => BarcodeDetectorLike;

/** The printed gate QR's token, from its link (…/punch?p=…). */
function placeFrom(raw: string): string {
  const m = raw.match(/[?&]p=([A-Za-z0-9_-]{10,64})/);
  return m ? m[1]! : "";
}

function codeFrom(raw: string): string {
  const link = raw.match(/[?&]c=(\d{6})\b/);
  if (link) return link[1]!;
  const d = raw.replace(/\D/g, "");
  return d.length === 6 ? d : "";
}

/**
 * Punch IN / OUT with the office screen's code, signed by this phone's key
 * (lib/punchClient). Used on /punch (where the QR lands) and in
 * Attendance → Staff → My punch. The code comes from the QR link, from the
 * in-page camera where the browser can read QR codes, or typed by hand.
 */
export function QrPunchCard(props: {
  staffId: string;
  inTime?: string | null;
  outTime?: string | null;
  initialCode?: string;
  /** Came in through the printed gate QR. */
  initialPlace?: string;
  onPunched?: () => void;
}) {
  const [code, setCode] = useState(props.initialCode || "");
  const [place, setPlace] = useState(props.initialPlace || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [canScan, setCanScan] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    setCanScan(
      typeof window !== "undefined" &&
        "BarcodeDetector" in window &&
        !!navigator.mediaDevices?.getUserMedia,
    );
  }, []);

  function stopScan() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setScanning(false);
  }
  useEffect(() => stopScan, []);

  async function startScan() {
    setMsg(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      stream.current = s;
      setScanning(true);
      await new Promise((r) => setTimeout(r, 50));
      if (!video.current) return stopScan();
      video.current.srcObject = s;
      await video.current.play();
      const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
      const detector = new Ctor({ formats: ["qr_code"] });
      const tick = async () => {
        if (!stream.current || !video.current) return;
        const found = await detector.detect(video.current).catch(() => []);
        const p = found.map((f) => placeFrom(f.rawValue)).find(Boolean);
        if (p) {
          setPlace(p);
          setCode("");
          stopScan();
          return;
        }
        const c = found.map((f) => codeFrom(f.rawValue)).find(Boolean);
        if (c) {
          setCode(c);
          setPlace("");
          stopScan();
          return;
        }
        window.setTimeout(() => void tick(), 250);
      };
      void tick();
    } catch {
      stopScan();
      setMsg({ ok: false, text: "The camera is blocked. Allow the camera for this site, or type the code." });
    }
  }

  const next: "in" | "out" | null = !props.inTime ? "in" : !props.outTime ? "out" : null;
  const clean = codeFrom(code);

  async function punch(kind: "in" | "out") {
    if (!clean && !place) {
      setMsg({ ok: false, text: "Scan the QR on the office screen, or type its 6-digit code." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await submitQrPunch({ staffId: props.staffId, kind, code: clean, place: clean ? undefined : place });
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.error });
      return;
    }
    setCode("");
    setPlace("");
    setMsg({
      ok: true,
      text:
        `${r.kind === "in" ? "Punched IN" : "Punched OUT"} at ${r.time}` +
        (r.firstRegistration ? " · this phone is now your registered punch phone" : ""),
    });
    props.onPunched?.();
  }

  return (
    <div className="space-y-3">
      {next === null ? (
        <p className="text-sm font-semibold text-[var(--success)]">Done for today — IN {props.inTime} · OUT {props.outTime}</p>
      ) : (
        <>
          <p className="text-xs text-[var(--muted)]">
            At school, scan the QR on the office screen{canScan ? "" : " with your phone camera"}, or type the 6-digit code
            shown under it. Punch only from your own phone.
          </p>
          {place && !clean ? (
            <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--brand-deep)]">
              Printed gate QR scanned · your phone&apos;s exact location is checked, so stand near the gate with GPS on.
            </p>
          ) : null}
          <div className="flex gap-2">
            <input
              className="field !py-2.5 flex-1 text-center font-mono text-xl tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
              aria-label="Office screen code"
            />
            {canScan ? (
              <button
                type="button"
                onClick={() => (scanning ? stopScan() : void startScan())}
                className="rounded-xl border border-[var(--border)] px-3 text-sm font-semibold text-[var(--brand-deep)]"
                aria-label={scanning ? "Close camera" : "Scan QR"}
              >
                {scanning ? <X className="size-5" /> : <Camera className="size-5" />}
              </button>
            ) : null}
          </div>
          {scanning ? (
            <video ref={video} muted playsInline className="aspect-square w-full rounded-xl bg-black object-cover" />
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void punch(next)}
            className="min-h-12 w-full rounded-xl bg-[var(--brand-deep)] px-4 text-base font-bold text-white disabled:opacity-50"
          >
            {busy ? "Punching…" : next === "in" ? "Punch IN" : "Punch OUT"}
          </button>
        </>
      )}
      {msg ? (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}
        >
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
