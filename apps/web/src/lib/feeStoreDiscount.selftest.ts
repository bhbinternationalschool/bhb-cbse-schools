import assert from "node:assert/strict";
import { isStoreDueKey, projectDuesAfterDiscount, splitDiscountSlices, storeSaleIdOf } from "./feeStoreDiscount";

console.log("feeStoreDiscount.selftest.ts");

// The 10 Oct 2026 case: two book kits, ₹3,650 each, 10% off.
const shaurya = "store:stu_dtjestoa:fde371a5-9428-44f5-99f9-be80b7304647";
const pratiksha = "store:stu_ziaxme8g:73c1a398-b8d2-4865-b0a6-2f174d568ade";
const slices = [
  { dueKey: shaurya, amountPaise: 36500 },
  { dueKey: pratiksha, amountPaise: 36500 },
  { dueKey: "fee:stu_dtjestoa:tuition:apr", amountPaise: 10000 },
];
assert.equal(isStoreDueKey(shaurya), true);
assert.equal(isStoreDueKey("fee:x"), false);
assert.equal(storeSaleIdOf(shaurya), "fde371a5-9428-44f5-99f9-be80b7304647");
assert.equal(storeSaleIdOf("fee:x:y"), "");

const { fee, store } = splitDiscountSlices(slices);
assert.deepEqual(store.map((s) => s.dueKey), [shaurya, pratiksha], "store discounts go to the store");
assert.deepEqual(fee.map((s) => s.dueKey), ["fee:stu_dtjestoa:tuition:apr"], "fee discounts stay fee waivers");

const dues = [
  { dueKey: shaurya, balancePaise: 365000 },
  { dueKey: pratiksha, balancePaise: 365000 },
  { dueKey: "other", balancePaise: 5000 },
];
const projected = projectDuesAfterDiscount(dues, store);
assert.deepEqual(projected.map((d) => d.balancePaise), [328500, 328500, 5000], "₹3,285 each left to collect");
assert.equal(dues[0]!.balancePaise, 365000, "input not mutated");
assert.equal(projectDuesAfterDiscount([{ dueKey: shaurya, balancePaise: 1000 }], store)[0]!.balancePaise, 0, "never below zero");

console.log("feeStoreDiscount.selftest: all assertions passed");
