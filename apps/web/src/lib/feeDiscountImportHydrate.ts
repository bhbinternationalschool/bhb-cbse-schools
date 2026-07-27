/**
 * Browser: apply bundled fee discount seed grants when SIS students are available.
 */

import { normAdmissionNo } from "@/lib/dailyCollectionReportImport";
import feeDiscountSeedJson from "@/lib/data/fee_discount_import_seed.json";
import {
  mergeFeeDiscountSeedGrants,
  type FeeDiscountImportSeed,
} from "@/lib/feeDiscountExcelImport";
import { mergeDiscountRulesFromSeed } from "@/lib/feeDiscountRuntime";
import {
  loadMasters,
  persistMastersSystemImport,
  type MastersState,
} from "@/lib/masters";
import type { SisState } from "@/lib/sis";

const APPLIED_KEY = "bhb_fee_discount_seed_applied_v1";
const bundledSeed = feeDiscountSeedJson as FeeDiscountImportSeed;

let running = false;

function seedMarker(seed: FeeDiscountImportSeed): string {
  return `${seed.importedAt}:${seed.grants.length}`;
}

function isSeedFullyApplied(
  masters: MastersState,
  seed: FeeDiscountImportSeed,
): boolean {
  const prev = localStorage.getItem(APPLIED_KEY);
  if (prev !== seedMarker(seed)) return false;
  const ruleByCode = new Map(
    masters.concessions.map((c) => [c.code.toUpperCase(), c.id]),
  );
  const grantIds = new Set((masters.concessionGrants ?? []).map((g) => g.id));
  return seed.grants.every((row) => {
    const ruleId = ruleByCode.get(row.concessionCode.toUpperCase());
    if (!ruleId) return false;
    const adm = normAdmissionNo(row.admissionNo).replace(/[^\w]+/g, "_");
    return grantIds.has(`cg_imp_${adm}_${ruleId.slice(-8)}`);
  });
}

/**
 * Apply seed to in-memory masters + SIS; persist when grants were added.
 */
export function mergeAndPersistFeeDiscountSeed(
  masters: MastersState,
  sis: SisState,
): { masters: MastersState; applied: number; pending: number } {
  if (typeof window === "undefined") {
    return { masters, applied: 0, pending: bundledSeed.grants.length };
  }

  masters = mergeDiscountRulesFromSeed(masters);
  const rulesOnly = !sis.students.length;

  if (rulesOnly) {
    persistMastersSystemImport(masters);
    return { masters, applied: 0, pending: bundledSeed.grants.length };
  }

  if (isSeedFullyApplied(masters, bundledSeed)) {
    return { masters, applied: 0, pending: 0 };
  }

  const { masters: next, applied, pending } = mergeFeeDiscountSeedGrants(
    masters,
    sis,
    bundledSeed,
  );

  const shouldPersist =
    applied > 0 ||
    next.concessions.length !== masters.concessions.length ||
    (next.concessionGrants?.length ?? 0) !== (masters.concessionGrants?.length ?? 0);

  if (shouldPersist) {
    persistMastersSystemImport(next);
    if (applied > 0 && pending === 0) {
      localStorage.setItem(APPLIED_KEY, seedMarker(bundledSeed));
    }
    return { masters: next, applied, pending };
  }

  return { masters: next, applied, pending };
}

/** Load current desk state and apply bundled seed (safe to call after SIS hydrate). */
export function applyFeeDiscountSeedNow(): {
  applied: number;
  pending: number;
} {
  if (typeof window === "undefined" || running) {
    return { applied: 0, pending: 0 };
  }
  running = true;
  try {
    // Dynamic import avoids loadSis ↔ hydrate circular import at module init.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadSis } = require("@/lib/sis") as typeof import("@/lib/sis");
    const sis = loadSis();
    if (!sis.students.length) {
      return { applied: 0, pending: bundledSeed.grants.length };
    }
    const masters = mergeDiscountRulesFromSeed(loadMasters());
    const { applied, pending } = mergeAndPersistFeeDiscountSeed(masters, sis);
    return { applied, pending };
  } finally {
    running = false;
  }
}

/** @deprecated Use applyFeeDiscountSeedNow after SIS is hydrated. */
export async function hydrateFeeDiscountGrantsFromSeed(): Promise<{
  applied: number;
  pending: number;
}> {
  return applyFeeDiscountSeedNow();
}
