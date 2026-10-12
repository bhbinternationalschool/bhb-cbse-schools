import assert from "node:assert/strict";
import { aadhaarOnRecord } from "./parentProfile";
import type { SisStudent } from "./sis";

const s = {
  aadhaarNumber: "234123412346",
  aadhaarLast4: "",
  aadhaarVerification: "received",
  fatherAadhaarNumber: "",
  fatherAadhaarLast4: "9876",
  fatherAadhaarVerification: "verified_udise",
  motherAadhaarNumber: "",
  motherAadhaarLast4: "",
  motherAadhaarVerification: "",
} as unknown as SisStudent;

const rows = aadhaarOnRecord(s);
assert.deepEqual(rows, [
  { who: "child", last4: "2346", status: "received" },
  { who: "father", last4: "9876", status: "verified" },
  { who: "mother", last4: "", status: "missing" },
]);
// Never the full number.
assert.ok(!JSON.stringify(rows).includes("234123412346"));
console.log("parentAadhaarOnRecord.selftest.ts\n  ok");
