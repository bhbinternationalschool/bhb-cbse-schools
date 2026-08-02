/**
 * Import Inventory Payment Report PDF → fee collection vouchers.
 *
 * Run from apps/web:
 *   npx tsx scripts/import-payment-report-pdf.ts [path-to.pdf]
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

import { DEFAULT_AY } from "../src/lib/masters";
import {
  applyPaymentReportImport,
  formatPaymentImportSummary,
  parsePaymentReportText,
} from "../src/lib/inventoryPaymentReportImport";

const execFileAsync = promisify(execFile);
const ROOT = path.join(process.cwd());
const DEFAULT_PDF = path.join(
  ROOT,
  "data",
  "fees",
  "Inventory_Payment_Report_2026.pdf",
);

const PY_EXTRACT = `
import sys
from pypdf import PdfReader
reader = PdfReader(sys.argv[1])
for page in reader.pages:
    print(page.extract_text() or "")
`;

async function extractPdfText(pdfPath: string): Promise<string> {
  const pyPath = path.join(path.dirname(pdfPath), ".extract_pdf.py");
  await fs.writeFile(pyPath, PY_EXTRACT);
  const { stdout } = await execFileAsync("python3", [pyPath, pdfPath], {
    maxBuffer: 20 * 1024 * 1024,
  });
  await fs.unlink(pyPath).catch(() => undefined);
  return stdout;
}

async function main() {
  const pdfPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_PDF;

  console.log(`Extracting text from ${pdfPath}…`);
  const text = await extractPdfText(pdfPath);
  const receipts = parsePaymentReportText(text);
  console.log(`Parsed ${receipts.length} receipt rows`);

  const { loadOpsFees, saveOpsFees, loadOpsMasters, loadOpsSis } =
    await import("../src/lib/deskOpsLoad.server");
  const sis = await loadOpsSis();
  const fees = await loadOpsFees();
  const masters = await loadOpsMasters();

  const result = applyPaymentReportImport({
    fees,
    sis,
    masters,
    receipts,
    academicYearCode: DEFAULT_AY,
    importedBy: `CLI · ${path.basename(pdfPath)}`,
  });

  console.log(formatPaymentImportSummary(result.summary, result.imported));
  console.log(`Imported: ${result.imported} · Skipped: ${result.skipped}`);
  if (result.unmatched.length) {
    console.log(`Unmatched (${result.unmatched.length}):`);
    for (const u of result.unmatched.slice(0, 20)) console.log(`  ${u}`);
  }

  await saveOpsFees(result.fees);
  console.log(
    `Wrote fees desk (${result.fees.vouchers.length} vouchers) — fee_desk_*`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
