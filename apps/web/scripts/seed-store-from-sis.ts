#!/usr/bin/env npx tsx
/**
 * Seed store_desk_* — default catalog, opening movements, one credit issue from SIS.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-store-from-sis.ts
 */

import {
  defaultStoreCategories,
  defaultStoreInfraLevels,
  defaultStoreUoms,
  seedStoreCatalog,
  type StoreIssue,
  type StoreState,
  type StoreStockMovement,
} from "../src/lib/store";
import { DEFAULT_AY } from "../src/lib/masters";
import { fetchSisFromDb } from "../src/lib/sisNormalized.server";
import {
  fetchStoreDeskFromDb,
  pushStoreDeskToDb,
} from "../src/lib/storeNormalized.server";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function main() {
  const today = todayYmd();
  const { bundle } = await fetchSisFromDb();
  const student = bundle.students.find((s) => s.status === "active");
  if (!student) throw new Error("No active SIS student — seed SIS first.");

  const categories = defaultStoreCategories();
  const uoms = defaultStoreUoms();
  const infraLevels = defaultStoreInfraLevels();
  const items = seedStoreCatalog(categories);

  const movements: StoreStockMovement[] = items
    .filter((i) => i.openingQty > 0)
    .map((i, idx) => ({
      id: `stm_seed_open_${idx + 1}`,
      itemId: i.id,
      at: nowIso(),
      kind: "opening" as const,
      qtyDelta: i.openingQty,
      note: "Seed catalog",
      refIssueId: "",
      by: "seed-store-from-sis",
    }));

  const bookItem = items.find((i) => i.sku === "BK-ENG-6") ?? items[0]!;
  const linePaise = bookItem.salePricePaise;

  const issues: StoreIssue[] = [
    {
      id: "stoi_seed_credit",
      issueNo: "ST-SEED-001",
      recipientKind: "student",
      studentId: student.id,
      staffId: "",
      householdId: student.householdId || "",
      academicYearCode: student.academicYearCode || DEFAULT_AY,
      issuedOn: today,
      lines: [
        {
          itemId: bookItem.id,
          sku: bookItem.sku,
          name: bookItem.name,
          sizeLabel: bookItem.sizeLabel,
          qty: 1,
          unitPricePaise: bookItem.salePricePaise,
          linePaise,
          maxDiscountPct: bookItem.maxDiscountPct,
        },
      ],
      totalPaise: linePaise,
      saleDiscountPaise: 0,
      note: "Seeded credit issue for desk cutover",
      createdAt: nowIso(),
      voidedAt: null,
      paymentMode: "credit",
      paymentStatus: "due",
      issueKind: "first",
      replacesIssueId: "",
      replacementReason: "",
      issuedBy: "seed-store-from-sis",
      storeLocation: "Main store",
      returnToStock: false,
      returnedPaise: 0,
    },
  ];

  const state: StoreState = {
    version: 1,
    categories,
    saleGroups: [],
    uoms,
    infraLevels,
    sources: [],
    items,
    issues,
    movements,
    inventoryAllocations: [],
    assetAllocations: [],
    sellReturns: [],
  };

  console.log(
    `Seeding ${categories.length} categories, ${items.length} items, ${issues.length} issues, ${movements.length} movements`,
  );

  const before = await fetchStoreDeskFromDb();
  console.log(`DB before: ${before.bundle.items.length} items`);

  const result = await pushStoreDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchStoreDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.items.length} items, ${after.meta?.issueCount ?? 0} issues, ${after.meta?.openDueCount ?? 0} open dues`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
