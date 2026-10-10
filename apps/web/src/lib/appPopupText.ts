/**
 * App pop-up text: length limits and the AI prompts (director, 10 Oct 2026).
 *
 * A pop-up must fit one phone screen — title, message, the form and the
 * buttons — without scrolling. The first Aadhaar pop-up's message ran to
 * 900 characters and pushed the boxes and Save below the fold. The limits
 * below are what fits on a small phone (about 560 px of dialog) alongside
 * each form; a poster image takes room from the message.
 *
 * The AI writes the message from the title, and fills the other language
 * from whichever one was typed. Pure — the call itself is in aiLlm.server.
 */

import type { AppPopupForm } from "@/lib/appPopups";

export const POPUP_TITLE_MAX = 70;
export const POPUP_CONSENT_MAX = 300;

/** The longest message that still fits one screen with this form. */
export function popupBodyMax(form: AppPopupForm, hasImage: boolean): number {
  const byForm: Record<AppPopupForm, number> = { aadhaar: 160, documents: 200, consent: 120, none: 320 };
  return hasImage ? Math.min(byForm[form], 120) : byForm[form];
}

/** What is too long, as the office would say it ("" = fits). */
export function popupTextTooLong(p: {
  title: string;
  titleHi: string;
  body: string;
  bodyHi: string;
  consentText: string;
  consentTextHi: string;
  form: AppPopupForm;
  imageUrl: string;
}): string {
  const max = popupBodyMax(p.form, !!p.imageUrl);
  const over = (label: string, text: string, limit: number) =>
    [...text].length > limit ? `${label} is ${[...text].length} characters — keep it within ${limit} so it fits on one phone screen.` : "";
  return (
    over("The English title", p.title, POPUP_TITLE_MAX) ||
    over("The Hindi title", p.titleHi, POPUP_TITLE_MAX) ||
    over("The English message", p.body, max) ||
    over("The Hindi message", p.bodyHi, max) ||
    (p.form === "consent"
      ? over("The English consent text", p.consentText, POPUP_CONSENT_MAX) || over("The Hindi consent text", p.consentTextHi, POPUP_CONSENT_MAX)
      : "")
  );
}

export type PopupTextRequest =
  | { mode: "draft"; title: string; form: AppPopupForm; bodyMax: number }
  | { mode: "translate"; text: string; from: "en" | "hi"; field: "title" | "body" | "consent"; max: number };

const FORM_PURPOSE: Record<AppPopupForm, string> = {
  aadhaar: "the parent is asked to type the missing Aadhaar numbers (child, father, mother) in boxes below the message",
  documents: "the parent is asked to upload the child's missing documents with a button below the message",
  consent: "the parent answers I agree / I do not agree to a consent shown below the message",
  none: "an announcement or poster with an OK button",
};

export function buildPopupTextPrompt(r: PopupTextRequest): { system: string; user: string } {
  if (r.mode === "draft") {
    return {
      system: `You write the short message for a pop-up that opens when a parent opens an Indian school's mobile app (BHB International School, Varanasi).
Write it in English and in Hindi (Devanagari, simple everyday Hindi a parent reads easily — not a word-for-word translation).
Rules:
- Warm and respectful, plain and direct. No emojis, no "Dear Parent", no greetings, no sign-off.
- Say what is needed and why in one or two short sentences. Do not invent deadlines, dates, fees, penalties or facts that are not in the title.
- Each message at most ${r.bodyMax} characters. The titles at most ${POPUP_TITLE_MAX} characters; keep the given title's meaning, tidy it if needed.
Respond with JSON only: {"title":"...","titleHi":"...","body":"...","bodyHi":"..."}.`,
      user: `Title: ${r.title}\nWhat the pop-up does: ${FORM_PURPOSE[r.form]}.`,
    };
  }
  const to = r.from === "en" ? "Hindi (Devanagari, simple everyday Hindi a parent reads easily)" : "English (plain and simple)";
  return {
    system: `You translate text for a pop-up in an Indian school's parent app into ${to}.
Keep the meaning, tone and any names, numbers, dates and terms like UDISE+, PEN, APAAR and Aadhaar exactly. Add nothing.
At most ${r.max} characters. Respond with JSON only: {"text":"..."}.`,
    user: `The ${r.field === "title" ? "title" : r.field === "consent" ? "consent text" : "message"}:\n${r.text}`,
  };
}

const clip = (v: unknown, max: number) => [...String(v ?? "").trim()].slice(0, max).join("");

export function parsePopupDraft(raw: string, bodyMax: number): { title: string; titleHi: string; body: string; bodyHi: string } | null {
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const out = {
      title: clip(j.title, POPUP_TITLE_MAX),
      titleHi: clip(j.titleHi, POPUP_TITLE_MAX),
      body: clip(j.body, bodyMax),
      bodyHi: clip(j.bodyHi, bodyMax),
    };
    return out.body && out.bodyHi ? out : null;
  } catch {
    return null;
  }
}

export function parsePopupTranslation(raw: string, max: number): { text: string } | null {
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const text = clip(j.text, max);
    return text ? { text } : null;
  } catch {
    return null;
  }
}

/** Is this Hindi (Devanagari) or English? Decides which box a typed line fills. */
export function looksHindi(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (!letters) return false;
  const deva = (letters.match(/[ऀ-ॿ]/g) ?? []).length;
  return deva / letters.length > 0.3;
}
