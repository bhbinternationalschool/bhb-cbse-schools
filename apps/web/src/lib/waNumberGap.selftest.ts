/**
 * Run: npx tsx src/lib/waNumberGap.selftest.ts
 *
 * The rule this file exists to protect: an UNCHECKED number is not a bad
 * number. Nobody has run Meta's contacts lookup over this school's roster,
 * so if "unchecked" counted as "not on WhatsApp" the counter would open
 * with a red banner naming all 600 families, the clerks would learn to
 * click past it, and the ten families who really cannot be reached would
 * stay unreachable — with a warning on screen the whole time.
 */
import assert from "node:assert/strict";
import {
  householdWaGap,
  studentsNeedingWaNumber,
  waGapFamilyCount,
  waGapHeadline,
  type WaVerdictMap,
} from "./waNumberGap";

console.log("waNumberGap.selftest.ts");

const HH = {
  id: "hh1",
  guardianName: "Ramesh Kumar",
  whatsappMobile: "9876500001",
  mobile: "9876500001",
  altMobile: "",
};

const KID = {
  id: "st1",
  fullName: "Aarav Kumar",
  fatherName: "Ramesh Kumar",
  admissionNo: "A-101",
  householdId: "hh1",
  status: "active",
  fatherMobile: "9876500002",
  motherMobile: "",
};

// --- nobody has checked → say nothing ---------------------------------
{
  assert.equal(
    householdWaGap(HH, [KID], {}),
    null,
    "an unchecked family is not a problem the office has to see",
  );
}

// --- one number confirmed dead, the other never checked ---------------
{
  const verdicts: WaVerdictMap = {
    "9876500001": { onWhatsApp: false, source: "send_failure" },
  };
  assert.equal(
    householdWaGap(HH, [KID], verdicts),
    null,
    "the father's number might work — nobody asked, so nobody is nagged",
  );
}

// --- every number confirmed dead → the real case ----------------------
{
  const verdicts: WaVerdictMap = {
    "9876500001": { onWhatsApp: false, source: "contacts_api" },
    "9876500002": { onWhatsApp: false, source: "send_failure" },
  };
  const gap = householdWaGap(HH, [KID], verdicts);
  assert.ok(gap, "this family cannot be reached at all");
  assert.equal(gap.reason, "not_on_whatsapp");
  assert.equal(gap.numbers.length, 2, "both numbers are named on the card");
  assert.ok(
    gap.numbers.every((n) => n.onWhatsApp === false),
    "and each carries its own verdict",
  );
  assert.match(gap.headline, /All 2 numbers/);
}

// --- one working number is enough -------------------------------------
{
  const verdicts: WaVerdictMap = {
    "9876500001": { onWhatsApp: false },
    "9876500002": { onWhatsApp: true },
  };
  assert.equal(
    householdWaGap(HH, [KID], verdicts),
    null,
    "messages already reach the father — do not send the clerk asking",
  );
}

// --- no usable number at all ------------------------------------------
{
  const gap = householdWaGap(
    { id: "hh2", guardianName: "Sita Devi", mobile: "0000000000" },
    [{ id: "st9", householdId: "hh2", status: "active" }],
    {},
  );
  assert.ok(gap, "a placeholder is not a number");
  assert.equal(gap.reason, "no_number");
  assert.equal(gap.numbers.length, 0);
  assert.match(gap.headline, /No mobile number/);
}

// --- the roster view: per child, per family ----------------------------
{
  const sis = {
    households: [
      HH,
      { id: "hh3", guardianName: "Vikas Rao", mobile: "9998800001" },
    ],
    students: [
      { ...KID, id: "s1", fullName: "Bina Kumar", classId: "c2" },
      { ...KID, id: "s2", fullName: "Aarav Kumar", classId: "c1" },
      {
        id: "s3",
        fullName: "Left School",
        householdId: "hh1",
        status: "inactive",
        fatherMobile: "9876500002",
      },
      {
        id: "s4",
        fullName: "Chirag Rao",
        householdId: "hh3",
        status: "active",
        fatherMobile: "",
      },
    ],
  };
  const verdicts: WaVerdictMap = {
    "9876500001": { onWhatsApp: false },
    "9876500002": { onWhatsApp: false },
    "9998800001": { onWhatsApp: false },
  };
  const labels: Record<string, string> = { s1: "II-A", s2: "I-A", s4: "V-B" };
  const rows = studentsNeedingWaNumber(sis, verdicts, {
    classLabel: (s) => labels[s.id] || "",
  });
  assert.deepEqual(
    rows.map((r) => r.studentName),
    ["Aarav Kumar", "Bina Kumar", "Chirag Rao"],
    "sorted by class then child, and the leaver is not listed",
  );
  assert.equal(waGapFamilyCount(rows), 2, "three children, two families");
  assert.equal(waGapHeadline(rows), "2 families are NOT on WhatsApp — 3 children affected");

  // The counter scopes to the family at the desk.
  const scoped = studentsNeedingWaNumber(sis, verdicts, { studentIds: ["s4"] });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0]?.studentName, "Chirag Rao");
  assert.equal(waGapHeadline(scoped), "1 family is NOT on WhatsApp — 1 child affected");

  // Fixing hh1's number clears BOTH of its children in one go.
  const fixed = studentsNeedingWaNumber(
    sis,
    { ...verdicts, "9876500001": { onWhatsApp: true } },
    { classLabel: (s) => labels[s.id] || "" },
  );
  assert.deepEqual(fixed.map((r) => r.studentName), ["Chirag Rao"]);
}

// --- an empty roster says nothing, and neither does a missing one ------
{
  assert.deepEqual(studentsNeedingWaNumber(null, {}), []);
  assert.deepEqual(studentsNeedingWaNumber({ students: [], households: [] }, {}), []);
  assert.equal(waGapHeadline([]), "");
}

console.log("  all WhatsApp number-gap assertions passed");
