/**
 * Run: npx tsx src/lib/store.selftest.ts
 *
 * Exercises only the pure logic — groupLowStockByLocation(). Only
 * `store.infraLevels` is actually read (via infraLevelLabel), so the fixture
 * store object below is intentionally minimal, not a full StoreState.
 */
import assert from "node:assert/strict";

import { groupLowStockByLocation, type StoreItem, type StoreState } from "./store";

console.log("store.selftest.ts");

function makeItem(overrides: Partial<StoreItem>): StoreItem {
  return {
    id: overrides.id || "item",
    sku: overrides.sku || "SKU",
    name: overrides.name || "Item",
    categoryId: "",
    saleGroupId: "",
    uomId: "",
    sourceId: "",
    infraLevelId: "",
    sizeLabel: "",
    purchasePricePaise: 0,
    salePricePaise: 0,
    unitPricePaise: 0,
    maxDiscountPct: 0,
    audience: "both",
    applicableClassIds: [],
    isActive: true,
    stockOnHand: 0,
    reorderLevel: 0,
    openingQty: 0,
    issuePolicy: "unlimited",
    maxQtyPerAy: 0,
    barcode: "",
    ...overrides,
  };
}

const store = {
  infraLevels: [
    { id: "lab-physics", name: "Physics Lab", code: "PHY", isActive: true, sortOrder: 1 },
    { id: "lab-chem", name: "Chemistry Lab", code: "CHEM", isActive: true, sortOrder: 2 },
  ],
} as StoreState;

// --- groups already-low items by their infraLevelId, resolving real names -
{
  const beaker = makeItem({ id: "1", sku: "BEAKER", infraLevelId: "lab-physics", stockOnHand: 2, reorderLevel: 5 });
  const flask = makeItem({ id: "2", sku: "FLASK", infraLevelId: "lab-physics", stockOnHand: 1, reorderLevel: 5 });
  const acid = makeItem({ id: "3", sku: "ACID", infraLevelId: "lab-chem", stockOnHand: 0, reorderLevel: 3 });

  const groups = groupLowStockByLocation([beaker, flask, acid], store);
  assert.equal(groups.length, 2);

  const physics = groups.find((g) => g.infraLevelId === "lab-physics");
  assert.ok(physics);
  assert.equal(physics.infraLevelLabel, "Physics Lab", "must resolve the real name, not just echo the id");
  assert.equal(physics.items.length, 2);

  const chem = groups.find((g) => g.infraLevelId === "lab-chem");
  assert.ok(chem);
  assert.equal(chem.infraLevelLabel, "Chemistry Lab");
  assert.equal(chem.items.length, 1);
}

// --- worst-affected location (most low-stock items) sorts first -----------
{
  const physicsItems = [
    makeItem({ id: "p1", infraLevelId: "lab-physics", stockOnHand: 1, reorderLevel: 5 }),
    makeItem({ id: "p2", infraLevelId: "lab-physics", stockOnHand: 1, reorderLevel: 5 }),
    makeItem({ id: "p3", infraLevelId: "lab-physics", stockOnHand: 1, reorderLevel: 5 }),
  ];
  const chemItem = makeItem({ id: "c1", infraLevelId: "lab-chem", stockOnHand: 1, reorderLevel: 5 });
  const groups = groupLowStockByLocation([chemItem, ...physicsItems], store);
  assert.equal(groups[0].infraLevelId, "lab-physics", "3 low items must sort before 1 low item");
  assert.equal(groups[1].infraLevelId, "lab-chem");
}

// --- an unrecognized/unset infraLevelId still groups (falls back to "—") --
{
  const noLocation = makeItem({ id: "n1", infraLevelId: "", stockOnHand: 0, reorderLevel: 5 });
  const groups = groupLowStockByLocation([noLocation], store);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].infraLevelLabel, "—", "infraLevelLabel's own fallback for an empty id");
}

// --- empty input -> empty output -------------------------------------------
{
  assert.deepEqual(groupLowStockByLocation([], store), []);
}

console.log("OK — store.selftest.ts");
