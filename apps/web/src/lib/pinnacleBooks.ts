/**
 * Pinnacle Smart Teach (teacher.pinnaclelearning.in) — the publisher's own
 * e-books of the school's Pearson / LEAD add-on books (director, 12 Oct 2026).
 *
 * Its Book Library holds Click Code Connect 1–8, Know and Grow 1–8, New
 * Longman Vistas 1–5 and Tip-Tap-Toe Nursery–UKG, each an EPUB whose table of
 * contents is the book's complete chapter list — the list Propel never gives
 * for Classes 1–8. The Office Robot reads those contents on the page and the
 * ERP compares them with its loaded books, both ways, with the same check as
 * Propel's pre-primary books (lib/propelRobot propelFullBookCheck).
 *
 * Pure: no I/O.
 */

import type { PropelBook } from "@/lib/propelRobot";

export type PinnacleRawBook = { title?: unknown; path?: unknown; chapters?: unknown };

/** A Pinnacle book as the book check reads it, plus where it came from. */
export type PinnacleBook = PropelBook & { title: string; path: string };

/** Series → the subject name the book check maps to an ERP subject_key. */
const SERIES: { re: RegExp; subject: string }[] = [
  { re: /click\s*code\s*connect|\bccc_/i, subject: "Computer" },
  { re: /know\s*(and|&)\s*grow|know_and_grow|\bkag_/i, subject: "General Knowledge" },
  { re: /vistas/i, subject: "Social Studies" },
  // No ERP subject: listed so the office sees it, never compared.
  { re: /tip.?tap.?toe|rhymes/i, subject: "Rhymes and Stories" },
];

/** "Nursery" / "LKG" / "UKG" / "Class3", from the title, else the folder. */
export function pinnacleClassName(title: string, path: string): string {
  const t = title.toLowerCase();
  if (/\bnursery\b/.test(t)) return "Nursery";
  if (/\blkg\b/.test(t)) return "LKG";
  if (/\bukg\b/.test(t)) return "UKG";
  const fromTitle = t.match(/(?:\bgr(?:ade)?\.?\s*|[-–]\s*|\s)(\d{1,2})(?:\s*\(|\s*$)/);
  const fromPath = path.toLowerCase().match(/(?:_g|grade|_g\s*)(\d{1,2})(?:\b|_|$)/);
  const n = Number((fromTitle && fromTitle[1]) || (fromPath && fromPath[1]) || NaN);
  return n >= 1 && n <= 12 ? `Class${n}` : "";
}

/**
 * A table-of-contents entry as a chapter name: "Ch1: Parts of a Computer" and
 * "Ch:3 Early to Bed" lose their numbering; the answer key, infographics and
 * the book's front matter are not chapters and come back "".
 */
export function pinnacleChapterName(raw: string): string {
  const s = String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:ch(?:apter)?\s*[:.]?\s*\d+\s*[:.\-–]?\s*)/i, "")
    .trim();
  if (!s) return "";
  if (/^(book\s+)?answer\s*key\b|^infographic\b|^(table of )?contents$|^cover$|^title page$|^copyright/i.test(s)) return "";
  return s.slice(0, 160);
}

const NUMBERED = /^ch(?:apter)?\s*[:.]?\s*\d/i;

/** The robot's scan, cleaned: one entry per class × series, chapters named. */
export function normalizePinnacleBooks(raw: unknown): PinnacleBook[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PinnacleBook[] = [];
  for (const r of raw.slice(0, 200) as PinnacleRawBook[]) {
    const title = String(r?.title || "").trim().slice(0, 160);
    const path = String(r?.path || "").trim().slice(0, 200);
    const series = SERIES.find((x) => x.re.test(title) || x.re.test(path));
    const className = pinnacleClassName(title, path);
    if (!series || !className) continue;
    const key = `${className}|${series.subject}`;
    if (seen.has(key)) continue;
    const entries = (Array.isArray(r.chapters) ? r.chapters : []).slice(0, 300).map((c) => String(c));
    // A book that numbers its chapters ("Ch1: …") also lists extras between
    // them — "Cyber Olympiad", "Software Space" — that are not chapters; only
    // the numbered entries count. A book with no numbering keeps every entry.
    const numbered = entries.filter((c) => NUMBERED.test(c.trim()));
    const units = (numbered.length ? numbered : entries).map(pinnacleChapterName).filter(Boolean);
    if (!units.length) continue;
    seen.add(key);
    out.push({ title, path, className, subject: series.subject, units });
  }
  return out.sort((a, b) => a.subject.localeCompare(b.subject) || classOrder(a.className) - classOrder(b.className));
}

const classOrder = (c: string) => (c === "Nursery" ? -2 : c === "LKG" ? -1 : c === "UKG" ? 0 : Number(c.replace(/\D/g, "")) || 99);
