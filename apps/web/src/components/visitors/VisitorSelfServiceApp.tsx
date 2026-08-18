"use client";

/**
 * Public gate flow at /visit (behind the printed gate QR). No ERP shell, no
 * login; large touch targets; Hindi/English toggle remembered on the phone.
 *
 *   mobile → lookup (SIS parents / admission leads) → purpose → check-in
 *   → visitor number + time + a QR that reopens this page for check-out.
 *
 * ?out=1 opens straight in check-out mode; ?v=<id> shows that visit.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { qrDataUrlFor } from "@/lib/pdfQr";
import { TENANT } from "@/lib/types";
import {
  VISITOR_PURPOSE_HI,
  visitorStrings,
  type VisitorLang,
} from "@/lib/visitorI18n";
import { VISITOR_PURPOSES, type VisitorEntry, type VisitorPurpose } from "@/lib/visitors";

type Lookup = {
  mobile: string;
  suggestedName: string;
  parentOf: { studentName: string; classLabel: string; admissionNo: string }[];
  leads: { childName: string; classSought: string; stage: string }[];
  openVisit: VisitorEntry | null;
};

type Step = "mobile" | "details" | "done" | "checkout" | "checkedOut";
const LANG_KEY = "bhb_visitor_lang";

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
}

export function VisitorSelfServiceApp({
  initialMode,
  visitId,
  initialLang,
  gate,
}: {
  initialMode: "checkin" | "checkout";
  visitId: string | null;
  initialLang: VisitorLang | null;
  gate: string | null;
}) {
  const [lang, setLang] = useState<VisitorLang>("en");
  const t = visitorStrings(lang);
  const [step, setStep] = useState<Step>(initialMode === "checkout" ? "checkout" : "mobile");
  const [mobile, setMobile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState<VisitorPurpose | "">("");
  const [personToMeet, setPersonToMeet] = useState("");
  const [entry, setEntry] = useState<VisitorEntry | null>(null);
  const [passQr, setPassQr] = useState<string | null>(null);

  // Language: URL param > remembered > phone language.
  useEffect(() => {
    let l: VisitorLang | null = initialLang;
    if (!l) {
      try {
        const saved = localStorage.getItem(LANG_KEY);
        if (saved === "hi" || saved === "en") l = saved;
      } catch {
        /* ignore */
      }
    }
    if (!l) l = /^hi\b/i.test(navigator.language || "") ? "hi" : "en";
    setLang(l);
  }, [initialLang]);
  function toggleLang() {
    const next: VisitorLang = lang === "en" ? "hi" : "en";
    setLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* ignore */
    }
  }

  // ?v=<id> — show that visit (check-out or already-out).
  useEffect(() => {
    if (!visitId) return;
    void (async () => {
      const r = await fetch("/api/public/visitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", id: visitId }) });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; entry?: VisitorEntry } | null;
      if (j?.ok && j.entry) {
        setEntry(j.entry);
        setStep(j.entry.outTime ? "checkedOut" : "done");
      }
    })();
  }, [visitId]);

  // Pass QR → this page with ?v=<id> (scan again to check out).
  useEffect(() => {
    if (!entry) return;
    const url = `${window.location.origin}/visit?v=${encodeURIComponent(entry.id)}`;
    void qrDataUrlFor(url).then(setPassQr).catch(() => setPassQr(null));
  }, [entry]);

  const purposeLabel = useCallback(
    (p: VisitorPurpose) => (lang === "hi" ? VISITOR_PURPOSE_HI[p] || p : VISITOR_PURPOSES.find((x) => x.value === p)?.label || p),
    [lang],
  );

  async function api<T>(body: Record<string, unknown>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/public/visitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
      if (!j || j.ok === false) {
        setError(j?.error || t.error);
        return null;
      }
      return j;
    } catch {
      setError(t.error);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onLookup() {
    const digits = mobile.replace(/\D/g, "");
    if (digits.length < 10) {
      setError(t.invalidMobile);
      return;
    }
    const r = await api<Lookup>({ action: "lookup", mobile: digits });
    if (!r) return;
    setLookup(r);
    if (r.openVisit) {
      setEntry(r.openVisit);
      setStep("done");
      return;
    }
    setName(r.suggestedName || "");
    setStep("details");
  }

  async function onCheckIn() {
    if (!lookup) return;
    if (!name.trim()) {
      setError(t.yourName);
      return;
    }
    if (!purpose) {
      setError(t.purpose);
      return;
    }
    const linkedTo =
      lookup.parentOf.length > 0
        ? `Parent of ${lookup.parentOf.map((p) => `${p.studentName}${p.classLabel ? ` (${p.classLabel})` : ""}`).join(", ")}`
        : lookup.leads.length > 0
          ? `Admission lead: ${lookup.leads.map((l) => l.childName).join(", ")}`
          : "";
    const r = await api<{ entry: VisitorEntry; alreadyIn: boolean }>({
      action: "checkin",
      mobile: lookup.mobile,
      visitorName: name.trim(),
      purpose,
      personToMeet,
      linkedTo,
    });
    if (!r) return;
    setEntry(r.entry);
    setStep("done");
  }

  async function onCheckOut(id?: string) {
    const digits = mobile.replace(/\D/g, "");
    if (!id && digits.length < 10) {
      setError(t.invalidMobile);
      return;
    }
    const r = await api<{ entry: VisitorEntry }>({ action: "checkout", id, mobile: id ? undefined : digits });
    if (!r) return;
    setEntry(r.entry);
    setStep("checkedOut");
  }

  function reset() {
    setStep("mobile");
    setMobile("");
    setLookup(null);
    setName("");
    setPurpose("");
    setPersonToMeet("");
    setEntry(null);
    setPassQr(null);
    setError(null);
  }

  const purposeChips = useMemo(() => VISITOR_PURPOSES.map((p) => ({ value: p.value, label: purposeLabel(p.value) })), [purposeLabel]);

  const big = "w-full rounded-2xl px-4 py-4 text-lg font-bold";
  const primary = `${big} bg-[#203050] text-white shadow-md active:opacity-90 disabled:opacity-50`;
  const secondary = `${big} border-2 border-[#203050]/30 bg-white text-[#203050]`;
  const input = "w-full rounded-2xl border-2 border-[#203050]/25 bg-white px-4 py-4 text-xl tracking-wide text-[#203050] outline-none focus:border-[#203050]";

  return (
    <main className="min-h-screen bg-[#f6f5ef] text-[#203050]" style={{ colorScheme: "light" }}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-10 pt-5">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={TENANT.logoCrestUrl} alt="" className="h-11 w-11 object-contain" />
            <div>
              <p className="text-[15px] font-black leading-tight">{TENANT.name}</p>
              <p className="text-[12px] text-[#5c6478]">
                {t.appTitle}
                {gate ? ` · ${t.schoolGate} ${gate}` : ""}
              </p>
            </div>
          </div>
          <button type="button" onClick={toggleLang} className="rounded-full border-2 border-[#203050]/25 bg-white px-3 py-1.5 text-[13px] font-bold">
            {t.langToggle}
          </button>
        </header>

        {error ? <p className="mb-3 rounded-xl bg-[#fee2e2] px-3 py-2 text-sm font-semibold text-[#b91c1c]">{error}</p> : null}

        {step === "mobile" ? (
          <section className="space-y-4">
            <h1 className="text-2xl font-black leading-snug">{t.step1}</h1>
            <input className={input} inputMode="numeric" autoComplete="tel" maxLength={13} placeholder={t.mobilePlaceholder} value={mobile} onChange={(e) => setMobile(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void onLookup(); }} autoFocus />
            <button type="button" className={primary} disabled={busy} onClick={() => void onLookup()}>{busy ? t.checking : t.next}</button>
            <button type="button" className={secondary} onClick={() => { setStep("checkout"); setError(null); }}>{t.checkOut}</button>
          </section>
        ) : null}

        {step === "details" && lookup ? (
          <section className="space-y-4">
            <div className="rounded-2xl border border-[#203050]/15 bg-white p-4">
              <p className="text-lg font-black">{t.welcome}{lookup.suggestedName ? `, ${lookup.suggestedName}` : ""}</p>
              {lookup.parentOf.length > 0 ? (
                <div className="mt-2 text-sm">
                  <p className="font-semibold text-[#15803d]">{t.weFound}</p>
                  <p className="mt-1">{t.parentOf}</p>
                  <ul className="mt-1 space-y-1">
                    {lookup.parentOf.map((p) => (
                      <li key={p.admissionNo || p.studentName} className="rounded-lg bg-[#f6f5ef] px-3 py-1.5 font-semibold">
                        {p.studentName}{p.classLabel ? <span className="ml-2 text-[#5c6478]">· {t.classLabel} {p.classLabel}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : lookup.leads.length > 0 ? (
                <div className="mt-2 text-sm">
                  <p className="font-semibold text-[#15803d]">{t.weFound}</p>
                  <p className="mt-1">{t.admissionLead}</p>
                  <ul className="mt-1 space-y-1">
                    {lookup.leads.map((l, i) => (
                      <li key={i} className="rounded-lg bg-[#f6f5ef] px-3 py-1.5 font-semibold">
                        {l.childName}{l.classSought ? <span className="ml-2 text-[#5c6478]">· {t.classLabel} {l.classSought}</span> : null}{l.stage ? <span className="ml-2 text-[#5c6478]">· {t.stage}: {l.stage}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-2 text-sm text-[#5c6478]">{t.notOnFile}</p>
              )}
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-bold">{t.yourName}</span>
              <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
            </label>

            <div>
              <p className="mb-2 text-sm font-bold">{t.purpose}</p>
              <div className="grid grid-cols-2 gap-2">
                {purposeChips.map((p) => (
                  <button key={p.value} type="button" onClick={() => setPurpose(p.value)}
                    className={`rounded-2xl border-2 px-3 py-3 text-[15px] font-bold ${purpose === p.value ? "border-[#203050] bg-[#203050] text-white" : "border-[#203050]/20 bg-white"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-bold">{t.personToMeet}</span>
              <input className={input} value={personToMeet} onChange={(e) => setPersonToMeet(e.target.value)} />
            </label>

            <button type="button" className={primary} disabled={busy} onClick={() => void onCheckIn()}>{busy ? t.checkingIn : t.checkIn}</button>
            <button type="button" className={secondary} onClick={reset}>{t.startOver}</button>
          </section>
        ) : null}

        {step === "done" && entry ? (
          <section className="space-y-4">
            <div className="rounded-2xl border-2 border-[#15803d]/40 bg-white p-5 text-center">
              <p className="text-lg font-black text-[#15803d]">{lookup?.openVisit ? t.alreadyIn : t.checkedIn}</p>
              <p className="mt-3 text-sm text-[#5c6478]">{t.visitorNo}</p>
              <p className="text-4xl font-black tracking-wide">{entry.visitorNo || entry.id.slice(-6).toUpperCase()}</p>
              <p className="mt-2 text-lg font-bold">{entry.visitorName}</p>
              <p className="text-sm text-[#5c6478]">{purposeLabel(entry.purpose)}{entry.personToMeet ? ` · ${entry.personToMeet}` : ""}</p>
              {entry.linkedTo ? <p className="mt-1 text-xs text-[#5c6478]">{entry.linkedTo}</p> : null}
              <p className="mt-3 text-sm"><span className="text-[#5c6478]">{t.inTime}:</span> <b>{fmtTime(entry.inTime)}</b> · {fmtDate(entry.inTime)}</p>
              {passQr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={passQr} alt="Visitor QR" className="mx-auto mt-4 h-40 w-40" />
              ) : null}
              <p className="mt-3 text-xs text-[#5c6478]">{t.showAtGate}</p>
              <p className="mt-1 text-xs text-[#5c6478]">{t.keepPhone}</p>
            </div>
            <button type="button" className={primary} disabled={busy} onClick={() => void onCheckOut(entry.id)}>{busy ? t.checkingOut : t.checkOut}</button>
            <button type="button" className={secondary} onClick={reset}>{t.startOver}</button>
          </section>
        ) : null}

        {step === "checkout" ? (
          <section className="space-y-4">
            <h1 className="text-2xl font-black leading-snug">{t.checkOutPrompt}</h1>
            <input className={input} inputMode="numeric" autoComplete="tel" maxLength={13} placeholder={t.mobilePlaceholder} value={mobile} onChange={(e) => setMobile(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void onCheckOut(); }} autoFocus />
            <button type="button" className={primary} disabled={busy} onClick={() => void onCheckOut()}>{busy ? t.checkingOut : t.checkOut}</button>
            <button type="button" className={secondary} onClick={reset}>{t.startOver}</button>
          </section>
        ) : null}

        {step === "checkedOut" && entry ? (
          <section className="space-y-4">
            <div className="rounded-2xl border-2 border-[#203050]/20 bg-white p-5 text-center">
              <p className="text-lg font-black text-[#15803d]">{t.checkedOut}</p>
              <p className="mt-3 text-sm text-[#5c6478]">{t.visitorNo}</p>
              <p className="text-3xl font-black">{entry.visitorNo || entry.id.slice(-6).toUpperCase()}</p>
              <p className="mt-2 font-bold">{entry.visitorName}</p>
              <p className="mt-2 text-sm"><span className="text-[#5c6478]">{t.inTime}:</span> <b>{fmtTime(entry.inTime)}</b> · <span className="text-[#5c6478]">{t.outTime}:</span> <b>{fmtTime(entry.outTime)}</b></p>
            </div>
            <button type="button" className={secondary} onClick={reset}>{t.startOver}</button>
          </section>
        ) : null}

        <p className="mt-auto pt-8 text-center text-[11px] text-[#5c6478]">{t.printedBy}</p>
      </div>
    </main>
  );
}
