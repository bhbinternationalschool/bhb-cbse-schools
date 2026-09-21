/**
 * Run: npx tsx src/lib/waHouseholdNumbers.selftest.ts
 */
import assert from "node:assert/strict";
import {
  householdCandidateNumbers,
  pickWaNumbers,
  liveNumberInstead,
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

// --- the set arrives in the form production actually uses --------------
{
  // 21 Sep 2026: every set above is ten-digit, so this file passed while
  // production never skipped a number. `listKnownNotOnWhatsApp` — the only
  // thing that fills the set outside a test — returns E.164, and the picker
  // looked up the bare ten digits. Test with what the caller really passes.
  const c = householdCandidateNumbers({
    household: { whatsappMobile: "9876500001", mobile: "9876500002" },
  });
  const e164 = pickWaNumbers(c, new Set(["919876500001"]));
  assert.equal(e164.primary?.mobile10, "9876500002", "E.164 dead number is skipped");
  assert.equal(e164.skipped.length, 1);
  assert.equal(e164.skipped[0]!.mobile10, "9876500001");

  // And the other forms we store — "+91 …", with spaces — mean the same number.
  const plus = pickWaNumbers(c, new Set(["+91 98765 00001"]));
  assert.equal(plus.primary?.mobile10, "9876500002");

  // A malformed entry in the set is not a number and skips nothing.
  const junk = pickWaNumbers(c, new Set(["", "12", "abc"]));
  assert.equal(junk.primary?.mobile10, "9876500001");
  assert.equal(junk.skipped.length, 0);
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

// --- keep a sender's number unless it is dead ---------------------------
{
  // Exam-eve and the fee-reminder card already chose one number each. A
  // working one is never swapped; only a dead one, or a placeholder.
  const c = householdCandidateNumbers({
    household: { whatsappMobile: "9876500001", mobile: "9876500002" },
    students: [{ motherMobile: "9876500003" }],
  });

  const kept = liveNumberInstead("9876500001", c, new Set());
  assert.deepEqual(kept, { mobile10: "9876500001", replaced: false, label: "" }, "a working number is left alone");

  // Dead, in the E.164 form production passes → the next working number.
  const swapped = liveNumberInstead("9876500001", c, new Set(["919876500001"]));
  assert.equal(swapped?.mobile10, "9876500002");
  assert.equal(swapped?.replaced, true);

  // A placeholder is not a number, dead or alive — "0000000000" was the
  // stored number for three children on 21 Sep 2026.
  const placeholder = liveNumberInstead("0000000000", c, new Set());
  assert.equal(placeholder?.mobile10, "9876500001", "a placeholder falls to a real number");
  assert.equal(placeholder?.replaced, true);

  // Every number dead → null. The caller must say so, not drop the family.
  assert.equal(
    liveNumberInstead("9876500001", c, new Set(["919876500001", "919876500002", "919876500003"])),
    null,
  );
  // No candidates to fall to, and the planned one is dead → null too.
  assert.equal(liveNumberInstead("9876500001", [], new Set(["919876500001"])), null);
  // No candidates, but the planned one works → it stands.
  assert.equal(liveNumberInstead("9876500001", [], new Set())?.mobile10, "9876500001");
}

console.log("OK — waHouseholdNumbers.selftest.ts");
