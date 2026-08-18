"use client";

/**
 * Visitors → Gate QR: the QR that visitors scan at the gate (opens /visit),
 * a printable A4 poster with the procedure in Hindi and English, and a
 * full-screen "show to visitor" mode for the gateman's phone/tablet.
 */

import { useEffect, useMemo, useState } from "react";
import { Printer, QrCode, X } from "lucide-react";
import { qrDataUrlFor } from "@/lib/pdfQr";
import { TENANT } from "@/lib/types";
import { GATE_POSTER_STEPS, type VisitorLang } from "@/lib/visitorI18n";

function useQr(url: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void qrDataUrlFor(url).then((d) => {
      if (!cancelled) setSrc(d);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return src;
}

export function GateQrPanel({ lang }: { lang: VisitorLang }) {
  const [origin, setOrigin] = useState<string>("");
  const [gate, setGate] = useState("");
  const [showFull, setShowFull] = useState<"in" | "out" | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin.replace("localhost", "localhost"));
  }, []);
  const base = origin ? `${origin}/visit` : null;
  const checkInUrl = useMemo(() => (base ? `${base}${gate ? `?gate=${encodeURIComponent(gate)}` : ""}` : null), [base, gate]);
  const checkOutUrl = useMemo(() => (base ? `${base}?out=1${gate ? `&gate=${encodeURIComponent(gate)}` : ""}` : null), [base, gate]);
  const qrIn = useQr(checkInUrl);
  const qrOut = useQr(checkOutUrl);

  const L = lang === "hi";

  function print() {
    document.body.classList.add("printing-gate-poster");
    const cleanup = () => {
      document.body.classList.remove("printing-gate-poster");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    window.setTimeout(cleanup, 1500);
  }

  return (
    <div className="mt-5 space-y-4">
      <style>{`
        @media print {
          body.printing-gate-poster * { visibility: hidden !important; }
          body.printing-gate-poster #gate-poster, body.printing-gate-poster #gate-poster * { visibility: visible !important; }
          body.printing-gate-poster #gate-poster { position: fixed; inset: 0; margin: 0; width: 210mm; min-height: 297mm; padding: 14mm; background: #fff; color: #203050; box-shadow: none; border: 0; }
        }
      `}</style>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <label className="text-sm">
          <span className="mr-2 text-[11px] text-[var(--muted)]">{L ? "गेट का नाम (वैकल्पिक)" : "Gate label (optional)"}</span>
          <input className="h-9 w-40 rounded-lg border border-[var(--border)] bg-transparent px-2 text-sm" placeholder={L ? "मुख्य गेट" : "Main gate"} value={gate} onChange={(e) => setGate(e.target.value)} />
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold" onClick={() => setShowFull("in")}>
            <QrCode className="size-4" aria-hidden /> {L ? "विज़िटर को QR दिखाएँ" : "Show QR to visitor"}
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold" onClick={() => setShowFull("out")}>
            <QrCode className="size-4" aria-hidden /> {L ? "चेक-आउट QR दिखाएँ" : "Show check-out QR"}
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-sm font-semibold text-white" onClick={print}>
            <Printer className="size-4" aria-hidden /> {L ? "पोस्टर प्रिंट करें" : "Print gate poster"}
          </button>
        </div>
      </div>

      {/* Poster — what gets printed */}
      <div id="gate-poster" className="mx-auto max-w-[210mm] rounded-2xl border border-[var(--border)] bg-white p-8 text-[#203050] shadow-[var(--shadow-1)]" style={{ colorScheme: "light" }}>
        <div className="flex items-center gap-3 border-b-2 border-[#203050]/15 pb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={TENANT.logoCrestUrl} alt="" className="h-14 w-14 object-contain" />
          <div>
            <p className="text-2xl font-black leading-tight">{TENANT.name}</p>
            <p className="text-sm font-semibold text-[#5c6478]">Visitor check-in · विज़िटर चेक-इन{gate ? ` · ${gate}` : ""}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <p className="text-3xl font-black leading-tight">Scan to check in</p>
            <p className="text-2xl font-black leading-tight text-[#5c6478]">चेक-इन के लिए स्कैन करें</p>
            <p className="mt-2 text-sm text-[#5c6478]">{checkInUrl || ""}</p>
          </div>
          {qrIn ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrIn} alt="Check-in QR" className="h-52 w-52 shrink-0" />
          ) : (
            <div className="h-52 w-52 animate-pulse rounded-lg bg-[#efeee7]" />
          )}
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <ol className="space-y-2 text-[15px]">
            <p className="mb-1 text-xs font-black uppercase tracking-widest text-[#5c6478]">How it works</p>
            {GATE_POSTER_STEPS.en.map((s, i) => (
              <li key={i} className="flex gap-2"><span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#203050] text-xs font-black text-white">{i + 1}</span><span>{s}</span></li>
            ))}
          </ol>
          <ol className="space-y-2 text-[15px]">
            <p className="mb-1 text-xs font-black uppercase tracking-widest text-[#5c6478]">तरीका</p>
            {GATE_POSTER_STEPS.hi.map((s, i) => (
              <li key={i} className="flex gap-2"><span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#203050] text-xs font-black text-white">{i + 1}</span><span>{s}</span></li>
            ))}
          </ol>
        </div>

        <div className="mt-6 flex items-center gap-4 rounded-xl border border-[#203050]/15 bg-[#f6f5ef] p-4">
          {qrOut ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrOut} alt="Check-out QR" className="h-24 w-24 shrink-0" />
          ) : (
            <div className="h-24 w-24 animate-pulse rounded bg-[#efeee7]" />
          )}
          <div>
            <p className="text-lg font-black">Leaving? Scan to check out</p>
            <p className="font-black text-[#5c6478]">जाते समय चेक-आउट के लिए स्कैन करें</p>
            <p className="mt-1 text-xs text-[#5c6478]">Or ask the gate to check you out · या गेट पर चेक-आउट करवाएँ</p>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-[#5c6478]">
          Please carry a phone with a camera · कृपया कैमरे वाला फ़ोन साथ रखें · If you cannot scan, the gate will check you in · स्कैन न हो पाए तो गेट पर चेक-इन करवाएँ
        </p>
      </div>

      {showFull ? (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white p-6 text-[#203050]" style={{ colorScheme: "light" }} onClick={() => setShowFull(null)}>
          <button type="button" className="absolute right-4 top-4 rounded-full border-2 border-[#203050]/20 p-2" aria-label="Close" onClick={() => setShowFull(null)}>
            <X className="size-6" aria-hidden />
          </button>
          <p className="text-3xl font-black">{showFull === "in" ? "Scan to check in" : "Scan to check out"}</p>
          <p className="mb-6 text-2xl font-black text-[#5c6478]">{showFull === "in" ? "चेक-इन के लिए स्कैन करें" : "चेक-आउट के लिए स्कैन करें"}</p>
          {(showFull === "in" ? qrIn : qrOut) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={(showFull === "in" ? qrIn : qrOut) as string} alt="QR" className="h-[min(70vw,70vh)] w-[min(70vw,70vh)]" />
          ) : null}
          <p className="mt-6 text-sm text-[#5c6478]">{TENANT.name}</p>
        </div>
      ) : null}
    </div>
  );
}
