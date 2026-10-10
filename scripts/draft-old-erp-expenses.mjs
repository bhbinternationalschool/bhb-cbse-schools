/**
 * Turn the old ERP's expense report into vouchers — as a FILE, not as postings.
 *
 * Nothing here touches the ledger. It reads the parsed report and writes every
 * voucher it would create, so the whole import can be read and corrected on
 * paper before a single rupee is posted. That order matters: 171 vouchers
 * entered wrongly are 171 reversals, and the reversals show up in the books
 * for ever.
 *
 * Rows the mapping cannot settle are written as UNRESOLVED with the amount and
 * the reason, rather than guessed at. A draft that quietly picks a head for
 * something it does not understand is worse than one that says so.
 *
 *   node scripts/draft-old-erp-expenses.mjs > draft.txt
 */

import { readFileSync } from "node:fs";

const SRC = process.argv[2] ??
  "/private/tmp/claude-501/-Users-ashishsingh-CBSE-Schools/8ab210d5-fd8a-4352-8f47-602ae7d41429/scratchpad/exp.json";

/** Confirmed by the director: every UPI payment left the Union Bank account. */
const BANK_UPI = { code: "1012", name: "UBI -Main · Union Bank of India 5371" };
const CASH = { code: "1000", name: "Cash in Hand" };

const A = {
  salary:    { code: "5070",    name: "Salary & Wages" },
  advances:  { code: "1070",    name: "Staff Advances" },
  pf:        { code: "2320",    name: "Provident Fund Payable" },
  esi:       { code: "2330",    name: "ESI Payable" },
  trustee:   { code: "2100",    name: "Owner / Trustee Loans" },
  refresh:   { code: "5000",    name: "Refreshment" },
  fuel:      { code: "5031",    name: "Vehicle Fuel" },
  office:    { code: "5040",    name: "Office Expenses" },
  /* Heads that do NOT exist yet. Marked NEW so nothing is silently invented —
     each has to be created in Masters before the import can run. */
  upkeep:    { code: "5010",    name: "Repairs & Maintenance (building)", isNew: true },
  welfare:   { code: "5011",    name: "Student Welfare", isNew: true },
  advert:    { code: "5012",    name: "Advertising & Publicity", isNew: true },
  commission:{ code: "5013",    name: "Admission Commission", isNew: true },
  payable:   { code: "2000",    name: "Accounts Payable" },
  duties:    { code: "2300",    name: "Statutory Dues" },
  corpus:    { code: "3000",    name: "Corpus / Trust Fund" },
};

/**
 * Opening balances at 31-Mar-2026, chained from three of the old ERP's own
 * trial balances.
 *
 * None of those trial balances carries an opening balance — each records only
 * that year's movement — so the position had to be built by adding them in
 * order: 2024-25 (which balances exactly, and in which the trustee does not
 * appear at all), then 2025-26, then this year. That chain is why the trustee
 * figure is 4,27,184 and not zero, and why the account was already overdrawn
 * on the first day of April.
 *
 * The corpus figure is the balancing entry. The old ERP had no capital account
 * of any kind, which is the reason its trial balances do not balance; a ledger
 * without one cannot state what the trust is actually worth.
 */
const OPENING = {
  date: "2026-03-31",
  lines: [
    ["Dr", A.cashInHand ?? CASH,      80809.75, "cash in hand, chained 2024-25 + 2025-26"],
    ["Dr", BANK_UPI,                  96194.02, "bank, chained 2024-25 + 2025-26"],
    ["Dr", A.advances,                41745.00, "from the advance ledger, not the trial balance"],
    ["Dr", A.trustee,                427184.00, "party: Ashish Singh — already owed to the trust"],
    ["Dr", A.duties,                 218758.00, "debit balance carried in the old ERP"],
    ["Cr", A.payable,                451044.99, "sundry creditors at 31-Mar-2026"],
    ["Cr", A.corpus,                 413645.78, "balancing figure — the old ERP had no capital account"],
  ],
};

/** Sub-labels whose head is not in doubt. Everything else is asked about. */
const HEAD = new Map([
  ["Refreshment",     A.refresh],
  ["CNG-Magic 2024",  A.fuel],
  ["CNG-Magic 2026",  A.fuel],
  ["Misllaneous",     A.office],   // the old ERP's spelling, kept verbatim
  ["Stationary",      A.office],
  // Confirmed by the director: electrical, plumbing and the like — building
  // upkeep, NOT the vehicle head. The file records only "MAINTAINENCE" with no
  // type, so every line lands on the parent; sub-heads can come later for
  // entries that actually say which trade.
  ["MAINTAINENCE",    A.upkeep],
  // Confirmed: student welfare.
  ["Welfare",         A.welfare],
  ["Advertisement Related", A.advert],
  /* Named people the director has identified. Each was ambiguous between
     wages, an advance and a reimbursement — three different accounts — so
     none was guessed. */
  ["SHYAM SUNDER",    A.salary],      // driver — this is his pay
  ["Vimal Driver",    A.salary],      // driver — pay
  ["SURAJ KUMAR",     A.commission],  // commission on an admission
  ["Vinay Kushwaha",  A.office],      // former staff, given a float for office spending
]);

/** Named in the report but not yet mapped — each is a question, not a guess. */
const UNRESOLVED = new Map([
  ["Puja Items",           "school function, or student welfare (5011)?"],
  ["Anjani Mam",           "narration says 'salary', same shape as Vimal — confirm it is pay"],
  ["VISHNU OM Tripathi",   "wages, advance or reimbursement?"],
  ["VISHAL MISHRA",        "wages, advance or reimbursement?"],
  ["Ravindra Yadav",       "he is on payroll — is this extra pay, or a reimbursement?"],
  ["Prathamesh Infotech",  "a company, not a person — IT service? which head?"],
  ["DEVENDRA KUMAR PANDEY","part of the 'Faulted July salary' — a correction, not new cost?"],
  ["PRASHANT DEV",         "part of the 'Faulted July salary' — a correction, not new cost?"],
  ["Advance Payment",      "a bare ₹50 line with no context"],
]);

/**
 * Lines that must NOT be imported, because our system already holds them.
 *
 * Peerson Books ₹1,23,000 on 07-Apr is a payment against bill
 * BILL/2026-27/0004, already recorded in inv_vendor_payments on that date for
 * that amount in cash. Posting it again would pay the vendor twice in the
 * books and drop their outstanding by ₹1,23,000 too far.
 */
const ALREADY_OURS = new Map([
  ["Peerson Books", "already in the store as a vendor payment on 07-Apr-2026 against BILL/2026-27/0004"],
]);

const MONTH = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
const iso = (d) => {
  const [dd, mm, yy] = d.split("-");
  return `${yy}-${String(MONTH[mm]).padStart(2, "0")}-${String(+dd).padStart(2, "0")}`;
};
const inr = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const rows = JSON.parse(readFileSync(SRC, "utf8"))
  .map((r) => ({ ...r, lines: (r.lines ?? []).filter((l) => l.label !== "Total") }));

const pay = (r) => (r.ledger === "UPI" ? BANK_UPI : CASH);

function classify(r) {
  const n = (r.narr ?? "").trim();
  if (n.startsWith("Salary Payment of") || (!n && r.lines.some((l) => /\(Earning\)|\(Deduction\)/.test(l.label)))) return "salary";
  if (n.startsWith("Extra/Advance")) return "advance";
  if (n === "City Office") return "trustee";
  return "expense";
}

/* ── voucher builders ─────────────────────────────────────── */

function salaryVoucher(r) {
  const L = [];
  let earn = 0, absent = 0, pf = 0, esi = 0, advTaken = 0, advGiven = 0;
  for (const l of r.lines) {
    const a = Math.abs(l.amount);
    if (/^ESI/.test(l.label)) esi += a;
    else if (/^EPF\(Deduction\)/.test(l.label)) pf += a;
    else if (/^EPF Employer/.test(l.label)) earn += a;      // employer cost — question 7
    else if (/^Absent Deduction/.test(l.label)) absent += a;
    else if (/^Advance Payment Deduction/.test(l.label)) advTaken += a;
    else if (/^Advance Payment\(Earning\)/.test(l.label)) advGiven += a;
    else if (/\(Earning\)$/.test(l.label)) earn += a;
  }
  const cost = earn - absent;
  if (cost > 0) L.push(["Dr", A.salary, cost, "gross earned, net of absence"]);
  if (advGiven > 0) L.push(["Dr", A.advances, advGiven, "advance paid with the salary"]);
  if (pf > 0) L.push(["Cr", A.pf, pf, "employee PF withheld"]);
  if (esi > 0) L.push(["Cr", A.esi, esi, "employee ESI withheld"]);
  if (advTaken > 0) L.push(["Cr", A.advances, advTaken, "advance recovered"]);
  L.push(["Cr", pay(r), r.amount, "net paid"]);
  return L;
}

function trusteeVoucher(r) {
  return [
    ["Dr", A.trustee, r.amount, "party: Ashish Singh — taken from the trust"],
    ["Cr", pay(r), r.amount, ""],
  ];
}

function advanceVoucher(r) {
  const who = (r.narr.match(/Payment of (.+?) for the month/) ?? [, "?"])[1];
  return [
    ["Dr", A.advances, r.amount, `party: ${who}`],
    ["Cr", pay(r), r.amount, ""],
  ];
}

function expenseVoucher(r) {
  const L = [];
  const asks = [];
  const skips = [];
  for (const l of r.lines) {
    const head = HEAD.get(l.label);
    if (head) { L.push(["Dr", head, l.amount, l.label]); continue; }
    if (ALREADY_OURS.has(l.label)) { skips.push([l.label, l.amount, ALREADY_OURS.get(l.label)]); continue; }
    if (UNRESOLVED.has(l.label)) { asks.push([l.label, l.amount, UNRESOLVED.get(l.label)]); continue; }

    asks.push([l.label, l.amount, "label not recognised"]);
  }
  if (L.length) L.push(["Cr", pay(r), L.reduce((s, x) => s + x[2], 0), ""]);
  return { L, asks, skips };
}

/* ── render ───────────────────────────────────────────────── */

const tally = { salary: 0, advance: 0, trustee: 0, expense: 0, unresolved: 0, skipped: 0 };
const counts = { salary: 0, advance: 0, trustee: 0, expense: 0, unresolved: 0, skipped: 0 };

console.log("DRAFT — old ERP expenses, 01 Apr to 03 Sep 2026");
console.log("NOTHING POSTED. Every voucher below is a proposal.\n");
console.log(`UPI payments are credited to ${BANK_UPI.code} ${BANK_UPI.name}`);
console.log(`Cash payments are credited to ${CASH.code} ${CASH.name}\n`);
console.log("=".repeat(78));
console.log("\nSTEP 2 — OPENING BALANCES  (one journal, dated " + OPENING.date + ")\n");
let od = 0, oc = 0;
for (const [dc, acct, amt, why] of OPENING.lines) {
  console.log(`    ${dc}  ${acct.code.padEnd(6)} ${acct.name.padEnd(34)} ${inr(amt).padStart(13)}   ${why}`);
  if (dc === "Dr") od += amt; else oc += amt;
}
console.log(`    ${"".padEnd(45)}${"─".repeat(13)}`);
console.log(`    ${"balanced".padEnd(45)}${inr(od).padStart(13)} Dr   ${inr(oc)} Cr`);
console.log("\n" + "=".repeat(78));
console.log("\nSTEPS 3-4 — THE VOUCHERS, IN DATE ORDER\n");

for (const r of [...rows].sort((a, b) => iso(a.date).localeCompare(iso(b.date)))) {
  const kind = classify(r);
  const head = `${iso(r.date)}  ${r.ledger.padEnd(5)} rcpt ${String(r.receipt).padEnd(5)} ${kind.toUpperCase()}`;
  let lines = [], asks = [], skips = [];
  if (kind === "salary") lines = salaryVoucher(r);
  else if (kind === "trustee") lines = trusteeVoucher(r);
  else if (kind === "advance") lines = advanceVoucher(r);
  else ({ L: lines, asks, skips } = expenseVoucher(r));

  console.log(`\n${head}`);
  console.log(`  ${(r.narr || "(no narration in the file)").slice(0, 72)}`);
  for (const [dc, acct, amt, why] of lines) {
    const tag = acct.isNew ? " [NEW HEAD]" : "";
    console.log(`    ${dc}  ${acct.code.padEnd(6)} ${(acct.name + tag).padEnd(42)} ${inr(amt).padStart(12)}${why ? "   " + why : ""}`);
  }
  for (const [label, amt, why] of skips) {
    console.log(`    --  ------ ${label.padEnd(30)} ${inr(amt).padStart(12)}   SKIPPED: ${why}`);
    tally.skipped += amt; counts.skipped += 1;
  }
  for (const [label, amt, why] of asks) {
    console.log(`    ??  ------ ${label.padEnd(30)} ${inr(amt).padStart(12)}   UNRESOLVED: ${why}`);
    tally.unresolved += amt; counts.unresolved += 1;
  }
  const posted = lines.filter((l) => l[0] === "Dr").reduce((s, x) => s + x[2], 0);
  tally[kind] += kind === "salary" ? r.amount : posted;
  counts[kind] += 1;
}

console.log("\n" + "=".repeat(78));
console.log("SUMMARY");
for (const k of ["salary", "advance", "trustee", "expense"]) {
  console.log(`  ${k.padEnd(12)} ${String(counts[k]).padStart(4)} vouchers   ${inr(tally[k]).padStart(14)}`);
}
console.log(`  ${"SKIPPED".padEnd(12)} ${String(counts.skipped).padStart(4)} lines      ${inr(tally.skipped).padStart(14)}   <-- already in our system`);
console.log(`  ${"UNRESOLVED".padEnd(12)} ${String(counts.unresolved).padStart(4)} lines      ${inr(tally.unresolved).padStart(14)}   <-- needs your answer`);
console.log("\n  HEADS TO CREATE FIRST:");
for (const a of Object.values(A)) if (a.isNew) console.log(`    ${a.code}  ${a.name}`);
console.log(`\n  file total ${inr(rows.reduce((s, r) => s + r.amount, 0)).padStart(14)}`);
