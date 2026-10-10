/**
 * Run: npx tsx src/lib/reportExport.selftest.ts
 *
 * downloadPdfReport() itself needs jsPDF + a browser Blob/anchor download,
 * so it isn't driven directly here — this exercises bandColumns(), the pure
 * function the fix hinges on: wide reports used to silently drop every
 * column past a hardcoded 12 (matched against a priority-key allowlist);
 * now every column ends up in some band instead of being dropped. The full
 * multi-band PDF render is verified live in the browser against a report
 * with real wide columns (SIS predefined download).
 */
import assert from "node:assert/strict";

import { bandColumns, safeSheetName, type ReportColumn } from "./reportExport";

console.log("reportExport.selftest.ts");

function col(key: string): ReportColumn {
  return { key, header: key };
}

// --- narrow reports (the vast majority) render unchanged: one band ------
{
  const cols = Array.from({ length: 8 }, (_, i) => col(`c${i}`));
  const bands = bandColumns(cols, 700);
  assert.equal(bands.length, 1, "8 columns must fit in a single band at typical page width");
  assert.deepEqual(bands[0], cols);
}

// --- wide reports: every column appears in some band, none dropped ------
{
  const cols = Array.from({ length: 40 }, (_, i) => col(`c${i}`));
  const bands = bandColumns(cols, 700);
  assert.ok(bands.length > 1, "40 columns at 700pt usable width must split into multiple bands");

  const seen = new Set<string>();
  for (const band of bands) {
    for (const c of band) seen.add(c.key);
  }
  assert.equal(seen.size, 40, "every original column key must appear in at least one band");
  for (const orig of cols) {
    assert.ok(seen.has(orig.key), `column ${orig.key} must not be silently dropped`);
  }
}

// --- the first (identifying) column repeats in every band, so every band's
// rows stay identifiable on their own page -------------------------------
{
  const cols = [col("admissionNo"), ...Array.from({ length: 30 }, (_, i) => col(`f${i}`))];
  const bands = bandColumns(cols, 700);
  assert.ok(bands.length > 1);
  for (const band of bands) {
    assert.equal(band[0]!.key, "admissionNo", "every band must repeat the identifying column");
  }
}

// --- a single column never gets banded into an empty rest ----------------
{
  const bands = bandColumns([col("only")], 700);
  assert.equal(bands.length, 1);
  assert.equal(bands[0]!.length, 1);
}

// --- narrower usable width lowers the fit-per-band, producing more bands
// for the same column count (page-size-aware, not a fixed magic number) --
{
  const cols = Array.from({ length: 20 }, (_, i) => col(`c${i}`));
  const wideBands = bandColumns(cols, 900);
  const narrowBands = bandColumns(cols, 300);
  assert.ok(
    narrowBands.length >= wideBands.length,
    "a narrower page must never produce fewer bands than a wider one for the same columns",
  );
}

// --- safeSheetName: Excel's 31-char limit and illegal characters --------
{
  const used = new Set<string>();
  const long = "This Is A Very Long Report Title That Exceeds The Limit";
  const cleaned = safeSheetName(long, used);
  assert.ok(cleaned.length <= 31, "sheet name must never exceed Excel's 31-char limit");
}

{
  const used = new Set<string>();
  const cleaned = safeSheetName("Fees: Class VI/VII [2026]", used);
  assert.ok(!/[[\]:*?/\\]/.test(cleaned), "illegal Excel sheet-name characters must be stripped");
}

// --- safeSheetName: collisions get disambiguated, never silently dropped -
{
  const used = new Set<string>();
  const a = safeSheetName("Summary", used);
  const b = safeSheetName("Summary", used);
  const c = safeSheetName("Summary", used);
  assert.equal(a, "Summary");
  assert.notEqual(a, b, "a second sheet with the same name must not collide with the first");
  assert.notEqual(b, c, "a third sheet with the same name must not collide with the first two");
  assert.ok(b.length <= 31 && c.length <= 31);
}

// --- safeSheetName: a name that's already unique passes through untouched
{
  const used = new Set<string>();
  assert.equal(safeSheetName("By mode", used), "By mode");
}

console.log("OK — reportExport.selftest.ts");
