/**
 * Run: npx tsx src/lib/waHouseholdNumbers.selftest.ts
 */
import assert from "node:assert/strict";
import {
  householdCandidateNumbers,
  pickWaNumbers,
} from "./waHouseholdNumbers";

console.log("waHouseholdNumbers.selftest.ts");

// --- order: the school's designated number first, alternate last ---------
{
  const c = householdCandidateNumbers({
    household: {
      whatsappMobile: "9876500001",
      mobile: "9876500002",
      altMobile: "9876500005",
    },
    students: [{ fatherMobile: "9876500003", motherMobile: "9876500004" }],
  });
  assert.deepEqual(
    c.map((x) => x.source),
    ["whatsapp", "guardian", "father", "mother", "alternate"],
  );
  assert.equal(c[0]!.mobile10, "9876500001");
}

// --- the same number in two fields appears once, under the first role ---
{
  const c = householdCandidateNumbers({
    household: { whatsappMobile: "9876500001", mobile: "9876500001" },
    students: [{ fatherMobile: "9876500001" }],
  });
  assert.equal(c.length, 1);
  assert.equal(c[0]!.source, "whatsapp");
}

// --- siblings' parents dedupe, but two different fathers both count -----
{
  const c = householdCandidateNumbers({
    household: null,
    students: [
      { fatherMobile: "9876500003" },
      { fatherMobile: "9876500003" },
      { fatherMobile: "9811100000" },
    ],
  });
  assert.deepEqual(c.map((x) => x.mobile10), ["9876500003", "9811100000"]);
}

// --- placeholders are not numbers ---------------------------------------
{
  // This school has eight households on 0000000000. Offering it as a
  // candidate would burn a message on it every single run.
  const c = householdCandidateNumbers({
    household: { whatsappMobile: "0000000000", mobile: "9876500002" },
  });
  assert.deepEqual(c.map((x) => x.mobile10), ["9876500002"]);

  // An Indian mobile starts 6-9; a landline or a short number is not one.
  assert.equal(
    householdCandidateNumbers({ household: { mobile: "1234567890" } }).length,
    0,
  );
  assert.equal(
    householdCandidateNumbers({ household: { mobile: "12345" } }).length,
    0,
  );
}

// --- 91-prefixed and 0-prefixed forms normalize to the same number ------
{
  const c = householdCandidateNumbers({
    household: {
      whatsappMobile: "919876500001",
      mobile: "09876500001",
      altMobile: "+91 98765 00001",
    },
  });
  assert.equal(c.length, 1, "one number written three ways is one number");
}

// --- choosing: skip only what is KNOWN bad ------------------------------
{
  const c = householdCandidateNumbers({
    household: { whatsappMobile: "9876500001", mobile: "9876500002" },
    students: [{ fatherMobile: "9876500003" }],
  });

  // Nothing known bad → the designated number, with the guardian as backup.
  const clean = pickWaNumbers(c, new Set());
  assert.equal(clean.primary?.mobile10, "9876500001");
  assert.equal(clean.fallback?.mobile10, "9876500002");
  assert.equal(clean.skipped.length, 0);

  // The designated number is dead → fall to the guardian, then the father.
  const one = pickWaNumbers(c, new Set(["9876500001"]));
  assert.equal(one.primary?.mobile10, "9876500002");
  assert.equal(one.fallback?.mobile10, "9876500003");
  assert.equal(one.skipped.length, 1);
  assert.equal(one.skipped[0]!.source, "whatsapp");

  // Two dead → the father's number carries it, with no backup left.
  const two = pickWaNumbers(c, new Set(["9876500001", "9876500002"]));
  assert.equal(two.primary?.mobile10, "9876500003");
  assert.equal(two.fallback, null);

  // All dead → genuinely unreachable. Never fall back to a bad number.
  const all = pickWaNumbers(
    c,
    new Set(["9876500001", "9876500002", "9876500003"]),
  );
  assert.equal(all.primary, null);
  assert.equal(all.fallback, null);
  assert.equal(all.usable.length, 0);
  assert.equal(all.skipped.length, 3);
}

// --- an UNCHECKED number is not a bad number ----------------------------
{
  // The whole point: only Meta's "no WhatsApp account" verdict skips a
  // number. A number nobody has checked must still be tried, or the first
  // roster check would silence families whose numbers are fine.
  const c = householdCandidateNumbers({
    household: { whatsappMobile: "9876500001", mobile: "9876500002" },
  });
  const choice = pickWaNumbers(c, new Set(["9999999999"]));
  assert.equal(choice.primary?.mobile10, "9876500001");
  assert.equal(choice.skipped.length, 0);
}

// --- a family with no usable number at all ------------------------------
{
  const choice = pickWaNumbers(
    householdCandidateNumbers({ household: { mobile: "0000000000" } }),
    new Set(),
  );
  assert.equal(choice.primary, null, "no number is not a number to send to");
}

console.log("OK — waHouseholdNumbers.selftest.ts");
