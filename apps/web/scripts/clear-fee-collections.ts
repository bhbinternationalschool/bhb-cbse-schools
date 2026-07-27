/**
 * Wipe all fee collection vouchers (receipts) for a clean re-import.
 *
 * Run from apps/web:
 *   npx tsx scripts/clear-fee-collections.ts
 */

import { promises as fs } from "fs";
import path from "path";
import {
  clearFeeCollections,
  compactFeesForStorage,
  loadFees,
} from "../src/lib/fees";
import { replaceSchoolMirror } from "../src/lib/schoolDataMirror";

const ROOT = path.join(process.cwd());
const MIRROR_PATH = path.join(ROOT, ".data", "school_mirror.json");
const WIPE_SIGNAL_PATH = path.join(
  ROOT,
  "public",
  "fees",
  "collections_wiped.json",
);

type MirrorBundle = {
  version: 1;
  updatedAt: string;
  sis: unknown | null;
  fees: unknown | null;
  payments: unknown | null;
  masters: unknown | null;
  admissions: unknown | null;
};

async function main() {
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

  const prev = loadFees();
  const removedVouchers = (prev.vouchers ?? []).length;
  const removedCheques = (prev.cheques ?? []).length;
  const removedDayCloses = (prev.dayCloses ?? []).length;
  const removedAllocations = (prev.planAllocations ?? []).length;

  const next = compactFeesForStorage(clearFeeCollections(prev));
  mirror.fees = next;
  mirror.updatedAt = new Date().toISOString();

  await fs.mkdir(path.dirname(MIRROR_PATH), { recursive: true });
  await fs.writeFile(MIRROR_PATH, JSON.stringify(mirror), "utf8");

  const wipedAt = mirror.updatedAt;
  const signal = {
    wipedAt,
    removedVouchers,
    note: "All collection vouchers cleared — refresh Fee Take to sync browser desk.",
  };
  await fs.mkdir(path.dirname(WIPE_SIGNAL_PATH), { recursive: true });
  await fs.writeFile(WIPE_SIGNAL_PATH, JSON.stringify(signal, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        removedVouchers,
        removedCheques,
        removedDayCloses,
        removedPlanAllocations: removedAllocations,
        keptCarriedForwardDues: next.carriedForwardDues?.length ?? 0,
        keptChargeVouchers: next.chargeVouchers?.length ?? 0,
        mirror: MIRROR_PATH,
        wipeSignal: WIPE_SIGNAL_PATH,
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
