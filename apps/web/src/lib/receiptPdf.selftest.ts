/**
 * Self-test: the server-rendered receipt PDF.
 * Run: npx tsx apps/web/src/lib/receiptPdf.selftest.ts
 */
import assert from "node:assert/strict";
import { receiptQrText, renderReceiptPdf, rupees, type ReceiptSchoolHeader } from "@/lib/receiptPdf.server";
import { readFileSync } from "node:fs";
import type { CollectionVoucher } from "@/lib/fees";

(async () => {
assert.equal(rupees(0), "Rs 0");
assert.equal(rupees(150000), "Rs 1,500");
assert.equal(rupees(12345678), "Rs 1,23,456");
assert.equal(rupees(-50000), "-Rs 500");

const voucher: CollectionVoucher = {
  id: "cv_test",
  receiptNo: "F/2026-27/0042",
  schoolReceiptNo: "",
  source: "counter",
  manualBookSeries: "",
  manualBookLeaf: "",
  householdId: "hh_1",
  academicYearCode: "2026-27",
  collectionDate: "2026-09-04",
  transactionDate: "2026-09-04",
  transactionId: "",
  collectedAt: "2026-09-04T06:00:00.000Z",
  cashierName: "Office",
  lines: [
    { dueKey: "a", studentId: "stu_1", studentName: "Amay", label: "Tuition Fee · Sep", kind: "installment", amountPaise: 150000 },
    { dueKey: "b", studentId: "stu_1", studentName: "Amay", label: "Transport · Sep", kind: "installment", amountPaise: 80000, concessionPaise: 20000 },
    { dueKey: "c", studentId: "stu_2", studentName: "Dipti", label: "Examination Fee · Sep", kind: "installment", amountPaise: 50000 },
  ],
  tenders: [
    { mode: "upi", amountPaise: 200000, ref: "UPI123", instrumentDate: "", bankName: "", realisation: "cleared", gatewayProvider: "cashfree" },
    { mode: "cheque", amountPaise: 80000, ref: "000123", instrumentDate: "2026-09-03", bankName: "UBI", realisation: "pending" },
  ],
  totalPaise: 280000,
  note: "Part payment",
  voidedAt: null,
  whatsappSentAt: null,
} as unknown as CollectionVoucher;

const school: ReceiptSchoolHeader = {
  logoPng: readFileSync("public/logo-crest.png"),
  phone: "+91 94519 38805",
  whatsapp: "+91 94519 38805",
  email: "office@bhbinternational.school",
  website: "bhbinternational.school",
  statutoryLine: "UDISE 09670312345",
};

const qr = receiptQrText(voucher, { householdCode: "HH-1", school });
assert.ok(qr.includes("Receipt F/2026-27/0042") && qr.includes("Rs 2,800") && qr.includes("Family HH-1"));
assert.ok(qr.length < 300, "the QR must stay scannable at receipt size");

const pdf = await renderReceiptPdf(voucher, {
  school,
  guardianName: "Mr. Test Parent",
  householdCode: "HH-1",
  studentLabel: (id, fallback) => (id === "stu_1" ? "AMAY SINGH · LKG-A" : fallback),
});
assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
assert.ok(pdf.length > 2000, "a receipt with three lines is not a near-empty file");
const text = pdf.toString("latin1");
assert.ok(text.includes("FEE RECEIPT"), "title present in the content stream");
assert.ok(text.includes("F/2026-27/0042"), "receipt number present");
assert.ok(text.includes("Rs 2,800"), "total present");
assert.ok(text.includes("subject to realisation"), "an uncleared cheque says so");
assert.ok(text.includes("office@bhbinternational.school"), "the office mailbox, not the director's");
assert.ok(text.includes("UDISE 09670312345"), "the statutory line is printed");
assert.ok(text.includes("WhatsApp +91 94519 38805"), "the bot number is printed");
assert.ok(pdf.length > 8000, "with a crest and a QR the file carries two images");

const voided = await renderReceiptPdf({ ...voucher, voidedAt: "2026-09-05T00:00:00.000Z" }, {
  school: { ...school, logoPng: null },
  guardianName: "", householdCode: "", studentLabel: (_, f) => f,
});
assert.ok(voided.toString("latin1").includes("VOID"), "a voided receipt is marked");

console.log("receiptPdf.selftest: ok");
})();
