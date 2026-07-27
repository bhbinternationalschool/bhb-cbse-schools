/**
 * Smoke-test daily collection PDF parser.
 * npx tsx scripts/test-daily-collection-parse.ts
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { summarizeDailyCollection, type DailyCollectionRow } from "../src/lib/dailyCollectionReportImport";
import { parsePaymentReportText } from "../src/lib/inventoryPaymentReportImport";

const exec = promisify(execFile);
const pdf = path.join(
  process.cwd(),
  "data/fees/Daily_Collection_Report_2026.pdf",
);

const PY = `import sys
from pypdf import PdfReader
for p in PdfReader(sys.argv[1]).pages:
    print(p.extract_text() or "")
`;

async function main() {
  const pyPath = path.join(process.cwd(), ".extract_pdf_tmp.py");
  const fs = await import("node:fs/promises");
  await fs.writeFile(pyPath, PY);
  const { stdout } = await exec("python3", [pyPath, pdf], {
    maxBuffer: 30 * 1024 * 1024,
  });
  await fs.unlink(pyPath).catch(() => undefined);

  const receipts = parsePaymentReportText(stdout);
  const dailyRows = receipts as DailyCollectionRow[];
  const summary = summarizeDailyCollection(dailyRows);
  console.log("rows", receipts.length);
  console.log("scopes", summary.byScope);
  console.log(
    "paid",
    summary.totalPaidRupees,
    "concession",
    summary.totalConcessionRupees,
  );
  console.log(
    "heads",
    Object.fromEntries(
      [...summary.byHead.entries()].map(([k, v]) => [k, v.rupees]),
    ),
  );
  const mixed = dailyRows.find((r) =>
    r.receiptNote?.toLowerCase().includes("previous"),
  );
  console.log("mixed sample", mixed?.admissionNo, mixed?.receiptNote, mixed?.lines);
  const ved = dailyRows.find((r) => r.admissionNo?.includes("009/2026"));
  console.log("vedika", ved);
  const kartik = dailyRows.find((r) => r.legacyReceiptNo === "1780");
  console.log("kartik", kartik?.receiptNote, kartik?.paymentScope);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
