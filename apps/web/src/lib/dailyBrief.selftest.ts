/**
 * Run: npx tsx src/lib/dailyBrief.selftest.ts
 *
 * The 6 PM brief goes to the owner and the principal, and they will act on
 * it without checking. So the assertions here are mostly about the two ways
 * a daily report lies: printing zero for something nobody recorded, and
 * printing a percentage without saying what it is a percentage of.
 */
import assert from "node:assert/strict";
import {
  BRIEF_TEMPLATE_VARIABLES,
  absencesNeedingAttention,
  briefTemplateProblems,
  briefTemplateValueProblem,
  composeBriefTemplateVariables,
  composePendingFallback,
  pendingFacts,
  pendingFactsBlock,
  attendancePercent,
  briefFilename,
  briefTitle,
  composeBriefSummary,
  emptyBrief,
  rupees,
  rupeesExact,
  staffPercent,
  tenderModeLabel,
  type DailyBrief,
} from "./dailyBrief";

console.log("dailyBrief.selftest.ts");

function brief(over: Partial<DailyBrief> = {}): DailyBrief {
  return { ...emptyBrief("2026-09-10", "BHB International School"), ...over };
}

// --- nothing recorded must not read as zero ---------------------------
{
  const quiet = brief();
  const text = composeBriefSummary(quiet);
  assert.match(text, /No fee collection recorded today/);
  assert.match(text, /No expense voucher entered today/);
  assert.match(text, /No class register was marked today/);
  assert.match(text, /Staff attendance not marked today/);
  // The failure this guards: "Collected ₹0" tells the owner the day was
  // dead when the truth is the desk was not used.
  assert.doesNotMatch(text, /₹0/);
  assert.equal(attendancePercent(quiet.students), null);
  assert.equal(staffPercent(quiet.staff), null);
}

// --- a real day, with the mode break-up -------------------------------
{
  const b = brief({
    collection: {
      recorded: true,
      totalPaise: 4_85_000,
      receipts: 7,
      byMode: [
        { key: "cash", label: "Cash", paise: 3_00_000, count: 5 },
        { key: "upi", label: "UPI", paise: 1_85_000, count: 2 },
      ],
    },
    expenses: {
      recorded: true,
      totalPaise: 1_20_000,
      vouchers: 3,
      byHead: [{ key: "c1", label: "Diesel", paise: 1_20_000, count: 3 }],
    },
  });
  const text = composeBriefSummary(b);
  assert.match(text, /Collected ₹4,850 in 7 receipts/);
  assert.match(text, /Cash ₹3,000, UPI ₹1,850/);
  assert.match(text, /Spent ₹1,200 across 3 vouchers/);
}

// --- a percentage always carries its denominator ----------------------
{
  const b = brief({
    students: {
      classes: [],
      present: 168,
      absent: 32,
      strength: 240,
      classesMarked: 14,
      classesUnmarked: 2,
    },
  });
  assert.equal(attendancePercent(b.students), 84);
  const text = composeBriefSummary(b);
  assert.match(text, /84% present — 168 in, 32 absent/);
  assert.match(
    text,
    /2 classes not marked/,
    "84% of a partly-marked school must say so, or it is read as the whole school",
  );

  // Every class marked → no caveat to add. Matched on the class phrase
  // specifically: "Staff attendance not marked today" is a different line
  // and a loose /not marked/ here passes for the wrong reason.
  const full = brief({
    students: { ...b.students, classesUnmarked: 0 },
  });
  assert.doesNotMatch(composeBriefSummary(full), /class(es)? not marked/);
}

// --- staff: approved leave is not a problem, the rest are -------------
{
  const b = brief({
    staff: {
      marked: true,
      present: 30,
      absent: 5,
      strength: 35,
      absentRows: [
        { staffId: "s1", name: "A", empCode: "E1", reason: "on_leave", leaveTypeLabel: "Casual", requestId: "", fromDate: "2026-09-10", toDate: "2026-09-10", days: 1 },
        { staffId: "s2", name: "B", empCode: "E2", reason: "on_leave", leaveTypeLabel: "Sick", requestId: "", fromDate: "2026-09-10", toDate: "2026-09-11", days: 2 },
        { staffId: "s3", name: "C", empCode: "E3", reason: "leave_pending", leaveTypeLabel: "Casual", requestId: "lr_1", fromDate: "2026-09-10", toDate: "2026-09-10", days: 1 },
        { staffId: "s4", name: "D", empCode: "E4", reason: "unexplained", leaveTypeLabel: "", requestId: "", fromDate: "", toDate: "", days: 0 },
        { staffId: "s5", name: "E", empCode: "E5", reason: "unexplained", leaveTypeLabel: "", requestId: "", fromDate: "", toDate: "", days: 0 },
      ],
      pending: [
        { staffId: "s3", name: "C", empCode: "E3", reason: "leave_pending", leaveTypeLabel: "Casual", requestId: "lr_1", fromDate: "2026-09-10", toDate: "2026-09-10", days: 1 },
      ],
    },
  });
  assert.equal(staffPercent(b.staff), 85.7);
  const attention = absencesNeedingAttention(b.staff);
  assert.equal(attention.length, 3, "two on approved leave are not flagged");
  assert.deepEqual(attention.map((r) => r.name), ["C", "D", "E"]);

  const text = composeBriefSummary(b);
  assert.match(text, /85\.7% present — 30 in, 5 absent, 3 without approved leave/);
  assert.match(text, /1 leave request waiting for you — reply \*LEAVE\*/);
}

// --- the defaulters line points at the PDF, never lists them ---------
{
  const b = brief({
    defaulters: {
      rows: Array.from({ length: 146 }, (_, i) => ({
        studentId: `st${i}`,
        name: `Child ${i}`,
        fatherName: `Father ${i}`,
        classLabel: "Class 5 · A",
        duePaise: 1_00_000,
        mobile: "9000000000",
        guardianName: `Father ${i}`,
      })),
      totalPaise: 146_00_000,
      noMobile: 3,
    },
  });
  const text = composeBriefSummary(b);
  assert.match(text, /146 families owe ₹1,46,000 — calling list is in the PDF/);
  assert.doesNotMatch(text, /Child 0/, "no family is named in the chat message");
  assert.doesNotMatch(text, /9000000000/, "and no mobile number either");
}

// --- the whole message fits a Meta template body ---------------------
{
  // 1024 is Meta's cap. A brief that overflows is a template Meta refuses,
  // which is a 6 PM message that silently never arrives.
  const worst = brief({
    collection: {
      recorded: true,
      totalPaise: 12_34_567,
      receipts: 99,
      byMode: [
        { key: "cash", label: "Cash", paise: 5_00_000, count: 40 },
        { key: "upi", label: "UPI", paise: 4_00_000, count: 40 },
        { key: "card", label: "Card", paise: 1_00_000, count: 8 },
        { key: "cheque", label: "Cheque", paise: 1_00_000, count: 5 },
        { key: "neft", label: "NEFT", paise: 34_567, count: 6 },
      ],
    },
    expenses: { recorded: true, totalPaise: 9_99_999, vouchers: 42, byHead: [] },
    students: {
      classes: [],
      present: 999,
      absent: 111,
      strength: 1200,
      classesMarked: 40,
      classesUnmarked: 12,
    },
    staff: {
      marked: true,
      present: 88,
      absent: 12,
      strength: 100,
      absentRows: [],
      pending: Array.from({ length: 9 }, (_, i) => ({
        staffId: `s${i}`,
        name: `Staff ${i}`,
        empCode: `E${i}`,
        reason: "leave_pending" as const,
        leaveTypeLabel: "Casual",
        requestId: `lr_${i}`,
        fromDate: "2026-09-10",
        toDate: "2026-09-12",
        days: 3,
      })),
    },
    defaulters: { rows: [], totalPaise: 0, noMobile: 0 },
    aiNote:
      "Three fee cheques from last week are still unrealised, the transport register for Bus 2 has not been closed since Monday, and eleven admission enquiries have had no follow-up call in nine days.",
  });
  const text = composeBriefSummary(worst);
  assert.ok(
    text.length < 900,
    `the brief must leave room inside Meta's 1024 cap, got ${text.length}`,
  );
}

// --- money and titles read the way the office writes them -----------
{
  assert.equal(rupees(4_85_000), "₹4,850");
  assert.equal(rupees(0), "₹0");
  assert.equal(rupeesExact(4_85_050), "₹4,850.50");
  assert.equal(tenderModeLabel("upi"), "UPI");
  assert.equal(tenderModeLabel("cash"), "Cash");
  assert.equal(tenderModeLabel("wallet"), "WALLET", "an unknown mode is shown, not dropped");
  assert.equal(briefTitle("2026-09-10"), "Daily brief · 10 Sep 2026");
  assert.equal(briefTitle("rubbish"), "Daily brief · rubbish");
  assert.equal(briefFilename("2026-09-10"), "daily-brief-2026-09-10.pdf");
}

// --- template parameters: Meta refuses newlines, tabs, wide spaces ----
{
  // A refused template is a 6 PM message that never arrives and leaves no
  // trace on the phone, so this is checked here rather than at Meta.
  const busy = brief({
    collection: {
      recorded: true, totalPaise: 4_85_000, receipts: 7,
      byMode: [
        { key: "cash", label: "Cash", paise: 3_00_000, count: 5 },
        { key: "upi", label: "UPI", paise: 1_85_000, count: 2 },
      ],
    },
    expenses: { recorded: true, totalPaise: 1_20_000, vouchers: 3, byHead: [] },
    students: {
      classes: [], present: 210, absent: 30, strength: 256,
      classesMarked: 15, classesUnmarked: 1,
    },
    staff: {
      marked: true, present: 30, absent: 5, strength: 35,
      absentRows: [
        { staffId: "s1", name: "A", empCode: "", reason: "unexplained", leaveTypeLabel: "", requestId: "", fromDate: "", toDate: "", days: 0 },
      ],
      pending: [
        { staffId: "s2", name: "B", empCode: "", reason: "leave_pending", leaveTypeLabel: "Casual", requestId: "lr1", fromDate: "2026-09-11", toDate: "2026-09-11", days: 1 },
      ],
    },
    defaulters: { rows: [], totalPaise: 0, noMobile: 0 },
  });

  const vars = composeBriefTemplateVariables(busy);
  assert.deepEqual(
    Object.keys(vars).sort(),
    [...BRIEF_TEMPLATE_VARIABLES].sort(),
    "the template declares exactly these variables",
  );
  assert.deepEqual(briefTemplateProblems(vars), [], "every value must be sendable");
  for (const [key, value] of Object.entries(vars)) {
    assert.ok(value.length > 0, `${key} must not be empty — Meta refuses a blank parameter`);
    assert.doesNotMatch(value, /[\n\r\t]/, `${key} must be one line`);
    assert.doesNotMatch(value, / {5,}/, `${key} must not have five spaces in a row`);
  }
  assert.match(vars.collection, /Cash ₹3,000, UPI ₹1,850/);
  assert.match(vars.leavePending, /1 waiting — reply LEAVE to decide/);
  assert.match(vars.students, /1 section not marked/);
  assert.match(vars.staff, /1 absent without approved leave/);
  // The AI paragraph rides in the message too, flattened and trimmed.
  assert.ok(vars.stillOpen.length > 0);
  assert.doesNotMatch(vars.stillOpen, /[\n\r]/);

  // A quiet day still fills every parameter: "nothing recorded" is a value,
  // and an empty one would be refused.
  const quiet = composeBriefTemplateVariables(brief());
  assert.deepEqual(briefTemplateProblems(quiet), []);
  assert.match(quiet.collection, /nothing recorded at the desk today/);
  assert.match(quiet.leavePending, /none waiting/);
  assert.match(quiet.defaulters, /none overdue today/);
  // A quiet day still fills stillOpen — Meta refuses a blank parameter —
  // and on this one the honest content is the unrecorded desks.
  assert.ok(quiet.stillOpen.length > 0);
  assert.match(quiet.stillOpen, /no fee receipt was raised|nothing outstanding|never marked/);
}

// --- the guard itself -------------------------------------------------
{
  assert.equal(briefTemplateValueProblem("fine"), null);
  assert.equal(briefTemplateValueProblem(""), "empty");
  assert.equal(briefTemplateValueProblem("a\nb"), "contains a newline");
  assert.equal(briefTemplateValueProblem("a\tb"), "contains a tab");
  assert.equal(briefTemplateValueProblem("a     b"), "more than four consecutive spaces");
  assert.equal(briefTemplateValueProblem("a    b"), null, "four is allowed");
  assert.equal(briefTemplateValueProblem("x".repeat(1025)), "longer than 1024 characters");
  assert.deepEqual(
    briefTemplateProblems({ collection: "a\nb" }).map((p) => p.key),
    ["schoolName", "briefDate", "collection", "expenses", "students", "staff", "leavePending", "defaulters", "stillOpen"],
    "a missing variable is a problem too, not just a malformed one",
  );
}

// --- what is still open: computed here, never by the model -----------
{
  const messy = brief({
    collection: { recorded: false, totalPaise: 0, receipts: 0, byMode: [] },
    expenses: { recorded: false, totalPaise: 0, vouchers: 0, byHead: [] },
    students: {
      classes: [
        { classId: "c1", sectionId: "a", label: "Class 1 · A", present: 14, absent: 2, unmarked: 0, strength: 16, marked: true },
        { classId: "c2", sectionId: "a", label: "Class 2 · A", present: 0, absent: 0, unmarked: 18, strength: 18, marked: false },
        { classId: "c3", sectionId: "a", label: "Class 3 · A", present: 0, absent: 0, unmarked: 20, strength: 20, marked: false },
      ],
      present: 14, absent: 2, strength: 54, classesMarked: 1, classesUnmarked: 2,
    },
    staff: {
      marked: true, present: 30, absent: 3, strength: 35,
      absentRows: [
        { staffId: "s1", name: "Seema Verma", empCode: "E1", reason: "unexplained", leaveTypeLabel: "", requestId: "", fromDate: "", toDate: "", days: 0 },
        { staffId: "s2", name: "Ravi Kumar", empCode: "E2", reason: "unexplained", leaveTypeLabel: "", requestId: "", fromDate: "", toDate: "", days: 0 },
        { staffId: "s3", name: "Anita Singh", empCode: "E3", reason: "on_leave", leaveTypeLabel: "Sick", requestId: "", fromDate: "2026-09-09", toDate: "2026-09-12", days: 4 },
      ],
      pending: [
        { staffId: "s4", name: "Ramesh", empCode: "E4", reason: "leave_pending", leaveTypeLabel: "Casual", requestId: "lr1", fromDate: "2026-09-11", toDate: "2026-09-11", days: 1 },
      ],
    },
    defaulters: {
      rows: [
        { studentId: "st1", name: "A", fatherName: "F", classLabel: "Class 5", duePaise: 5_00_000, mobile: "9000000001", guardianName: "G" },
      ],
      totalPaise: 5_00_000, noMobile: 2,
    },
  });

  const facts = pendingFacts(messy);
  // Ranked, not piled: a child unaccounted for outranks an unentered
  // voucher, and an unordered list invites the model to lead with whatever
  // sounds most dramatic.
  assert.match(facts[0]!.text, /2 staff absent with no leave on file: Seema Verma, Ravi Kumar/);
  assert.match(facts[1]!.text, /2 sections never marked attendance today, covering 38 children/);
  assert.match(facts[2]!.text, /1 leave request waiting for a decision, the earliest starting 2026-09-11/);
  assert.ok(
    facts.findIndex((f) => /no expense voucher/.test(f.text)) >
      facts.findIndex((f) => /staff absent/.test(f.text)),
    "money paperwork ranks below a person nobody can account for",
  );
  // An approved absence is not a loose end.
  assert.ok(!facts.some((f) => /Anita Singh/.test(f.text)));
  assert.match(pendingFactsBlock(messy), /^- 2 staff absent/);

  const fallback = composePendingFallback(messy);
  assert.match(fallback, /^Still open: 2 staff absent with no leave on file/);
  assert.match(fallback, /no expense voucher was entered today\.$/);
}

// --- a clean day has nothing to say, and says nothing ----------------
{
  const clean = brief({
    collection: { recorded: true, totalPaise: 1000, receipts: 1, byMode: [] },
    expenses: { recorded: true, totalPaise: 500, vouchers: 1, byHead: [] },
    students: {
      classes: [{ classId: "c1", sectionId: "a", label: "Class 1 · A", present: 16, absent: 0, unmarked: 0, strength: 16, marked: true }],
      present: 16, absent: 0, strength: 16, classesMarked: 1, classesUnmarked: 0,
    },
    staff: { marked: true, present: 35, absent: 0, strength: 35, absentRows: [], pending: [] },
    defaulters: { rows: [], totalPaise: 0, noMobile: 0 },
  });
  assert.deepEqual(pendingFacts(clean), []);
  assert.equal(
    composePendingFallback(clean),
    "",
    "an empty 'still open' section must not appear at all",
  );
  assert.equal(pendingFactsBlock(clean), "");
}

// --- a long AI paragraph is trimmed, never allowed to push the numbers
//     out of Meta's 1024-character body ---------------------------------
{
  const wordy = brief({
    aiNote:
      "Two sections never marked attendance today covering thirty eight children, and two staff members are absent with no leave on file at all. " +
      "One leave request is waiting for a decision starting tomorrow. " +
      "One hundred and forty six families are overdue on fees for a total of one lakh forty six thousand rupees, and fourteen of them have no usable telephone number on file so nobody is able to ring them at all this week. " +
      "No expense voucher was entered today and no fee receipt was raised at the desk either.",
  });
  const v = composeBriefTemplateVariables(wordy);
  assert.ok(v.stillOpen.length <= 360, `trimmed, got ${v.stillOpen.length}`);
  assert.match(v.stillOpen, /full list in the PDF/);
  assert.doesNotMatch(v.stillOpen, /[\n\r]/);
  assert.deepEqual(briefTemplateProblems(v), []);
  // Cut at a word: "146 famil…" would read as a broken figure.
  assert.doesNotMatch(v.stillOpen, /\d…/);
}

// --- one loose end reads as one, not as a list -----------------------
{
  const one = brief({
    collection: { recorded: true, totalPaise: 1000, receipts: 1, byMode: [] },
    expenses: { recorded: true, totalPaise: 500, vouchers: 1, byHead: [] },
    students: {
      classes: [{ classId: "c1", sectionId: "a", label: "Class 1 · A", present: 16, absent: 0, unmarked: 0, strength: 16, marked: true }],
      present: 16, absent: 0, strength: 16, classesMarked: 1, classesUnmarked: 0,
    },
    staff: {
      marked: true, present: 34, absent: 0, strength: 35, absentRows: [],
      pending: [
        { staffId: "s4", name: "Ramesh", empCode: "E4", reason: "leave_pending", leaveTypeLabel: "Casual", requestId: "lr1", fromDate: "2026-09-20", toDate: "2026-09-20", days: 1 },
      ],
    },
    defaulters: { rows: [], totalPaise: 0, noMobile: 0 },
  });
  assert.equal(pendingFacts(one).length, 1);
  assert.match(composePendingFallback(one), /^One thing is still open: 1 leave request/);
}

console.log("  ok");
