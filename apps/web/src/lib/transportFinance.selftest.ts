/**
 * Self-test: Transport → Finance from the books (14 Oct 2026) — which
 * months' EMIs are not posted, loan summaries, vehicle-paper expiry, and the
 * renewal-fee voucher lines.
 * Run: npx tsx src/lib/transportFinance.selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addMonths,
  currentDocsFor,
  dueDateIn,
  expiryStatus,
  fyBounds,
  isVehicleLoanAccount,
  missingEmiMonths,
  nextEmiDue,
  normalizeLoanLinks,
  normalizeVehicleDocs,
  pickVehicleDocExpenseAccount,
  summarizeLoan,
  validateVehicleDocInput,
  vehicleDocAlerts,
  vehicleDocFeeLines,
  type LoanVoucherRow,
  type VehicleDoc,
} from "./transportFinance";

console.log("transportFinance.selftest.ts");

/* ── dates ── */
assert.equal(addMonths("2026-12", 1), "2027-01");
assert.equal(addMonths("2026-01", -1), "2025-12");
assert.equal(dueDateIn("2026-02", 31), "2026-02-28");
assert.equal(dueDateIn("2026-09", 10), "2026-09-10");
assert.deepEqual(fyBounds("2026-10-14"), { code: "FY2026-27", from: "2026-04-01", to: "2027-03-31" });
assert.deepEqual(fyBounds("2027-02-01").code, "FY2026-27");
assert.deepEqual(fyBounds("2026-03-31").code, "FY2025-26");

/* ── missing EMI months: the production case (opening 31 Mar, Apr–Aug posted, today 14 Oct) ── */
const posted = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
assert.deepEqual(missingEmiMonths({ anchorMonth: "2026-03", postedMonths: posted, today: "2026-10-14", dueDay: 10 }), ["2026-09", "2026-10"]);
// On the 10th itself the month is not yet missed; on the 9th neither.
assert.deepEqual(missingEmiMonths({ anchorMonth: "2026-03", postedMonths: posted, today: "2026-10-10", dueDay: 10 }), ["2026-09"]);
assert.deepEqual(missingEmiMonths({ anchorMonth: "2026-03", postedMonths: posted, today: "2026-10-09", dueDay: 10 }), ["2026-09"]);
assert.deepEqual(missingEmiMonths({ anchorMonth: "2026-03", postedMonths: posted, today: "2026-09-10", dueDay: 10 }), []);
// A hole in the middle is missing too.
assert.deepEqual(
  missingEmiMonths({ anchorMonth: "2026-03", postedMonths: ["2026-04", "2026-05", "2026-07", "2026-08"], today: "2026-08-20", dueDay: 10 }),
  ["2026-06"],
);
// Across a year end.
assert.deepEqual(missingEmiMonths({ anchorMonth: "2026-11", postedMonths: [], today: "2027-01-15", dueDay: 10 }), ["2026-12", "2027-01"]);
// Bad input: nothing, never a runaway list.
assert.deepEqual(missingEmiMonths({ anchorMonth: "", postedMonths: [], today: "2026-10-14", dueDay: 10 }), []);
assert.deepEqual(missingEmiMonths({ anchorMonth: "2026-03", postedMonths: [], today: "not a date", dueDay: 10 }), []);

/* ── next due ── */
assert.equal(nextEmiDue({ postedMonths: posted, today: "2026-10-14", dueDay: 10 }), "2026-11-10");
assert.equal(nextEmiDue({ postedMonths: posted, today: "2026-10-05", dueDay: 10 }), "2026-10-10");
assert.equal(nextEmiDue({ postedMonths: [...posted, "2026-10"], today: "2026-10-05", dueDay: 10 }), "2026-11-10");

/* ── a loan from the book: opening JV + EMIs, one reversed and re-posted ── */
const row = (o: Partial<LoanVoucherRow>): LoanVoucherRow => ({
  voucherId: o.voucherNo ?? "v",
  voucherNo: "v",
  voucherType: "payment",
  date: "2026-04-10",
  debitPaise: 0,
  creditPaise: 0,
  interestPaise: 0,
  cancelled: false,
  ...o,
});
const rows: LoanVoucherRow[] = [
  row({ voucherNo: "JV/FY2025-26/00009", voucherType: "journal", date: "2026-03-31", creditPaise: 59_119_427 }),
  row({ voucherNo: "PY/1", date: "2026-04-10", debitPaise: 2_168_547, interestPaise: 631_053 }),
  row({ voucherNo: "PY/2", date: "2026-05-10", debitPaise: 2_211_304, interestPaise: 588_296 }),
  // Posted twice by mistake, then voided: the pair nets out and is not an EMI.
  row({ voucherNo: "PY/X", date: "2026-05-11", debitPaise: 2_211_304, interestPaise: 588_296, cancelled: true }),
  row({ voucherNo: "RV/1", voucherType: "reversal", date: "2026-05-12", creditPaise: 2_211_304, cancelled: true }),
  row({ voucherNo: "PY/3", date: "2026-06-10", debitPaise: 2_254_000, interestPaise: 545_600 }),
];
const s = summarizeLoan({ rows, today: "2026-10-14", dueDay: 10 });
assert.equal(s.outstandingPaise, 59_119_427 - 2_168_547 - 2_211_304 - 2_254_000);
assert.equal(s.principalThisFyPaise, 2_168_547 + 2_211_304 + 2_254_000);
assert.equal(s.interestThisFyPaise, 631_053 + 588_296 + 545_600);
assert.equal(s.emiCount, 3);
assert.equal(s.lastEmi?.voucherNo, "PY/3");
assert.equal(s.lastEmiTotalPaise, 2_254_000 + 545_600);
assert.equal(s.anchorMonth, "2026-03");
assert.deepEqual(s.missingMonths, ["2026-07", "2026-08", "2026-09", "2026-10"]);
assert.equal(s.nextDueOn, "2026-11-10");
// Interest of a previous FY is not "this FY".
const prevFy = summarizeLoan({ rows: [row({ date: "2026-03-01", voucherType: "opening", creditPaise: 100 }), row({ voucherNo: "PY/0", date: "2026-03-10", debitPaise: 10, interestPaise: 5 })], today: "2026-04-05", dueDay: 10 });
assert.equal(prevFy.principalThisFyPaise, 0);
assert.equal(prevFy.interestThisFyPaise, 0);
assert.deepEqual(prevFy.missingMonths, []);
// Repaid: no flags, no next due.
const repaid = summarizeLoan({ rows: [row({ voucherType: "journal", date: "2026-03-31", creditPaise: 100 }), row({ voucherNo: "PY/9", date: "2026-04-10", debitPaise: 100 })], today: "2026-10-14", dueDay: 10 });
assert.equal(repaid.outstandingPaise, 0);
assert.deepEqual(repaid.missingMonths, []);
assert.equal(repaid.nextDueOn, "");

/* ── which accounts are vehicle loans ── */
const none = new Set<string>();
assert.ok(isVehicleLoanAccount({ code: "2150", name: "Vehicle Loan — TATA Marco Polo Bus (Mahindra 10876691)", kind: "liability", parentCode: "2" }, none));
assert.ok(!isVehicleLoanAccount({ code: "2100", name: "Owner / Trustee Loans", kind: "liability", parentCode: "2" }, none));
assert.ok(!isVehicleLoanAccount({ code: "1950", name: "Suspense — Vehicles Pending Valuation", kind: "asset", parentCode: "1" }, none));
assert.ok(!isVehicleLoanAccount({ code: "2", name: "Vehicle loans", kind: "liability", parentCode: "" }, none), "a heading is not a loan");
assert.ok(!isVehicleLoanAccount({ code: "2150", name: "Vehicle Loan — x", kind: "liability", parentCode: "2", isActive: false }, none));
assert.ok(isVehicleLoanAccount({ code: "2160", name: "HDFC term finance", kind: "liability", parentCode: "2" }, new Set(["2160"])), "a linked liability is a loan whatever its name");
assert.ok(!isVehicleLoanAccount({ code: "5090", name: "Interest Expense", kind: "expense", parentCode: "5" }, new Set(["5090"])), "only liabilities");

/* ── loan links normalise ── */
const links = normalizeLoanLinks({ links: { "2150": { vehicleId: "veh_x", emiDueDay: 99, paidBy: "Bank NACH" }, "": {} } });
assert.deepEqual(Object.keys(links.links), ["2150"]);
assert.equal(links.links["2150"]!.emiDueDay, 10, "an impossible day falls back to the 10th");

/* ── expiry ── */
assert.equal(expiryStatus("2026-10-13", "2026-10-14").status, "expired");
assert.equal(expiryStatus("2026-10-14", "2026-10-14").status, "due", "valid till today is still valid");
assert.equal(expiryStatus("2026-11-13", "2026-10-14").status, "due");
assert.equal(expiryStatus("2026-11-13", "2026-10-14").daysLeft, 30);
assert.equal(expiryStatus("2026-11-14", "2026-10-14").status, "ok");
assert.equal(expiryStatus("", "2026-10-14").status, "missing");
assert.equal(expiryStatus("2026-02-30", "2026-10-14").status, "missing", "an impossible date is not a date");

/* ── current paper per type, and alerts ── */
const doc = (o: Partial<VehicleDoc>): VehicleDoc => ({
  id: "d", vehicleId: "bus1", type: "puc", number: "", issuedOn: "", expiresOn: "2026-12-01", feePaise: 0, insurer: "", policyNo: "",
  fileUrl: "", fileName: "", note: "", status: "active", voidReason: "", fee: null, createdAt: "2026-01-01", createdBy: "", updatedAt: "", updatedBy: "",
  ...o,
});
const docs = [
  doc({ id: "p1", expiresOn: "2026-10-01" }),
  doc({ id: "p2", expiresOn: "2027-04-01" }), // the renewal
  doc({ id: "p3", expiresOn: "2028-01-01", status: "void" }), // voided — never current
  doc({ id: "i1", type: "insurance", expiresOn: "2026-10-20" }),
  doc({ id: "f1", type: "fitness", expiresOn: "2026-09-30", vehicleId: "van1" }),
];
const cur = currentDocsFor(docs, "bus1");
assert.equal(cur.puc?.id, "p2");
assert.equal(cur.insurance?.id, "i1");
assert.equal(cur.fitness, undefined);
const alerts = vehicleDocAlerts(docs, [{ id: "bus1", label: "City Bus" }, { id: "van1", label: "Magic-1" }], "2026-10-14");
assert.deepEqual(alerts.map((a) => `${a.vehicleLabel}:${a.type}:${a.status}`), ["Magic-1:fitness:expired", "City Bus:insurance:due"]);

/* ── normalise drops junk and duplicates ── */
const n = normalizeVehicleDocs({ docs: [doc({ id: "a" }), doc({ id: "a" }), { id: "b", type: "nonsense" }, null] });
assert.equal(n.docs.length, 1);

/* ── input validation ── */
const known = new Set(["bus1"]);
assert.ok(!validateVehicleDocInput({ vehicleId: "ghost", type: "puc", expiresOn: "2027-01-01" }, known).ok);
assert.ok(!validateVehicleDocInput({ vehicleId: "bus1", type: "puc", expiresOn: "" }, known).ok);
assert.ok(!validateVehicleDocInput({ vehicleId: "bus1", type: "puc", issuedOn: "2027-02-01", expiresOn: "2027-01-01" }, known).ok);
assert.ok(!validateVehicleDocInput({ vehicleId: "bus1", type: "puc", expiresOn: "2027-01-01", fileUrl: "https://evil.example/x.pdf" }, known).ok, "only our uploads");
const okIn = validateVehicleDocInput({ vehicleId: "bus1", type: "puc", expiresOn: "2027-01-01", insurer: "should drop", feePaise: 40000, fileUrl: "/api/file/transport/x.pdf" }, known);
assert.ok(okIn.ok && okIn.input.insurer === "" && okIn.input.feePaise === 40000);

/* ── fee → books ── */
const chart = [
  { code: "5031", name: "Vehicle Fuel", kind: "expense" },
  { code: "5032", name: "Vehicle Repair & Maintenance", kind: "expense" },
  { code: "5033", name: "Vehicle Insurance & Permits", kind: "expense" },
  { code: "5900", name: "Other Expenses", kind: "expense" },
];
assert.equal(pickVehicleDocExpenseAccount(chart)?.code, "5033");
assert.equal(pickVehicleDocExpenseAccount([{ code: "5033", name: "Vehicle Insurance & Permits", kind: "expense", hasChildren: true }]), null, "a heading with sub-heads is never posted to");
assert.equal(pickVehicleDocExpenseAccount([{ code: "5040", name: "Office Insurance", kind: "expense" }]), null, "not a vehicle head");

const cash = vehicleDocFeeLines({ feePaise: 40000, expenseCode: "5033", mode: "cash", cashCode: "1000", narration: "PUC", date: "2026-10-14" });
assert.ok(cash.ok);
if (cash.ok) {
  assert.deepEqual(cash.lines.map((l) => [l.accountCode, l.debitPaise, l.creditPaise]), [["5033", 40000, 0], ["1000", 0, 40000]]);
}
const bank = vehicleDocFeeLines({ feePaise: 185_000_00, expenseCode: "5033", mode: "bank", cashCode: "1000", bankCode: "1012", bankAccountId: "ba_ubi", narration: "Insurance", date: "2026-10-14" });
assert.ok(bank.ok && bank.lines[1]!.subledgerKind === "bank_account" && bank.lines[1]!.subledgerId === "ba_ubi");
assert.ok(!vehicleDocFeeLines({ feePaise: 100, expenseCode: "5033", mode: "bank", cashCode: "1000", narration: "", date: "2026-10-14" }).ok, "bank needs a bank");
assert.ok(!vehicleDocFeeLines({ feePaise: 0, expenseCode: "5033", mode: "cash", cashCode: "1000", narration: "", date: "2026-10-14" }).ok);

/* ── wiring: the demo/desk-only forms are gone and the routes are gated ── */
const root = join(__dirname, "..");
const panels = readFileSync(join(root, "components/transport/TransportFleetPanels.tsx"), "utf8");
assert.ok(!panels.includes("Add sample policy"), "the demo insurance button is gone");
assert.ok(!/createVehicleLoan\(/.test(panels), "the desk-only loan form is gone");
assert.ok(!/recordCertificateRenewal\(/.test(panels), "the desk-only certificate form is gone");
const loansRoute = readFileSync(join(root, "app/api/transport/vehicle-loans/route.ts"), "utf8");
assert.ok(/requireStaffPermission\(req, "accounts", "view"\)/.test(loansRoute) && /requireStaffPermission\(req, "accounts_position", "view"\)/.test(loansRoute), "loan balances need accounts + position view");
assert.ok(/requireStaffPermission\(req, "accounts", "edit"\)/.test(loansRoute), "linking needs accounts edit");
assert.ok(!/ledgerPost/.test(loansRoute), "the loans route never posts");
const docsRoute = readFileSync(join(root, "app/api/transport/vehicle-docs/route.ts"), "utf8");
assert.ok(/"post-fee"[\s\S]*requireStaffPermission\(req, "accounts", "edit"\)/.test(docsRoute), "booking a fee needs accounts edit");
const registry = readFileSync(join(root, "lib/moduleStateRegistry.ts"), "utf8");
assert.ok(!registry.includes("transport_vehicle_docs") && !registry.includes("transport_loan_links"), "no browser route may write the stores");

console.log("ok");
