/**
 * Self-test: the fee receipt must go out as the RECEIPT template, filled.
 *
 * 2026-09-07, found while asking why "Send WhatsApp" on a receipt reported
 * "outside Meta's 24h window" even though Meta had approved the template.
 * Three faults sat in one code path:
 *
 *  1. The ERP only learns of Meta's approval when the template sync is run.
 *     Until then it holds the template as "pending", finds no approved
 *     template, and sends PLAIN TEXT — which Meta refuses outside 24 hours.
 *     That was the message on screen.
 *
 *  2. Selection took the first approved template in the whole `fees` module
 *     matching the family's language. The school's approved Hindi fees
 *     templates were, in order: bhb_fee_pay_link, then bhb_fee_receipt. So a
 *     Hindi-preferring family would have been sent "pay this link" moments
 *     after paying at the counter.
 *
 *  3. The approved bhb_fee_receipt declares FIVE variables (receiptNo,
 *     childName, feeDue, paidOn, schoolName) and the sender supplied two.
 *     Meta rejects a send whose parameter count does not match, so it would
 *     have failed even once approved.
 *
 *   npm run -w web test:wa-receipt-template
 */

import assert from "node:assert/strict";
import {
  pickTemplateForFamily,
  templateVariablePositions,
} from "./waTemplates";
import type { WaTemplate } from "./waTemplates";

console.log("waReceiptTemplate.selftest.ts");

const tpl = (
  familyKey: string,
  language: "en" | "hi",
  metaName: string,
  variables: string[] = [],
) => ({ familyKey, language, metaName, variables }) as unknown as WaTemplate;

/* The school's real approved set on the day this was found — note that the
 * pay-link template sorts BEFORE the receipt, which is what made the old
 * "first approved fees template" rule send the wrong message. */
const approved = [
  tpl("fees_pay_link", "hi", "bhb_fee_pay_link"),
  tpl("fees_receipt", "en", "bhb_fee_receipt"),
  tpl("fees_receipt", "hi", "bhb_fee_receipt"),
];

{
  const hi = pickTemplateForFamily(approved, "fees_receipt", "hi");
  assert.equal(
    hi?.metaName,
    "bhb_fee_receipt",
    "a Hindi family must get the RECEIPT, never the pay-link",
  );
  assert.equal(hi?.language, "hi", "and in Hindi");

  const en = pickTemplateForFamily(approved, "fees_receipt", "en");
  assert.equal(en?.metaName, "bhb_fee_receipt");
  assert.equal(en?.language, "en");
}

/* No Hindi receipt approved → the English RECEIPT, not a Hindi something-else. */
{
  const enOnly = [
    tpl("fees_pay_link", "hi", "bhb_fee_pay_link"),
    tpl("fees_receipt", "en", "bhb_fee_receipt"),
  ];
  const picked = pickTemplateForFamily(enOnly, "fees_receipt", "hi");
  assert.equal(
    picked?.metaName,
    "bhb_fee_receipt",
    "the fallback crosses LANGUAGE, never template family",
  );
  assert.equal(picked?.language, "en");
}

/* Nothing approved for this family → undefined, so the caller does not claim
 * to have sent a template it never had. */
{
  const none = [tpl("fees_pay_link", "hi", "bhb_fee_pay_link")];
  assert.equal(pickTemplateForFamily(none, "fees_receipt", "hi"), undefined);
}

/* Every declared variable gets a position, in the template's own order. */
{
  const receipt = tpl("fees_receipt", "en", "bhb_fee_receipt", [
    "receiptNo",
    "childName",
    "feeDue",
    "paidOn",
    "schoolName",
  ]);
  const vars = templateVariablePositions(receipt, {
    receiptNo: "RCV-00509",
    childName: "ABHI PATEL",
    feeDue: "₹12,850",
    paidOn: "2026-09-07",
    schoolName: "BHB International School",
  });
  assert.deepEqual(vars, {
    "1": "RCV-00509",
    "2": "ABHI PATEL",
    "3": "₹12,850",
    "4": "2026-09-07",
    "5": "BHB International School",
  });
  assert.equal(
    Object.keys(vars).length,
    receipt.variables.length,
    "Meta refuses a send whose parameter count differs from the template",
  );
}

/* A missing value becomes an em dash, never "" — Meta refuses blanks, and a
 * receipt that arrives naming a field it could not fill beats one that never
 * arrives at all. */
{
  const receipt = tpl("fees_receipt", "en", "bhb_fee_receipt", [
    "receiptNo",
    "childName",
  ]);
  const vars = templateVariablePositions(receipt, { receiptNo: "RCV-1" });
  assert.equal(vars["2"], "—");
  assert.ok(
    Object.values(vars).every((v) => v.length > 0),
    "no parameter may be empty",
  );
}

console.log("waReceiptTemplate.selftest.ts OK");
