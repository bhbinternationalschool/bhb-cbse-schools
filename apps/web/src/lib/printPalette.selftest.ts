import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

console.log("printPalette.selftest.ts");

/**
 * Every design token a printable sheet uses must be given a light value for
 * print.
 *
 * Reported from the counter on 2026-08-30: fee receipts printed blank. The
 * sheets colour their text with tokens, and in dark mode those tokens hold
 * near-white values (`--brand-deep` is #e4eaf7, `--muted` is #96a0ba) while
 * the print rules force a white background. White on white — a page that
 * looks blank, wastes a sheet, and hands a parent nothing.
 *
 * The fix restates the light values inside `@media print`. That list is only
 * correct as long as it covers every token the sheets actually use, and
 * nothing stops someone reaching for a new one. So this reads the sheets,
 * collects the tokens they reference, and fails if any is missing from the
 * print block — the check nobody has to remember to run by hand.
 */

const ROOT = join(__dirname, "..");
const CSS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

/** Components that render something meant for paper. */
const PRINT_SHEETS = [
  "components/fees/FeeReceiptSheet.tsx",
  "components/fees/DayCloseSheet.tsx",
  "components/visitors/VisitorPassSheet.tsx",
  "components/certificates/CertificateSheet.tsx",
  "components/inventory/StoreDayBookSheet.tsx",
  "components/exams/ExamPaperPrintSheet.tsx",
  "components/exams/ReportCardSheet.tsx",
  "components/exams/ClassResultSheet.tsx",
  "components/payroll/PrintPayslipsPanel.tsx",
];

// ── The sheets we think we are protecting must still exist ──────────────
{
  for (const rel of PRINT_SHEETS) {
    assert.doesNotThrow(
      () => readFileSync(join(ROOT, rel), "utf8"),
      `${rel} is gone or moved — this list is now lying about what it covers`,
    );
  }
}

// ── The print block must exist and be findable ──────────────────────────
/**
 * The @media print blocks, brace-matched.
 *
 * Splitting on the marker is not enough: everything after the FIRST
 * `@media print` would be swept in, including the `.dark` palette further
 * down the file — which made an early version of this test report the dark
 * values as if they were inside the print block. Read the braces instead.
 */
function printBlocksOf(css: string): string {
  const out: string[] = [];
  const marker = "@media print";
  let from = 0;
  for (;;) {
    const at = css.indexOf(marker, from);
    if (at === -1) break;
    const open = css.indexOf("{", at);
    if (open === -1) break;
    let depth = 0;
    let i = open;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(css.slice(open + 1, i));
    from = i + 1;
  }
  return out.join("\n");
}

const printCss = printBlocksOf(CSS);
assert.ok(printCss.length > 0, "no @media print block in globals.css");
// The extractor must not reach past the block: the dark palette lives later
// in the file, and swallowing it is exactly how this test lied once already.
assert.ok(
  !printCss.includes("--brand-mid: #aab8d8"),
  "block extraction ran past the closing brace and swallowed .dark",
);

// ── Every token used on paper is restated for print ─────────────────────
{
  const used = new Set<string>();
  for (const rel of PRINT_SHEETS) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    for (const m of src.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]);
  }

  assert.ok(
    used.size > 0,
    "found no tokens at all — the scan is broken, not the CSS",
  );

  const missing = [...used].filter(
    (token) => !new RegExp(`${token}\\s*:`).test(printCss),
  );

  assert.deepEqual(
    missing,
    [],
    `these tokens are used on printed sheets but have no print value, so ` +
      `they keep their dark-mode colour on white paper: ${missing.join(", ")}`,
  );
}

// ── The print values must be the LIGHT ones, not the dark ones ──────────
{
  // The specific pairs that caused the blank receipt. If someone "fixes" the
  // print block by pasting the dark palette in, this catches it.
  const mustNotAppear: [string, string][] = [
    ["--brand-deep", "#e4eaf7"],
    ["--muted", "#96a0ba"],
    ["--surface-sunken", "#0a0f1c"],
  ];
  for (const [token, darkValue] of mustNotAppear) {
    assert.ok(
      !new RegExp(`${token}\\s*:\\s*${darkValue}`, "i").test(printCss),
      `${token} is set to its DARK value (${darkValue}) inside @media print`,
    );
  }

  assert.match(
    printCss,
    /--brand-deep\s*:\s*#203050/i,
    "--brand-deep must take its light navy value when printing",
  );
  assert.match(
    printCss,
    /--muted\s*:\s*#5c6478/i,
    "--muted must take its light value when printing",
  );
}

// ── The override has to outrank .dark, or it never applies ──────────────
{
  assert.match(
    printCss,
    /:root\.dark/,
    "the print palette must target :root.dark — plain :root loses to .dark, " +
      "which is exactly the case that prints blank",
  );
}

// ── Sheets keep their deliberate backgrounds ────────────────────────────
{
  // Some labels are white on a navy block. They are only legible if that
  // navy prints, so exact colour has to be asked for on the sheet itself.
  assert.match(
    printCss,
    /print-color-adjust:\s*exact/,
    "without exact colour the navy header drops out and its white text " +
      "becomes invisible — the same bug by another route",
  );
}

console.log("printPalette.selftest: all assertions passed");
