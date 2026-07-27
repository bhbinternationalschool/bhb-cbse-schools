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
import { DEFAULT_AY } from "../src/lib/masters";
import {
  applyPaymentReportImport,
  formatPaymentImportSummary,
  parsePaymentReportText,
} from "../src/lib/inventoryPaymentReportImport";
import type { FeesState } from "../src/lib/fees";
import type { MastersState } from "../src/lib/masters";
import type { SisState } from "../src/lib/sis";

const execFileAsync = promisify(execFile);
const ROOT = path.join(process.cwd());
const MIRROR_PATH = path.join(ROOT, ".data", "school_mirror.json");
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

type MirrorBundle = {
  version: 1;
  updatedAt: string;
  sis: SisState | null;
  fees: FeesState | null;
  masters: MastersState | null;
};

function emptyFees(): FeesState {
  return {
    version: 1,
    vouchers: [],
    cheques: [],
    manualBooks: [],
    dayCloses: [],
    installmentPlans: [],
    planAllocations: [],
    carriedForwardDues: [],
    chargeVouchers: [],
  };
}

function emptySis(): SisState {
  return { households: [], students: [] } as unknown as SisState;
}

function emptyMasters(): MastersState {
  return { feeHeads: [], feeGroups: [], feeStructureLines: [], installments: [] } as unknown as MastersState;
}

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

  let mirror: MirrorBundle | null = null;
  try {
    const raw = await fs.readFile(MIRROR_PATH, "utf8");
    mirror = JSON.parse(raw) as MirrorBundle;
  } catch {
    mirror = null;
  }

  const sis = mirror?.sis ?? emptySis();
  const fees = mirror?.fees ?? emptyFees();
  const masters = mirror?.masters ?? emptyMasters();

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

  const next: MirrorBundle = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sis,
    fees: result.fees,
    masters,
  };
  await fs.mkdir(path.dirname(MIRROR_PATH), { recursive: true });
  await fs.writeFile(MIRROR_PATH, JSON.stringify(next, null, 2));
  console.log(`Wrote fees (${result.fees.vouchers.length} vouchers) → ${MIRROR_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
