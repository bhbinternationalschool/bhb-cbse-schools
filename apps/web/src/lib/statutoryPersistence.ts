/**
 * Statutory desk hydration — normalized statutory_desk_* only (no legacy blob;
 * this module never had one). Mirrors payrollPersistence.ts's ensurePayrollHydrated
 * shape, minus the blob layer.
 */

import {
  loadStatutoryRemit,
  writeStatutoryRemitLocalRaw,
} from "@/lib/statutoryRemit";
import { hydrateStatutoryDeskFromDb } from "@/lib/statutoryNormalizedClient";
import { mergeDbDeskIntoStatutoryState } from "@/lib/statutoryNormalizedMerge";
import { statutoryReadFromDbEnabled } from "@/lib/statutoryDbConfig";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "statutory";

export async function ensureStatutoryHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;

  const readFromDb = statutoryReadFromDbEnabled();
  const { bundle, changed, ok } = await hydrateStatutoryDeskFromDb(readFromDb);
  if (!ok) {
    // Fetch failed — do not lock hydration flag; caller can retry later.
    return false;
  }
  markDeskHydrated(MODULE);
  if (!changed) return false;
  if (bundle.batches.length === 0 && !readFromDb) return false;

  const merged = mergeDbDeskIntoStatutoryState(loadStatutoryRemit(), bundle, {
    preferDb: readFromDb,
  });
  writeStatutoryRemitLocalRaw(merged);
  return true;
}

export function resetStatutoryPersistenceCache() {
  resetDeskHydrated(MODULE);
}
