/**
 * Self-test: what the parent app is shown of a child — the Aadhaar mask
 * and the document checklist.
 * Run: npx tsx apps/web/src/lib/parentProfile.selftest.ts
 */
import assert from "node:assert/strict";
import { documentChecklist, maskAadhaar } from "@/lib/parentProfile";

assert.equal(maskAadhaar({ aadhaarNumber: "1234 5678 9012", aadhaarLast4: "" }), "XXXX XXXX 9012");
assert.equal(maskAadhaar({ aadhaarNumber: "", aadhaarLast4: "4321" }), "XXXX XXXX 4321");
assert.equal(maskAadhaar({ aadhaarNumber: "", aadhaarLast4: "" }), "", "no number, no mask");

const list = documentChecklist();
assert.equal(list.length, 7);
assert.deepEqual(
  list.filter((d) => d.required).map((d) => d.key),
  ["birthCert", "photo", "aadhaar", "addressProof"],
);
assert.ok(!list.find((d) => d.key === "photo")!.accept.includes("pdf"), "photo is never a PDF");
assert.ok(list.every((d) => d.hint.length > 20), "every document explains itself");

console.log("parentProfile.selftest: ok");
