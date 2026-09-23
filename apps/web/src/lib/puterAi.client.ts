"use client";

/**
 * Puter's browser SDK, wrapped so a call site cannot get it wrong.
 *
 * Everything here is a thin, typed shell over `window.puter` with four
 * things bolted on, because the raw SDK has none of them:
 *
 *  - the feature flag and the DPDP fence from puterAi.ts, checked BEFORE the
 *    script tag is even injected, so a refused prompt never reaches Puter's
 *    CDN, let alone its models;
 *  - a timeout, because a script that never loads must not leave a teacher
 *    watching a spinner — it must fail fast enough to fall back;
 *  - a single load, shared by every caller on the page;
 *  - a result type that always says WHY it failed, so the caller can tell
 *    "the school turned this off" from "the free quota ran out" from "the
 *    staff member closed the sign-in popup" — all three fall back to the
 *    paid path, but only the middle one is worth a word on screen.
 *
 * No function here throws. A call site that forgets to check `ok` gets a
 * falsy result, not an unhandled rejection in a panel.
 */

import {
  PUTER_SDK_URL,
  assertPuterSafe,
  puterEnabled,
  type PuterSurface,
} from "@/lib/puterAi";

type PuterAi = {
  txt2img?: (prompt: string, testMode?: boolean) => Promise<HTMLImageElement>;
  img2txt?: (source: string | File | Blob, testMode?: boolean) => Promise<string>;
};

type PuterAuth = {
  isSignedIn?: () => boolean;
};

type PuterGlobal = { ai?: PuterAi; auth?: PuterAuth };

function puterGlobal(): PuterGlobal | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { puter?: PuterGlobal };
  return w.puter ?? null;
}

/** The SDK is present and usable right now (no network call). */
export function puterLoaded(): boolean {
  return !!puterGlobal()?.ai;
}

/** The staff member has a Puter session, so no popup is coming. */
export function puterSignedIn(): boolean {
  try {
    return puterGlobal()?.auth?.isSignedIn?.() === true;
  } catch {
    return false;
  }
}

const LOAD_TIMEOUT_MS = 12_000;
let loading: Promise<PuterGlobal | null> | null = null;

/**
 * Inject the SDK once per page and resolve when `window.puter` appears.
 *
 * Resolves `null` rather than throwing on every failure path — flag off,
 * server render, blocked CDN, slow network — because every one of them means
 * the same thing to the caller: use the paid path.
 */
export function loadPuter(): Promise<PuterGlobal | null> {
  if (!puterEnabled()) return Promise.resolve(null);
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(null);
  }
  const already = puterGlobal();
  if (already?.ai) return Promise.resolve(already);
  if (loading) return loading;

  loading = new Promise<PuterGlobal | null>((resolve) => {
    let settled = false;
    const finish = (v: PuterGlobal | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      // A failed load must not be cached: the CDN may be reachable on the
      // teacher's next press, and one flaky minute should not disable the
      // free path for the whole session.
      if (!v) loading = null;
      resolve(v);
    };
    const timer = window.setTimeout(() => finish(null), LOAD_TIMEOUT_MS);

    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-puter-sdk="1"]`,
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => finish(puterGlobal()?.ai ? puterGlobal() : null));
    script.addEventListener("error", () => finish(null));
    if (!existing) {
      script.src = PUTER_SDK_URL;
      script.async = true;
      script.dataset.puterSdk = "1";
      document.head.appendChild(script);
    }
  });
  return loading;
}

export type PuterFailure =
  | "disabled"
  | "unsafe"
  | "unavailable"
  | "declined"
  | "quota"
  | "failed";

export type PuterResult<T> =
  | ({ ok: true; kind: "puter" } & T)
  | { ok: false; kind: PuterFailure; message: string };

/**
 * Classify what Puter threw. Only `quota` and `declined` are worth telling
 * the staff member about; the rest are our problem, not theirs.
 */
function classify(err: unknown): { kind: PuterFailure; message: string } {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return "";
            }
          })();
  const text = String(raw || "").toLowerCase();
  if (/cancel|declin|dismiss|closed|denied|abort/.test(text)) {
    return {
      kind: "declined",
      message: "Free service sign-in was closed — used the school's own service instead.",
    };
  }
  if (/quota|credit|usage|limit|insufficient|402|429/.test(text)) {
    return {
      kind: "quota",
      message: "The free allowance is used up for now — used the school's own service instead.",
    };
  }
  return { kind: "failed", message: "The free service did not answer — used the school's own service instead." };
}

/** Shared preflight: flag, fence, SDK. */
async function ready(
  surface: PuterSurface,
  text: string,
): Promise<
  | { ok: true; ai: PuterAi; text: string }
  | { ok: false; kind: PuterFailure; message: string }
> {
  if (!puterEnabled()) {
    return { ok: false, kind: "disabled", message: "The free service is switched off for this school." };
  }
  const safe = assertPuterSafe(surface, text);
  if (!safe.ok) return { ok: false, kind: "unsafe", message: safe.reason };
  const puter = await loadPuter();
  if (!puter?.ai) {
    return { ok: false, kind: "unavailable", message: "The free service could not be reached." };
  }
  return { ok: true, ai: puter.ai, text: safe.text };
}

/**
 * Generate artwork from a prompt built by `buildPosterPrompt`.
 *
 * Puter hands back an `<img>` element rather than bytes, so we read its src.
 * A cross-origin src would be useless to us — we need a data URL to store
 * and to lay copy over — so anything else is treated as a failure.
 */
export async function puterGenerateImage(
  prompt: string,
): Promise<PuterResult<{ dataUrl: string }>> {
  const pre = await ready("marketing_image", prompt);
  if (!pre.ok) return pre;
  if (!pre.ai.txt2img) {
    return { ok: false, kind: "unavailable", message: "The free service could not be reached." };
  }
  try {
    const img = await pre.ai.txt2img(pre.text);
    const dataUrl = typeof img?.src === "string" ? img.src : "";
    if (!dataUrl.startsWith("data:image/")) {
      return { ok: false, kind: "failed", message: "The free service returned no usable picture." };
    }
    return { ok: true, kind: "puter", dataUrl };
  } catch (err) {
    return { ok: false, ...classify(err) };
  }
}

/**
 * Read the text off a page photo — the free first pass in front of Vision.
 *
 * The image itself is never checked by the DPDP fence (we cannot read a
 * photo from here), so the CALLER is responsible for only ever pointing this
 * at a printed textbook page. That is why the surface is named
 * `syllabus_ocr` and not `ocr`: a document with a child on it does not come
 * through this function.
 */
export async function puterReadImageText(
  dataUrl: string,
): Promise<PuterResult<{ text: string }>> {
  // The fence runs over the surface label, not the image: there is no text
  // to screen yet, and a data URL is megabytes of base64.
  const pre = await ready("syllabus_ocr", "textbook contents page");
  if (!pre.ok) return pre;
  if (!pre.ai.img2txt) {
    return { ok: false, kind: "unavailable", message: "The free service could not be reached." };
  }
  if (!dataUrl.startsWith("data:image/")) {
    return { ok: false, kind: "unsafe", message: "Only a photo can be read this way — not a PDF." };
  }
  try {
    const text = await pre.ai.img2txt(dataUrl);
    const out = String(text || "").trim();
    if (!out) {
      return { ok: false, kind: "failed", message: "The free service read nothing on that page." };
    }
    return { ok: true, kind: "puter", text: out };
  } catch (err) {
    return { ok: false, ...classify(err) };
  }
}
