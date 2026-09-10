/**
 * Run: npx tsx src/lib/waStudentLinkEngine.selftest.ts
 *
 * The scope rule is the reason this feature is safe to switch on, so most
 * of these assertions are about a child's phone being refused things.
 */
import assert from "node:assert/strict";
import {
  composeLinkCodeText,
  composeLinkMenu,
  composeStudentRefusal,
  composeStudentWelcome,
  linkCodeUsable,
  parseParentLinkCommand,
  parseStudentLinkCode,
  STUDENT_DENIED,
  studentScopeCheck,
} from "./waStudentLinkEngine";

console.log("waStudentLinkEngine.selftest.ts");

// --- THE rule: a student's phone gets study help and nothing else ------
{
  for (const word of ["TUTOR", "HINT", "TEACH", "PRACTICE", "SCORE", "HOMEWORK", "EXAM"]) {
    assert.equal(
      studentScopeCheck(word).allowed,
      true,
      `${word} is study help and must be allowed`,
    );
  }

  // Family data must never reach a child's handset.
  for (const word of ["DUES", "RECEIPTS", "KIDS", "COMPLAINT", "HUMAN", "INFO"]) {
    const v = studentScopeCheck(word);
    assert.equal(v.allowed, false, `${word} must be refused`);
    assert.equal(v.allowed === false && v.reason, "family_data");
  }

  // Money is never in a child's hands.
  for (const word of ["PAY", "PASS", "BUY"]) {
    const v = studentScopeCheck(word);
    assert.equal(v.allowed, false, `${word} must be refused`);
    assert.equal(v.allowed === false && v.reason, "money");
  }

  // Case and arguments do not get round it.
  assert.equal(studentScopeCheck("dues").allowed, false);
  assert.equal(studentScopeCheck("pay 1").allowed, false);
  assert.equal(studentScopeCheck("  RECEIPTS  ").allowed, false);
}

// --- an unknown word is the child's QUESTION, not a refusal -----------
{
  // Refusing unknown words would make the tutor unusable: every question a
  // child types starts with a word that is not a keyword.
  assert.equal(studentScopeCheck("what is photosynthesis").allowed, true);
  assert.equal(studentScopeCheck("").allowed, true);
  assert.equal(studentScopeCheck("fractions").allowed, true);
}

// --- the denied list is closed, not derived --------------------------
{
  // If this ever shrinks, something has widened what a child's phone can
  // read — which is exactly the change that should fail a test.
  for (const word of ["DUES", "PAY", "RECEIPTS", "PASS", "BUY", "KIDS"]) {
    assert.ok(STUDENT_DENIED.has(word), `${word} must stay denied`);
  }
}

// --- what the parent types -------------------------------------------
{
  assert.deepEqual(parseParentLinkCommand("LINK"), { kind: "list" });
  assert.deepEqual(parseParentLinkCommand("links"), { kind: "list" });
  assert.deepEqual(parseParentLinkCommand("LINK 1 9876543210"), {
    kind: "start",
    index: 1,
    mobile10: "9876543210",
  });
  // 91-prefixed, spaced and +91 forms all mean the same handset.
  assert.deepEqual(parseParentLinkCommand("LINK 2 +91 98765 43210"), {
    kind: "start",
    index: 2,
    mobile10: "9876543210",
  });
  assert.deepEqual(parseParentLinkCommand("LINK 2 09876543210"), {
    kind: "start",
    index: 2,
    mobile10: "9876543210",
  });
  assert.deepEqual(parseParentLinkCommand("UNLINK 1"), {
    kind: "revoke",
    index: 1,
  });
  // A number that is not an Indian mobile falls back to the menu rather
  // than starting a link to nothing.
  assert.deepEqual(parseParentLinkCommand("LINK 1 1234567890"), {
    kind: "list",
  });
  assert.deepEqual(parseParentLinkCommand("LINK 1 12345"), { kind: "list" });
  assert.deepEqual(parseParentLinkCommand("DUES"), { kind: "none" });
  assert.deepEqual(parseParentLinkCommand(""), { kind: "none" });
}

// --- what the student sends -------------------------------------------
{
  assert.equal(parseStudentLinkCode("123456"), "123456");
  assert.equal(parseStudentLinkCode("LINK 123456"), "123456");
  assert.equal(parseStudentLinkCode("link 123456"), "123456");
  // Not a code: a 5- or 7-digit number, or a code buried in a sentence.
  assert.equal(parseStudentLinkCode("12345"), "");
  assert.equal(parseStudentLinkCode("1234567"), "");
  assert.equal(parseStudentLinkCode("my code is 123456"), "");
  assert.equal(parseStudentLinkCode(""), "");
}

// --- codes are single-use and expire ----------------------------------
{
  const now = new Date("2026-09-10T12:00:00Z");
  assert.equal(
    linkCodeUsable({ expiresAt: "2026-09-11T12:00:00Z", now }).ok,
    true,
  );
  const used = linkCodeUsable({
    expiresAt: "2026-09-11T12:00:00Z",
    usedAt: "2026-09-10T11:00:00Z",
    now,
  });
  assert.equal(used.ok, false);
  assert.match(used.reason || "", /already been used/);

  const expired = linkCodeUsable({ expiresAt: "2026-09-09T12:00:00Z", now });
  assert.equal(expired.ok, false);
  assert.match(expired.reason || "", /expired/);

  assert.equal(linkCodeUsable({ expiresAt: "nonsense", now }).ok, false);
}

// --- the parent's menu says what the child will and will not get ------
{
  const menu = composeLinkMenu({
    children: [
      { name: "Asha", classLabel: "V-A" },
      { name: "Kabir", classLabel: "VII-B", linkedMobile10: "9876543210" },
    ],
  });
  // The limits are stated up front, not discovered later.
  assert.match(menu, /study help only/);
  assert.match(menu, /never fees, receipts or payments/);
  assert.match(menu, /cannot buy a pass/);
  assert.match(menu, /1\. \*Asha\* \(V-A\) — not linked/);
  assert.match(menu, /2\. \*Kabir\* \(VII-B\) — linked to 98765 43210/);
  assert.match(menu, /LINK 1 9876543210/);
  assert.match(menu, /UNLINK 1/);

  assert.match(composeLinkMenu({ children: [] }), /school office/);
}

// --- the code goes to the PARENT, and says so -------------------------
{
  const t = composeLinkCodeText({
    code: "123456",
    childName: "Asha",
    mobile10: "9876543210",
  });
  assert.match(t, /Code for Asha: 123456/);
  assert.match(t, /Give this code to Asha/);
  assert.match(t, /98765 43210/);
  assert.match(t, /lasts 24 hours and works once/);
}

// --- a refusal points the child somewhere real ------------------------
{
  const money = composeStudentRefusal("money");
  assert.match(money, /bought by a parent/);
  assert.match(money, /reply \*PASS\* on their own WhatsApp/);

  const data = composeStudentRefusal("family_data");
  assert.match(data, /study help only/);
  assert.match(data, /parent's WhatsApp/);
  // Never tell a child to reply PASS themselves — it would dead-end.
  assert.doesNotMatch(data, /reply \*PASS\*/);
}

// --- the student's welcome offers study help and nothing else ---------
{
  const w = composeStudentWelcome({ studentName: "Asha", classLabel: "V-A" });
  assert.match(w, /Welcome, \*Asha\*/);
  assert.match(w, /HINT/);
  assert.match(w, /TEACH/);
  // It must not advertise anything a student cannot do.
  for (const word of ["DUES", "RECEIPTS", "PASS", "COMPLAINT"]) {
    assert.doesNotMatch(w, new RegExp(`\\*${word}\\*`), `${word} offered to a student`);
  }
  assert.match(w, /stay with your parent's number/);
}

console.log("OK — waStudentLinkEngine.selftest.ts");
