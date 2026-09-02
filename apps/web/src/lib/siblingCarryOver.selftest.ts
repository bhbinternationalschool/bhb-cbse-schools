/**
 * Inheriting a sibling's parent details.
 *
 * The convenience is obvious. The two ways it goes wrong are not: writing over
 * something the office typed, and copying an identity number onto a family
 * that only shares a name.
 */
import assert from "node:assert/strict";
import {
  HOUSEHOLD_CARRY_FIELDS,
  IDENTITY_FIELDS,
  NEVER_CARRY,
  PARENT_LEVEL_FIELDS,
  carryOverFromSibling,
  carryOverHousehold,
  carryOverNote,
} from "@/lib/siblingCarryOver";

const SIBLING = {
  id: "s1",
  fullName: "Darsh Yadav",
  admissionNo: "BHB-2023-24-1029",
  fatherAadhaarNumber: "111122223333",
  motherAadhaarNumber: "444455556666",
  fatherAadhaarLast4: "3333",
  fatherPan: "ABCDE1234F",
  fatherOccupation: "Farmer",
  motherOccupation: "Homemaker",
  motherTongue: "Hindi",
  religion: "Hindu",
  // child-level — must never travel
  aadhaarNumber: "999988887777",
  dob: "2018-04-01",
  penNumber: "PEN-1",
};

/** The result's type is the caller's own draft, so inherited fields are not
 *  on it statically. Read through a record view rather than widening the
 *  library's return type for the sake of a test. */
const rec = (v: unknown) => v as Record<string, unknown>;

function run() {
  /* ── Same household: the school has already decided it is one family ── */
  const same = carryOverFromSibling({
    student: { id: "s2", fullName: "Rudraksha Yadav", fatherOccupation: "" },
    siblings: [SIBLING],
    confidence: "household",
  });
  assert.equal(rec(same.student).fatherAadhaarNumber, "111122223333");
  assert.equal(rec(same.student).motherAadhaarNumber, "444455556666");
  assert.equal(rec(same.student).fatherOccupation, "Farmer");
  assert.equal(rec(same.student).motherTongue, "Hindi");
  assert.equal(same.withheld.length, 0);

  // The child's OWN identity never travels. This is the difference between a
  // convenience and a fabricated record.
  for (const f of NEVER_CARRY) {
    assert.equal(
      (same.student as Record<string, unknown>)[f],
      undefined,
      `${f} belongs to one child and must never be inherited`,
    );
  }
  assert.equal(rec(same.student).aadhaarNumber, undefined);
  assert.equal(rec(same.student).dob, undefined);

  /* ── Names only: a hint, not an identification ───────────────────────── */
  const twins = carryOverFromSibling({
    student: { id: "s3", fullName: "Someone Else" },
    siblings: [SIBLING],
    confidence: "names_only",
  });
  // The harmless things still cross…
  assert.equal(rec(twins.student).fatherOccupation, "Farmer");
  assert.equal(rec(twins.student).religion, "Hindu");
  // …the identity numbers do not, and the fact is reported rather than hidden.
  assert.equal(rec(twins.student).fatherAadhaarNumber, undefined);
  assert.equal(rec(twins.student).motherAadhaarNumber, undefined);
  assert.equal(rec(twins.student).fatherPan, undefined);
  assert.ok(twins.withheld.includes("fatherAadhaarNumber"));
  assert.ok(twins.withheld.includes("fatherPan"));
  for (const f of twins.withheld) {
    assert.ok(IDENTITY_FIELDS.has(f), `${f} was withheld but is not an identity field`);
  }

  /* ── Never overwrite what a person typed ─────────────────────────────── */
  const typed = carryOverFromSibling({
    student: {
      id: "s4",
      fatherOccupation: "Shopkeeper",
      fatherAadhaarNumber: "000011112222",
    },
    siblings: [SIBLING],
    confidence: "household",
  });
  assert.equal(rec(typed.student).fatherOccupation, "Shopkeeper", "typed value must win");
  assert.equal(rec(typed.student).fatherAadhaarNumber, "000011112222");
  assert.ok(!typed.carried.some((c) => c.field === "fatherOccupation"));

  // Whitespace is blank. " " is not an answer somebody gave.
  const spaces = carryOverFromSibling({
    student: { id: "s5", fatherOccupation: "   " },
    siblings: [SIBLING],
    confidence: "household",
  });
  assert.equal(rec(spaces.student).fatherOccupation, "Farmer");

  /* ── Nothing to inherit from ─────────────────────────────────────────── */
  const alone = carryOverFromSibling({
    student: { id: "s6" },
    siblings: [],
    confidence: "household",
  });
  assert.deepEqual(alone.carried, []);
  assert.equal(carryOverNote(alone), "", "no note when nothing was inherited");

  // The first sibling holding a value is the donor; a blank one is skipped.
  const skip = carryOverFromSibling({
    student: { id: "s7" },
    siblings: [{ id: "a", fullName: "Blank One", fatherPan: "" }, SIBLING],
    confidence: "household",
  });
  assert.equal(rec(skip.student).fatherPan, "ABCDE1234F");
  assert.ok(skip.carried.some((c) => c.from === "Darsh Yadav"));

  /* ── The note says it was inherited, not checked ─────────────────────── */
  const note = carryOverNote(same);
  assert.match(note, /copied from sibling record/i);
  assert.match(note, /Darsh Yadav/);
  assert.match(note, /Check before relying/i);

  /* ── Household: address travels, the phone number does not ───────────── */
  const hh = carryOverHousehold({
    household: { id: "h2", address: "", email: "", mobile: "", guardianName: "Ram" },
    donor: {
      id: "h1",
      address: "Baniyavapar, Ayar",
      email: "ram@example.com",
      city: "Varanasi",
      mobile: "9451408585",
      whatsappMobile: "9451408585",
    },
  });
  assert.equal(rec(hh.household).address, "Baniyavapar, Ayar");
  assert.equal(rec(hh.household).email, "ram@example.com");
  assert.equal(rec(hh.household).city, "Varanasi");
  // THE ONE THAT MATTERS: the mobile identifies a household here, so copying
  // it would merge two families and misdirect the other one's fee reminders.
  assert.equal(rec(hh.household).mobile, "", "a mobile must never be inherited");
  assert.ok(!HOUSEHOLD_CARRY_FIELDS.includes("mobile" as never));
  assert.ok(!HOUSEHOLD_CARRY_FIELDS.includes("whatsappMobile" as never));

  const noDonor = carryOverHousehold({ household: { id: "h3", address: "" }, donor: undefined });
  assert.deepEqual(noDonor.carried, []);

  // Every identity field is declared parent-level, or it would never be
  // considered for carrying at all and the withholding rule would be dead.
  for (const f of IDENTITY_FIELDS) {
    assert.ok(
      (PARENT_LEVEL_FIELDS as readonly string[]).includes(f),
      `${f} is gated as identity but never offered for carry`,
    );
  }

  console.log("siblingCarryOver selftest: ok");
}

run();
