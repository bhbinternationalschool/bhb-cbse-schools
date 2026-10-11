import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addProgressSnapshot,
  normalizePropelProgress,
  buildPropelExamPlan,
  buildPropelHolidayPlan,
  buildPropelStudentRows,
  buildPropelTeacherPlan,
  normalizePropelTests,
  propelChapterGaps,
  propelClassKey,
  propelDescription,
  propelExamType,
  propelSubjectFor,
  PROPEL_STUDENT_COLUMNS,
} from "./propelRobot";

console.log("propelRobot.selftest.ts");

/**
 * The Office Robot's Propel panel (12 Oct 2026): ERP → Propel calendar,
 * teachers and student sheet; Propel → ERP tests. Portal facts studied
 * read-only on 12 Oct: class ids, description rule ^[ a-zA-Z0-9]*$, dates
 * YYYY-MM-DD, starts not before today, exam types 1 Unit / 2 Periodic /
 * 3 MOY / 4 EOY, teacher login = mobile.
 */

// ── Classes and text ───────────────────────────────────────────────────
assert.equal(propelClassKey("Nursery"), "nursery");
assert.equal(propelClassKey("LKG"), "lkg");
assert.equal(propelClassKey("UKG"), "ukg");
assert.equal(propelClassKey("VII"), "7");
assert.equal(propelClassKey("Class 3"), "3");
assert.equal(propelClassKey("IX"), "", "Propel has no Class 9 for this school");
assert.equal(propelDescription("Teachers' Day & Janmashtami!"), "Teachers Day Janmashtami");
assert.equal(propelExamType({ code: "HY", label: "Half Yearly" }), 3);
assert.equal(propelExamType({ code: "ANN", label: "Annual Exam" }), 4);
assert.equal(propelExamType({ code: "UT1", label: "Unit Test 1" }), 1);
assert.equal(propelExamType({ code: "PT2", label: "Periodic Test 2" }), 2);
console.log("  ok  class mapping, description rule, exam types");

const classes = [
  { id: "c-nur", name: "Nursery", groupCode: "PRE_PRIMARY" },
  { id: "c-lkg", name: "LKG", groupCode: "PRE_PRIMARY" },
  { id: "c-ukg", name: "UKG", groupCode: "PRE_PRIMARY" },
  { id: "c-6", name: "VI", groupCode: "MIDDLE" },
  { id: "c-8", name: "VIII", groupCode: "MIDDLE" },
  { id: "c-9", name: "IX", groupCode: "SECONDARY" },
];
const base = {
  academicYearCode: "2026-27",
  scope: "school",
  groupCode: "",
  classIds: [] as string[],
  mode: "one_off",
  weekday: null as number | null,
  exceptionDates: [] as string[],
  workingOverride: false,
  isPublished: true,
};

// ── Holidays ───────────────────────────────────────────────────────────
{
  const plan = buildPropelHolidayPlan({
    holidays: [
      { ...base, id: "h1", title: "Diwali", startsOn: "2026-11-08", endsOn: "2026-11-10", appliesTo: "everyone" },
      { ...base, id: "h2", title: "Gandhi Jayanti", startsOn: "2026-10-02", endsOn: "2026-10-02", appliesTo: "everyone" },
      { ...base, id: "h3", title: "Staff training", startsOn: "2026-11-20", endsOn: "2026-11-20", appliesTo: "staff_all" },
      { ...base, id: "h4", title: "Chhath", startsOn: "2026-11-15", endsOn: "2026-11-15", appliesTo: "students" },
      { ...base, id: "h5", title: "Saturday", startsOn: "2026-10-01", endsOn: "2026-10-31", appliesTo: "students", mode: "weekly", weekday: 6, scope: "class_group", groupCode: "PRE_PRIMARY", exceptionDates: ["2026-10-24"] },
      { ...base, id: "h6", title: "Draft", startsOn: "2026-12-01", endsOn: "2026-12-01", appliesTo: "everyone", isPublished: false },
      { ...base, id: "h7", title: "Dussehra", startsOn: "2026-10-11", endsOn: "2026-10-14", appliesTo: "everyone" },
    ],
    classes,
    academicYearCode: "2026-27",
    ayEnd: "2027-03-31",
    today: "2026-10-12",
    existing: [{ description: "Chhath", startDate: "2026-11-15T00:00:00.000Z", endDate: "2026-11-15T00:00:00.000Z", is_active: true }],
  });
  const descs = plan.create.map((p) => `${p.startDate} ${p.description}`);
  assert.ok(descs.includes("2026-11-08 Diwali"), "a future holiday is sent");
  assert.ok(!descs.some((d) => d.includes("Gandhi")), "a past holiday is not");
  assert.ok(!descs.some((d) => d.includes("Draft")), "an unpublished one is not");
  assert.equal(plan.already, 1, "Chhath is already on Propel");
  assert.ok(plan.skipped.some((s) => /staff-only/.test(s.why)), "staff-only is listed, not sent");
  assert.ok(plan.skipped.some((s) => /Dussehra/.test(s.what) && /before today/.test(s.why)), "a holiday under way is listed");
  const sats = plan.create.filter((p) => p.description === "Saturday").map((p) => p.startDate);
  assert.deepEqual(sats, ["2026-10-17", "2026-10-31"], "weekly rule: one entry per future day, exception skipped");
  const diwali = plan.create.find((p) => p.description === "Diwali")!;
  assert.deepEqual(diwali.selectedClasses, ["1", "114", "116", "154", "155"], "Class IX is not on Propel");
  assert.equal(diwali.applicableTo, 2);
  assert.equal(plan.create.find((p) => p.description === "Saturday")!.applicableTo, 1);
  assert.deepEqual(plan.create.find((p) => p.description === "Saturday")!.selectedClasses, ["1", "154", "155"]);
  console.log("  ok  holidays: future, published, students; weekly expanded; already/under-way handled");
}

// ── Exams ──────────────────────────────────────────────────────────────
{
  const propelSubjects = [
    { id: 352, name: "Propel English", classes: [114, 116] },
    { id: 364, name: "Propel English Literacy", classes: [1, 154, 155] },
    { id: 359, name: "Propel Math", classes: [114, 116] },
  ];
  assert.equal(propelSubjectFor("English", 114, propelSubjects), 352);
  assert.equal(propelSubjectFor("English", 154, propelSubjects), 364, "pre-primary English is English Literacy");
  assert.equal(propelSubjectFor("Sanskrit", 116, propelSubjects), 0);
  const plan = buildPropelExamPlan({
    terms: [{ id: "t1", code: "HY", label: "Half Yearly", academicYearCode: "2026-27" }],
    subjects: [
      { id: "s-eng", name: "English" },
      { id: "s-san", name: "Sanskrit" },
      { id: "s-mat", name: "Maths" },
    ],
    dateSheet: [
      { id: "d1", academicYearCode: "2026-27", examTermId: "t1", classId: "c-6", subjectId: "s-eng", date: "2026-10-20" },
      { id: "d2", academicYearCode: "2026-27", examTermId: "t1", classId: "c-8", subjectId: "s-eng", date: "2026-10-20" },
      { id: "d3", academicYearCode: "2026-27", examTermId: "t1", classId: "c-8", subjectId: "s-san", date: "2026-10-21" },
      { id: "d4", academicYearCode: "2026-27", examTermId: "t1", classId: "c-6", subjectId: "s-mat", date: "2026-10-05" },
      { id: "d5", academicYearCode: "2026-27", examTermId: "t1", classId: "c-8", subjectId: "s-mat", date: "2026-10-22" },
      { id: "d6", academicYearCode: "2026-27", examTermId: "t1", classId: "c-9", subjectId: "s-mat", date: "2026-10-22" },
    ],
    classes,
    academicYearCode: "2026-27",
    today: "2026-10-12",
    propelSubjects,
    existing: [{ eventType: "Offline assessment", subjectId: 359, startDate: "2026-10-22T00:00:00.000Z", selectedClasses: [116], is_active: true }],
  });
  const eng = plan.create.find((e) => e.subjectId === 352)!;
  assert.equal(eng.eventType, "22", "Offline assessment");
  assert.equal(eng.eventCustomId, 3, "Half Yearly = MOY");
  assert.deepEqual(eng.selectedClasses, ["114", "116"], "one event, both classes sitting it");
  assert.equal(eng.startDate, "2026-10-20");
  const san = plan.create.find((e) => /Sanskrit/.test(e.description))!;
  assert.equal(san.eventType, "4", "a subject Propel lacks goes as Academic Event");
  assert.equal(san.subjectId, null);
  assert.equal(plan.asAcademicEvent, 1);
  assert.ok(!plan.create.some((e) => e.startDate === "2026-10-05"), "a past exam is not sent");
  assert.equal(plan.already, 1, "Class 8 Maths on 22 Oct is already on Propel");
  assert.ok(plan.skipped.some((s) => /IX/.test(s.what)), "Class IX is listed, not sent");
  console.log("  ok  exams: Offline assessment by subject and day, classes grouped, fallbacks listed");
}

// ── Teachers ───────────────────────────────────────────────────────────
{
  const plan = buildPropelTeacherPlan({
    staff: [
      { id: "s1", fullName: "Asha Rani Singh", stream: "teaching", designationId: "d-t", mobile: "+91 98765 43210", email: "asha@x.in", status: "active" },
      { id: "s2", fullName: "Ravi Kumar", stream: "teaching", designationId: "d-c", mobile: "9123456789", email: "", status: "active" },
      { id: "s3", fullName: "No Phone", stream: "teaching", designationId: "d-t", mobile: "12345", email: "", status: "active" },
      { id: "s4", fullName: "Peon", stream: "non_teaching", designationId: null, mobile: "9000000001", email: "", status: "active" },
      { id: "s5", fullName: "Left", stream: "teaching", designationId: "d-t", mobile: "9000000002", email: "", status: "inactive" },
    ],
    designationName: (id) => (id === "d-c" ? "Academic Co-ordinator" : "TGT"),
    existing: [
      { first_name: "Ravi", last_name: "Kumar", mobile: "9123456789", school_user_status: true },
      { first_name: "Old", last_name: "Teacher", mobile: "9888888888", school_user_status: true },
    ],
  });
  assert.equal(plan.create.length, 1);
  assert.deepEqual(
    { first: plan.create[0].first_name, last: plan.create[0].last_name, mobile: plan.create[0].mobile, role: plan.create[0].role_id },
    { first: "Asha", last: "Rani Singh", mobile: "9876543210", role: 58 },
  );
  assert.equal(plan.already, 1, "matched by mobile");
  assert.ok(plan.skipped.some((s) => s.what === "No Phone"), "no valid mobile = listed");
  assert.deepEqual(plan.onlyOnPropel, ["Old Teacher"], "unknown Propel accounts are reported, never touched");
  console.log("  ok  teachers: created by mobile, roles, skips, never deactivates");
}

// ── Students ───────────────────────────────────────────────────────────
{
  const st = (o: Record<string, string>) => ({
    id: o.id,
    admissionNo: o.adm ?? "",
    fullName: o.name,
    gender: o.g ?? "M",
    status: "active",
    classId: o.cls ?? "c-6",
    sectionId: "sec-a",
    joinedOn: "2025-04-03",
    academicYearCode: "2026-27",
    householdId: "h1",
    fatherName: o.father ?? "Ramesh Kumar",
    motherName: "",
    fatherMobile: o.fm ?? "9811111111",
    motherMobile: "",
    guardianRelation: "",
  });
  const { rows, skipped } = buildPropelStudentRows({
    students: [
      st({ id: "1", adm: "A101", name: "Aarav Kumar Singh" }),
      st({ id: "2", adm: "A102", name: "Diya", g: "F", cls: "c-lkg" }),
      st({ id: "3", adm: "", name: "No Code" }),
      st({ id: "4", adm: "A104", name: "Big Kid", cls: "c-9" }),
      st({ id: "5", adm: "A105", name: "No Parent", fm: "" }),
    ],
    households: [{ id: "h1", guardianName: "", mobile: "", email: "", address: "Gali 2", city: "Varanasi", state: "Uttar Pradesh", pincode: "221005" }],
    classes,
    sections: [{ id: "sec-a", classId: "c-6", name: "A" }],
    academicYearCode: "2026-27",
  });
  assert.equal(PROPEL_STUDENT_COLUMNS.length, 23);
  assert.equal(rows.length, 2);
  const aarav = rows.find((r) => r[0] === "A101")!;
  assert.equal(aarav.length, 23);
  assert.deepEqual(aarav.slice(0, 9), ["A101", "03/04/2025", "Aarav", "Kumar", "Singh", "Male", "", "Class 6", "A"]);
  assert.equal(aarav[12], "221005");
  assert.equal(aarav[14], "9811111111");
  const diya = rows.find((r) => r[0] === "A102")!;
  assert.deepEqual([diya[2], diya[4], diya[5], diya[7]], ["Diya", ".", "Female", "JKG"], "LKG is JKG on Propel; no surname = '.'");
  assert.deepEqual(skipped.map((s) => s.what).sort(), ["Big Kid", "No Code", "No Parent"]);
  console.log("  ok  students: Propel's 23 columns, JKG/SKG, '.', skips listed");
}

// ── Tests & chapters ──────────────────────────────────────────────────
{
  const tests = normalizePropelTests([
    {
      asmId: 1,
      className: "Class3",
      divisionName: "A",
      subjectName: "Propel Math",
      asmName: "Formative Assessment 1",
      assessmentState: "PUBLISHED",
      finalisedDate: "2026-07-20T05:48:02Z",
      associatedUnits: [{ shellTitle: "Numbers up to 999" }, { shellTitle: "Shapes Around Us" }],
    },
    { bad: true },
  ]);
  assert.equal(tests.length, 1);
  assert.deepEqual(tests[0].chapters, ["Numbers up to 999", "Shapes Around Us"]);
  const gaps = propelChapterGaps(tests, () => ["Numbers Up To 999", "Addition"]);
  assert.deepEqual(gaps, [{ className: "Class3", subject: "Propel Math", missing: ["Shapes Around Us"] }]);
  assert.deepEqual(propelChapterGaps(tests, () => null), [], "no ERP book = nothing to compare");
  console.log("  ok  tests: kept without student data; chapter gaps against the ERP's books");
}

// ── Teacher progress ──────────────────────────────────────────────────
{
  const rows = normalizePropelProgress(
    [
      { schoolUserId: 11, teacherName: "Kiran Patel", className: "Class1", divName: "A", subjectName: "Propel Hindi", total_days: 140, required_day_plans_completed: 60, current_day_plans_completed: 10, progress: -50, current_unitno: 8, required_unitno: 7, dailyDate: "2026-09-09T05:33:33.000Z" },
      { schoolUserId: 12, teacherName: "Devendra", className: "Class3", divName: "A", subjectName: "Propel Math", total_days: 140, required_day_plans_completed: 60, current_day_plans_completed: 106, progress: 46 },
      { schoolUserId: 13, teacherName: "No numbers", className: "Class4", subjectName: "Propel EVS" },
    ],
    [{ school_user_id: 11, mobile: "9811111111" }, { school_user_id: 12, mobile: "9822222222" }],
    [{ id: "stf-k", mobile: "+91 98111 11111", status: "active" }],
  );
  assert.equal(rows.length, 2, "a row without numbers is dropped, never read as zero");
  assert.equal(rows[0].teacher, "Kiran Patel", "furthest behind first");
  assert.equal(rows[0].gap, -50);
  assert.equal(rows[0].staffId, "stf-k", "matched to ERP staff by the Propel login mobile");
  assert.equal(rows[1].staffId, "", "no ERP match = shown as not matched");
  assert.equal(rows[0].lastPlanOn, "2026-09-09");
  let h = addProgressSnapshot([], "2026-10-05", rows);
  h = addProgressSnapshot(h, "2026-10-12", rows);
  h = addProgressSnapshot(h, "2026-10-12", rows.map((r) => ({ ...r, donePlans: r.donePlans + 1 })));
  assert.deepEqual(h.map((x) => x.on), ["2026-10-05", "2026-10-12"], "one snapshot a day, latest wins");
  assert.equal(h[1].done["Class1|A|Propel Hindi"], 11);
  console.log("  ok  teacher progress: matched by mobile, behind first, daily snapshots for the trend");
}

// ── Wiring ─────────────────────────────────────────────────────────────
{
  const root = join(__dirname, "../../../../extensions/office-robot");
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
    description: string;
    host_permissions: string[];
    content_scripts: { matches: string[]; js: string[] }[];
  };
  assert.ok(manifest.description.length <= 132, "Chrome Web Store caps the description at 132");
  assert.ok(
    manifest.content_scripts.some((c) => c.matches.includes("https://nucleus.leadgroup.co.in/*") && c.js.includes("content-propel.js")),
    "the Propel panel runs on Nucleus",
  );
  assert.deepEqual(manifest.host_permissions, ["https://bhbinternational.school/*"], "no new host permission");
  const panel = readFileSync(join(root, "content-propel.js"), "utf8");
  assert.ok(!/setInterval|chrome\.alarms/.test(panel), "no timers: every move is a click");
  assert.ok((panel.match(/window\.confirm\(/g) || []).length >= 2, "both sends ask first");
  assert.ok(!/\bDELETE\b|inactivate|is_active:\s*false/.test(panel), "the robot never deletes or deactivates on Propel");
  const bg = readFileSync(join(root, "background.js"), "utf8");
  for (const t of ["propel-calendar", "propel-teachers", "propel-students-file", "propel-tests", "propel-progress"]) {
    assert.ok(bg.includes(`"${t}"`), `${t} is relayed`);
  }
  console.log("  ok  wiring: manifest, panel asks before sending, never deletes, relays");
}

console.log("\nAll Propel robot checks passed.");
