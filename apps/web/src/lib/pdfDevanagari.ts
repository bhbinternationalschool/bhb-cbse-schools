/**
 * Devanagari (Hindi) font support for jsPDF — Noto Sans Devanagari.
 */

import type { jsPDF } from "jspdf";

const DEVANAGARI_RE = /[\u0900-\u097F]/;
const FONT_VFS = "NotoSansDevanagari-Regular.ttf";
const FONT_FAMILY = "NotoSansDevanagari";
const FONT_URL = "/fonts/NotoSansDevanagari-Regular.ttf";

let fontBase64Cache: string | null = null;
let fontLoadPromise: Promise<string | null> | null = null;

export function hasDevanagari(text: string): boolean {
  return DEVANAGARI_RE.test(text);
}

async function loadFontBase64(): Promise<string | null> {
  if (fontBase64Cache) return fontBase64Cache;
  if (fontLoadPromise) return fontLoadPromise;
  fontLoadPromise = (async () => {
    if (typeof window === "undefined") return null;
    try {
      const res = await fetch(FONT_URL);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      fontBase64Cache = btoa(binary);
      return fontBase64Cache;
    } catch {
      return null;
    }
  })();
  return fontLoadPromise;
}

function fontRegistered(doc: jsPDF): boolean {
  try {
    const list = doc.getFontList() as Record<string, unknown>;
    return Boolean(list[FONT_FAMILY]);
  } catch {
    return false;
  }
}

/** Register Noto Sans Devanagari on the jsPDF instance (idempotent). */
export async function ensureDevanagariFont(doc: jsPDF): Promise<boolean> {
  if (fontRegistered(doc)) return true;
  const b64 = await loadFontBase64();
  if (!b64) return false;
  try {
    doc.addFileToVFS(FONT_VFS, b64);
    doc.addFont(FONT_VFS, FONT_FAMILY, "normal");
    doc.addFont(FONT_VFS, FONT_FAMILY, "bold");
    return true;
  } catch {
    return false;
  }
}

export type PdfTextStyle = "normal" | "bold" | "italic";

function applyPdfFont(
  doc: jsPDF,
  text: string,
  devanagariReady: boolean,
  style: PdfTextStyle,
) {
  const useHi = devanagariReady && hasDevanagari(text);
  if (useHi) {
    doc.setFont(FONT_FAMILY, style === "bold" ? "bold" : "normal");
  } else if (style === "bold") {
    doc.setFont("helvetica", "bold");
  } else if (style === "italic") {
    doc.setFont("helvetica", "italic");
  } else {
    doc.setFont("helvetica", "normal");
  }
}

/**
 * Draw wrapped text; picks Devanagari font per paragraph when needed.
 * Returns the Y position after the block.
 */
export function drawPdfWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  opts: {
    fontSize: number;
    lineHeight: number;
    align?: "left" | "center";
    style?: PdfTextStyle;
    devanagariReady: boolean;
  },
): number {
  const lineHeight = opts.lineHeight;
  const align = opts.align ?? "left";
  doc.setFontSize(opts.fontSize);

  const paragraphs = text.split(/\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return y;

  for (const para of paragraphs) {
    applyPdfFont(doc, para, opts.devanagariReady, opts.style ?? "normal");
    const lines = doc.splitTextToSize(para, maxWidth) as string[];
    for (const line of lines) {
      if (align === "center") {
        doc.text(line, x + maxWidth / 2, y, { align: "center" });
      } else {
        doc.text(line, x, y);
      }
      y += lineHeight;
    }
    y += 4;
  }
  return y;
}

/** Split agreement body into language sections when bilingual markers present. */
export function splitAgreementBodySections(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.includes("[English]") || trimmed.includes("[हिन्दी]")) {
    const parts: string[] = [];
    const enMatch = trimmed.match(/\[English\]\s*([\s\S]*?)(?=\[हिन्दी\]|$)/);
    const hiMatch = trimmed.match(/\[हिन्दी\]\s*([\s\S]*?)$/);
    if (enMatch?.[1]?.trim()) parts.push(enMatch[1].trim());
    if (hiMatch?.[1]?.trim()) parts.push(hiMatch[1].trim());
    if (parts.length > 0) return parts;
  }
  if (trimmed.includes("\n\n————————————————\n\n")) {
    return trimmed
      .split(/\n\n————————————————\n\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return splitParagraphsLoose(trimmed);
}

function splitParagraphsLoose(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function resolveAgreementConsentText(body: string): string {
  const hi = hasDevanagari(body);
  const en =
    body.includes("[English]") ||
    !hi ||
    /[a-zA-Z]{4,}/.test(body.replace(/\[English\]/g, ""));
  if (hi && en) {
    return `${CONSENT_TEXT_EN}\n\n${CONSENT_TEXT_HI}`;
  }
  if (hi) return CONSENT_TEXT_HI;
  return CONSENT_TEXT_EN;
}

export const CONSENT_TEXT_EN =
  "I have read and understood the terms of this agreement and agree to abide by them.";

export const CONSENT_TEXT_HI =
  "मैंने इस समझौते की शर्तें पढ़ ली हैं और समझ ली हैं तथा उनका पालन करने के लिए सहमत हूँ।";
