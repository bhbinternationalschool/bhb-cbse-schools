/**
 * Import fee_discount_report.xlsx → Masters concessions + approved grants.
 *
 * Run from apps/web:
 *   npx tsx scripts/import-fee-discounts-excel.ts [path-to-xlsx]
 */

import { promises as fs } from "fs";
import path from "path";
import * as XLSX from "xlsx";
import {
  applyFeeDiscountImport,
  parseFeeDiscountExcelRows,
} from "../src/lib/feeDiscountExcelImport";
import { loadMasters, type MastersState } from "../src/lib/masters";
import { replaceSchoolMirror } from "../src/lib/schoolDataMirror";
import type { SisState } from "../src/lib/sis";

const ROOT = path.join(process.cwd());
const MIRROR_PATH = path.join(ROOT, ".data", "school_mirror.json");
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

type MirrorBundle = {
  version: 1;
  updatedAt: string;
  sis: SisState | null;
  fees: unknown | null;
  payments: unknown | null;
  masters: MastersState | null;
  admissions: unknown | null;
};

function emptySis(): SisState {
  return { households: [], students: [] } as unknown as SisState;
}

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

  let mirror: MirrorBundle = {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    sis: null,
    fees: null,
    payments: null,
    masters: null,
    admissions: null,
  };
  try {
    mirror = JSON.parse(await fs.readFile(MIRROR_PATH, "utf8")) as MirrorBundle;
  } catch {
    /* first run */
  }

  replaceSchoolMirror(mirror);

  const sis =
    mirror.sis &&
    Array.isArray(mirror.sis.students) &&
    Array.isArray(mirror.sis.households)
      ? mirror.sis
      : emptySis();

  const masters = loadMasters();

  if (!sis.students.length) {
    console.warn(
      "WARNING: No students in school mirror — rules will be created; grants apply when SIS syncs.",
    );
  }

  const result = applyFeeDiscountImport({
    masters,
    sis,
    rows,
    sourceFile: path.basename(xlsxPath),
    importedBy: `CLI · ${path.basename(xlsxPath)}`,
  });

  mirror.masters = result.masters;
  mirror.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(MIRROR_PATH), { recursive: true });
  await fs.writeFile(MIRROR_PATH, JSON.stringify(mirror), "utf8");

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
        mirror: MIRROR_PATH,
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
