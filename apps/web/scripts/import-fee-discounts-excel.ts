/**
 * Import fee_discount_report.xlsx → Masters concessions + approved grants.
 *
 * Run from apps/web:
 *   npx tsx scripts/import-fee-discounts-excel.ts [path-to-xlsx]
 */

import { promises as fs } from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

import {
  applyFeeDiscountImport,
  parseFeeDiscountExcelRows,
} from "../src/lib/feeDiscountExcelImport";

const ROOT = path.join(process.cwd());
const DEFAULT_XLSX = path.join(ROOT, "data", "fees", "fee_discount_report.xlsx");
const SEED_PATH = path.join(ROOT, "data", "fees", "fee_discount_import_seed.json");
const BUNDLED_SEED_PATH = path.join(
  ROOT,
  "src",
  "lib",
  "data",
  "fee_discount_import_seed.json",
);
const PUBLIC_SEED_PATH = path.join(
  ROOT,
  "public",
  "fees",
  "fee_discount_import_seed.json",
);

function readSheetRows(filePath: string): Record<string, unknown>[] {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  return XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: true,
  }) as Record<string, unknown>[];
}

async function main() {
  const xlsxPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_XLSX;

  const raw = readSheetRows(xlsxPath);
  const rows = parseFeeDiscountExcelRows(raw);

  console.log(`Parsed ${rows.length} discount rows from ${xlsxPath}`);

  const { loadOpsMasters, saveOpsMasters, loadOpsSis } = await import(
    "../src/lib/deskOpsLoad.server"
  );
  const sis = await loadOpsSis();
  const masters = await loadOpsMasters();

  if (!sis.students.length) {
    console.warn(
      "WARNING: No students in SIS desk — rules will be created; grants apply when SIS syncs.",
    );
  }

  const result = applyFeeDiscountImport({
    masters,
    sis,
    rows,
    sourceFile: path.basename(xlsxPath),
    importedBy: `CLI · ${path.basename(xlsxPath)}`,
  });

  await saveOpsMasters(result.masters);

  const seedJson = JSON.stringify(result.seed, null, 2);
  await fs.mkdir(path.dirname(SEED_PATH), { recursive: true });
  await fs.writeFile(SEED_PATH, seedJson, "utf8");
  await fs.mkdir(path.dirname(BUNDLED_SEED_PATH), { recursive: true });
  await fs.writeFile(BUNDLED_SEED_PATH, seedJson, "utf8");
  await fs.mkdir(path.dirname(PUBLIC_SEED_PATH), { recursive: true });
  await fs.writeFile(PUBLIC_SEED_PATH, seedJson, "utf8");

  console.log(
    JSON.stringify(
      {
        ...result.stats,
        rulesInMasters: result.masters.concessions.length,
        grantsInMasters: result.masters.concessionGrants?.length ?? 0,
        desk: "masters_desk_*",
        seed: SEED_PATH,
        bundledSeed: BUNDLED_SEED_PATH,
        publicSeed: PUBLIC_SEED_PATH,
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
