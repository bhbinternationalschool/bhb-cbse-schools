"use client";

/**
 * Visitors → Gate QR: the QR that visitors scan at the gate (opens /visit),
 * a printable A4 poster with the procedure in Hindi and English, and a
 * full-screen "show to visitor" mode for the gateman's phone/tablet.
 */

import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Printer, QrCode, X } from "lucide-react";
import { qrDataUrlFor } from "@/lib/pdfQr";
import { TENANT } from "@/lib/types";
import { GATE_POSTER_STEPS, GATE_WA_POSTER_STEPS, type VisitorLang } from "@/lib/visitorI18n";

const WA_KEY = "bhb_gate_wa_number";

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
  const [showFull, setShowFull] = useState<"in" | "out" | "wa" | null>(null);
  // School WhatsApp number for the second QR: server (Meta display number /
  // WHATSAPP_GATE_NUMBER) unless overridden here (kept on this browser).
  const [waServer, setWaServer] = useState<string | null>(null);
  const [waStart, setWaStart] = useState("VISIT");
  const [waOverride, setWaOverride] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      setWaOverride(localStorage.getItem(WA_KEY) || "");
    } catch {
      /* ignore */
    }
    void fetch("/api/public/visitor", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { whatsapp?: string | null; startText?: string }) => {
        setWaServer(j.whatsapp || null);
        if (j.startText) setWaStart(j.startText);
      })
      .catch(() => setWaServer(null));
  }, []);
  const waNumber = useMemo(() => {
    const d = (waOverride || waServer || "").replace(/\D/g, "");
    if (!d) return "";
    return d.length === 10 ? `91${d}` : d;
  }, [waOverride, waServer]);
  const waUrl = useMemo(() => (waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(waStart)}` : null), [waNumber, waStart]);
  const qrWa = useQr(waUrl);
  function setWaOverridePersist(v: string) {
    setWaOverride(v);
    try {
      if (v.trim()) localStorage.setItem(WA_KEY, v.trim());
      else localStorage.removeItem(WA_KEY);
    } catch {
      /* ignore */
    }
  }
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
          @page { size: A4; margin: 0; }
          body.printing-gate-poster #gate-poster { position: absolute; top: 0; left: 0; margin: 0; width: 210mm; max-width: 210mm; padding: 10mm 12mm; background: #fff; color: #203050; box-shadow: none; border: 0; border-radius: 0; }
        }
      `}</style>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <label className="text-sm">
          <span className="mr-2 text-[11px] text-[var(--muted)]">{L ? "गेट का नाम (वैकल्पिक)" : "Gate label (optional)"}</span>
          <input className="h-9 w-40 rounded-lg border border-[var(--border)] bg-transparent px-2 text-sm" placeholder={L ? "मुख्य गेट" : "Main gate"} value={gate} onChange={(e) => setGate(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mr-2 text-[11px] text-[var(--muted)]">{L ? "WhatsApp नंबर" : "WhatsApp number"}</span>
          <input
            className="h-9 w-44 rounded-lg border border-[var(--border)] bg-transparent px-2 font-mono text-sm"
            placeholder={waServer ? `+${waServer}` : L ? "91XXXXXXXXXX" : "91XXXXXXXXXX"}
            value={waOverride}
            onChange={(e) => setWaOverridePersist(e.target.value)}
            title={waServer ? (L ? "खाली छोड़ें = स्कूल का WhatsApp नंबर" : "Blank = school WhatsApp number from Meta") : L ? "स्कूल WhatsApp नंबर लिखें" : "Enter the school WhatsApp number"}
          />
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={!waUrl} onClick={() => setShowFull("wa")}>
            <MessageCircle className="size-4" aria-hidden /> {L ? "WhatsApp QR दिखाएँ" : "Show WhatsApp QR"}
          </button>
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
      <div id="gate-poster" className="theme-light-island mx-auto max-w-[210mm] rounded-2xl border border-[var(--border)] bg-white p-8 text-[#203050] shadow-[var(--shadow-1)]" style={{ colorScheme: "light" }}>
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

        {waUrl ? (
          <div className="mt-6 rounded-xl border-2 border-[#25D366]/60 bg-[#f0fbf4] p-5">
            <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
              {qrWa ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrWa} alt="WhatsApp check-in QR" className="h-40 w-40 shrink-0" />
              ) : (
                <div className="h-40 w-40 animate-pulse rounded-lg bg-[#e3f3e8]" />
              )}
              <div>
                <p className="text-2xl font-black leading-tight">Or check in on WhatsApp</p>
                <p className="text-xl font-black leading-tight text-[#5c6478]">या WhatsApp से चेक-इन करें</p>
                <p className="mt-1 text-sm text-[#5c6478]">
                  +{waNumber} · send <span className="font-mono font-black text-[#203050]">{waStart}</span> · जाते समय <span className="font-mono font-black text-[#203050]">OUT</span> भेजें
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <ol className="space-y-1.5 text-[14px]">
                <p className="mb-1 text-xs font-black uppercase tracking-widest text-[#5c6478]">On WhatsApp</p>
                {GATE_WA_POSTER_STEPS.en.map((st, i) => (
                  <li key={i} className="flex gap-2"><span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#128C7E] text-xs font-black text-white">{i + 1}</span><span>{st}</span></li>
                ))}
              </ol>
              <ol className="space-y-1.5 text-[14px]">
                <p className="mb-1 text-xs font-black uppercase tracking-widest text-[#5c6478]">WhatsApp पर</p>
                {GATE_WA_POSTER_STEPS.hi.map((st, i) => (
                  <li key={i} className="flex gap-2"><span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#128C7E] text-xs font-black text-white">{i + 1}</span><span>{st}</span></li>
                ))}
              </ol>
            </div>
          </div>
        ) : (
          <p className="mt-6 rounded-xl border border-dashed border-[#203050]/25 p-3 text-center text-xs text-[#5c6478] print:hidden">
            {L ? "WhatsApp QR जोड़ने के लिए ऊपर स्कूल का WhatsApp नंबर लिखें।" : "Enter the school WhatsApp number above to add the WhatsApp check-in QR to this poster."}
          </p>
        )}

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
        <div className="theme-light-island fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white p-6 text-[#203050]" style={{ colorScheme: "light" }} onClick={() => setShowFull(null)}>
          <button type="button" className="absolute right-4 top-4 rounded-full border-2 border-[#203050]/20 p-2" aria-label="Close" onClick={() => setShowFull(null)}>
            <X className="size-6" aria-hidden />
          </button>
          <p className="text-3xl font-black">{showFull === "in" ? "Scan to check in" : showFull === "out" ? "Scan to check out" : "Check in on WhatsApp"}</p>
          <p className="mb-6 text-2xl font-black text-[#5c6478]">{showFull === "in" ? "चेक-इन के लिए स्कैन करें" : showFull === "out" ? "चेक-आउट के लिए स्कैन करें" : "WhatsApp से चेक-इन करें"}</p>
          {(showFull === "in" ? qrIn : showFull === "out" ? qrOut : qrWa) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={(showFull === "in" ? qrIn : showFull === "out" ? qrOut : qrWa) as string} alt="QR" className="h-[min(70vw,70vh)] w-[min(70vw,70vh)]" />
          ) : null}
          {showFull === "wa" ? <p className="mt-4 text-lg font-bold">+{waNumber} · send {waStart} · जाते समय OUT भेजें</p> : null}
          <p className="mt-6 text-sm text-[#5c6478]">{TENANT.name}</p>
        </div>
      ) : null}
    </div>
  );
}
