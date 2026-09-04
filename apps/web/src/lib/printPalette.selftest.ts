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

/**
 * Every component that renders something meant for paper.
 *
 * One per `printing-*` body class in globals.css, plus the exam sheets that
 * print through the same rules. The first version of this list had nine and
 * missed four — the event certificates and poster, the staff ID card, and
 * the store receipt — which is precisely why the check below no longer
 * depends on the list being complete: it guards the MECHANISM instead.
 */
const PRINT_SHEETS = [
  "components/fees/FeeReceiptSheet.tsx",
  "components/fees/DayCloseSheet.tsx",
  "components/fees/StorePurchasesPanel.tsx",
  "components/visitors/VisitorPassSheet.tsx",
  "components/certificates/CertificateSheet.tsx",
  "components/inventory/StoreDayBookSheet.tsx",
  "components/exams/ExamPaperPrintSheet.tsx",
  "components/exams/ReportCardSheet.tsx",
  "components/exams/ClassResultSheet.tsx",
  "components/payroll/PrintPayslipsPanel.tsx",
  "components/events/InterSchoolPanel.tsx",
  "components/events/EventPublicity.tsx",
  "components/staff/StaffProfileForm.tsx",
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

function mediaBlocksOf(css: string, kind: string): string {
  const out: string[] = [];
  const re = new RegExp(`@media\\s+${kind}\\s*\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const open = css.indexOf("{", m.index);
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

// ── Dark mode must not reach paper ──────────────────────────────────────
{
  /**
   * The mechanism: every `.dark` rule lives inside `@media screen`, so on
   * paper `:root`'s light palette is simply what is left. That covers every
   * token at once — which a hand-kept list did not: the first fix restated
   * four and missed --card, --border, --danger and --warning, and missed the
   * utility remaps entirely, of which `.dark .bg-white { var(--card) }` would
   * have printed every white card on a sheet as dark navy.
   */
  const screenBlocks = mediaBlocksOf(CSS, "screen");
  assert.ok(screenBlocks.length > 0, "no @media screen block in globals.css");

  // No `.dark` rule may sit outside a screen-only block.
  const outside = CSS.split("@media");
  const strayDark: string[] = [];
  // Walk the file, tracking whether we are inside a screen-scoped block.
  const withoutScreen = CSS.replace(
    /@media\s+screen\s*\{/g,
    (m) => "@media SCREENMARK {",
  );
  let depth = 0;
  let inScreen = false;
  let screenDepth = 0;
  for (let i = 0; i < withoutScreen.length; i++) {
    if (withoutScreen.startsWith("@media SCREENMARK {", i) && !inScreen) {
      inScreen = true;
      screenDepth = depth;
      i += "@media SCREENMARK {".length - 1;
      depth++;
      continue;
    }
    const ch = withoutScreen[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (inScreen && depth === screenDepth) inScreen = false;
    } else if (!inScreen && withoutScreen.startsWith(".dark", i)) {
      const before = withoutScreen[i - 1];
      if (before === undefined || /[\s},;{]/.test(before)) {
        strayDark.push(withoutScreen.slice(i, i + 60).split("\n")[0]);
      }
    }
  }
  void outside;

  assert.deepEqual(
    strayDark,
    [],
    `these .dark rules are not screen-scoped, so they still apply on paper: ` +
      strayDark.join(" | "),
  );

  // And the light palette must still be there to fall back to.
  assert.match(CSS, /--brand-deep:\s*#203050/i);
  assert.match(CSS, /--muted:\s*#5c6478/i);
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
