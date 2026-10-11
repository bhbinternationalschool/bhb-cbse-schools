/**
 * Self-test: what the fee counter says about a typed payment reference.
 * Run: npx tsx apps/web/src/lib/feeTenderRefCheck.selftest.ts
 *
 * Cases are the real ones from the 11 Oct 2026 transaction-id audit: a date
 * saved as the id, one UPI ref on 9 receipts of 7 families, a phone number
 * as a UTR, and the legitimate case — one transfer split across siblings.
 */

import assert from "node:assert/strict";

import {
  findRefUses,
  phonePeIdDate,
  refLooksLikeDate,
  refLooksLikePhone,
  splitRefs,
  tenderRefWarnings,
} from "./feeTenderRefCheck";

console.log("feeTenderRefCheck.selftest.ts");

// ── shapes ──────────────────────────────────────────────────────────────
for (const d of ["2026-04-17", "17-04-2026", "17/4/26", "17.04.2026", "17 Apr 2026", "17-apr-26"]) {
  assert.equal(refLooksLikeDate(d), true, d);
}
for (const r of ["609407475673", "T2604061107082976941302", "2530092025648843", "1376", "UTR123"]) {
  assert.equal(refLooksLikeDate(r), false, r);
}
assert.equal(refLooksLikePhone("9453820108"), true);
assert.equal(refLooksLikePhone("+91 94538 20108"), true);
assert.equal(refLooksLikePhone("609407475673"), false, "12-digit RRN is not a phone");
assert.equal(refLooksLikePhone("1453820108"), false, "mobiles start 6–9");

assert.equal(phonePeIdDate("T2604061107082976941302"), "2026-04-06");
assert.equal(phonePeIdDate("T2064011154133420189751"), "invalid", "month 40 is a mistyped id");
assert.equal(phonePeIdDate("609407475673"), null);

assert.deepEqual(splitRefs("110258987768,110258991654"), [
  "110258987768,110258991654",
  "110258987768",
  "110258991654",
]);
assert.deepEqual(splitRefs("  "), []);

// ── reuse ───────────────────────────────────────────────────────────────
const book = [
  {
    id: "rcv_fhnwq9af",
    receiptNo: "RCV-00345",
    householdId: "hh_jq329ioa",
    collectionDate: "2026-04-04",
    totalPaise: 410000,
    transactionId: "609407475673",
    voidedAt: null,
    tenders: [{ ref: "609407475673" }],
  },
  {
    id: "rcv_0dirpcq4",
    receiptNo: "RCV-00248",
    householdId: "hh_hwlmyss6",
    collectionDate: "2026-07-11",
    totalPaise: 200000,
    transactionId: "2530092025648843",
    voidedAt: null,
    tenders: [{ ref: "2530092025648843" }],
  },
  {
    id: "rcv_void",
    receiptNo: "RCV-00090",
    householdId: "hh_jq329ioa",
    collectionDate: "2026-04-04",
    totalPaise: 410000,
    transactionId: "609407475673",
    voidedAt: "2026-08-28T19:35:03Z",
    tenders: [{ ref: "609407475673" }],
  },
];

const uses = findRefUses(book, splitRefs("609407475673"));
assert.equal(uses.length, 1, "a voided receipt does not count as a use");
assert.equal(uses[0].receiptNo, "RCV-00345");

// Siblings split from one transfer: said, softly, with the bank-sum hint.
{
  const w = tenderRefWarnings({
    tenders: [{ mode: "upi", ref: "609407475673" }],
    householdId: "hh_jq329ioa",
    collectionDate: "2026-04-04",
    uses,
  });
  assert.equal(w.length, 1);
  assert.match(w[0], /RCV-00345/);
  assert.match(w[0], /this family/);
  assert.match(w[0], /split across children/);
}

// Same ref on another family: the 2530092025648843 case.
{
  const w = tenderRefWarnings({
    tenders: [{ mode: "upi", ref: "2530092025648843" }],
    householdId: "hh_l30cgaqf",
    collectionDate: "2026-07-15",
    uses: findRefUses(book, splitRefs("2530092025648843")),
    familyName: (id) => (id === "hh_hwlmyss6" ? "Yadav family" : id),
  });
  assert.equal(w.length, 1);
  assert.match(w[0], /Yadav family/);
  assert.match(w[0], /cannot pay two families/);
}

// Same family, a different day.
{
  const w = tenderRefWarnings({
    tenders: [{ mode: "upi", ref: "609407475673" }],
    householdId: "hh_jq329ioa",
    collectionDate: "2026-07-07",
    uses,
  });
  assert.match(w[0], /on two different days/);
}

// The same receipt reached by two sources (server + browser) is said once.
{
  const w = tenderRefWarnings({
    tenders: [{ mode: "upi", ref: "609407475673" }],
    householdId: "hh_jq329ioa",
    collectionDate: "2026-04-04",
    uses: [...uses, ...uses],
  });
  assert.equal(w.length, 1);
}

// Date, phone, PhonePe date drift.
{
  const w = tenderRefWarnings({
    tenders: [
      { mode: "upi", ref: "2026-05-19" },
      { mode: "upi", ref: "9453820108" },
      { mode: "upi", ref: "T2604061107082976941302" },
    ],
    householdId: "hh_x",
    collectionDate: "2026-07-15",
    uses: [],
  });
  assert.equal(w.length, 3);
  assert.match(w[0], /is a date/);
  assert.match(w[1], /mobile number/);
  assert.match(w[2], /made on 2026-04-06/);
}

// Cash slip numbers are not judged for shape; a clean UPI ref says nothing.
{
  const w = tenderRefWarnings({
    tenders: [
      { mode: "cash", ref: "17-04-2026" },
      { mode: "upi", ref: "T2604061107082976941302" },
      { mode: "cash", ref: "" },
    ],
    householdId: "hh_x",
    collectionDate: "2026-04-06",
    uses: [],
  });
  assert.deepEqual(w, []);
}

console.log("  ok");
