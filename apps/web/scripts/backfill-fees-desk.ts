#!/usr/bin/env npx tsx
/**
 * Backfill fee_desk_* tables from fees_state blob or school mirror file.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-fees-desk.ts
 *   cd apps/web && npx tsx scripts/backfill-fees-desk.ts --from-mirror=../../.data/school_mirror.json
 *   cd apps/web && npx tsx scripts/backfill-fees-desk.ts --skip-open-dues
 */

import { readFile } from "fs/promises";
import path from "path";
import type { FeesState } from "../src/lib/fees";
import {
  fetchFeeDeskFromDb,
  pushFeeDeskToDb,
} from "../src/lib/feesNormalized.server";
import { currentAcademicYearCode, loadMasters } from "../src/lib/masters";

function deskSliceCounts(fees: FeesState | null) {
  if (!fees) {
    return {
      vouchers: 0,
      cheques: 0,
      manualBooks: 0,
      dayCloses: 0,
      chargeVouchers: 0,
      installmentPlans: 0,
      planAllocations: 0,
      carriedForwardDues: 0,
    };
  }
  return {
    vouchers: fees.vouchers?.length ?? 0,
    cheques: fees.cheques?.length ?? 0,
    manualBooks: fees.manualBooks?.length ?? 0,
    dayCloses: fees.dayCloses?.length ?? 0,
    chargeVouchers: fees.chargeVouchers?.length ?? 0,
    installmentPlans: fees.installmentPlans?.length ?? 0,
    planAllocations: fees.planAllocations?.length ?? 0,
    carriedForwardDues: fees.carriedForwardDues?.length ?? 0,
  };
}

function hasDeskData(fees: FeesState | null): boolean {
  const c = deskSliceCounts(fees);
  return Object.values(c).some((n) => n > 0);
}

async function loadFeesFromMirror(file: string): Promise<FeesState | null> {
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw) as { fees?: FeesState };
  return parsed.fees ?? null;
}

async function loadFeesFromSupabaseBlob(): Promise<FeesState | null> {
  const { fetchServerBlob } = await import("../src/lib/serverBlob");
  const blob = await fetchServerBlob<FeesState>("fees_state");
  return blob.state ?? null;
}

async function loadFeesFromSchoolMirrorBlob(): Promise<FeesState | null> {
  const { fetchServerBlob } = await import("../src/lib/serverBlob");
  const blob = await fetchServerBlob<{ fees?: FeesState }>("school_mirror_state");
  return blob.state?.fees ?? null;
}

async function resolveFeesSource(): Promise<{
  fees: FeesState;
  source: string;
}> {
  const fromArg = process.argv.find((a) => a.startsWith("--from-mirror="));
  if (fromArg) {
    const file = fromArg.split("=")[1]!;
    const fees = await loadFeesFromMirror(path.resolve(file));
    if (!hasDeskData(fees)) {
      throw new Error(`No fee desk slices in mirror file: ${file}`);
    }
    return { fees: fees!, source: `mirror file ${file}` };
  }

  const mirrorPath = path.join(process.cwd(), ".data", "school_mirror.json");
  try {
    const local = await loadFeesFromMirror(mirrorPath);
    if (hasDeskData(local)) {
      return { fees: local!, source: mirrorPath };
    }
  } catch {
    /* try remote sources */
  }

  const feesBlob = await loadFeesFromSupabaseBlob();
  if (hasDeskData(feesBlob)) {
    return { fees: feesBlob!, source: "fees_state blob" };
  }

  const schoolMirror = await loadFeesFromSchoolMirrorBlob();
  if (hasDeskData(schoolMirror)) {
    return { fees: schoolMirror!, source: "school_mirror_state blob" };
  }

  throw new Error(
    "No fee desk data found in local mirror, fees_state, or school_mirror_state.",
  );
}

async function main() {
  const skipOpenDues = process.argv.includes("--skip-open-dues");
  const { fees, source } = await resolveFeesSource();
  const counts = deskSliceCounts(fees);
  console.log(`Loaded fees from ${source}`, counts);

  const { writeFeesLocalRaw } = await import("../src/lib/fees");
  writeFeesLocalRaw(fees);

  const before = await fetchFeeDeskFromDb();
  console.log(
    `DB before: ${before.vouchers.length} vouchers, ${before.ancillary.cheques.length} cheques, ${before.ancillary.chargeVouchers.length} charge vouchers`,
  );

  const masters = loadMasters();
  const ay =
    fees.vouchers?.[0]?.academicYearCode || currentAcademicYearCode(masters);

  const result = await pushFeeDeskToDb(
    {
      vouchers: fees.vouchers ?? [],
      cheques: fees.cheques ?? [],
      manualBooks: fees.manualBooks ?? [],
      dayCloses: fees.dayCloses ?? [],
      installmentPlans: fees.installmentPlans ?? [],
      planAllocations: fees.planAllocations ?? [],
      carriedForwardDues: fees.carriedForwardDues ?? [],
      chargeVouchers: fees.chargeVouchers ?? [],
    },
    { academicYearCode: ay, rebuildOpenDues: !skipOpenDues },
  );
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchFeeDeskFromDb();
  console.log(
    `Backfill OK — wrote ${result.voucherCount} vouchers (DB now ${after.vouchers.length})`,
  );
  console.log(
    `Ancillary: ${after.ancillary.cheques.length} cheques, ${after.ancillary.dayCloses.length} day closes, ${after.ancillary.chargeVouchers.length} charge vouchers, ${after.ancillary.manualBooks.length} manual books`,
  );
  if (!skipOpenDues) {
    console.log(`Open dues cache: ${result.openDuesCount ?? 0} rows`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
