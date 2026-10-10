/**
 * Puter — the free, browser-side AI layer, and the fence around it.
 *
 * Puter (js.puter.com) gives an app free `txt2img`, `img2txt`, `chat` and
 * `txt2speech` under a "User Pays" model: there is no API key, the call runs
 * in the visitor's browser, and once the app's free allotment is spent the
 * VISITOR is asked to sign into a Puter account.
 *
 * That shape decides everything about how we may use it:
 *
 *  1. **Staff only.** A Puter sign-in popup in front of a parent at a gate
 *     ends the flow. Nothing parent-facing may reach for it — not the PWA,
 *     not the WhatsApp bots, not `/track`, not `/pay`.
 *  2. **Never the only path.** It has no SLA and the free allotment can run
 *     out mid-press, so every call site keeps its existing paid path
 *     (Gemini / OpenAI / Google Vision) and falls back to it silently.
 *  3. **No student data, ever.** The call leaves our servers entirely and
 *     lands with a third party outside India. Under the DPDP Act 2023 that
 *     is a transfer we have no consent for, so a prompt carrying an Aadhaar
 *     or APAAR number, a phone, an email, a UDISE code or a date of birth is
 *     refused HERE, before the SDK is even loaded — `assertPuterSafe` is not
 *     advice, it is the gate every wrapper in puterAi.client.ts calls first.
 *
 * This module is pure and client-safe on purpose: the rules above are what
 * puterAi.selftest.ts pins, and a rule that needs a browser to test is a
 * rule nobody tests. The SDK itself lives in puterAi.client.ts.
 */

/** Loaded from Puter's CDN at first use — there is no npm package for v2. */
export const PUTER_SDK_URL = "https://js.puter.com/v2/";

/**
 * The only two surfaces cleared for Puter, each staff-only and each with a
 * paid path behind it. Adding a third is a decision, not an import: put it
 * here with its fallback named, or it cannot be called.
 */
export type PuterSurface = "marketing_image" | "syllabus_ocr";

export const PUTER_SURFACES: {
  id: PuterSurface;
  label: string;
  /** What runs when Puter is off, declines, or fails. */
  fallback: string;
  /** Longest prompt/text we will hand over. */
  maxChars: number;
}[] = [
  {
    id: "marketing_image",
    label: "Marketing artwork",
    fallback: "no artwork — the office uses its own photo",
    maxChars: 1200,
  },
  {
    id: "syllabus_ocr",
    label: "Textbook contents scan",
    fallback: "Google Vision OCR (/api/ocr/syllabus)",
    maxChars: 400,
  },
];

export function puterSurface(id: PuterSurface) {
  const s = PUTER_SURFACES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown Puter surface: ${id}`);
  return s;
}

/**
 * Off unless the school switches it on. Read as a literal so the value is
 * inlined at build time — a dynamic `process.env[...]` read is always
 * undefined in the browser (see the dynamic_public_env ratchet).
 */
export function puterEnabled(): boolean {
  return String(process.env.NEXT_PUBLIC_PUTER_ENABLED || "").trim() === "true";
}

/* ── The DPDP fence ──────────────────────────────────────────────────── */

export type PiiKind =
  | "aadhaar_or_apaar"
  | "phone"
  | "email"
  | "udise_or_long_id"
  | "date_of_birth"
  | "account_number";

const PII_PATTERNS: { kind: PiiKind; re: RegExp }[] = [
  // Aadhaar and APAAR are both 12 digits, written in 4-4-4 or as one run.
  { kind: "aadhaar_or_apaar", re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  // Indian mobile, with or without +91 / 0.
  { kind: "phone", re: /(?:\+?91[\s-]?|\b0)?[6-9]\d{9}\b/g },
  { kind: "email", re: /\b[^\s@]+@[^\s@]+\.[a-z]{2,}\b/gi },
  // UDISE is 11 digits; any other long run is an id we cannot vouch for.
  { kind: "udise_or_long_id", re: /\b\d{8,}\b/g },
  { kind: "date_of_birth", re: /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g },
  // Bank / IFSC-shaped strings from the fee book.
  { kind: "account_number", re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
];

/** Every kind of identifier found in `text`, de-duplicated and ordered. */
export function piiKinds(text: string): PiiKind[] {
  const src = String(text || "");
  const hits = new Set<PiiKind>();
  for (const { kind, re } of PII_PATTERNS) {
    // Fresh lastIndex each time — these are module-level /g regexes.
    re.lastIndex = 0;
    if (re.test(src)) hits.add(kind);
  }
  return PII_PATTERNS.map((p) => p.kind).filter((k) => hits.has(k));
}

const PII_REASON: Record<PiiKind, string> = {
  aadhaar_or_apaar: "an Aadhaar or APAAR number",
  phone: "a phone number",
  email: "an email address",
  udise_or_long_id: "a UDISE code or another long identifier",
  date_of_birth: "a date of birth",
  account_number: "a bank or IFSC code",
};

export type PuterSafety =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * The one gate. Refuses an empty prompt, an over-long prompt, and — the
 * point of the whole module — anything carrying a personal identifier.
 *
 * The refusal names what it found so the staff member can retype the line
 * without it, rather than being told "blocked" and giving up.
 */
export function assertPuterSafe(
  surface: PuterSurface,
  text: string,
): PuterSafety {
  const s = puterSurface(surface);
  const trimmed = String(text || "").trim();
  if (!trimmed) return { ok: false, reason: "Nothing to send" };
  if (trimmed.length > s.maxChars) {
    return {
      ok: false,
      reason: `Too long for the free service (${trimmed.length} of ${s.maxChars} characters)`,
    };
  }
  const found = piiKinds(trimmed);
  if (found.length) {
    return {
      ok: false,
      reason: `Cannot use the free service: this text contains ${found
        .map((k) => PII_REASON[k])
        .join(", ")}. It would leave the school's servers, so it stays on the paid, India-hosted path.`,
    };
  }
  return { ok: true, text: trimmed };
}

/* ── Marketing artwork ───────────────────────────────────────────────── */

export type PosterBrief = {
  /** What the artwork is for — "Open house", "Diwali greeting". */
  occasion: string;
  /** Free direction from the office — "children planting saplings". */
  subject: string;
  mood: PosterMood;
  style: PosterStyle;
};

export type PosterMood = "warm" | "festive" | "calm" | "proud";
export type PosterStyle = "illustration" | "watercolour" | "flat_vector" | "photo";

export const POSTER_MOODS: { id: PosterMood; label: string; phrase: string }[] = [
  { id: "warm", label: "Warm", phrase: "warm, welcoming, soft daylight" },
  { id: "festive", label: "Festive", phrase: "festive, bright, celebratory" },
  { id: "calm", label: "Calm", phrase: "calm, uncluttered, plenty of empty space" },
  { id: "proud", label: "Proud", phrase: "dignified and proud, formal composition" },
];

export const POSTER_STYLES: { id: PosterStyle; label: string; phrase: string }[] = [
  { id: "illustration", label: "Illustration", phrase: "hand-drawn editorial illustration" },
  { id: "watercolour", label: "Watercolour", phrase: "soft watercolour painting" },
  { id: "flat_vector", label: "Flat vector", phrase: "clean flat vector art, simple shapes" },
  { id: "photo", label: "Photographic", phrase: "photographic, natural light, shallow depth of field" },
];

/**
 * Build the image prompt — and, just as importantly, the list of things the
 * picture must NOT contain.
 *
 * Three refusals are baked in and are not options:
 *
 *  - **No text, letters or numbers.** Image models render words as plausible
 *    nonsense, and a school poster that says "98% resuit" or invents a fee
 *    is a CBSE/ASCI problem, not a typo. The ERP already writes the copy and
 *    the office lays it over the picture.
 *  - **No recognisable faces.** The artwork must not look like a photograph
 *    of identifiable children, which is a consent question we cannot answer
 *    for a generated face.
 *  - **No logos or crests.** Ours is a real mark; a generated approximation
 *    of it is worse than none.
 */
export function buildPosterPrompt(brief: PosterBrief): string {
  const mood = POSTER_MOODS.find((m) => m.id === brief.mood) ?? POSTER_MOODS[0];
  const style = POSTER_STYLES.find((s) => s.id === brief.style) ?? POSTER_STYLES[0];
  const occasion = String(brief.occasion || "").trim();
  const subject = String(brief.subject || "").trim();
  const scene = [occasion, subject].filter(Boolean).join(" — ") || "a school day";
  return [
    `${style.phrase} for an Indian school, set in Varanasi, Uttar Pradesh.`,
    `Scene: ${scene}.`,
    `Mood: ${mood.phrase}.`,
    "Leave the upper third calm and uncluttered so a headline can be placed over it.",
    "Absolutely no text, letters, numbers, words or signage anywhere in the image.",
    "No logos, crests or emblems.",
    "No close-up or recognisable faces — show children from behind, at a distance, or in silhouette.",
  ].join(" ");
}

/* ── Free OCR first pass ─────────────────────────────────────────────── */

/**
 * Is the text Puter read good enough to hand to the syllabus parser, or
 * should we spend a Vision call?
 *
 * A contents page that read properly has several lines and a fair number of
 * letters. Anything thinner is a bad scan dressed up as a result, and the
 * caller must fall back rather than show a teacher three chapters out of
 * twenty and call it done.
 */
export function ocrFirstPassUsable(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 40) return false;
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  const letters = (t.match(/[A-Za-zऀ-ॿ]/g) || []).length;
  return letters >= 30 && letters / t.length > 0.4;
}

/** One line for the UI saying which engine actually answered. */
export function puterPathNote(used: "puter" | "paid"): string {
  return used === "puter"
    ? "Read with the free service — check the lines before adding."
    : "Read with the school's own text recognition.";
}
