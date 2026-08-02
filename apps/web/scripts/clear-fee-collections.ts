/**
 * Wipe all fee collection vouchers (receipts) for a clean re-import.
 *
 * Run from apps/web:
 *   npx tsx scripts/clear-fee-collections.ts
 */

import { promises as fs } from "fs";
import path from "path";
import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

import {
  clearFeeCollections,
  compactFeesForStorage,
} from "../src/lib/fees";

const ROOT = path.join(process.cwd());
const WIPE_SIGNAL_PATH = path.join(
  ROOT,
  "public",
  "fees",
  "collections_wiped.json",
);

async function main() {
  const { loadOpsFees, saveOpsFees } = await import(
    "../src/lib/deskOpsLoad.server"
  );

  const prev = await loadOpsFees();
  const removedVouchers = (prev.vouchers ?? []).length;
  const removedCheques = (prev.cheques ?? []).length;
  const removedDayCloses = (prev.dayCloses ?? []).length;
  const removedAllocations = (prev.planAllocations ?? []).length;

  const next = compactFeesForStorage(clearFeeCollections(prev));
  await saveOpsFees(next);

  const wipedAt = new Date().toISOString();
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
        desk: "fee_desk_*",
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
