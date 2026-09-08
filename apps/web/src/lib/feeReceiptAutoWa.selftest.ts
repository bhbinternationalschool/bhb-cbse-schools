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
import {
  receiptPdfPublicUrl,
  signReceiptLinkToken,
  verifyReceiptLinkToken,
} from "./receiptLinkToken.server";

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

// 6. THE ATTACHMENT, and the rule that keeps it from breaking what works.
//
//    The PDF rides on a SECOND template (`fees_receipt_doc`), because adding
//    a document header to the approved `fees_receipt` would send it back to
//    PENDING at Meta and stop every receipt again. So the doc family is used
//    only when it is approved in BOTH languages, and the text-only family is
//    the floor underneath it however long Meta's queue takes.
const docTpl = (language: "en" | "hi", status: string) => ({
  ...tpl(language, status),
  id: `doc_${language}`,
  familyKey: "fees_receipt_doc",
  metaName: "bhb_fee_receipt_pdf",
});

const awaitingApproval = state([
  tpl("en", "approved"),
  tpl("hi", "approved"),
  docTpl("en", "pending"),
  docTpl("hi", "pending"),
]);
assert.equal(templateFamilyReady(awaitingApproval, "fees_receipt").ready, true);
assert.equal(
  templateFamilyReady(awaitingApproval, "fees_receipt_doc").ready,
  false,
  "an unapproved PDF template must not be chosen",
);

const halfApprovedDoc = state([
  tpl("en", "approved"),
  tpl("hi", "approved"),
  docTpl("en", "approved"),
  docTpl("hi", "pending"),
]);
assert.equal(
  templateFamilyReady(halfApprovedDoc, "fees_receipt_doc").ready,
  false,
  "half-approved must fall back, not send Hindi families an English receipt",
);

const bothApproved = state([
  tpl("en", "approved"),
  tpl("hi", "approved"),
  docTpl("en", "approved"),
  docTpl("hi", "approved"),
]);
assert.equal(templateFamilyReady(bothApproved, "fees_receipt_doc").ready, true);

// 7. The signed link Meta fetches. It is the ONLY unauthenticated way to a
//    receipt, so each of these is a way in that must stay shut.
const A = "cv_receipt_a";
const B = "cv_receipt_b";
const t = signReceiptLinkToken(A);
assert.ok(t, "a link must be signable in dev");
assert.deepEqual(verifyReceiptLinkToken(A, t!.exp, t!.sig), { ok: true });

//    Another receipt's id with this signature — the obvious attack, and the
//    reason the voucher id is inside the signed payload rather than beside it.
assert.equal(verifyReceiptLinkToken(B, t!.exp, t!.sig).ok, false);
//    A longer expiry than was signed for.
assert.equal(verifyReceiptLinkToken(A, t!.exp + 86400, t!.sig).ok, false);
//    A tampered signature, and a missing one.
assert.equal(verifyReceiptLinkToken(A, t!.exp, `${t!.sig}x`).ok, false);
assert.equal(verifyReceiptLinkToken(A, t!.exp, null).ok, false);
//    Expired, checked at a clock past the expiry.
const expired = verifyReceiptLinkToken(A, t!.exp, t!.sig, (t!.exp + 5) * 1000);
assert.equal(expired.ok, false);
assert.equal(expired.ok === false ? expired.reason : "", "expired");

//    The URL carries the id, the expiry and the signature, and nothing else.
const url = receiptPdfPublicUrl(A, "https://bhbinternational.school");
assert.ok(url && url.startsWith("https://bhbinternational.school/api/fees/receipt-pdf/"));
assert.match(url!, /[?&]exp=\d+/);
assert.match(url!, /[?&]sig=/);

console.log("  ok — the family is whole, the variables keep their order, and the PDF link is narrow");
