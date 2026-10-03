/**
 * Run: npx tsx src/lib/canvaBirthday.selftest.ts
 *
 * The Canva birthday card fills the school's own design. The failures that
 * matter: a field the office named sensibly that the ERP doesn't recognise
 * (the placeholder text prints on a child's card), an empty value sent as
 * text (Canva would blank a designed line), and a pasted link the settings
 * can't turn into a design id (the feature silently stays off).
 */
import assert from "node:assert/strict";
import { canvaSubjectKey, parseCanvaDesignId, planCanvaFill, type CanvaCardValues } from "./canvaBirthday";
import { normalizeBirthdaySettings } from "./birthdayCards";

// --- links the office actually pastes -------------------------------------
assert.equal(parseCanvaDesignId("https://www.canva.com/design/DAGz1aBcDeF/abc123XYZ/edit"), "DAGz1aBcDeF");
assert.equal(parseCanvaDesignId("https://www.canva.com/design/DAGz1aBcDeF/view?utm_content=x"), "DAGz1aBcDeF");
assert.equal(parseCanvaDesignId("  https://www.canva.com/design/DAGz1aBcDeF  "), "DAGz1aBcDeF");
assert.equal(parseCanvaDesignId("DAGz1aBcDeF"), "DAGz1aBcDeF");
assert.equal(parseCanvaDesignId("https://canva.link/abc"), "", "a short link has no id in it");
assert.equal(parseCanvaDesignId("birthday card"), "");
assert.equal(parseCanvaDesignId(""), "");

// --- settings keep the id, not the whole link -----------------------------
{
  const s = normalizeBirthdaySettings({ canvaStudentDesign: "https://www.canva.com/design/DAGz1aBcDeF/xyz/edit", canvaStaffDesign: "nonsense here" });
  assert.equal(s.canvaStudentDesign, "DAGz1aBcDeF");
  assert.equal(s.canvaStaffDesign, "");
  assert.equal(normalizeBirthdaySettings({}).canvaStudentDesign, "", "off by default — built-in cards keep going");
}

// --- field names, the way an office names them ----------------------------
const v: CanvaCardValues = {
  name: "SATVIK YADAV",
  className: "Class LKG · A",
  age: 4,
  wish: "Have a wonderful year!",
  schoolName: "BHB INTERNATIONAL SCHOOL",
  dateLabel: "3 October 2026",
  signature: "Principal",
};
{
  const plan = planCanvaFill(
    {
      "Student Name": { type: "text" },
      first_name: { type: "text" },
      CLASS: { type: "text" },
      Age: { type: "text" },
      wish: { type: "text" },
      "Date": { type: "text" },
      school: { type: "text" },
      From: { type: "text" },
      Photo: { type: "image" },
      logo: { type: "image" },
      "Favourite colour": { type: "text" },
      chart1: { type: "chart" },
    },
    v,
  );
  assert.equal(plan.text["Student Name"], "SATVIK YADAV");
  assert.equal(plan.text.first_name, "SATVIK");
  assert.equal(plan.text.CLASS, "Class LKG · A");
  assert.equal(plan.text.Age, "4");
  assert.equal(plan.text.wish, "Have a wonderful year!");
  assert.equal(plan.text.Date, "3 October 2026");
  assert.equal(plan.text.school, "BHB INTERNATIONAL SCHOOL");
  assert.equal(plan.text.From, "Principal");
  assert.equal(plan.images.Photo, "photo");
  assert.equal(plan.images.logo, "logo");
  assert.deepEqual(plan.unknown.sort(), ["Favourite colour", "chart1"], "unknown fields are reported, not guessed");
}

// --- nothing to say is left as designed, never sent as "" -----------------
{
  const plan = planCanvaFill({ age: { type: "text" }, name: { type: "text" } }, { ...v, age: null });
  assert.equal("age" in plan.text, false);
  assert.deepEqual(plan.empty, ["age"]);
  assert.equal(plan.text.name, "SATVIK YADAV");
}

// --- staff: designation fills the class slot ------------------------------
{
  const plan = planCanvaFill({ designation: { type: "text" } }, { ...v, className: "PGT · Mathematics" });
  assert.equal(plan.text.designation, "PGT · Mathematics");
}

assert.equal(canvaSubjectKey("staff", "stf_1"), "staff:stf_1");
assert.equal(canvaSubjectKey("student", "stu_1"), "student:stu_1");

console.log("OK — canvaBirthday.selftest.ts");
