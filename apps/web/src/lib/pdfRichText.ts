/**
 * Text in exported PDFs that the built-in font cannot draw: ₹, Hindi, arrows.
 *
 * jsPDF's helvetica only covers WinAnsi (Latin-1 plus a few signs). Until
 * 14 Oct 2026 the report export drew everything with it, so ₹ printed as "¹",
 * every Hindi name as junk, and "→" in filter notes as garbage. Embedding
 * Noto Sans Devanagari in jsPDF (lib/pdfDevanagari.ts) is not enough either:
 * jsPDF does no Indic shaping, so "किशन" prints as "कशिन" and conjuncts fall
 * apart — and that font has no Latin letters, so a mixed cell loses its
 * English half.
 *
 * So a cell is split into runs. WinAnsi text stays real PDF text in
 * helvetica. Everything else is drawn by the BROWSER (canvas, which shapes
 * Devanagari properly) and placed as a small image on the same baseline.
 * Without a renderer (server, tests) ₹ becomes "Rs" and other signs get an
 * ASCII stand-in; Hindi has none, and `needsGlyphs` lets the caller refuse
 * rather than print junk.
 *
 * The same layout wraps a cell to its column width and reports how many
 * lines it took, so a table row can grow to fit instead of the wrapped lines
 * printing over the next row.
 *
 * Dependency-free on purpose (type-only jsPDF import): its tests load it
 * outside the app.
 */

import type { jsPDF } from "jspdf";

export type Rgb = [number, number, number];

export type GlyphStyle = { sizePt: number; bold: boolean; color: Rgb };

export type GlyphImage = {
  dataUrl: string;
  /** Same text + style → same alias, so jsPDF stores the image once. */
  alias: string;
  /** Drawn width (may slightly exceed the advance for overhanging marks). */
  widthPt: number;
  ascentPt: number;
  descentPt: number;
  /** Ink that starts left of the pen (pt): the image is drawn this far left. */
  offsetXPt: number;
};

export type GlyphRenderer = {
  /** Advance width in pt. */
  measure(text: string, style: GlyphStyle): number;
  render(text: string, style: GlyphStyle): GlyphImage | null;
};

// cp1252 code points above 0x7F that are not Latin-1 (jsPDF's WinAnsi).
const CP1252_EXTRA = new Set(
  [0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178],
);

/** Can helvetica (WinAnsi) draw this character? */
export function isWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  if (c >= 0x20 && c <= 0x7e) return true;
  if (c >= 0xa0 && c <= 0xff) return true;
  return CP1252_EXTRA.has(c);
}

const DEVANAGARI_RE = /[ऀ-ॿ꣠-ꣿ]/;

export function hasDevanagari(text: string): boolean {
  return DEVANAGARI_RE.test(text);
}

/** Anything in this text that helvetica cannot draw? */
export function needsGlyphs(text: string): boolean {
  for (const ch of text) if (!isWinAnsi(ch) && ch !== "\n" && ch !== "\t") return true;
  return false;
}

// Stand-ins when no renderer is available. Devanagari has none.
const ASCII_STANDIN: Record<string, string> = {
  "₹": "Rs ",
  "→": "->",
  "←": "<-",
  "⇒": "=>",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "−": "-",
  "✓": "Yes",
  "✔": "Yes",
  "✗": "x",
  "✘": "x",
  "×": "x",
  "‑": "-",
  " ": " ",
};

export type Run = { text: string; glyph: boolean };

/**
 * Split into helvetica runs and glyph runs. A space between two glyph
 * characters joins the glyph run, so a Hindi name is one image, not one
 * per word.
 */
export function splitRuns(text: string, renderer: GlyphRenderer | null): Run[] {
  const chars = Array.from(text.replace(/\t/g, " "));
  const kind: boolean[] = chars.map((ch) => !isWinAnsi(ch));
  for (let i = 1; i < chars.length - 1; i++) {
    if (chars[i] === " " && kind[i - 1] && kind[i + 1]) kind[i] = true;
  }
  const runs: Run[] = [];
  chars.forEach((ch, i) => {
    let glyph = kind[i]!;
    let piece = ch;
    if (glyph && !renderer) {
      const s = ASCII_STANDIN[ch];
      if (s !== undefined) {
        glyph = false;
        piece = s;
      } else if (ch === " ") {
        glyph = false;
      } else if (!DEVANAGARI_RE.test(ch) && !/[\u200c\u200d]/.test(ch)) {
        glyph = false;
        piece = "?";
      }
    }
    const last = runs[runs.length - 1];
    if (last && last.glyph === glyph) last.text += piece;
    else runs.push({ text: piece, glyph });
  });
  return runs;
}

export type TextStyle = { sizePt: number; bold: boolean; color: Rgb };

function setLatin(doc: jsPDF, style: TextStyle) {
  doc.setFont("helvetica", style.bold ? "bold" : "normal");
  doc.setFontSize(style.sizePt);
}

/** Width in pt of a single line (no wrapping). */
export function measureLine(doc: jsPDF, text: string, style: TextStyle, renderer: GlyphRenderer | null): number {
  setLatin(doc, style);
  let w = 0;
  for (const r of splitRuns(text, renderer)) {
    w += r.glyph && renderer ? renderer.measure(r.text, style) : doc.getTextWidth(r.text);
  }
  return w;
}

function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
  return Array.from(text);
}

/**
 * Wrap to `maxWidth`, at most `maxLines` lines (the last one ends in "…"
 * when text was cut). Breaks at spaces; a single word wider than the column
 * is broken between characters (whole graphemes, so a Hindi syllable is
 * never split).
 */
export function wrapText(
  doc: jsPDF,
  text: string,
  maxWidth: number,
  style: TextStyle,
  renderer: GlyphRenderer | null,
  maxLines = Infinity,
): string[] {
  const width = (s: string) => measureLine(doc, s, style, renderer);
  const out: string[] = [];
  for (const para of String(text ?? "").split(/\r?\n/)) {
    const words = para.split(/ +/).filter((w, i, a) => w !== "" || a.length === 1);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (width(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      line = "";
      if (width(word) <= maxWidth) {
        line = word;
        continue;
      }
      // One word wider than the column: break it.
      let piece = "";
      for (const g of graphemes(word)) {
        if (piece && width(piece + g) > maxWidth) {
          out.push(piece);
          piece = g;
        } else piece += g;
      }
      line = piece;
    }
    out.push(line);
  }
  if (out.length <= maxLines) return out;
  const kept = out.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last && width(`${last}…`) > maxWidth) last = Array.from(last).slice(0, -1).join("");
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

/**
 * Draw one line with its baseline at `y`. `align: "right"` puts the line's
 * end at `x`.
 */
export function drawLine(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
  renderer: GlyphRenderer | null,
  align: "left" | "right" = "left",
): void {
  const runs = splitRuns(text, renderer);
  setLatin(doc, style);
  doc.setTextColor(style.color[0], style.color[1], style.color[2]);
  const widths = runs.map((r) => (r.glyph && renderer ? renderer.measure(r.text, style) : doc.getTextWidth(r.text)));
  let cx = align === "right" ? x - widths.reduce((s, w) => s + w, 0) : x;
  runs.forEach((r, i) => {
    if (r.glyph && renderer) {
      const img = renderer.render(r.text, style);
      if (img) {
        doc.addImage(img.dataUrl, "PNG", cx - img.offsetXPt, y - img.ascentPt, img.widthPt, img.ascentPt + img.descentPt, img.alias, "FAST");
      }
    } else if (r.text) {
      doc.text(r.text, cx, y);
    }
    cx += widths[i]!;
  });
}

/* ── Browser renderer ───────────────────────────────────────────────── */

const SCALE = 4; // canvas px per pt — sharp when printed
const FAMILY = "BhbPdfGlyph";
const FALLBACK_STACK = `"Noto Sans Devanagari", "Nirmala UI", "Kohinoor Devanagari", Mangal, "Segoe UI Symbol", sans-serif`;

let fontsLoading: Promise<void> | null = null;

/**
 * Load the app's Noto Sans Devanagari (regular + bold) into the page so the
 * canvas draws with it on every machine. A failure is not fatal: the stack
 * falls back to the system's Devanagari font (Windows, Android and macOS
 * all ship one).
 */
export function loadGlyphFonts(): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return Promise.resolve();
  fontsLoading ??= (async () => {
    const faces = [
      new FontFace(FAMILY, "url(/fonts/NotoSansDevanagari-Regular.ttf)", { weight: "400" }),
      new FontFace(FAMILY, "url(/fonts/NotoSansDevanagari-Bold.woff)", { weight: "700" }),
    ];
    await Promise.all(
      faces.map(async (f) => {
        try {
          await f.load();
          document.fonts.add(f);
        } catch {
          /* system fallback */
        }
      }),
    );
  })();
  return fontsLoading;
}

/** The canvas renderer, or null outside a browser. */
export function createCanvasGlyphRenderer(): GlyphRenderer | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const cache = new Map<string, GlyphImage>();
  const font = (s: GlyphStyle) => `${s.bold ? 700 : 400} ${s.sizePt * SCALE}px ${FAMILY}, ${FALLBACK_STACK}`;

  return {
    measure(text, style) {
      ctx.font = font(style);
      return ctx.measureText(text).width / SCALE;
    },
    render(text, style) {
      const key = `${style.bold ? "b" : "n"}|${style.sizePt}|${style.color.join(",")}|${text}`;
      const hit = cache.get(key);
      if (hit) return hit;
      ctx.font = font(style);
      const m = ctx.measureText(text);
      const ascent = Math.max(m.fontBoundingBoxAscent || 0, m.actualBoundingBoxAscent || 0, style.sizePt * SCALE * 0.8);
      const descent = Math.max(m.fontBoundingBoxDescent || 0, m.actualBoundingBoxDescent || 0, style.sizePt * SCALE * 0.25);
      const left = Math.max(0, m.actualBoundingBoxLeft || 0);
      const w = Math.ceil(Math.max(m.width, (m.actualBoundingBoxRight || 0)) + left + 2);
      const h = Math.ceil(ascent + descent + 2);
      if (w <= 2 || h <= 2) return null;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      if (!g) return null;
      g.font = font(style);
      g.fillStyle = `rgb(${style.color.join(",")})`;
      g.textBaseline = "alphabetic";
      g.fillText(text, left, ascent + 1);
      const img: GlyphImage = {
        dataUrl: c.toDataURL("image/png"),
        alias: `g${cache.size}_${hashKey(key)}`,
        widthPt: w / SCALE,
        ascentPt: (ascent + 1) / SCALE,
        descentPt: (h - ascent - 1) / SCALE,
        offsetXPt: left / SCALE,
      };
      cache.set(key, img);
      return img;
    },
  };
}

function hashKey(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
