/**
 * The two tone families must not be used in each other's place.
 *
 * `--tone-teal` and its seven siblings INVERT with the theme: deep in light,
 * a pale tint in dark. They are text and border colours. `--tone-teal-solid`
 * and its five siblings do NOT invert; they are fills, and they carry white
 * text.
 *
 * Swap them and the failure is silent and total:
 *
 *   bg-[var(--tone-teal)] text-white   → in dark mode a pale mint fill with
 *                                        white text on it. Invisible.
 *   text-[var(--tone-teal-solid)]      → in dark mode deep teal ink on a
 *                                        near-black card. Unreadable.
 *
 * Both are exactly the shape of bug the 2026-09-06 contrast audit spent a
 * day finding by hand across 49 routes, so it is checked here instead.
 *
 * Run: npx tsx src/lib/toneTokens.selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src");
const CSS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

/* ── Every token exists, in the right number of themes ────────────────── */

const INVERTING = [
  "teal", "green", "slate", "amber", "rose", "violet", "sky", "coral",
] as const;
const SOLID = [
  "teal", "green", "green-deep", "brick", "violet", "red",
] as const;

for (const t of INVERTING) {
  const light = new RegExp(`^ {2}--tone-${t}: #[0-9a-f]{6};$`, "m");
  const dark = new RegExp(`^ {4}--tone-${t}: #[0-9a-f]{6};$`, "m");
  assert.ok(light.test(CSS), `--tone-${t} must have a light value`);
  assert.ok(dark.test(CSS), `--tone-${t} must have a dark value — it inverts`);
}

for (const t of SOLID) {
  const light = new RegExp(`^ {2}--tone-${t}-solid: #[0-9a-f]{6};$`, "m");
  const dark = new RegExp(`^ {4}--tone-${t}-solid:`, "m");
  assert.ok(light.test(CSS), `--tone-${t}-solid must be defined`);
  assert.ok(
    !dark.test(CSS),
    `--tone-${t}-solid must NOT be redefined in dark — a fill that inverts ` +
      `turns pale and swallows the white text on it`,
  );
}

/* ── Every fill still carries white text readably ─────────────────────── */

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(ch[0]!) + 0.7152 * f(ch[1]!) + 0.0722 * f(ch[2]!);
}

for (const t of SOLID) {
  const m = CSS.match(new RegExp(`^ {2}--tone-${t}-solid: (#[0-9a-f]{6});$`, "m"));
  assert.ok(m, `--tone-${t}-solid value not found`);
  const contrast = 1.05 / (luminance(m[1]!) + 0.05);
  assert.ok(
    contrast >= 4.5,
    `white text on --tone-${t}-solid is ${contrast.toFixed(2)}:1 — a fill in ` +
      `this family must clear 4.5:1 or the label on the chip stops being read`,
  );
}

/* ── Nobody uses one family where the other belongs ───────────────────── */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const offenders: string[] = [];
for (const file of walk(ROOT)) {
  if (file.endsWith("toneTokens.selftest.ts")) continue;
  const src = readFileSync(file, "utf8");
  const rel = file.slice(ROOT.length + 1);
  // An inverting tone as a background.
  for (const m of src.matchAll(/bg-\[var\(--tone-(teal|green|slate|amber|rose|violet|sky|coral)\)\]/g)) {
    offenders.push(`${rel}: bg-[var(--tone-${m[1]})] — use --tone-${m[1]}-solid`);
  }
  // A fill colour used as ink.
  for (const m of src.matchAll(/text-\[var\(--tone-([a-z-]+)-solid\)\]/g)) {
    offenders.push(`${rel}: text-[var(--tone-${m[1]}-solid)] — use --tone-${m[1]}`);
  }
}
assert.deepEqual(offenders, [], `tone tokens used in the wrong place:\n  ${offenders.join("\n  ")}`);

console.log(
  `toneTokens: ${INVERTING.length} inverting + ${SOLID.length} solid, ` +
    `all fills ≥4.5:1 on white, no crossed uses — ok`,
);
