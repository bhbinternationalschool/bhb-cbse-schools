/**
 * "Not on payroll" (director, 14 Oct 2026). The July 2026 draft carried six
 * active staff who draw no salary — the owner, trustees, honorary staff — as
 * ₹1 lines, because the only other ways out of a run were removing the line
 * by hand each month or making them inactive (which also drops them from
 * attendance, the staff app and roles).
 *
 * These pin the switch's rules: old links read as on payroll, the switch
 * survives the screens that rebuild a link, staff with no link can be
 * switched without gaining a salary setup, and payroll's partition says who
 * was left out and why.
 */
import assert from "node:assert/strict";
import {
  carryNotOnPayroll,
  clearSalaryAssignment,
  hasSalaryAssignment,
  isOnPayroll,
  leftOutText,
  mergeLeftOut,
  normalizeNotOnPayroll,
  notOnPayrollLabel,
  notOnPayrollLines,
  partitionDueStaff,
  setNotOnPayroll,
} from "./payrollNotOnPayroll";
import { defaultSalarySetupState, type StaffSalaryLink } from "./salarySetup";
import { buildPayrollDraft } from "./payroll";
import { defaultMasters, type MastersState } from "./masters";
import type { StaffRecord } from "./foundationMasters";

console.log("payrollNotOnPayroll.selftest.ts");

const link = (staffId: string, extra: Partial<StaffSalaryLink> = {}): StaffSalaryLink => ({
  staffId,
  structureId: "ss_std",
  basicOverride: 12000,
  statutoryCover: "pf_only",
  additionalAmount: 0,
  additionalLabel: "",
  statutoryGrossUp: false,
  effectiveFrom: "2026-04-01",
  salaryAccountNote: "",
  ...extra,
});
const AT = "2026-10-14T10:00:00.000Z";

// 1. Backward compatible: a link saved before the switch is on payroll, and
//    normalising it adds nothing.
{
  assert.equal(isOnPayroll(link("a")), true);
  assert.equal(isOnPayroll(undefined), true, "no link = on payroll (as before)");
  assert.deepEqual(normalizeNotOnPayroll(link("a")), {});
  assert.deepEqual(normalizeNotOnPayroll({ notOnPayroll: "yes" as unknown as boolean }), {}, "only true counts");
  console.log("  ok  old links read as on payroll");
}

// 2. Switching an assigned staff member keeps their structure and figures.
{
  const r = setNotOnPayroll([link("a"), link("b")], "a", { on: true, reason: "  Owner / trustee ", by: "Director", at: AT });
  const a = r.links.find((l) => l.staffId === "a")!;
  assert.equal(isOnPayroll(a), false);
  assert.equal(a.notOnPayrollReason, "Owner / trustee");
  assert.equal(a.notOnPayrollSetBy, "Director");
  assert.equal(a.structureId, "ss_std");
  assert.equal(a.basicOverride, 12000);
  assert.equal(a.statutoryCover, "pf_only");
  assert.equal(hasSalaryAssignment(a), true);
  assert.equal(notOnPayrollLabel(a), "Not on payroll — Owner / trustee");
  assert.deepEqual(r.before, {});
  assert.equal(r.after?.notOnPayroll, true);
  assert.equal(isOnPayroll(r.links.find((l) => l.staffId === "b")), true, "others untouched");

  // Back on payroll: the assignment stays, the switch goes, who did it stays.
  const back = setNotOnPayroll(r.links, "a", { on: false, by: "Principal", at: AT });
  const a2 = back.links.find((l) => l.staffId === "a")!;
  assert.equal(isOnPayroll(a2), true);
  assert.equal(a2.notOnPayrollReason, undefined);
  assert.equal(a2.notOnPayrollSetBy, "Principal");
  assert.equal(a2.basicOverride, 12000);
  console.log("  ok  switch on an assigned link keeps the assignment");
}

// 3. No link yet: a switch-only link — no structure, no PF/ESI decision — that
//    goes away again when they are put back on payroll.
{
  const r = setNotOnPayroll([link("b")], "x", { on: true, reason: "", by: "Director", at: AT });
  const x = r.links.find((l) => l.staffId === "x")!;
  assert.equal(isOnPayroll(x), false);
  assert.equal(x.structureId, "");
  assert.equal(x.basicOverride, 0);
  assert.equal(x.statutoryCover, "none");
  assert.equal(x.notOnPayrollOnly, true);
  assert.equal(hasSalaryAssignment(x), false, "a switch-only link is no salary setup");
  assert.equal(notOnPayrollLabel(x), "Not on payroll");
  const back = setNotOnPayroll(r.links, "x", { on: false, by: "Director", at: AT });
  assert.equal(back.links.some((l) => l.staffId === "x"), false, "switch-only link removed");
  assert.equal(back.links.length, 1);
  // Switching on payroll someone never switched is a no-op.
  const noop = setNotOnPayroll([link("b")], "y", { on: false, by: "Director", at: AT });
  assert.equal(noop.links.length, 1);
  console.log("  ok  staff without a link are switched without a salary setup");
}

// 4. Screens that rebuild a link keep the switch.
{
  const off = setNotOnPayroll([], "x", { on: true, reason: "Unpaid / honorary", by: "D", at: AT }).links[0]!;
  // Assign / increment: carried, and the link is now a real assignment.
  const carried = { ...link("x"), ...carryNotOnPayroll(off) };
  assert.equal(isOnPayroll(carried), false);
  assert.equal(carried.notOnPayrollReason, "Unpaid / honorary");
  assert.equal(hasSalaryAssignment(carried), true);
  // Clearing an assignment (or removing its structure) keeps the switch on
  // a switch-only link; anyone else's link goes as before.
  const cleared = clearSalaryAssignment([carried, link("b")], () => true);
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0]!.staffId, "x");
  assert.equal(isOnPayroll(cleared[0]), false);
  assert.equal(cleared[0]!.structureId, "");
  assert.equal(cleared[0]!.notOnPayrollOnly, true);
  assert.equal(cleared[0]!.notOnPayrollReason, "Unpaid / honorary");
  console.log("  ok  rebuilt and cleared links keep the switch");
}

// 5. Payroll's partition: the six July 2026 ₹1 lines are left out, with
//    their reasons; everyone else is built.
{
  const staff = [
    { id: "s1", fullName: "Ashish Singh", empCode: "EMP-0001" },
    { id: "s2", fullName: "Beena Singh", empCode: "STF-012" },
    { id: "s3", fullName: "Teacher One", empCode: "STF-040" },
    { id: "s4", fullName: "No Link", empCode: "STF-041" },
  ];
  let links: StaffSalaryLink[] = [link("s1"), link("s2"), link("s3")];
  links = setNotOnPayroll(links, "s1", { on: true, reason: "Owner / trustee", by: "D", at: AT }).links;
  links = setNotOnPayroll(links, "s2", { on: true, reason: "", by: "D", at: AT }).links;
  const p = partitionDueStaff(staff, links);
  assert.deepEqual(p.onPayroll.map((s) => s.id), ["s3", "s4"]);
  assert.deepEqual(p.leftOut, [
    { staffId: "s1", fullName: "Ashish Singh", empCode: "EMP-0001", reason: "Owner / trustee" },
    { staffId: "s2", fullName: "Beena Singh", empCode: "STF-012", reason: "" },
  ]);
  // An open draft: the lines to badge and offer for removal.
  const lines = notOnPayrollLines(
    [
      { staffId: "s1", fullName: "Ashish Singh", empCode: "EMP-0001" },
      { staffId: "s3", fullName: "Teacher One", empCode: "STF-040" },
    ],
    links,
  );
  assert.deepEqual(lines.map((l) => l.staffId), ["s1"]);
  assert.deepEqual(partitionDueStaff(staff, []).leftOut, [], "no switch = nobody left out");
  console.log("  ok  due staff partitioned; draft lines found");
}

// 6. The draft builder: a not-on-payroll person gets no line — in a bulk
//    build and when picked by name — and everyone else is built as before.
{
  const st = (id: string) =>
    ({
      id, empCode: id, fullName: id, status: "active", stream: "teaching",
      category: "permanent", designationId: "", classTeacherLinks: [], subjectTeachingLinks: [],
    }) as unknown as StaffRecord;
  const masters: MastersState = { ...defaultMasters(), staff: [st("paid"), st("owner")], holidays: [] };
  const base = defaultSalarySetupState();
  const salary = {
    ...base,
    staffLinks: setNotOnPayroll([], "owner", { on: true, reason: "Owner / trustee", by: "D", at: AT }).links,
  };
  const ids = (r: { lines: { staffId: string }[] }) => r.lines.map((l) => l.staffId).sort();
  const before = buildPayrollDraft({ masters, salary: base, month: "2026-08", academicYearCode: "2026-27", createdBy: "t" });
  assert.deepEqual(ids(before), ["owner", "paid"], "without the switch both are built (structure resolves)");
  const bulk = buildPayrollDraft({ masters, salary, month: "2026-08", academicYearCode: "2026-27", createdBy: "t" });
  assert.deepEqual(ids(bulk), ["paid"]);
  const picked = buildPayrollDraft({
    masters, salary, month: "2026-08", academicYearCode: "2026-27", createdBy: "t", staffIds: ["owner", "paid"],
  });
  assert.deepEqual(ids(picked), ["paid"]);
  console.log("  ok  draft builder skips not-on-payroll staff");
}

// 7. One left-out list: not on payroll first, joined-after added once.
{
  const merged = mergeLeftOut(
    [{ staffId: "s1", fullName: "Ashish Singh", empCode: "EMP-0001", reason: "Owner / trustee" }],
    [
      { staffId: "s1", fullName: "Ashish Singh", joiningDate: "2026-08-01" },
      { staffId: "s9", fullName: "New Joiner", joiningDate: "2026-08-01" },
      { staffId: "s9", fullName: "New Joiner", joiningDate: "2026-08-01" },
    ],
    [{ id: "s9", empCode: "STF-099" }],
  );
  assert.deepEqual(merged.map((e) => `${e.staffId}:${e.why}`), ["s1:not_on_payroll", "s9:joined_after"]);
  assert.equal(merged[1]!.empCode, "STF-099");
  assert.equal(leftOutText(merged[0]!), "Not on payroll — Owner / trustee");
  assert.match(leftOutText(merged[1]!), /^Joined 2026-08-01 — after the month/);
  console.log("  ok  one left-out list, nobody twice");
}

console.log("payrollNotOnPayroll.selftest.ts — all passed");
