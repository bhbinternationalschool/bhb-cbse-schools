"use client";

/**
 * Publicity for an inter-school event — everything generates from the event
 * record itself: the print poster and square graphic (real QR to the
 * registration page), the parent WhatsApp broadcast, the forwardable invite
 * for other schools, AI-drafted social captions (EN/HI), and one-tap
 * cross-posting to the connected social channels.
 */

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { loadSis } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import { btn, btnOutline } from "@/components/ui/erp-ui";

type Category = {
  id: string;
  name: string;
  classBand: string;
  prize1Paise: number;
  prize2Paise: number;
  prize3Paise: number;
  prizeNotes: string;
};

type Evt = {
  id: string;
  name: string;
  slug: string;
  eventDate: string;
  venue: string;
  registrationClosesOn: string;
  entryFeePaise: number;
  status: string;
  categories: Category[];
};

function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function displayDate(iso: string): string {
  if (!iso) return "Date to be announced";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function EventPublicity({
  event,
  readOnly,
}: {
  event: Evt;
  readOnly?: boolean;
}) {
  const origin = `https://${TENANT.publicPortal}`;
  const publicUrl = `${origin}/fest/${event.slug}`;
  const registerUrl = `${publicUrl}/register`;

  const [qr, setQr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [captions, setCaptions] = useState<
    { language: string; text: string }[]
  >([]);
  const [broadcastResult, setBroadcastResult] = useState<string | null>(null);

  const topPrize = Math.max(
    0,
    ...event.categories.map((c) => c.prize1Paise),
  );

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(registerUrl, {
      width: 480,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#203050", light: "#ffffff" },
    }).then((d) => {
      if (!cancelled) setQr(d);
    });
    return () => {
      cancelled = true;
    };
  }, [registerUrl]);

  const parentMobiles = useMemo(() => {
    const sis = loadSis();
    const out = new Set<string>();
    for (const h of sis.households) {
      const m = (h.whatsappMobile || h.mobile || "").replace(/\D/g, "").slice(-10);
      if (m.length === 10) out.add(m);
    }
    return [...out];
  }, []);

  const feeLine =
    event.entryFeePaise > 0
      ? `Entry ${inr(event.entryFeePaise)} per participant (pay online while registering)`
      : "FREE entry";

  const parentMessage = [
    `*${TENANT.nameDisplay}* 🏆`,
    `*${event.name}*`,
    "",
    `${displayDate(event.eventDate)}${event.venue ? ` · ${event.venue}` : ""}`,
    `Competitions: ${event.categories.map((c) => c.name).join(", ")}`,
    topPrize > 0 ? `Prizes up to *${inr(topPrize)}* · certificate for EVERY participant` : "Certificate for every participant",
    feeLine,
    "",
    `Register your child: ${registerUrl}`,
    `Rules, participants & results (public): ${publicUrl}`,
  ].join("\n");

  const schoolInvite = [
    `Respected Principal / Teacher,`,
    "",
    `*${TENANT.nameDisplay}, ${TENANT.city}* invites your students to`,
    `*${event.name}* — ${displayDate(event.eventDate)}${event.venue ? `, ${event.venue}` : ""}.`,
    "",
    `Open to students of ALL schools.`,
    `Competitions: ${event.categories.map((c) => [c.name, c.classBand].filter(Boolean).join(" ")).join(" · ")}`,
    topPrize > 0 ? `Prizes up to ${inr(topPrize)} per category · certificate for every participant (winner certificates verifiable online).` : `Certificate for every participant (verifiable online).`,
    feeLine + ".",
    event.registrationClosesOn ? `Registration closes ${event.registrationClosesOn}.` : "",
    "",
    `Parents can register directly: ${registerUrl}`,
    `Rules, judging and results are published openly at: ${publicUrl}`,
    "",
    `We look forward to hosting your students.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const templateCaptions = [
    {
      language: "en",
      text: `🏆 ${event.name} — hosted by ${TENANT.nameDisplay}, ${TENANT.city}!\n${displayDate(event.eventDate)}${event.venue ? ` · ${event.venue}` : ""}\nOpen to students of ALL schools · ${event.categories.map((c) => c.name).join(", ")}\n${topPrize > 0 ? `Prizes up to ${inr(topPrize)} · ` : ""}certificate for every participant.\n${feeLine}\nRegister: ${registerUrl}\n#${TENANT.shortName?.replace(/\W/g, "") ?? "School"} #InterSchool #${event.slug.replace(/-/g, "")}`,
    },
    {
      language: "hi",
      text: `🏆 ${event.name} — ${TENANT.nameDisplay}, ${TENANT.city} में!\n${displayDate(event.eventDate)}${event.venue ? ` · ${event.venue}` : ""}\nसभी विद्यालयों के विद्यार्थियों के लिए खुला · ${event.categories.map((c) => c.name).join(", ")}\n${topPrize > 0 ? `पुरस्कार ${inr(topPrize)} तक · ` : ""}हर प्रतिभागी को प्रमाण-पत्र।\nपंजीकरण: ${registerUrl}`,
    },
  ];

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3500);
  }

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(
      () => flash(`${label} copied`),
      () => setError("Could not copy — select and copy manually"),
    );
  }

  async function draftCaptions() {
    setBusy("captions");
    setError(null);
    try {
      const res = await fetch("/api/ai/marketing-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "social_post",
          facts: {
            occasion: `${event.name} — inter-school competition hosted by us · ${displayDate(event.eventDate)} · ${event.venue} · open to students of ALL schools · categories: ${event.categories.map((c) => `${c.name} ${c.classBand}`.trim()).join(", ")} · ${topPrize > 0 ? `top prize ${inr(topPrize)} per category · ` : ""}certificate for every participant · ${feeLine}`,
            ctaUrl: registerUrl,
          },
          audiences: [
            { language: "en", register: "warm" },
            { language: "hi", register: "warm" },
          ],
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        variants?: { language: string; text: string }[];
        error?: string;
      };
      if (!res.ok || !json.variants?.length) {
        throw new Error(json.error || "AI unavailable");
      }
      setCaptions(json.variants.map((v) => ({ language: v.language, text: v.text })));
      flash("Captions drafted");
    } catch (e) {
      setCaptions(templateCaptions);
      flash(
        `AI unavailable (${e instanceof Error ? e.message : "error"}) — showing ready-made captions instead`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function crossPost() {
    if (readOnly) return;
    const caption = (captions[0] ?? templateCaptions[0]!).text;
    if (!window.confirm("Post this event to the connected social channels (Telegram / Facebook / Instagram where configured)?")) return;
    setBusy("social");
    try {
      const res = await fetch("/api/integrations/social/cross-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "marketing",
          contentId: `evt_${event.id}`,
          title: event.name,
          body: caption,
          linkUrl: publicUrl,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(json.error || `HTTP ${res.status}`));
      flash("Cross-post submitted — see Comms → Social for per-channel status");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cross-post failed");
    } finally {
      setBusy(null);
    }
  }

  async function broadcastParents() {
    if (readOnly) return;
    if (parentMobiles.length === 0) {
      setError("No parent WhatsApp numbers found on this device's roster");
      return;
    }
    if (
      !window.confirm(
        `Send the event invite on WhatsApp to ${parentMobiles.length} parent number(s)? Quiet hours are respected automatically.`,
      )
    ) {
      return;
    }
    setBusy("broadcast");
    setBroadcastResult(null);
    try {
      let sent = 0;
      let failed = 0;
      for (let i = 0; i < parentMobiles.length; i += 40) {
        const chunk = parentMobiles.slice(i, i + 40);
        const res = await fetch("/api/wa/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: chunk.map((mobile) => ({ mobile, body: parentMessage })),
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          sent?: number;
          failed?: number;
          results?: unknown[];
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        sent += json.sent ?? chunk.length;
        failed += json.failed ?? 0;
        setBroadcastResult(`Sending… ${Math.min(i + 40, parentMobiles.length)}/${parentMobiles.length}`);
      }
      setBroadcastResult(
        `Broadcast done — ${sent} queued${failed ? `, ${failed} failed` : ""}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Broadcast failed");
    } finally {
      setBusy(null);
    }
  }

  function printPoster() {
    document.body.classList.add("printing-evt-poster");
    window.print();
    window.setTimeout(
      () => document.body.classList.remove("printing-evt-poster"),
      400,
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">{notice}</p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ── WhatsApp broadcast to own parents ── */}
        <section className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--brand-deep)]">
            WhatsApp — all parents ({parentMobiles.length})
          </div>
          <pre className="max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-sunken)] p-3 text-xs text-[var(--brand-deep)]">{parentMessage}</pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={readOnly || busy === "broadcast"} onClick={() => void broadcastParents()}>
              {busy === "broadcast" ? "Sending…" : `Broadcast to ${parentMobiles.length} parents`}
            </button>
            <button type="button" className={btnOutline} onClick={() => copy(parentMessage, "Parent message")}>Copy</button>
          </div>
          {broadcastResult ? (
            <p className="text-xs font-semibold text-[var(--success)]">{broadcastResult}</p>
          ) : null}
        </section>

        {/* ── Invite for other schools ── */}
        <section className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--brand-deep)]">
            Invite for other schools — forwardable
          </div>
          <pre className="max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-sunken)] p-3 text-xs text-[var(--brand-deep)]">{schoolInvite}</pre>
          <div className="flex flex-wrap gap-2">
            <a
              className="rounded-lg bg-[#128C7E] px-3 py-1.5 text-xs font-bold text-white"
              href={`https://wa.me/?text=${encodeURIComponent(schoolInvite)}`}
              target="_blank"
              rel="noopener"
            >
              Share on WhatsApp
            </a>
            <button type="button" className={btnOutline} onClick={() => copy(schoolInvite, "School invite")}>Copy</button>
          </div>
        </section>

        {/* ── Social captions + cross-post ── */}
        <section className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--brand-deep)]">
              Social media captions
            </div>
            <div className="flex gap-2">
              <button type="button" className={btnOutline} disabled={busy === "captions"} onClick={() => void draftCaptions()}>
                {busy === "captions" ? "Drafting…" : captions.length ? "Redraft (AI)" : "Draft captions (AI, EN + HI)"}
              </button>
              <button type="button" className={btn} disabled={readOnly || busy === "social"} onClick={() => void crossPost()}>
                {busy === "social" ? "Posting…" : "Post to channels"}
              </button>
            </div>
          </div>
          {(captions.length ? captions : templateCaptions).map((c, i) => (
            <div key={i} className="rounded-lg bg-[var(--surface-sunken)] p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase text-[var(--muted)]">
                  {c.language === "hi" ? "Hindi" : "English"}
                </span>
                <button type="button" className="text-[10px] font-bold text-[var(--brand-mid)] underline" onClick={() => copy(c.text, "Caption")}>
                  Copy
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-xs text-[var(--brand-deep)]">{c.text}</pre>
            </div>
          ))}
          <p className="text-[10px] text-[var(--muted)]">
            &quot;Post to channels&quot; sends to the connected Telegram / Facebook / Instagram
            pipes (Comms → Social shows per-channel status). For WhatsApp Status, use the
            square graphic below.
          </p>
        </section>

        {/* ── Poster & square graphic ── */}
        <section className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--brand-deep)]">
              Poster (A4 print) &amp; square graphic
            </div>
            <button type="button" className={btn} onClick={printPoster}>
              Print / save PDF
            </button>
          </div>
          <p className="text-[10px] text-[var(--muted)]">
            The A4 poster prints below (also save as PDF for the print shop). The square
            version is sized for Instagram / WhatsApp Status — screenshot it or print to
            image. Both carry the same scannable QR to the registration page.
          </p>
        </section>
      </div>

      {/* Print target: A4 poster then square graphic */}
      <div className="evt-poster-sheet print-target space-y-6">
        {/* A4 poster */}
        <div className="evt-poster-page relative mx-auto w-full max-w-[794px] overflow-hidden rounded-lg border border-[var(--border)] bg-[#f6f5ef] p-10 text-center text-[#203050]" style={{ aspectRatio: "794/1123" }}>
          <p className="text-[13px] font-extrabold tracking-[0.3em] text-[#c5a028]">
            {TENANT.nameDisplay.toUpperCase()}
          </p>
          <p className="mt-1 text-[10px] tracking-[0.14em] text-[#5a6a8a]">
            {TENANT.city?.toUpperCase?.() ?? ""} · PRESENTS
          </p>
          <h2 className="mt-8 text-5xl font-extrabold leading-tight tracking-tight">{event.name}</h2>
          <p className="mt-4 text-lg font-bold">{displayDate(event.eventDate)}</p>
          {event.venue ? <p className="text-sm text-[#5a6a8a]">{event.venue}</p> : null}

          <div className="mx-auto mt-8 inline-block rounded-full bg-[#203050] px-6 py-2 text-sm font-extrabold uppercase tracking-widest text-white">
            Open to all schools
          </div>

          <div className="mx-auto mt-8 grid max-w-[560px] grid-cols-2 gap-3">
            {event.categories.slice(0, 6).map((c) => (
              <div key={c.id} className="rounded-xl border-2 border-[#c5a028] bg-white p-3">
                <div className="text-base font-extrabold">{c.name}</div>
                <div className="text-[11px] text-[#5a6a8a]">{c.classBand}</div>
                <div className="mt-1 text-sm font-bold text-[#b45309]">
                  1st {inr(c.prize1Paise)}{c.prizeNotes ? ` ${c.prizeNotes}` : ""}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-6 text-sm font-bold">
            Certificate for EVERY participant · {feeLine}
          </p>
          {event.registrationClosesOn ? (
            <p className="mt-1 text-xs text-[#5a6a8a]">Register by {event.registrationClosesOn}</p>
          ) : null}

          <div className="mt-8 flex items-center justify-center gap-5">
            {qr ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={qr} alt="Scan to register" className="h-36 w-36 rounded-lg border border-[#203050]/20 bg-white p-1.5" />
            ) : null}
            <div className="text-left">
              <p className="text-lg font-extrabold">Scan to register</p>
              <p className="mt-1 max-w-[240px] break-all text-xs text-[#5a6a8a]">{registerUrl}</p>
              <p className="mt-2 text-[10px] text-[#5a6a8a]">
                Rules · participants · results · accounts — all public at
                <br />
                <span className="font-semibold text-[#203050]">{publicUrl}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Square graphic (social / status) */}
        <div className="evt-poster-page relative mx-auto w-full max-w-[540px] overflow-hidden rounded-lg bg-[#203050] p-8 text-center text-white" style={{ aspectRatio: "1/1" }}>
          <p className="text-[11px] font-extrabold tracking-[0.26em] text-[#f0d878]">
            {TENANT.nameDisplay.toUpperCase()}
          </p>
          <h3 className="mt-4 text-3xl font-extrabold leading-tight">{event.name}</h3>
          <p className="mt-2 text-sm font-bold text-[#f0d878]">{displayDate(event.eventDate)}</p>
          <p className="mt-3 text-xs text-white/85">
            {event.categories.map((c) => c.name).join(" · ")}
          </p>
          <div className="mx-auto mt-4 inline-block rounded-full bg-[#c5a028] px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-widest text-[#1a2740]">
            Open to all schools
          </div>
          <p className="mt-3 text-xs font-bold">
            {topPrize > 0 ? `Prizes up to ${inr(topPrize)} · ` : ""}Certificate for every participant
          </p>
          {qr ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={qr} alt="Scan to register" className="mx-auto mt-4 h-28 w-28 rounded-lg bg-white p-1.5" />
          ) : null}
          <p className="mt-2 text-[10px] text-white/80">{registerUrl}</p>
        </div>
      </div>
    </div>
  );
}
