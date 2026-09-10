/**
 * Run: npx tsx src/lib/waTutorBotEngine.selftest.ts
 */
import assert from "node:assert/strict";
import {
  composeNeedsPassText,
  composePlansText,
  composeTutorStatus,
  isReservedBotWord,
  parseWaTutorCommand,
  passDaysLeft,
  tutorSessionExpired,
  TUTOR_SESSION_TTL_MS,
} from "./waTutorBotEngine";

console.log("waTutorBotEngine.selftest.ts");

const open = (t: string) => parseWaTutorCommand(t, true);
const closed = (t: string) => parseWaTutorCommand(t, false);

// --- opening and closing ------------------------------------------------
{
  assert.deepEqual(closed("TUTOR"), { kind: "open" });
  assert.deepEqual(closed("tutor"), { kind: "open" });
  assert.deepEqual(closed("TUTOR OFF"), { kind: "close" });
  assert.deepEqual(closed("tutor stop"), { kind: "close" });
  assert.deepEqual(closed("TUTOR 2"), { kind: "child", index: 2 });
  assert.deepEqual(closed("CHILD 1"), { kind: "child", index: 1 });
}

// --- modes, with and without the question on the same line -------------
{
  assert.deepEqual(closed("TEACH"), {
    kind: "mode",
    mode: "teach",
    question: "",
  });
  assert.deepEqual(closed("TEACH photosynthesis for class V"), {
    kind: "mode",
    mode: "teach",
    question: "photosynthesis for class V",
  });
  assert.equal(closed("HINT").kind, "mode");
  assert.equal(closed("HINTS").kind, "mode");
  assert.equal(closed("HW").kind, "mode");
  assert.equal(closed("CHECK").kind, "mode");
  // "check" is scoring the child's answer, not a different feature.
  assert.equal(
    (closed("CHECK") as { mode: string }).mode,
    "score",
  );
}

// --- passes -------------------------------------------------------------
{
  assert.deepEqual(closed("PASS"), { kind: "plans" });
  assert.deepEqual(closed("BUY"), { kind: "plans" });
  assert.deepEqual(closed("PASS 2"), { kind: "buy", index: 2 });
  assert.deepEqual(closed("buy 1"), { kind: "buy", index: 1 });
}

// --- free text only becomes a question when a session is OPEN ----------
{
  // The parent never asked for the tutor, so the tutor must not answer.
  assert.deepEqual(closed("what is photosynthesis"), { kind: "none" });
  assert.deepEqual(open("what is photosynthesis"), {
    kind: "question",
    text: "what is photosynthesis",
  });
}

// --- an open session never swallows the school's other keywords --------
{
  // A parent mid-session who types PAY wants to pay a fee.
  for (const word of ["PAY", "DUES", "KIDS", "RECEIPTS", "HUMAN", "MENU", "HI"]) {
    assert.deepEqual(
      open(word),
      { kind: "none" },
      `${word} must stay with the school bot`,
    );
    assert.equal(isReservedBotWord(word), true);
  }
  // …including with an argument, e.g. PAY 1 for one child.
  assert.deepEqual(open("PAY 1"), { kind: "none" });
}

// --- a leading mode word carries the rest of the line as the question ---
{
  // The topic must survive: reading this as a question in whatever mode
  // happened to be open would answer it as a hint when the parent plainly
  // asked to be taught. And it must not become an EMPTY teach either,
  // which would throw the sentence away and ask them to type it again.
  assert.deepEqual(open("teach me about fractions please"), {
    kind: "mode",
    mode: "teach",
    question: "me about fractions please",
  });
  assert.deepEqual(open("TEACH long division"), {
    kind: "mode",
    mode: "teach",
    question: "long division",
  });
  // A sentence with no mode word is just a question.
  assert.deepEqual(open("can you explain fractions"), {
    kind: "question",
    text: "can you explain fractions",
  });
}

// --- blank input does nothing ------------------------------------------
{
  assert.deepEqual(open(""), { kind: "none" });
  assert.deepEqual(open("   "), { kind: "none" });
}

// --- days left counts part of today as a day ---------------------------
{
  const now = new Date("2026-09-10T12:00:00Z");
  assert.equal(passDaysLeft("2026-09-10T18:00:00Z", now), 1);
  assert.equal(passDaysLeft("2026-09-13T12:00:00Z", now), 3);
  assert.equal(passDaysLeft("2026-09-09T12:00:00Z", now), 0, "expired");
  assert.equal(passDaysLeft("nonsense", now), 0);
}

// --- sessions go stale rather than capturing tomorrow's "hi" -----------
{
  const now = new Date("2026-09-10T12:00:00Z");
  assert.equal(tutorSessionExpired(null, now), true);
  assert.equal(
    tutorSessionExpired(
      { mobile10: "9876500001", studentId: "s1", mode: "teach", updatedAt: new Date(now.getTime() - 1000).toISOString() },
      now,
    ),
    false,
  );
  assert.equal(
    tutorSessionExpired(
      { mobile10: "9876500001", studentId: "s1", mode: "teach", updatedAt: new Date(now.getTime() - TUTOR_SESSION_TTL_MS - 1000).toISOString() },
      now,
    ),
    true,
  );
  assert.equal(
    tutorSessionExpired(
      { mobile10: "9876500001", studentId: "s1", mode: "teach", updatedAt: "" },
      now,
    ),
    true,
  );
}

// --- the status message says where the family stands -------------------
{
  const base = {
    guardianName: "Ravi",
    children: [
      { name: "Asha", classLabel: "V-A" },
      { name: "Kabir", classLabel: "VII-B" },
    ],
    activeChild: 0,
    mode: null,
    now: new Date("2026-09-10T12:00:00Z"),
  };

  const free = composeTutorStatus({
    ...base,
    allowance: {
      studentId: "s1",
      studentName: "Asha",
      classLabel: "V-A",
      freeHintsPerDay: 5,
      freeUsedToday: 2,
      pass: null,
      passMessagesPerDay: 60,
      passUsedToday: 0,
    },
  });
  assert.match(free, /Free hints left today: \*3\* of 5/);
  assert.match(free, /PASS/);
  // Both children are offered, and the active one is marked.
  assert.match(free, /TUTOR 1\* — Asha/);
  assert.match(free, /TUTOR 2\* — Kabir/);
  assert.match(free, /← now/);

  const paid = composeTutorStatus({
    ...base,
    allowance: {
      studentId: "s1",
      studentName: "Asha",
      classLabel: "V-A",
      freeHintsPerDay: 5,
      freeUsedToday: 5,
      pass: {
        planCode: "tutor_week",
        planLabel: "1 week",
        startsAt: "2026-09-08T00:00:00Z",
        endsAt: "2026-09-15T00:00:00Z",
      },
      passMessagesPerDay: 60,
      passUsedToday: 3,
    },
  });
  // With a pass, the free-hint count is not the story.
  assert.match(paid, /Pass active/);
  assert.match(paid, /5 days left/);
  assert.doesNotMatch(paid, /Free hints left/);
}

// --- a single-child family is never asked to pick ----------------------
{
  const one = composeTutorStatus({
    guardianName: "Ravi",
    children: [{ name: "Asha", classLabel: "V-A" }],
    activeChild: 0,
    allowance: null,
    mode: "teach",
  });
  assert.doesNotMatch(one, /TUTOR 1\*/);
  assert.match(one, /For \*Asha\* \(V-A\)/);
  assert.match(one, /Now in \*TEACH\*/);
}

// --- plans list, and the honest note when a pass is already running ----
{
  const plans = [
    { code: "tutor_day", label: "1 day", days: 1, pricePaise: 4900 },
    { code: "tutor_week", label: "1 week", days: 7, pricePaise: 19900 },
  ];
  const text = composePlansText({ plans, childName: "Asha", hasPass: false });
  assert.match(text, /PASS 1\* — 1 day, ₹49/);
  assert.match(text, /PASS 2\* — 1 week, ₹199/);

  const topUp = composePlansText({
    plans,
    childName: "Asha",
    hasPass: true,
    passEndsAt: "2026-09-13T12:00:00Z",
    now: new Date("2026-09-10T12:00:00Z"),
  });
  assert.match(topUp, /already has a pass with 3 days left/);
  assert.match(topUp, /adds time on top/);

  // Nothing on sale must not render an empty list.
  assert.match(
    composePlansText({ plans: [], childName: "Asha", hasPass: false }),
    /school office/,
  );
}

// --- a refusal always carries the next step ---------------------------
{
  const withBuy = composeNeedsPassText({
    mode: "teach",
    reason: "Today's free hints are used up.",
    childName: "Asha",
    canBuy: true,
  });
  assert.match(withBuy, /Today's free hints are used up\./);
  assert.match(withBuy, /Reply \*PASS\*/);

  // With no online payment, do not tell them to reply PASS — it would
  // dead-end. Point at the office instead.
  const noBuy = composeNeedsPassText({
    mode: "teach",
    reason: "Today's free hints are used up.",
    childName: "Asha",
    canBuy: false,
  });
  assert.doesNotMatch(noBuy, /Reply \*PASS\*/);
  assert.match(noBuy, /school office/);
}

console.log("OK — waTutorBotEngine.selftest.ts");
