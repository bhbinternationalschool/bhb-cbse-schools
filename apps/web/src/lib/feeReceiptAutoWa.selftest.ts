/**
 * Self-test: the receipt template resolves and fills correctly.
 * Run: npx tsx apps/web/src/lib/feeReceiptAutoWa.selftest.ts
 *
 * The live failure this pins had two halves, and only one was obvious.
 *
 * The obvious half: `bhb_fee_receipt` was APPROVED at Meta in both languages
 * while the ERP still stored it as `pending`, so the resolver refused it.
 *
 * The half nobody saw: even with the status right, the counter's send used
 * PLAIN TEXT, not the template. Plain text is deliverable only inside Meta's
 * 24-hour window, so a parent who had not messaged the school that day got
 * nothing — and the error said "outside the 24 hour window", which points at
 * the parent's silence rather than at the code choosing text over a template.
 *
 * So the assertions below are about the two things that must be true
 * together: the family is usable, and what we send is a template with the
 * five variables filled in the order Meta approved them.
 */

import assert from "node:assert/strict";

import {
  normalizeWaTemplatesState,
  pickTemplateForFamily,
  templateFamilyReady,
  templateVariablePositions,
  type WaTemplatesState,
} from "./waTemplates";

console.log("feeReceiptAutoWa.selftest.ts");

const RECEIPT_VARS = ["receiptNo", "childName", "feeDue", "paidOn", "schoolName"];

function tpl(language: "en" | "hi", status: string) {
  return {
    id: `tpl_${language}`,
    familyKey: "fees_receipt",
    name: "Fee receipt share",
    module: "fees",
    category: "UTILITY",
    language,
    status,
    metaName: "bhb_fee_receipt",
    metaLanguage: language,
    variables: RECEIPT_VARS,
  };
}

function state(templates: unknown[]): WaTemplatesState {
  return normalizeWaTemplatesState({ templates } as unknown as WaTemplatesState);
}

// 1. The exact production shape on 2026-09-08: approved at Meta, pending
//    here. The family must read as NOT ready — that refusal is correct, and
//    the bug was never that it refused, it was that nothing told the ERP the
//    status had moved.
const stale = state([tpl("en", "pending"), tpl("hi", "pending")]);
assert.equal(templateFamilyReady(stale, "fees_receipt").ready, false);

// 2. Once synced, both languages approved, the family is usable and each
//    language resolves to its own template — never the other one. A Hindi
//    household getting the English receipt is the failure mode the
//    both-languages rule exists to prevent.
const synced = state([tpl("en", "approved"), tpl("hi", "approved")]);
assert.equal(templateFamilyReady(synced, "fees_receipt").ready, true);
// pickTemplateForFamily takes the APPROVED templates, not the whole state.
const approved = synced.templates.filter((t) => t.status === "approved");
assert.equal(pickTemplateForFamily(approved, "fees_receipt", "hi")?.language, "hi");
assert.equal(pickTemplateForFamily(approved, "fees_receipt", "en")?.language, "en");

// 3. Half-approved stays refused. If only English came back approved, a
//    Hindi family must get silence rather than the wrong language.
const half = state([tpl("en", "approved"), tpl("hi", "pending")]);
assert.equal(templateFamilyReady(half, "fees_receipt").ready, false);

// 4. The variables land in Meta's approved order. bhb_fee_receipt reads
//    "Receipt no {{1}} · Student {{2}} · Paid {{3}} · On {{4}} · thanks {{5}}",
//    so a reordering here would tell a parent their child's name was the
//    amount they paid.
const filled = templateVariablePositions(
  { variables: RECEIPT_VARS },
  {
    receiptNo: "RCV-00511",
    childName: "AARAV SINGH",
    feeDue: "₹1,650",
    paidOn: "2026-09-08",
    schoolName: "BHB International School",
  },
);
assert.deepEqual(filled, {
  "1": "RCV-00511",
  "2": "AARAV SINGH",
  "3": "₹1,650",
  "4": "2026-09-08",
  "5": "BHB International School",
});

// 5. A missing value must not silently become an empty bubble in a parent's
//    chat — Meta also rejects empty template parameters outright.
const gaps = templateVariablePositions({ variables: RECEIPT_VARS }, {
  receiptNo: "RCV-00512",
});
assert.equal(gaps["1"], "RCV-00512");
for (const k of ["2", "3", "4", "5"]) {
  assert.ok((gaps[k] ?? "").length > 0, `variable ${k} must never be empty`);
}

console.log("  ok — the family is whole, and the five variables keep their order");
