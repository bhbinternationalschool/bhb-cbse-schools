/**
 * Import Student Wise Fee Details.xlsx → previous session arrears (carried forward).
 *
 * Run from apps/web:
 *   npx tsx scripts/import-previous-dues-excel.ts [path-to-xlsx]
 */

import { promises as fs } from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

import { DEFAULT_AY } from "../src/lib/masters";
import {
  applyPreviousDuesImport,
  parseStudentWiseFeeSummaryRows,
  summarizePreviousDueRows,
} from "../src/lib/previousDuesExcelImport";

const ROOT = path.join(process.cwd());
const DEFAULT_XLSX = path.join(
  ROOT,
  "data",
  "fees",
  "Student_Wise_Fee_Details.xlsx",
);

function readSheetRows(filePath: string): unknown[][] {
  const wb = XLSX.readFile(filePath);
  const sheet =
    wb.Sheets["Student Wise Summary"] ?? wb.Sheets[wb.SheetNames[0]!];
  return XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    header: 1,
  }) as unknown[][];
}

async function main() {
  const xlsxPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_XLSX;

  const raw = readSheetRows(xlsxPath);
  const rows = parseStudentWiseFeeSummaryRows(raw);
  const summary = summarizePreviousDueRows(rows);

  console.log(`Parsed ${summary.totalRows} students from ${xlsxPath}`);
  console.log(
    `With previous pending: ${summary.withPending} · total ₹${summary.totalPendingRupees}`,
  );

  const { loadOpsFees, saveOpsFees, loadOpsSis } = await import(
    "../src/lib/deskOpsLoad.server"
  );
  const sis = await loadOpsSis();
  const fees = await loadOpsFees();

  if (!sis.students.length) {
    console.warn(
      "WARNING: No students in SIS desk — import will not match anyone.",
    );
  }

  const result = applyPreviousDuesImport({
    fees,
    sis,
    rows,
    toAy: DEFAULT_AY,
    importedBy: `Excel · ${path.basename(xlsxPath)}`,
  });

  await saveOpsFees(result.fees);
  const importedAt = new Date().toISOString();

  const seedPath = path.join(ROOT, "data", "fees", "previous_dues_import.json");
  await fs.mkdir(path.dirname(seedPath), { recursive: true });
  await fs.writeFile(
    seedPath,
    JSON.stringify(
      {
        version: 1,
        importedAt,
        sourceFile: path.basename(xlsxPath),
        summary,
        stats: {
          created: result.created,
          updated: result.updated,
          cleared: result.cleared,
          skipped: result.skipped,
          errors: result.errors.length,
        },
        matched: result.matched,
        errors: result.errors,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        created: result.created,
        updated: result.updated,
        cleared: result.cleared,
        skipped: result.skipped,
        matched: result.matched,
        errors: result.errors,
        desk: "fee_desk_*",
        seed: seedPath,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
