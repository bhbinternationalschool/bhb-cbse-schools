/**
 * Self-test: bulk fee payment allocation, post-dated cheque rules, and
 * concession templates — the pure halves.
 * Run: npx tsx apps/web/src/lib/feeBulkPdcTemplates.selftest.ts
 *
 * The mistakes that cost money: a bulk payment that creates an advance or
 * pays a child twice, a PDC deposited early or for more than is owed, and a
 * template that approves its own grant for someone who may only ask.
 */
import assert from "node:assert/strict";

import {
  BULK_MAX_CHILDREN,
  bulkReceiptTransactionId,
  planBulkAllocation,
  type BulkChild,
} from "@/lib/feeBulkAllocation";
import {
  canClosePdc,
  canDepositPdc,
  pdcInputProblem,
  pdcReceiptTransactionId,
  pdcUrgency,
  planPdcDeposit,
  sortPdcsByChequeDate,
  type PdcInput,
} from "@/lib/feePdc";
import {
  estimateTemplatePaise,
  planTemplateApplication,
  ruleMatchesTemplate,
  templateInputProblem,
  templateRuleCode,
  templateToRule,
  type ConcessionTemplate,
} from "@/lib/feeConcessionTemplates";
import type { ConcessionGrant } from "@/lib/masters";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  void name;
}

const due = (dueKey: string, dueOn: string | null, balancePaise: number) => ({
  dueKey,
  label: dueKey,
  kind: "academic",
  dueOn,
  balancePaise,
});

const asha: BulkChild = {
  studentId: "s1",
  studentName: "Asha",
  householdId: "h1",
  dues: [due("tui:may", "2026-05-10", 150000), due("tui:apr", "2026-04-10", 150000)],
};
const ravi: BulkChild = {
  studentId: "s2",
  studentName: "Ravi",
  householdId: "h2",
  dues: [due("tui:apr", "2026-04-10", 100000), due("bus:jun", "2026-06-10", 50000)],
};

/* ——— bulk allocation ——— */

test("full settles every open due, one receipt per child", () => {
  const p = planBulkAllocation([asha, ravi], { kind: "full" });
  assert.ok(p.ok);
  assert.equal(p.receipts.length, 2);
  assert.equal(p.totalPaise, 450000);
  assert.deepEqual(p.receipts[0]!.lines.map((l) => l.dueKey), ["tui:apr", "tui:may"]);
  assert.equal(p.receipts[0]!.remainingPaise, 0);
});

test("lump sum goes oldest due first ACROSS children", () => {
  const p = planBulkAllocation([asha, ravi], { kind: "oldest_first", amountPaise: 300000 });
  assert.ok(p.ok);
  // Both April dues (1500 + 1000) first, then 500 of Asha's May.
  const a = p.receipts.find((r) => r.studentId === "s1")!;
  const r = p.receipts.find((r) => r.studentId === "s2")!;
  assert.equal(a.totalPaise, 200000);
  assert.equal(r.totalPaise, 100000);
  assert.deepEqual(r.lines.map((l) => l.dueKey), ["tui:apr"]);
  assert.equal(a.lines.find((l) => l.dueKey === "tui:may")!.amountPaise, 50000);
  assert.equal(p.totalPaise, 300000);
});

test("never more than is owed — no advance", () => {
  const p = planBulkAllocation([asha, ravi], { kind: "oldest_first", amountPaise: 450001 });
  assert.equal(p.ok, false);
  const q = planBulkAllocation([asha], { kind: "per_child", amounts: { s1: 300001 } });
  assert.equal(q.ok, false);
});

test("per child: each child its own amount, a zero child is skipped", () => {
  const p = planBulkAllocation([asha, ravi], { kind: "per_child", amounts: { s1: 100000, s2: 0 } });
  assert.ok(p.ok);
  assert.equal(p.receipts.length, 1);
  assert.equal(p.skipped.length, 1);
  assert.equal(p.skipped[0]!.studentId, "s2");
  assert.deepEqual(p.receipts[0]!.lines, [{ dueKey: "tui:apr", label: "tui:apr", kind: "academic", amountPaise: 100000 }]);
});

test("a child picked twice is refused, not merged", () => {
  const p = planBulkAllocation([asha, asha], { kind: "full" });
  assert.equal(p.ok, false);
});

test("no family = no receipt; zero / negative amounts refused; cap on size", () => {
  assert.equal(planBulkAllocation([{ ...asha, householdId: "" }], { kind: "full" }).ok, false);
  assert.equal(planBulkAllocation([asha], { kind: "oldest_first", amountPaise: 0 }).ok, false);
  assert.equal(planBulkAllocation([asha], { kind: "per_child", amounts: { s1: -5 } }).ok, false);
  const many = Array.from({ length: BULK_MAX_CHILDREN + 1 }, (_, i) => ({ ...asha, studentId: `x${i}` }));
  assert.equal(planBulkAllocation(many, { kind: "full" }).ok, false);
  assert.equal(planBulkAllocation([], { kind: "full" }).ok, false);
});

test("children owing nothing → refused, not an empty success", () => {
  const p = planBulkAllocation([{ ...asha, dues: [] }], { kind: "full" });
  assert.equal(p.ok, false);
});

test("receipt ids are stable per batch and child", () => {
  assert.equal(bulkReceiptTransactionId("b1", "s1"), "bulk:b1:s1");
  assert.equal(pdcReceiptTransactionId("p1"), "pdc:p1");
});

/* ——— PDC ——— */

const open = new Map<string, number>([
  ["s1|tui:nov", 150000],
  ["s1|tui:dec", 150000],
]);
const goodPdc: PdcInput = {
  householdId: "h1",
  chequeNo: "004512",
  bankName: "SBI",
  chequeDate: "2026-11-05",
  amountPaise: 300000,
  receivedOn: "2026-10-11",
  intended: [
    { studentId: "s1", studentName: "Asha", dueKey: "tui:nov", label: "Nov", kind: "academic", amountPaise: 150000 },
    { studentId: "s1", studentName: "Asha", dueKey: "tui:dec", label: "Dec", kind: "academic", amountPaise: 150000 },
  ],
};

test("a good PDC passes", () => {
  assert.equal(pdcInputProblem(goodPdc, "2026-10-11", open), null);
});

test("a cheque dated today or earlier is not post-dated", () => {
  assert.match(pdcInputProblem({ ...goodPdc, chequeDate: "2026-10-11" }, "2026-10-11", open)!, /not post-dated/);
});

test("dues ticked must equal the cheque, be open, and not exceed what is owed", () => {
  assert.match(pdcInputProblem({ ...goodPdc, amountPaise: 290000 }, "2026-10-11", open)!, /must match/);
  assert.match(
    pdcInputProblem({ ...goodPdc, intended: [{ ...goodPdc.intended[0]!, dueKey: "tui:jan" }] , amountPaise: 150000 }, "2026-10-11", open)!,
    /not an open due/,
  );
  assert.match(
    pdcInputProblem({ ...goodPdc, amountPaise: 160000, intended: [{ ...goodPdc.intended[0]!, amountPaise: 160000 }] }, "2026-10-11", open)!,
    /more than/,
  );
  assert.match(pdcInputProblem({ ...goodPdc, intended: [goodPdc.intended[0]!, goodPdc.intended[0]!] }, "2026-10-11", open)!, /twice/);
  assert.match(pdcInputProblem({ ...goodPdc, intended: [] }, "2026-10-11", open)!, /Tick/);
});

test("no deposit before the cheque date; only a held cheque deposits", () => {
  assert.match(canDepositPdc({ status: "held", chequeDate: "2026-11-05" }, "2026-11-04")!, /before its date/);
  assert.equal(canDepositPdc({ status: "held", chequeDate: "2026-11-05" }, "2026-11-05"), null);
  assert.equal(canDepositPdc({ status: "held", chequeDate: "2026-11-05" }, "2026-11-20"), null);
  assert.ok(canDepositPdc({ status: "deposited", chequeDate: "2026-11-05" }, "2026-11-20"));
  assert.ok(canDepositPdc({ status: "cancelled", chequeDate: "2026-11-05" }, "2026-11-20"));
});

test("closing needs a held cheque and a reason; a deposited one bounces in Cheques", () => {
  assert.equal(canClosePdc({ status: "held" }, "returned", "paid cash"), null);
  assert.ok(canClosePdc({ status: "held" }, "bounced", "  "));
  assert.match(canClosePdc({ status: "deposited" }, "bounced", "x")!, /Cheques/);
});

test("urgency: overdue, today, this week, later, closed", () => {
  assert.equal(pdcUrgency({ status: "held", chequeDate: "2026-10-01" }, "2026-10-11"), "overdue");
  assert.equal(pdcUrgency({ status: "held", chequeDate: "2026-10-11" }, "2026-10-11"), "due_today");
  assert.equal(pdcUrgency({ status: "held", chequeDate: "2026-10-17" }, "2026-10-11"), "this_week");
  assert.equal(pdcUrgency({ status: "held", chequeDate: "2026-10-18" }, "2026-10-11"), "later");
  assert.equal(pdcUrgency({ status: "deposited", chequeDate: "2026-10-01" }, "2026-10-11"), "closed");
});

test("held cheques sort by cheque date, earliest first, ahead of closed ones", () => {
  const rows = sortPdcsByChequeDate([
    { status: "deposited" as const, chequeDate: "2026-10-01", createdAt: "a" },
    { status: "held" as const, chequeDate: "2026-12-01", createdAt: "b" },
    { status: "held" as const, chequeDate: "2026-11-01", createdAt: "c" },
  ]);
  assert.deepEqual(rows.map((r) => r.createdAt), ["c", "b", "a"]);
});

test("deposit: intended dues as they stand today", () => {
  const live = new Map([["s1", [due("tui:nov", "2026-11-10", 150000), due("tui:dec", "2026-12-10", 150000)]]]);
  const p = planPdcDeposit(goodPdc, live);
  assert.ok(p.ok);
  assert.equal(p.lines.reduce((n, l) => n + l.amountPaise, 0), 300000);
  assert.equal(p.movedPaise, 0);
});

test("deposit: a due part-paid since → the rest spills to the child's next open due", () => {
  const live = new Map([
    ["s1", [due("tui:nov", "2026-11-10", 50000), due("tui:dec", "2026-12-10", 150000), due("tui:jan", "2027-01-10", 150000)]],
  ]);
  const p = planPdcDeposit(goodPdc, live);
  assert.ok(p.ok);
  assert.equal(p.lines.reduce((n, l) => n + l.amountPaise, 0), 300000);
  assert.equal(p.movedPaise, 100000);
  assert.equal(p.lines.find((l) => l.dueKey === "tui:jan")!.amountPaise, 100000);
  assert.equal(p.lines.find((l) => l.dueKey === "tui:nov")!.amountPaise, 50000);
});

test("deposit: family owes less than the cheque → refused", () => {
  const live = new Map([["s1", [due("tui:nov", "2026-11-10", 150000)]]]);
  const p = planPdcDeposit(goodPdc, live);
  assert.equal(p.ok, false);
});

/* ——— templates ——— */

const tpl: ConcessionTemplate = {
  id: "cct_abcdefgh12",
  name: "Staff ward 50% tuition",
  ground: "staff_ward",
  mode: "percent",
  value: 50,
  feeHeadIds: ["fh_tui"],
  siblingChildNo: null,
  endPolicy: "session_end",
  autoApproveMaxPaise: 100000,
  defaultReason: "Staff ward policy",
  isActive: true,
  ruleCode: templateRuleCode("cct_abcdefgh12"),
};

test("template input checks", () => {
  const heads = new Set(["fh_tui", "fh_bus"]);
  const base = { ...tpl } as Omit<ConcessionTemplate, "id" | "ruleCode">;
  assert.equal(templateInputProblem(base, heads), null);
  assert.ok(templateInputProblem({ ...base, name: " " }, heads));
  assert.ok(templateInputProblem({ ...base, value: 120 }, heads));
  assert.ok(templateInputProblem({ ...base, value: 12.5 }, heads));
  assert.ok(templateInputProblem({ ...base, feeHeadIds: ["gone"] }, heads));
  assert.ok(templateInputProblem({ ...base, siblingChildNo: 2 }, heads), "child no only on sibling");
  assert.equal(templateInputProblem({ ...base, ground: "sibling", siblingChildNo: 2, mode: "fixed", value: 50000 }, heads), null);
  assert.ok(templateInputProblem({ ...base, ground: "nonsense" as never }, heads));
});

test("rule code is stable and the rule mirrors the template", () => {
  assert.equal(templateRuleCode("cct_abcdefgh12"), "TPL-CDEFGH12");
  const rule = templateToRule(tpl, "cn_1");
  assert.equal(rule.code, tpl.ruleCode);
  assert.equal(rule.kind, "staff_ward");
  assert.equal(rule.value, 50);
  assert.ok(ruleMatchesTemplate(rule, tpl));
  assert.equal(ruleMatchesTemplate(rule, { ...tpl, value: 40 }), false);
  const sib = templateToRule({ ...tpl, ground: "sibling", siblingChildNo: 2, mode: "fixed", value: 50000 }, "cn_2");
  assert.equal(sib.kind, "sibling");
  assert.deepEqual(sib.siblingTiers, [{ childNo: 2, mode: "fixed", value: 50000 }]);
  assert.equal(templateToRule({ ...tpl, ground: "director" }, "x").kind, "other");
});

test("estimate covers only the template's heads, capped at the bill", () => {
  assert.equal(estimateTemplatePaise(tpl, { fh_tui: 150000, fh_bus: 80000 }), 75000);
  assert.equal(estimateTemplatePaise({ ...tpl, mode: "fixed", value: 999999, feeHeadIds: [] }, { fh_tui: 150000, fh_bus: 80000 }), 230000);
});

function plan(over: Partial<Parameters<typeof planTemplateApplication>[0]> = {}) {
  let n = 0;
  return planTemplateApplication({
    template: tpl,
    students: [
      { studentId: "s1", studentName: "Asha", billedByHead: { fh_tui: 150000 } },
      { studentId: "s2", studentName: "Ravi", billedByHead: { fh_tui: 300000 } },
      { studentId: "s3", studentName: "Mira", billedByHead: { fh_bus: 80000 } },
    ],
    ruleIds: new Set(["cn_1"]),
    ruleId: "cn_1",
    existingGrants: [],
    canGrant: true,
    canApprove: true,
    fromMonth: "2026-10",
    sessionEndOn: "2027-03-31",
    reason: "",
    nowIso: "2026-10-11T10:00:00.000Z",
    newId: () => `cg_${++n}`,
    ...over,
  });
}

test("approver: under the limit approved, over the limit pending, unbilled skipped", () => {
  const p = plan();
  assert.ok(p.ok);
  assert.equal(p.grants.length, 2);
  assert.equal(p.grants[0]!.status, "approved"); // 750 ≤ 1000
  assert.equal(p.grants[1]!.status, "pending"); // 1500 > 1000
  assert.equal(p.rows.find((r) => r.studentId === "s3")!.action, "skip");
  for (const g of p.grants) {
    assert.equal(g.ground, "staff_ward");
    assert.equal(g.effectiveFrom, "2026-10-01");
    assert.equal(g.effectiveTo, "2027-03-31");
    assert.equal(g.reason, "Staff ward policy");
    assert.equal(g.concessionId, "cn_1");
  }
});

test("someone who may only grant never approves — whatever the amount", () => {
  const p = plan({ canApprove: false });
  assert.ok(p.ok);
  assert.ok(p.grants.every((g) => g.status === "pending"));
  assert.equal(plan({ canGrant: false }).ok, false);
});

test("no auto limit = always pending, even for an approver", () => {
  const p = plan({ template: { ...tpl, autoApproveMaxPaise: null } });
  assert.ok(p.ok);
  assert.ok(p.grants.every((g) => g.status === "pending"));
});

test("a live grant under the template is skipped; a rejected or ended one is not", () => {
  const g = (status: ConcessionGrant["status"], effectiveTo: string | null): ConcessionGrant => ({
    id: "old",
    concessionId: "cn_1",
    studentId: "s1",
    status,
    ground: "staff_ward",
    reason: "",
    effectiveFrom: "2026-04-01",
    effectiveTo,
    createdAt: "",
    siblingChildNo: null,
  });
  const live = plan({ existingGrants: [g("approved", null)] });
  assert.ok(live.ok);
  assert.equal(live.rows.find((r) => r.studentId === "s1")!.action, "skip");
  const rejected = plan({ existingGrants: [g("rejected", null)] });
  assert.ok(rejected.ok);
  assert.equal(rejected.rows.find((r) => r.studentId === "s1")!.action, "grant");
  const ended = plan({ existingGrants: [g("approved", "2026-09-30")] });
  assert.ok(ended.ok);
  assert.equal(ended.rows.find((r) => r.studentId === "s1")!.action, "grant");
});

test("session end unknown → refused, never open-ended; open policy has no end", () => {
  assert.equal(plan({ sessionEndOn: null }).ok, false);
  const open = plan({ sessionEndOn: null, template: { ...tpl, endPolicy: "open" } });
  assert.ok(open.ok);
  assert.ok(open.grants.every((g) => g.effectiveTo === null));
});

test("switched-off template, bad month, nobody chosen → refused", () => {
  assert.equal(plan({ template: { ...tpl, isActive: false } }).ok, false);
  assert.equal(plan({ fromMonth: "Oct" }).ok, false);
  assert.equal(plan({ students: [] }).ok, false);
});

test("sibling template stamps the child number", () => {
  const sib = { ...tpl, ground: "sibling" as const, siblingChildNo: 2, mode: "fixed" as const, value: 50000, feeHeadIds: [] };
  const p = plan({ template: sib });
  assert.ok(p.ok);
  assert.ok(p.grants.every((g) => g.siblingChildNo === 2));
});

console.log(`feeBulkPdcTemplates selftest: ${passed} passed`);
