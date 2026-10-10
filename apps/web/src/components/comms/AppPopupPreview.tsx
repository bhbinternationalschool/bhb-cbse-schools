"use client";

import type { AppPopup } from "@/lib/appPopups";

/**
 * How a pop-up looks on a parent's or staff member's phone — the same layout,
 * text and buttons as the app's own dialog (cbse_school_mobile
 * core/popups/app_popups.dart), drawn in the app's colours. A phone is light
 * whatever the ERP's theme, so the colours here are the app's literals, not
 * the ERP's tokens.
 *
 * The real app asks only for what a family is missing; the preview shows
 * every box the pop-up can ask for, with a sample child.
 */

const APP = {
  primary: "#203050",
  muted: "#5C6478",
  surface: "#F6F5EF",
  border: "rgba(32,48,80,0.3)",
};

function t(lang: "hi" | "en", en: string, hi: string) {
  return lang === "hi" && hi.trim() ? hi : en;
}

function aadhaarBoxes(p: AppPopup, lang: "hi" | "en"): string[] {
  const child = lang === "hi" ? "बच्चे का नाम" : "Child's name";
  const father = lang === "hi" ? "पिता" : "Father";
  const mother = lang === "hi" ? "माता" : "Mother";
  const who = p.aadhaarScope === "child" ? [child] : p.aadhaarScope === "parents" ? [father, mother] : [child, father, mother];
  return who.map((w) => (lang === "hi" ? `${w} — आधार नंबर` : `${w} — Aadhaar number`));
}

export function AppPopupPreview({ popup: p, lang }: { popup: AppPopup; lang: "hi" | "en" }) {
  const title = t(lang, p.title, p.titleHi) || (lang === "hi" ? "(शीर्षक)" : "(title)");
  const body = t(lang, p.body, p.bodyHi);
  const btn = {
    background: APP.primary,
    color: "#FFFFFF",
    borderRadius: 14,
    padding: "13px 16px",
    textAlign: "center" as const,
    fontSize: 14,
    fontWeight: 600,
  };
  const outline = { ...btn, background: "#FFFFFF", color: APP.primary, border: `1px solid ${APP.border}` };
  return (
    <div
      aria-label="Phone preview"
      style={{
        width: 300,
        maxWidth: "100%",
        border: "8px solid #2C2C2A",
        borderRadius: 32,
        overflow: "hidden",
        background: "rgba(0,0,0,0.45)",
        minHeight: 520,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 14,
      }}
    >
      <div style={{ background: "#FFFFFF", borderRadius: 24, padding: 18, width: "100%", color: APP.primary, fontFamily: "system-ui, sans-serif" }}>
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- an uploaded poster, shown as the app shows it
          <img src={p.imageUrl} alt="" style={{ width: "100%", borderRadius: 12, marginBottom: 12, objectFit: "contain" }} />
        ) : null}
        <p style={{ fontSize: 17, fontWeight: 700, margin: "0 0 8px", color: APP.primary }}>{title}</p>
        {body ? <p style={{ fontSize: 14, margin: "0 0 12px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{body}</p> : null}

        {p.form === "aadhaar" ? (
          <>
            <p style={{ fontSize: 12, color: APP.muted, margin: "0 0 10px", lineHeight: 1.5 }}>
              {t(
                lang,
                "Used only for the school's records, UDISE+ and APAAR. The app shows it hidden (XXXX-XXXX-1234).",
                "यह केवल स्कूल के रिकॉर्ड, UDISE+ और APAAR के लिए है। ऐप में यह छिपा दिखेगा (XXXX-XXXX-1234)।",
              )}
            </p>
            {aadhaarBoxes(p, lang).map((label) => (
              <div key={label} style={{ border: `1px solid ${APP.border}`, borderRadius: 14, padding: 12, marginBottom: 10, fontSize: 13, color: APP.muted }}>
                {label}
              </div>
            ))}
            <div style={btn}>{t(lang, "Save", "सेव करें")}</div>
          </>
        ) : null}

        {p.form === "consent" ? (
          <>
            <div style={{ background: APP.surface, borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 1.5, marginBottom: 12, whiteSpace: "pre-wrap" }}>
              {t(lang, p.consentText, p.consentTextHi) || (lang === "hi" ? "(सहमति का पाठ)" : "(consent text)")}
            </div>
            <div style={btn}>{t(lang, "I agree", "मैं सहमत हूँ")}</div>
            <div style={{ ...outline, marginTop: 6 }}>{t(lang, "I do not agree", "मैं सहमत नहीं हूँ")}</div>
          </>
        ) : null}

        {p.form === "documents" ? (
          <div style={outline}>{t(lang, "Upload documents — Child's name", "दस्तावेज़ अपलोड करें — बच्चे का नाम")}</div>
        ) : null}

        {p.form === "none" ? <div style={btn}>{p.ctaLabel && p.ctaRoute ? p.ctaLabel : t(lang, "OK", "ठीक है")}</div> : null}

        <div style={{ textAlign: "center", padding: "12px 0 2px", fontSize: 14 }}>{t(lang, "Later", "बाद में")}</div>
      </div>
    </div>
  );
}

/** Live / scheduled / ended / stopped, by today's date (IST). */
export function popupStatus(p: AppPopup, today: string): { label: string; tone: "live" | "wait" | "off" } {
  if (!p.active) return { label: "Stopped", tone: "off" };
  if (p.startsOn && today < p.startsOn) return { label: `Starts ${p.startsOn}`, tone: "wait" };
  if (p.endsOn && today > p.endsOn) return { label: "Ended", tone: "off" };
  return { label: "Live", tone: "live" };
}
