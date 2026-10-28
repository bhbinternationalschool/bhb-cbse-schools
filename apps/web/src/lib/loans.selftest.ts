/**
 * Accounts → Loans (lib/loans.ts): the interest method against the real
 * Mahindra figures, which months are proposed, approval edits, idempotent
 * source ids, prepayments, top-ups, exports, and the route gates.
 *
 * Run: npx tsx src/lib/loans.selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  LOAN_EMI_SOURCE,
  LOAN_PREPAYMENT_SOURCE,
  SEED_LOAN_TERMS,
  TRUSTEE_ASHISH,
  TRUSTEE_LOAN_CODE,
  assignEmiMonths,
  bookingLines,
  computeLoan,
  effectiveTerms,
  emiApprovalProblem,
  emiLines,
  emiNarration,
  loanExportRows,
  loanRequestProblem,
  loanTotals,
  monthFromSourceId,
  nextLoanCode,
  normalizeLoanQueue,
  normalizeLoanTermsState,
  paidFromLabel,
  paidFromProblem,
  periodInterest,
  requestLines,
  rupees,
  startMonthFor,
  type LoanLedgerEntry,
  type LoanRequest,
  type LoanTerms,
} from "./loans";

console.log("loans.selftest.ts");

const terms = (code: string): LoanTerms => effectiveTerms(code, { loans: {} })!.terms;
const one = (bal: number, from: string, to: string, code: string) => {
  const t = terms(code);
  return periodInterest({ events: [{ date: "0000-01-01", deltaPaise: bal }], from, to, annualRatePct: t.annualRatePct, rounding: t.interestRounding });
};

/* ── 1. The three figures the director's lead checked by hand ───────────── */
{
  const a = one(177_822_357, "2026-08-10", "2026-09-10", "2150");
  assert.equal(a.days, 31);
  assert.equal(a.interestPaise, 1_530_896, "2150 Sep 10: 15,308.96 on 17,78,223.57 over 31 days");
  const b = one(69_245_700, "2026-09-10", "2026-10-10", "2153");
  assert.equal(b.days, 30);
  assert.equal(b.interestPaise, 671_600, "2153 Oct 10: 6,716 on 6,92,457 over 30 days at 11.8%");
  const c = one(72_600_000, "2026-08-31", "2026-10-10", "2154");
  assert.equal(c.days, 40);
  assert.equal(c.interestPaise, 954_700, "2154 Oct 10: 9,547 on 7,26,000 over 40 days at 12%");
}

/* ── 2. Every posted Apr–Oct 2026 EMI reproduced to the paisa ───────────── */
const REAL: Record<string, { opening: [string, number]; emis: [string, number, number][] }> = {
  // [date, principal, total paid]
  "2150": {
    opening: ["2026-03-31", 199_173_245],
    emis: [
      ["2026-04-10", 4_176_091, 5_890_800], ["2026-05-10", 4_266_197, 5_890_800], ["2026-06-10", 4_248_772, 5_890_800],
      ["2026-07-10", 4_337_139, 5_890_800], ["2026-08-10", 4_322_689, 5_890_800], ["2026-09-10", 4_359_904, 5_890_800],
      ["2026-10-10", 4_445_612, 5_890_800],
    ],
  },
  "2151": {
    opening: ["2026-03-31", 59_119_427],
    emis: [
      ["2026-04-10", 2_168_547, 2_799_600], ["2026-05-10", 2_211_304, 2_799_600], ["2026-06-10", 2_215_299, 2_799_600],
      ["2026-07-10", 2_257_031, 2_799_600], ["2026-08-10", 2_263_037, 2_799_600], ["2026-09-10", 2_287_193, 2_799_600],
      ["2026-10-10", 2_327_349, 2_799_600],
    ],
  },
  "2152": {
    opening: ["2026-03-31", 46_539_181],
    emis: [
      ["2026-04-10", 1_351_802, 1_776_400], ["2026-05-10", 1_377_434, 1_776_400], ["2026-06-10", 1_376_702, 1_776_400],
      ["2026-07-10", 1_401_751, 1_776_400], ["2026-08-10", 1_402_051, 1_776_400], ["2026-09-10", 1_414_843, 1_776_400],
      ["2026-10-10", 1_438_998, 1_776_400],
    ],
  },
  // 2153's EMI 1 was a cheque cleared 17 Sep, EMI 2 on 14 Oct — both for the 10th.
  "2153": { opening: ["2026-07-20", 70_100_000], emis: [["2026-09-17", 854_300, 2_032_700], ["2026-10-14", 1_474_500, 2_146_100]] },
  "2154": { opening: ["2026-08-31", 72_600_000], emis: [["2026-10-10", 1_240_200, 2_194_900]] },
};

function entriesFor(code: string, upto = "9999-12-31", sourced = true): LoanLedgerEntry[] {
  const r = REAL[code]!;
  const t = SEED_LOAN_TERMS[code]!;
  const out: LoanLedgerEntry[] = [
    { voucherId: `${code}-open`, voucherNo: `JV/${code}`, voucherType: "journal", date: r.opening[0], sourceType: "vehicle_loan", sourceId: "", narration: "", loanDebitPaise: 0, loanCreditPaise: r.opening[1], interestPaise: 0, cancelled: false },
  ];
  r.emis.forEach(([date, principal, total], i) => {
    if (date > upto) return;
    const dueMonth = date.slice(0, 7);
    out.push({
      voucherId: `${code}-e${i}`,
      voucherNo: `PY/${code}/${i}`,
      voucherType: "payment",
      date,
      sourceType: sourced ? "mahindra_soa" : "vehicle_loan",
      sourceId: sourced ? `${t.contractNo}:${dueMonth}-10` : "",
      narration: "",
      loanDebitPaise: principal,
      loanCreditPaise: 0,
      interestPaise: total - principal,
      cancelled: false,
    });
  });
  return out;
}

{
  let checked = 0;
  for (const code of Object.keys(REAL)) {
    const r = REAL[code]!;
    const t = terms(code);
    for (let i = 0; i < r.emis.length; i++) {
      const [date, principal, total] = r.emis[i]!;
      // As of the day it fell due, with everything before it in the books.
      const due = `${date.slice(0, 7)}-10`;
      const c = computeLoan({ code, entries: entriesFor(code, i === 0 ? "0000" : r.emis[i - 1]![0]), terms: t, today: due, skips: {} });
      const p = c.pending.find((x) => x.dueOn === due);
      assert.ok(p, `${code} ${due} is proposed`);
      assert.equal(p.interestPaise, total - principal, `${code} ${due} interest`);
      if (total === t.emiPaise) assert.equal(p.principalPaise, principal, `${code} ${due} principal`);
      checked++;
    }
  }
  assert.equal(checked, 24, "all 24 posted EMIs checked");
}

/* ── 3. Proposal months: none twice, manual vouchers recognised ─────────── */
{
  for (const code of Object.keys(REAL)) {
    const now = computeLoan({ code, entries: entriesFor(code), terms: terms(code), today: "2026-10-14", skips: {} });
    assert.deepEqual(now.pending, [], `${code}: nothing pending on 14 Oct — Sep/Oct are in the books`);
    assert.equal(now.nextDueOn, "2026-11-10");
    const nov = computeLoan({ code, entries: entriesFor(code), terms: terms(code), today: "2026-11-10", skips: {} });
    assert.deepEqual(nov.pending.map((p) => p.month), ["2026-11"], `${code}: only November on 10 Nov`);
    // The same vouchers without month-bearing source ids (typed by hand) are recognised by shape.
    const bare = computeLoan({ code, entries: entriesFor(code, "9999", false), terms: terms(code), today: "2026-11-10", skips: {} });
    assert.deepEqual(bare.pending.map((p) => p.month), ["2026-11"], `${code}: manual EMIs are not proposed again`);
  }
  // 2153 started in September, not August (sanctioned 20 Jul).
  assert.equal(startMonthFor(terms("2153"), "2026-07-20"), "2026-09");
  // 2150 brought in by an opening balance on 31 Mar: EMIs owed from April.
  assert.equal(startMonthFor(terms("2150"), "2026-03-31"), "2026-04");

  // An October EMI cleared on 2 November is October's — October is never proposed again.
  const late = entriesFor("2153").filter((e) => e.voucherId !== "2153-e1");
  late.push({ ...entriesFor("2153").find((e) => e.voucherId === "2153-e1")!, date: "2026-11-02", sourceId: "" });
  const lc = computeLoan({ code: "2153", entries: late, terms: terms("2153"), today: "2026-11-10", skips: {} });
  assert.deepEqual(lc.pending.map((p) => p.month), ["2026-11"]);
  assert.equal(lc.history.find((h) => h.voucherId === "2153-e1")!.month, "2026-10");

  // A missed month in the middle is proposed, oldest first.
  const holed = entriesFor("2150").filter((e) => e.date !== "2026-09-10");
  const hc = computeLoan({ code: "2150", entries: holed, terms: terms("2150"), today: "2026-10-14", skips: {} });
  assert.deepEqual(hc.pending.map((p) => p.month), ["2026-09"]);

  // Skipped with a reason: not proposed.
  const sk = computeLoan({
    code: "2150",
    entries: entriesFor("2150"),
    terms: terms("2150"),
    today: "2026-11-11",
    skips: { "2150:2026-11": { key: "2150:2026-11", code: "2150", month: "2026-11", reason: "moratorium", by: "x", at: "" } },
  });
  assert.deepEqual(sk.pending, []);
  assert.equal(sk.skipped.length, 1);

  // A cancelled (reversed) EMI does not count.
  const rev = entriesFor("2150").map((e) => (e.date === "2026-10-10" ? { ...e, cancelled: true } : e));
  assert.deepEqual(computeLoan({ code: "2150", entries: rev, terms: terms("2150"), today: "2026-10-14", skips: {} }).pending.map((p) => p.month), ["2026-10"]);

  // assignEmiMonths: a source month wins; the rest fill the earliest open month.
  const m = assignEmiMonths(
    [
      { voucherId: "a", date: "2026-11-01", sourceId: "" },
      { voucherId: "b", date: "2026-10-10", sourceId: "2150:2026-10" },
    ],
    "2026-10",
  );
  assert.equal(m.get("b"), "2026-10");
  assert.equal(m.get("a"), "2026-11");
}

/* ── 4. Balances and the projection ─────────────────────────────────────── */
{
  const c = computeLoan({ code: "2150", entries: entriesFor("2150"), terms: terms("2150"), today: "2026-10-14", skips: {} });
  assert.equal(c.outstandingPaise, 169_016_841, "2150 balance 16,90,168.41 after Oct");
  assert.equal(c.history[c.history.length - 1]!.balancePaise, 169_016_841);
  assert.equal(c.projection[0]!.status, "projection");
  assert.equal(c.projection[0]!.month, "2026-11");
  const last = c.projection[c.projection.length - 1]!;
  assert.ok(last.isFinal && last.closingPaise === 0, "the projection runs to zero");
  const projectedPrincipal = c.projection.reduce((n, p) => n + p.principalPaise, 0);
  assert.equal(projectedPrincipal, c.outstandingPaise, "projected principal repays exactly what is owed");
  for (const code of ["2151", "2152", "2153", "2154"]) {
    const x = computeLoan({ code, entries: entriesFor(code), terms: terms(code), today: "2026-10-14", skips: {} });
    assert.equal(x.projection.reduce((n, p) => n + p.principalPaise, 0), x.outstandingPaise, `${code} projection repays the balance`);
  }
  assert.equal(computeLoan({ code: "2151", entries: entriesFor("2151"), terms: terms("2151"), today: "2026-10-14", skips: {} }).outstandingPaise, 43_389_667);
  assert.equal(computeLoan({ code: "2152", entries: entriesFor("2152"), terms: terms("2152"), today: "2026-10-14", skips: {} }).outstandingPaise, 36_775_600);
  assert.equal(computeLoan({ code: "2153", entries: entriesFor("2153"), terms: terms("2153"), today: "2026-10-14", skips: {} }).outstandingPaise, 67_771_200);
  assert.equal(computeLoan({ code: "2154", entries: entriesFor("2154"), terms: terms("2154"), today: "2026-10-14", skips: {} }).outstandingPaise, 71_359_800);
  // No terms: nothing is guessed.
  const none = computeLoan({ code: "2199", entries: entriesFor("2150"), terms: null, today: "2026-11-11", skips: {} });
  assert.deepEqual(none.pending, []);
  assert.ok(none.warnings.length > 0);
}

/* ── 5. 2151 is paid by the trustee personally: Cr 2100 with his party ──── */
{
  const t = terms("2151");
  assert.equal(t.paidFrom.accountCode, TRUSTEE_LOAN_CODE);
  assert.equal(t.paidFrom.mode, "trustee_personal");
  assert.deepEqual(t.paidFrom.party, { kind: "vendor", externalId: "ashish singh", name: "Ashish Singh" });
  const c = computeLoan({ code: "2151", entries: entriesFor("2151"), terms: t, today: "2026-11-10", skips: {} });
  const p = c.pending[0]!;
  assert.equal(p.paidFrom.accountCode, "2100");
  assert.equal(paidFromLabel(p.paidFrom, "Owner / Trustee Loans"), "Paid by trustee Ashish Singh — added to his loan to the trust");
  const a = { code: "2151", month: p.month, date: p.dueOn, amountPaise: p.amountPaise, principalPaise: p.principalPaise, interestPaise: p.interestPaise, accountCode: p.paidFrom.accountCode, mode: p.paidFrom.mode, ref: "", party: p.paidFrom.party };
  const lines = emiLines(a, null);
  const cr = lines.find((l) => l.creditPaise > 0)!;
  assert.equal(cr.accountCode, "2100");
  assert.deepEqual(cr.party, { kind: "vendor", externalId: "ashish singh", name: "Ashish Singh" });
  assert.equal(cr.creditPaise, p.amountPaise);
  assert.equal(lines.find((l) => l.accountCode === "2151")!.debitPaise, p.principalPaise);
  assert.equal(lines.find((l) => l.accountCode === "5090")!.debitPaise, p.interestPaise);
  const n = emiNarration({ emiNo: p.emiNo, terms: t, vehicleLabel: "TATA Winger bus UP65MT0849", dueOn: p.dueOn, a, accountName: "Owner / Trustee Loans" });
  assert.equal(p.emiNo, 43);
  assert.match(n, /^EMI 43 on Mahindra contract 8891720 \(TATA Winger bus UP65MT0849\) — 27,996, of which principal [\d.]+ and interest [\d.]+\. Paid by trustee Ashish Singh from his own account, so the trust owes him\.$/);
  // Every other seeded loan pays from a bank, never from 2100.
  for (const code of ["2150", "2152", "2153", "2154"]) assert.equal(terms(code).paidFrom.accountCode, "1012");
  // Saved terms win over the seed.
  const saved = normalizeLoanTermsState({ loans: { "2151": { ...t, emiPaise: 2_500_000 } } });
  assert.equal(effectiveTerms("2151", saved)!.source, "saved");
  assert.equal(effectiveTerms("2151", saved)!.terms.emiPaise, 2_500_000);
  assert.equal(effectiveTerms("2151", saved)!.terms.paidFrom.accountCode, "2100");
}

/* ── 6. Approval edits must balance; paid-from must be coherent ─────────── */
{
  const exists = (c: string) => ["1000", "1012", "2100", "1950", "5090", "2150"].includes(c);
  const base = { code: "2150", month: "2026-11", date: "2026-11-10", amountPaise: 5_890_800, principalPaise: 4_400_000, interestPaise: 1_490_800, accountCode: "1012", mode: "nach" as const, ref: "ACH1", party: null };
  const ctx = { today: "2026-11-12", outstandingPaise: 169_016_841, accountExists: exists };
  assert.equal(emiApprovalProblem(base, ctx), null);
  assert.match(emiApprovalProblem({ ...base, principalPaise: 4_400_001 }, ctx)!, /not the/);
  assert.match(emiApprovalProblem({ ...base, date: "2026-11-13" }, ctx)!, /future/);
  assert.match(emiApprovalProblem({ ...base, amountPaise: 0, principalPaise: 0, interestPaise: 0 }, ctx)!, /more than zero/);
  assert.match(emiApprovalProblem({ ...base, principalPaise: 200_000_000, amountPaise: 201_490_800 }, ctx)!, /more than/);
  assert.match(emiApprovalProblem({ ...base, accountCode: "2100", mode: "trustee_personal" }, ctx)!, /party/);
  assert.equal(emiApprovalProblem({ ...base, accountCode: "2100", mode: "trustee_personal", party: TRUSTEE_ASHISH }, ctx), null);
  assert.match(paidFromProblem({ accountCode: "1012", mode: "trustee_personal", party: TRUSTEE_ASHISH }, exists)!, /2100/);
  assert.match(paidFromProblem({ accountCode: "1012", mode: "cash", party: null }, exists)!, /cash box/);
  assert.match(paidFromProblem({ accountCode: "9999", mode: "nach", party: null }, exists)!, /not an account/);
  // The voucher balances and lands on the bank's sub-ledger.
  const lines = emiLines(base, { code: "1012", name: "UBI -Main", bankAccountId: "bnk_x" });
  assert.equal(lines.reduce((n, l) => n + l.debitPaise - l.creditPaise, 0), 0);
  assert.equal(lines.find((l) => l.accountCode === "1012")!.subledgerId, "bnk_x");
  assert.equal(lines.find((l) => l.accountCode === "1012")!.party, undefined);
  assert.equal(lines.find((l) => l.accountCode === "1012")!.instrument?.ref, "ACH1");
}

/* ── 7. Idempotent source ids ───────────────────────────────────────────── */
{
  assert.equal(LOAN_EMI_SOURCE, "loan_emi");
  assert.equal(monthFromSourceId("2150:2026-11"), "2026-11");
  assert.equal(monthFromSourceId("10876691:2026-09-10"), "2026-09");
  assert.equal(monthFromSourceId("loanpp_abc"), "");
  // An EMI this module posted (source loan_emi, id 2150:2026-11) claims November.
  const e = entriesFor("2150");
  e.push({ voucherId: "x", voucherNo: "PY/x", voucherType: "payment", date: "2026-11-12", sourceType: LOAN_EMI_SOURCE, sourceId: "2150:2026-11", narration: "", loanDebitPaise: 4_400_000, loanCreditPaise: 0, interestPaise: 1_490_800, cancelled: false });
  const c = computeLoan({ code: "2150", entries: e, terms: terms("2150"), today: "2026-11-30", skips: {} });
  assert.deepEqual(c.pending, []);
  assert.equal(c.history.find((h) => h.voucherId === "x")!.month, "2026-11");
  // The route posts with exactly that id.
  const server = readFileSync(join(__dirname, "loans.server.ts"), "utf8");
  assert.match(server, /sourceType: LOAN_EMI_SOURCE,\s*sourceId: `\$\{a\.code\}:\$\{a\.month\}`/);
  assert.match(server, /sourceId: req\.id/);
  assert.match(server, /sourceId: `\$\{code\}:booking`/);
}

/* ── 8. Prepayment posts principal only; a top-up raises the loan ───────── */
{
  const req: LoanRequest = {
    id: "loanpp_1", code: "2150", kind: "prepayment", date: "2026-11-05", amountPaise: 10_000_000, accountCode: "1012", mode: "bank_transfer", ref: "UTR9", party: null, note: "",
    status: "pending", requestedBy: "a", requestedAt: "", decidedBy: "", decidedAt: "", decisionNote: "", voucherNo: "", voucherId: "",
  };
  const lines = requestLines(req, { code: "1012", name: "UBI", bankAccountId: "bnk_x" });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => [l.accountCode, l.debitPaise, l.creditPaise]), [["2150", 10_000_000, 0], ["1012", 0, 10_000_000]]);
  assert.ok(!lines.some((l) => l.accountCode === "5090"), "no interest on a prepayment");
  // In the books it is a prepayment, not November's EMI; interest for November uses the lower balance from 5 Nov.
  const e = entriesFor("2150");
  e.push({ voucherId: "pp", voucherNo: "PY/pp", voucherType: "payment", date: "2026-11-05", sourceType: LOAN_PREPAYMENT_SOURCE, sourceId: "loanpp_1", narration: "", loanDebitPaise: 10_000_000, loanCreditPaise: 0, interestPaise: 0, cancelled: false });
  const c = computeLoan({ code: "2150", entries: e, terms: terms("2150"), today: "2026-11-10", skips: {} });
  assert.equal(c.history.find((h) => h.voucherId === "pp")!.kind, "prepayment");
  assert.equal(c.prepaidPaise, 10_000_000);
  assert.deepEqual(c.pending.map((p) => p.month), ["2026-11"]);
  const plain = computeLoan({ code: "2150", entries: entriesFor("2150"), terms: terms("2150"), today: "2026-11-10", skips: {} }).pending[0]!;
  const r = terms("2150").annualRatePct;
  const expect = Math.round((169_016_841 * r * 26) / 100 / 365 + (159_016_841 * r * 5) / 100 / 365);
  assert.equal(c.pending[0]!.interestPaise, expect, "interest follows the balance day by day");
  assert.ok(c.pending[0]!.interestPaise < plain.interestPaise);
  // A principal-only debit typed by hand is a prepayment too, never an EMI.
  const hand = entriesFor("2150");
  hand.push({ ...e[e.length - 1]!, voucherId: "hand", sourceType: "", sourceId: "" });
  assert.equal(computeLoan({ code: "2150", entries: hand, terms: terms("2150"), today: "2026-11-10", skips: {} }).pending.length, 1);
  // Top-up (additional loan): Dr where it went / Cr the loan.
  const tu = requestLines({ ...req, id: "loantu_1", kind: "topup", accountCode: "1950" }, null);
  assert.deepEqual(tu.map((l) => [l.accountCode, l.debitPaise, l.creditPaise]), [["1950", 10_000_000, 0], ["2150", 0, 10_000_000]]);
  // Request checks.
  const exists = (c2: string) => ["1012", "1950", "2100", "2150"].includes(c2);
  assert.equal(loanRequestProblem(req, { today: "2026-11-10", outstandingPaise: 169_016_841, accountExists: exists }), null);
  assert.match(loanRequestProblem({ ...req, amountPaise: 999_999_999 }, { today: "2026-11-10", outstandingPaise: 169_016_841, accountExists: exists })!, /more than/);
  assert.match(loanRequestProblem({ ...req, kind: "topup", accountCode: "2150" }, { today: "2026-11-10", outstandingPaise: 1, accountExists: exists })!, /itself/);
}

/* ── 9. New loan, queue store, exports ──────────────────────────────────── */
{
  assert.equal(nextLoanCode(new Set(["2150", "2151", "2152", "2153", "2154"])), "2155");
  const b = bookingLines({ code: "2155", sanctionedPaise: 72_600_000, chargesPaise: 614_100, debitCode: "1950" });
  assert.deepEqual(b.map((l) => [l.accountCode, l.debitPaise, l.creditPaise]), [["1950", 71_985_900, 0], ["5090", 614_100, 0], ["2155", 0, 72_600_000]]);
  const q = normalizeLoanQueue({ skips: { "2150:2026-11": { reason: "r" }, bad: {} }, requests: [{ id: "a", code: "2150", kind: "topup", amountPaise: 5 }, { id: "a" }], notified: { "2150:2026-11": "t" } });
  assert.deepEqual(Object.keys(q.skips), ["2150:2026-11"]);
  assert.equal(q.requests.length, 1);
  assert.equal(q.requests[0]!.status, "pending");
  assert.equal(rupees(5_890_800), "58,908");
  assert.equal(rupees(177_822_357), "17,78,223.57");

  const loans = ["2150", "2151"].map((code) => ({
    code,
    vehicle: code,
    contract: SEED_LOAN_TERMS[code]!.contractNo,
    computed: computeLoan({ code, entries: entriesFor(code), terms: terms(code), today: "2026-10-14", skips: {} }),
  }));
  const rows = loanExportRows(loans, { fromMonth: "2026-04", toMonth: "2026-08", projection: false });
  assert.equal(rows.length, 10, "Apr–Aug: five EMIs each, the 31 Mar opening outside the range");
  const byV = loanTotals(rows, "vehicle");
  assert.equal(byV.find((t) => t.key === "2150")!.interestPaise, 1_714_709 + 1_624_603 + 1_642_028 + 1_553_661 + 1_568_111);
  const byM = loanTotals(rows, "month");
  assert.equal(byM.length, 5);
  assert.equal(byM[0]!.principalPaise, 4_176_091 + 2_168_547);
  const withProj = loanExportRows(loans, { fromMonth: "2026-11", toMonth: "2026-12", projection: true });
  assert.ok(withProj.every((r) => r.status === "Projection") && withProj.length === 4);
}

/* ── 10. Gates: routes, catalog, tick ───────────────────────────────────── */
{
  const root = join(__dirname, "..");
  const route = readFileSync(join(root, "app/api/accounts/loans/route.ts"), "utf8");
  assert.match(route, /requireStaffPermission\(req, "accounts", "view"\)/);
  assert.match(route, /requireStaffPermission\(req, "accounts_position", "view"\)/);
  assert.match(route, /APPROVE_ACTIONS = new Set\(\["approve-emi", "skip-emi", "reopen-emi", "approve-request", "reject-request", "add-loan"\]\)/);
  assert.match(route, /EDIT_ACTIONS = new Set\(\["save-terms", "request"\]\)/);
  const tick = readFileSync(join(root, "app/api/accounts/loans/tick/route.ts"), "utf8");
  assert.match(tick, /requireJobSecret\(req, \["CRON_SECRET"\], \["x-cron-secret"\]\)/);
  assert.doesNotMatch(tick, /ledgerPost|approveEmi/, "the tick never posts");
  const server = readFileSync(join(__dirname, "loans.server.ts"), "utf8");
  const tickFn = server.slice(server.indexOf("export async function runLoanTick"));
  assert.doesNotMatch(tickFn, /ledgerPost/, "runLoanTick never posts");
  const money = readFileSync(join(__dirname, "rbacFeatureCatalog/money.ts"), "utf8");
  assert.match(money, /id: "accounts\.loans"[\s\S]*?tabs: \["loans"\],\s*routes: \["\/api\/accounts\/loans"\]/);
  // No seed is written: nothing in the server writes SEED_LOAN_TERMS.
  assert.doesNotMatch(server, /SEED_LOAN_TERMS/);
}

console.log("loans.selftest.ts: ok");
