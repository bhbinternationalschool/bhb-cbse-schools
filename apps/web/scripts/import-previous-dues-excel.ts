/**
 * Import Student Wise Fee Details.xlsx → previous session arrears (carried forward).
 *
 * Run from apps/web:
 *   npx tsx scripts/import-previous-dues-excel.ts [path-to-xlsx]
 */

import { promises as fs } from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { DEFAULT_AY } from "../src/lib/masters";
import {
  applyPreviousDuesImport,
  parseStudentWiseFeeSummaryRows,
  summarizePreviousDueRows,
} from "../src/lib/previousDuesExcelImport";
import type { FeesState } from "../src/lib/fees";
import type { SisState } from "../src/lib/sis";

const ROOT = path.join(process.cwd());
const MIRROR_PATH = path.join(ROOT, ".data", "school_mirror.json");
const DEFAULT_XLSX = path.join(
  ROOT,
  "data",
  "fees",
  "Student_Wise_Fee_Details.xlsx",
);

type MirrorBundle = {
  version: 1;
  updatedAt: string;
  sis: SisState | null;
  fees: FeesState | null;
  payments: unknown | null;
  masters: unknown | null;
  admissions: unknown | null;
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

  const sis =
    mirror.sis &&
    Array.isArray(mirror.sis.students) &&
    Array.isArray(mirror.sis.households)
      ? mirror.sis
      : emptySis();

  const fees =
    mirror.fees && Array.isArray(mirror.fees.vouchers)
      ? mirror.fees
      : emptyFees();

  if (!sis.students.length) {
    console.warn(
      "WARNING: No students in school mirror — import will not match anyone.",
    );
    console.warn(
      "Sync SIS first, or ensure .data/school_mirror.json has students.",
    );
  }

  const result = applyPreviousDuesImport({
    fees,
    sis,
    rows,
    toAy: DEFAULT_AY,
    importedBy: `Excel · ${path.basename(xlsxPath)}`,
  });

  mirror.fees = result.fees;
  mirror.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(MIRROR_PATH), { recursive: true });
  await fs.writeFile(MIRROR_PATH, JSON.stringify(mirror), "utf8");

  const seedPath = path.join(ROOT, "data", "fees", "previous_dues_import.json");
  await fs.mkdir(path.dirname(seedPath), { recursive: true });
  await fs.writeFile(
    seedPath,
    JSON.stringify(
      {
        version: 1,
        importedAt: mirror.updatedAt,
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
        mirror: MIRROR_PATH,
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
