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
  attendanceIdleNote,
  attendanceNotInUse,
  attendancePercent,
  briefFilename,
  briefTitle,
  composeBriefSummary,
  daysBetween,
  emptyBrief,
  rupees,
  rupeesExact,
  staffPercent,
  tenderModeLabel,
  allClassesOff,
  briefHolidaySkip,
  classesOffLine,
  computeHomeworkGaps,
  homeworkLine,
  unmarkedClassesWithTeachers,
  unmarkedWorkingClasses,
  type BriefClassAttendance,
  type BriefHomework,
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

// --- holidays: a class with the day off is not a register forgotten ----
const cls = (over: Partial<BriefClassAttendance> & { label: string }): BriefClassAttendance => ({
  classId: over.label,
  sectionId: "a",
  present: 0,
  absent: 0,
  unmarked: 20,
  strength: 20,
  marked: false,
  holiday: "",
  classTeacherName: "",
  ...over,
});
{
  const W = (label = "Working day") => ({ status: "working" as const, label });
  const H = (label: string) => ({ status: "holiday" as const, label });
  // Diwali: every class and the staff are off — no brief.
  assert.equal(
    briefHolidaySkip({ classDays: [H("Diwali"), H("Diwali")], staffDay: H("Diwali") }),
    "Diwali",
  );
  // Saturday: Pre-Primary is off, the rest of the school came in. The
  // calendar's "school" audience calls this a school holiday; the brief must not.
  assert.equal(
    briefHolidaySkip({ classDays: [H("Pre-Primary Saturday off"), W()], staffDay: W() }),
    null,
  );
  // Children off, staff working (a students-only holiday): the money and
  // the staff register still happen, so the brief still goes.
  assert.equal(briefHolidaySkip({ classDays: [H("PTM day"), H("PTM day")], staffDay: W() }), null);
  // A half day is a working day.
  assert.equal(
    briefHolidaySkip({
      classDays: [{ status: "half_holiday", label: "Half day" }],
      staffDay: { status: "half_holiday", label: "Half day" },
    }),
    null,
  );
  // No classes known: never a reason to stay quiet.
  assert.equal(briefHolidaySkip({ classDays: [], staffDay: H("Diwali") }), null);

  const saturday = brief({
    students: {
      classes: [
        cls({ label: "Class 3 · A", classTeacherName: "Ramesh Yadav" }),
        cls({ label: "Class 5 · B" }),
        cls({ label: "Nursery · A", holiday: "Pre-Primary Saturday off" }),
        cls({ label: "LKG · A", holiday: "Pre-Primary Saturday off" }),
        cls({ label: "Class 1 · A", marked: true, present: 18, absent: 2, unmarked: 0 }),
      ],
      present: 18, absent: 2, strength: 100,
      classesMarked: 1, classesUnmarked: 2, classesOff: 2,
    },
  });
  assert.deepEqual(unmarkedWorkingClasses(saturday.students).map((c) => c.label), ["Class 3 · A", "Class 5 · B"]);
  assert.equal(
    unmarkedClassesWithTeachers(saturday.students),
    "Class 3 · A (Ramesh Yadav), Class 5 · B (no class teacher on file)",
    "a section with no class teacher says so — never a guessed name",
  );
  assert.equal(classesOffLine(saturday.students), "2 sections off today (Pre-Primary Saturday off)");
  assert.equal(allClassesOff(saturday.students), false);

  const text = composeBriefSummary(saturday);
  assert.match(text, /2 classes not marked/);
  assert.match(text, /Not marked: Class 3 · A \(Ramesh Yadav\), Class 5 · B \(no class teacher on file\)/);
  assert.match(text, /🏖️ 2 sections off today \(Pre-Primary Saturday off\)/);
  assert.doesNotMatch(text, /Nursery/, "a class on holiday is not listed as unmarked");

  const vars = composeBriefTemplateVariables(saturday);
  assert.match(vars.students, /2 sections not marked: Class 3 · A \(Ramesh Yadav\)/);
  assert.match(vars.students, /2 sections off today/);
  assert.deepEqual(briefTemplateProblems(vars), [], "still one line each for Meta");

  const facts = pendingFacts(saturday);
  const unmarkedFact = facts.find((f) => f.rank === 2)!;
  assert.match(unmarkedFact.text, /2 sections never marked attendance today, covering 40 children: Class 3 · A \(Ramesh Yadav\)/);
  assert.doesNotMatch(unmarkedFact.text, /Nursery|LKG/);

  // Many unmarked: named up to the limit, then counted.
  const many = brief({
    students: {
      classes: ["1", "2", "3", "4", "5", "6"].map((n) => cls({ label: `Class ${n} · A`, classTeacherName: `T${n}` })),
      present: 0, absent: 0, strength: 120, classesMarked: 0, classesUnmarked: 6,
    },
  });
  assert.equal(
    unmarkedClassesWithTeachers(many.students, 4),
    "Class 1 · A (T1), Class 2 · A (T2), Class 3 · A (T3), Class 4 · A (T4), +2 more",
  );
  // No register at all: the template line still names whose they were.
  assert.match(composeBriefTemplateVariables(many).students, /^no register marked today: Class 1 · A \(T1\)/);

  // A students-only holiday for every class: nothing to mark, nothing missed.
  const allOff = brief({
    students: {
      classes: [cls({ label: "Class 1 · A", holiday: "PTM day" }), cls({ label: "Class 2 · A", holiday: "PTM day" })],
      present: 0, absent: 0, strength: 40, classesMarked: 0, classesUnmarked: 0, classesOff: 2,
    },
  });
  assert.equal(allClassesOff(allOff.students), true);
  assert.match(composeBriefSummary(allOff), /No classes today — holiday for every class/);
  assert.doesNotMatch(composeBriefSummary(allOff), /No class register was marked/);
  assert.equal(composeBriefTemplateVariables(allOff).students, "no classes today — holiday for every class");
}

// --- homework: who owes it ---------------------------------------------
{
  const e = (sectionKey: string, subjectKey: string, teacherStaffId: string, teacherName: string) => ({
    sectionKey,
    classLabel: sectionKey === "c3:a" ? "Class 3 · A" : "Class 5 · B",
    subjectKey,
    subjectName: subjectKey === "eng" ? "English" : subjectKey === "hin" ? "Hindi" : "Maths",
    teacherStaffId,
    teacherName,
  });
  const gaps = computeHomeworkGaps({
    expected: [
      e("c3:a", "eng", "t_priya", "Priya Nair"),
      e("c3:a", "eng", "t_priya", "Priya Nair"), // two English periods: one class-subject
      e("c3:a", "hin", "t_ramesh", "Ramesh Yadav"),
      e("c5:b", "eng", "t_priya", "Priya Nair"),
      e("c5:b", "mat", "t_sita", "Sita Devi"),
      e("c5:b", "mat", "t_ramesh", "Ramesh Yadav"), // two teachers share it
    ],
    // Hindi in 3A was set (by anyone — a substitute covers it).
    postedKeys: new Set(["c3:a|hin"]),
  });
  assert.equal(gaps.expected, 4, "class-subjects, not periods");
  assert.equal(gaps.posted, 1);
  assert.deepEqual(
    gaps.missing.map((t) => [t.name, t.gaps.map((g) => `${g.classLabel} ${g.subjectName}`)]),
    [
      ["Priya Nair", ["Class 3 · A English", "Class 5 · B English"]],
      ["Ramesh Yadav", ["Class 5 · B Maths"]],
      ["Sita Devi", ["Class 5 · B Maths"]],
    ],
    "most gaps first; Ramesh's posted Hindi does not excuse his unposted Maths",
  );

  const hw = (over: Partial<BriefHomework>): BriefHomework => ({
    checked: true, expected: 4, posted: 1, missing: gaps.missing,
    timetableSections: 0, assignmentSections: 2, absentTeachersSkipped: 0, ...over,
  });
  assert.equal(
    homeworkLine(hw({})),
    "homework posted for 1 of 4 class-subjects — not yet from Priya Nair, Ramesh Yadav, Sita Devi",
  );
  assert.equal(homeworkLine(hw({ missing: [], posted: 4 })), "homework posted for all 4 class-subjects");
  // Nothing expected (no assignments, or all off) is silence, not praise.
  assert.equal(homeworkLine(hw({ expected: 0, posted: 0, missing: [] })), "");
  // Could not read the desk: never "nobody posted".
  assert.equal(homeworkLine(hw({ checked: false, expected: 0, posted: 0, missing: [] })), "homework could not be read today");
  assert.equal(homeworkLine(undefined), "");
  const five = Array.from({ length: 6 }, (_, i) => ({ staffId: `t${i}`, name: `T${i}`, gaps: [{ classLabel: "C", subjectName: "S" }] }));
  assert.match(homeworkLine(hw({ missing: five, expected: 6, posted: 0 })), /T0, T1, T2, T3 \+2 more$/);

  // In the brief: a line in the summary, and a still-open fact ranked
  // below leave and above the staff register.
  const b = brief({ homework: hw({}), staff: { ...brief().staff, marked: false } });
  assert.match(composeBriefSummary(b), /📚 Homework posted for 1 of 4 class-subjects — not yet from Priya Nair/);
  const facts = pendingFacts(b);
  const hwRank = facts.findIndex((f) => /homework posted for 1 of 4/.test(f.text));
  const staffRank = facts.findIndex((f) => /staff attendance was never marked/.test(f.text));
  assert.ok(hwRank >= 0 && staffRank > hwRank);
  assert.match(composePendingFallback(b), /homework posted for 1 of 4/);
  assert.match(composeBriefTemplateVariables(b).stillOpen, /homework|Still open/);
  // A clean homework day adds no fact.
  assert.equal(pendingFacts(brief({ homework: hw({ missing: [], posted: 4 }) })).some((f) => /homework/.test(f.text)), false);
  // An unreadable desk is a fact worth saying.
  assert.ok(pendingFacts(brief({ homework: hw({ checked: false, missing: [] }) })).some((f) => /could not be read/.test(f.text)));
}

// --- a leave desk nobody could read is not "none waiting" -------------
{
  const blind = brief({
    staff: {
      marked: true, present: 35, absent: 0, strength: 35, absentRows: [], pending: [],
      leaveUnreadable: true,
    },
  });
  assert.match(composeBriefSummary(blind), /Leave requests could not be read/);
  assert.equal(composeBriefTemplateVariables(blind).leavePending, "could not be read — reply LEAVE to check");
  assert.equal(composeBriefTemplateVariables(brief()).leavePending, "none waiting");
  assert.doesNotMatch(composeBriefSummary(brief()), /could not be read/);
}

// --- a desk nobody uses is not a lapse today --------------------------
// 29 Sep 2026: every evening for a month said "no class register was marked
// today" while the registers on file were an import that ended 31 Aug. The
// brief must say the desk is not in use, and from when.
{
  assert.equal(daysBetween("2026-08-31", "2026-09-29"), 29);
  // Marked today, or an unknown last date: never "not in use".
  assert.equal(attendanceNotInUse(true, null, "2026-09-29"), false);
  assert.equal(attendanceNotInUse(false, undefined, "2026-09-29"), false);
  // A long weekend is not idleness; more than a week is.
  assert.equal(attendanceNotInUse(false, "2026-09-25", "2026-09-29"), false);
  assert.equal(attendanceNotInUse(false, "2026-09-22", "2026-09-29"), false);
  assert.equal(attendanceNotInUse(false, "2026-09-21", "2026-09-29"), true);
  assert.equal(attendanceNotInUse(false, null, "2026-09-29"), true);

  const base = emptyBrief("2026-09-29", "BHB International School");
  const idle = {
    ...base,
    students: { ...base.students, lastMarkedOn: "2026-08-31" },
    staff: { ...base.staff, lastMarkedOn: "2026-09-16" },
  };
  const text = composeBriefSummary(idle);
  assert.match(text, /Student attendance isn't being taken in the ERP — last register 31 Aug/);
  assert.match(text, /Staff attendance isn't being taken in the ERP — last register 16 Sep/);
  assert.doesNotMatch(text, /No class register was marked today/);
  assert.doesNotMatch(text, /Staff attendance not marked today/);

  const vars = composeBriefTemplateVariables(idle);
  assert.deepEqual(briefTemplateProblems(vars), []);
  assert.match(vars.students, /not being taken in the ERP — last register 31 Aug/);
  assert.match(vars.staff, /not being taken in the ERP — last register 16 Sep/);

  const facts = pendingFactsBlock(idle);
  assert.match(facts, /student attendance has not been taken in the ERP since 31 Aug \(29 days\)/);
  assert.match(facts, /staff attendance has not been taken in the ERP since 16 Sep \(13 days\)/);
  assert.doesNotMatch(facts, /never marked/);

  assert.match(attendanceIdleNote(idle, "students"), /not a lapse today/);

  // Never any register: says so, rather than naming a date.
  const never = { ...base, students: { ...base.students, lastMarkedOn: null } };
  assert.match(composeBriefSummary(never), /isn't being taken in the ERP — no register on file/);
  assert.match(pendingFactsBlock(never), /student attendance has not been taken in the ERP at all/);

  // Recent register, nothing today: the ordinary wording, with the date in the PDF.
  const recent = { ...base, students: { ...base.students, lastMarkedOn: "2026-09-26" } };
  assert.match(composeBriefSummary(recent), /No class register was marked today/);
  assert.match(attendanceIdleNote(recent, "students"), /last register on file is 26 Sep/);
}

// --- an unused desk and a holiday, together with class teachers --------
{
  const unused = brief({
    date: "2026-09-29",
    students: {
      classes: [cls({ label: "Class 3 · A", classTeacherName: "Ramesh Yadav" }), cls({ label: "Nursery · A", holiday: "Pre-Primary Saturday off" })],
      present: 0, absent: 0, strength: 40, classesMarked: 0, classesUnmarked: 1, classesOff: 1,
      lastMarkedOn: "2026-08-31",
    },
  });
  const text = composeBriefSummary(unused);
  assert.match(text, /Student attendance isn't being taken in the ERP — last register 31 Aug/);
  // A month of the same teacher list every night is what the line above replaces.
  assert.doesNotMatch(text, /Not marked: /);
  assert.doesNotMatch(pendingFacts(unused).map((f) => f.text).join("\n"), /Ramesh Yadav/);
  assert.match(composeBriefTemplateVariables(unused).students, /^not being taken in the ERP/);

  // Every class on holiday beats "not in use": there was nothing to take.
  const holiday = brief({
    date: "2026-10-02",
    students: {
      classes: [cls({ label: "Class 3 · A", holiday: "Gandhi Jayanti" })],
      present: 0, absent: 0, strength: 20, classesMarked: 0, classesUnmarked: 0, classesOff: 1,
      lastMarkedOn: "2026-08-31",
    },
  });
  assert.match(composeBriefSummary(holiday), /No classes today — holiday for every class/);
  assert.equal(composeBriefTemplateVariables(holiday).students, "no classes today — holiday for every class");
  assert.equal(pendingFacts(holiday).some((f) => /student attendance has not been taken/.test(f.text)), false);
}

console.log("  ok");
