/**
 * Run: npx tsx src/lib/store.selftest.ts
 *
 * Exercises only the pure logic — groupLowStockByLocation() and
 * listOverAllocatedItems(). Only the fields each function actually reads are
 * populated on the fixture store object below, not a full StoreState.
 */
import assert from "node:assert/strict";

import {
  groupLowStockByLocation,
  listOverAllocatedItems,
  type StoreInventoryAllocation,
  type StoreItem,
  type StoreState,
} from "./store";

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

function makeAlloc(overrides: Partial<StoreInventoryAllocation>): StoreInventoryAllocation {
  return {
    id: overrides.id || "alloc",
    itemId: overrides.itemId || "item",
    infraLevelId: overrides.infraLevelId || "",
    qty: overrides.qty ?? 0,
    note: "",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

// --- listOverAllocatedItems: allocations across locations summing past ----
// --- stockOnHand are flagged, with the correct overBy and per-location ----
// --- breakdown ---------------------------------------------------------
{
  const beaker = makeItem({ id: "beaker", name: "Beaker", stockOnHand: 10 });
  const overStore = {
    infraLevels: store.infraLevels,
    items: [beaker],
    inventoryAllocations: [
      makeAlloc({ id: "a1", itemId: "beaker", infraLevelId: "lab-physics", qty: 30 }),
      makeAlloc({ id: "a2", itemId: "beaker", infraLevelId: "lab-chem", qty: 20 }),
    ],
  } as StoreState;

  const flagged = listOverAllocatedItems(overStore);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].itemId, "beaker");
  assert.equal(flagged[0].totalAllocated, 50);
  assert.equal(flagged[0].stockOnHand, 10);
  assert.equal(flagged[0].overBy, 40);
  assert.equal(flagged[0].allocations.length, 2);
  assert.ok(
    flagged[0].allocations.some((a) => a.infraLevelLabel === "Physics Lab" && a.qty === 30),
    "must resolve real location names, not just echo the id",
  );
}

// --- an item allocated at or under stockOnHand is excluded -----------------
{
  const flask = makeItem({ id: "flask", stockOnHand: 10 });
  const okStore = {
    infraLevels: store.infraLevels,
    items: [flask],
    inventoryAllocations: [makeAlloc({ id: "a1", itemId: "flask", qty: 10 })],
  } as StoreState;
  assert.deepEqual(listOverAllocatedItems(okStore), []);
}

// --- an over-allocated but inactive item is excluded (not actionable) -----
{
  const retired = makeItem({ id: "retired", stockOnHand: 0, isActive: false });
  const inactiveStore = {
    infraLevels: store.infraLevels,
    items: [retired],
    inventoryAllocations: [makeAlloc({ id: "a1", itemId: "retired", qty: 25 })],
  } as StoreState;
  assert.deepEqual(listOverAllocatedItems(inactiveStore), []);
}

// --- worst over-allocation (largest overBy) sorts first ---------------------
{
  const a = makeItem({ id: "a", stockOnHand: 10 });
  const b = makeItem({ id: "b", stockOnHand: 10 });
  const sortStore = {
    infraLevels: store.infraLevels,
    items: [a, b],
    inventoryAllocations: [
      makeAlloc({ id: "a1", itemId: "a", qty: 15 }), // overBy 5
      makeAlloc({ id: "b1", itemId: "b", qty: 40 }), // overBy 30
    ],
  } as StoreState;
  const flagged = listOverAllocatedItems(sortStore);
  assert.equal(flagged[0].itemId, "b", "overBy 30 must sort before overBy 5");
  assert.equal(flagged[1].itemId, "a");
}

// --- no allocations -> empty output, not a crash ----------------------------
{
  const emptyStore = {
    infraLevels: store.infraLevels,
    items: [] as StoreItem[],
    inventoryAllocations: [] as StoreInventoryAllocation[],
  } as StoreState;
  assert.deepEqual(listOverAllocatedItems(emptyStore), []);
}

console.log("OK — store.selftest.ts");
