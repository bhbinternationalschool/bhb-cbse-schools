/**
 * Run: npx tsx src/lib/libraryFine.selftest.ts
 *
 * The library late fine and the counter's pure pieces (11 Oct 2026). The
 * rules worth pinning: grace days forgive the first late days, the cap is a
 * ceiling, a date nobody can read is an ERROR (never a ₹0 fine), a fine is
 * settled once, and a double scan never issues the same copy twice.
 */
import assert from "node:assert/strict";
import { canSettleFine, computeLateFine, initialFineStatus, isoDayNumber, validateFineRule } from "./libraryFine";
import {
  dueDateFor,
  fineDebitAccount,
  fineToDate,
  LIBRARY_FINE_INCOME_ACCOUNT,
  normalizeAccessionCode,
  splitScannedCodes,
  borrowerKey,
} from "./libraryCounter";
import { labelPosition, LABEL_SHEET } from "./libraryLabelsPdf";
import { bookCirculation, copyLocation, emptyLibraryState, searchCopies, type LibraryState } from "./library";

console.log("libraryFine.selftest.ts");

const RULE = { finePaisePerDay: 200, graceDays: 2, capPaise: 1000 };

// ── computeLateFine ──────────────────────────────────────────────────
{
  const onTime = computeLateFine(RULE, "2026-10-10", "2026-10-10");
  assert.ok(onTime.ok && onTime.finePaise === 0 && onTime.daysLate === 0, "on time owes nothing");

  const early = computeLateFine(RULE, "2026-10-10", "2026-10-05");
  assert.ok(early.ok && early.finePaise === 0 && early.daysLate === 0, "early owes nothing, never negative");

  const inGrace = computeLateFine(RULE, "2026-10-10", "2026-10-12");
  assert.ok(inGrace.ok && inGrace.daysLate === 2 && inGrace.chargeableDays === 0 && inGrace.finePaise === 0, "within grace owes nothing");

  const past = computeLateFine(RULE, "2026-10-10", "2026-10-15");
  assert.ok(past.ok && past.daysLate === 5 && past.chargeableDays === 3 && past.finePaise === 600 && !past.capped, "grace forgives the first days only");

  const capped = computeLateFine(RULE, "2026-10-10", "2026-11-30");
  assert.ok(capped.ok && capped.finePaise === 1000 && capped.capped, "cap is a ceiling");

  const noCap = computeLateFine({ ...RULE, capPaise: 0 }, "2026-10-10", "2026-11-30");
  assert.ok(noCap.ok && noCap.finePaise === (51 - 2) * 200 && !noCap.capped, "cap 0 = no cap");

  const monthEdge = computeLateFine({ finePaisePerDay: 100, graceDays: 0, capPaise: 0 }, "2026-02-28", "2026-03-02");
  assert.ok(monthEdge.ok && monthEdge.daysLate === 2, "counts calendar days across month ends");

  const free = computeLateFine({ finePaisePerDay: 0, graceDays: 0, capPaise: 0 }, "2026-10-01", "2026-10-30");
  assert.ok(free.ok && free.finePaise === 0 && free.daysLate === 29, "a school with no fine still sees days late");

  // Unknown never becomes zero.
  const badDue = computeLateFine(RULE, "", "2026-10-15");
  assert.equal(badDue.ok, false, "blank due date is an error, not ₹0");
  const badBack = computeLateFine(RULE, "2026-10-10", "2026-02-30");
  assert.equal(badBack.ok, false, "impossible date is an error");
  const badRule = computeLateFine({ finePaisePerDay: -5, graceDays: 0, capPaise: 0 }, "2026-10-10", "2026-10-15");
  assert.equal(badRule.ok, false, "negative rate refused");
  assert.equal(validateFineRule({ finePaisePerDay: 100, graceDays: 1.5, capPaise: 0 }).ok, false, "fractional grace refused");
  assert.equal(isoDayNumber("2026-13-01"), null);
}

// ── settling ─────────────────────────────────────────────────────────
{
  assert.equal(initialFineStatus(0), "none");
  assert.equal(initialFineStatus(600), "pending");
  assert.ok(canSettleFine("pending", 600).ok, "a pending fine can be settled");
  assert.equal(canSettleFine("collected", 600).ok, false, "collected once only");
  assert.equal(canSettleFine("waived", 600).ok, false, "a waived fine is not collected later");
  assert.equal(canSettleFine("none", 0).ok, false, "nothing to settle");
  assert.equal(canSettleFine("pending", 0).ok, false, "no zero-rupee receipts");

  assert.equal(fineDebitAccount("cash"), "1000", "cash lands in Cash in Hand");
  assert.equal(fineDebitAccount("upi"), "1010", "UPI lands in the bank");
  assert.equal(fineDebitAccount("cheque"), null, "a mode we do not take is refused, not guessed");
  assert.equal(LIBRARY_FINE_INCOME_ACCOUNT, "4100", "credited to Other Income, not fee income");
}

// ── counter input ────────────────────────────────────────────────────
{
  const s = splitScannedCodes("ACC-000001\nACC-000002\r\nacc-000001, ACC-000003  bad*code");
  assert.deepEqual(s.codes, ["ACC-000001", "ACC-000002", "ACC-000003"], "double scans dropped, order kept");
  assert.deepEqual(s.rejected, ["bad*code"], "junk reported, not ignored");
  assert.equal(normalizeAccessionCode("  PANCH-0001 "), "PANCH-0001");
  assert.equal(normalizeAccessionCode("a,b"), null, "commas cannot reach a query filter");
  assert.equal(dueDateFor("2026-10-25", 14), "2026-11-08");
  assert.equal(dueDateFor("not-a-date", 14), null);
  assert.equal(borrowerKey({ type: "staff", id: "s9" }), "staff:s9");
  assert.equal(borrowerKey({ type: "student", id: "st1" }), "st1");

  assert.equal(fineToDate(RULE, { dueOn: "2026-10-01" }, "2026-10-06"), 600);
  assert.equal(fineToDate(RULE, { dueOn: "2026-10-01", returnedOn: "2026-10-03" }, "2026-10-06"), null, "returned loans have no fine to date");
  assert.equal(fineToDate(RULE, { dueOn: "" }, "2026-10-06"), null, "unreadable due date shows ?, not ₹0");
}

// ── labels ───────────────────────────────────────────────────────────
{
  const first = labelPosition(0);
  const last = labelPosition(23);
  const next = labelPosition(24);
  assert.equal(first.page, 0);
  assert.equal(last.page, 0);
  assert.equal(next.page, 1, "25th label starts a new sheet");
  assert.deepEqual([next.x, next.y], [first.x, first.y]);
  assert.ok(last.x + LABEL_SHEET.labelW <= LABEL_SHEET.pageW && last.y + LABEL_SHEET.labelH <= LABEL_SHEET.pageH, "labels stay on the sheet");
}

// ── search and circulation ───────────────────────────────────────────
{
  const state: LibraryState = {
    ...emptyLibraryState(),
    titles: [
      { id: "t1", isbn: "", title: "Panchatantra", author: "Vishnu Sharma", publisher: "", edition: "", category: "book", shelf: "A1", purchaseDate: "", pricePaise: 0, copiesTotal: 2, isActive: true },
      { id: "t2", isbn: "", title: "Wings of Fire", author: "A P J Abdul Kalam", publisher: "", edition: "", category: "book", shelf: "B2", purchaseDate: "", pricePaise: 0, copiesTotal: 1, isActive: true },
    ],
    copies: [
      { id: "c1", titleId: "t1", accessionNo: "ACC-000001", barcode: "ACC-000001", status: "issued", location: "Rack 3" },
      { id: "c2", titleId: "t1", accessionNo: "ACC-000002", barcode: "ACC-000002", status: "available" },
      { id: "c3", titleId: "t2", accessionNo: "ACC-000003", barcode: "ACC-000003", status: "available" },
    ],
    issues: [
      { id: "i1", copyId: "c1", borrowerType: "student", studentId: "st1", staffId: "", academicYearCode: "2026-27", issuedOn: "2026-10-01", dueOn: "2026-10-15", finePaise: 0, issuedBy: "", note: "", issueCondition: "good", damageNoteOnIssue: "", damageNoteOnReturn: "" },
      { id: "i2", copyId: "c2", borrowerType: "student", studentId: "st2", staffId: "", academicYearCode: "2026-27", issuedOn: "2026-09-01", dueOn: "2026-09-15", returnedOn: "2026-09-10", finePaise: 0, issuedBy: "", note: "", issueCondition: "good", damageNoteOnIssue: "", damageNoteOnReturn: "" },
    ],
  };
  assert.equal(copyLocation(state.copies[0]!, state), "Rack 3", "a copy's own location wins");
  assert.equal(copyLocation(state.copies[1]!, state), "A1", "else its title's rack");
  assert.deepEqual(searchCopies(state, "kalam").map((c) => c.id), ["c3"], "search by author");
  assert.deepEqual(searchCopies(state, "000002").map((c) => c.id), ["c2"], "search by accession");
  assert.deepEqual(searchCopies(state, "rack 3").map((c) => c.id), ["c1"], "search by location");
  assert.deepEqual(searchCopies(state, "", "A1").map((c) => c.id), ["c2"], "filter by location");

  const circ = bookCirculation(state, "2026-09-01", "2026-10-31");
  const p = circ.find((r) => r.titleId === "t1")!;
  assert.equal(p.issues, 2);
  assert.equal(p.out, 1);
  assert.equal(p.copies, 2);
  assert.equal(p.lastIssued, "2026-10-01");
  assert.equal(circ[0]!.titleId, "t1", "most-issued first");
}

console.log("  ok");
