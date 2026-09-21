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
  appendTutorTurns,
  tutorHistoryFor,
  WA_TUTOR_MAX_TURNS,
  WA_TUTOR_TURN_MAX_CHARS,
  tutorReplyFromPayload,
  tutorSessionsInProgress,
  TUTOR_SESSION_LIVE_HOURS,
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

// --- a refusal always carries the next step, and the RIGHT one --------
{
  const base = {
    mode: "teach" as const,
    reason: "Today's free hints are used up.",
    childName: "Asha",
  };

  const self = composeNeedsPassText({ ...base, buy: "self" });
  assert.match(self, /Today's free hints are used up\./);
  assert.match(self, /Reply \*PASS\*/);

  // A student's own number: point at the parent. Never "reply PASS" (it
  // would dead-end) and never the office (the parent can fix it today).
  const parent = composeNeedsPassText({ ...base, buy: "parent" });
  assert.match(parent, /Ask a parent to reply \*PASS\* on their own WhatsApp/);
  assert.doesNotMatch(parent, /^Reply \*PASS\*/m);
  assert.doesNotMatch(parent, /school office/);

  // No gateway at all: the office is the only honest route.
  const off = composeNeedsPassText({ ...base, buy: "off" });
  assert.match(off, /school office/);
  assert.doesNotMatch(off, /Reply \*PASS\*/);
}

/* ── Conversation memory on WhatsApp (2026-09-16) ─────────────────────
 * Every WhatsApp message used to reach the model alone. The exam-eve
 * practice asked question 1, the child replied "3/4", and the model, shown
 * only "3/4", could not know what it answered. These hold down that the
 * session now carries the exchange, for the right child, within bounds. */
{
  const q1 = "Q1. What fraction of a pizza is left if 1 of 4 slices is eaten?";
  let turns = appendTutorTurns([], "EXAM practice for Class IV fractions", q1);
  assert.equal(turns.length, 2);
  assert.equal(turns[1]!.content, q1, "the question asked is remembered");

  const session = {
    mobile10: "9000000000",
    studentId: "stu_arav",
    mode: "exam" as const,
    updatedAt: new Date().toISOString(),
    turns,
  };

  const history = tutorHistoryFor(session, "stu_arav");
  assert.ok(
    history.some((t) => t.role === "assistant" && t.content === q1),
    "the child's '3/4' is sent WITH the question it answers",
  );

  assert.deepEqual(
    tutorHistoryFor(session, "stu_ansh"),
    [],
    "one child's practice is never another child's context",
  );
  assert.deepEqual(tutorHistoryFor(null, "stu_arav"), [], "no session, no history");

  // Bounded: a long practice keeps the latest exchanges only.
  for (let i = 0; i < 20; i++) turns = appendTutorTurns(turns, `answer ${i}`, `Q${i + 2}`);
  assert.equal(turns.length, WA_TUTOR_MAX_TURNS, "history is capped");
  assert.equal(turns[turns.length - 1]!.content, "Q21", "and keeps the most recent");

  const long = appendTutorTurns([], "x", "y".repeat(5000));
  assert.ok(
    long[1]!.content.length <= WA_TUTOR_TURN_MAX_CHARS + 1,
    "one long reply cannot bloat the saved bundle",
  );
}

/* ── the tutor's answer must survive the trip back ──────────────────── */
//
// 18 Sep 2026: an answer comes back wrapped, a refusal comes back flat, and
// the bot read only the flat shape — so every answer was dropped and eleven
// families were told study help had failed after it had already answered
// (and after their free tutor day was charged).
{
  assert.equal(
    tutorReplyFromPayload({ ok: true, data: { reply: "'चित्रकार' सही उत्तर है।" } }),
    "'चित्रकार' सही उत्तर है।",
    "the wrapped answer is the one the route actually sends",
  );
  // The older flat shape still reads, so this cannot break by being reverted.
  assert.equal(tutorReplyFromPayload({ ok: true, reply: "hello" }), "hello");
  // A refusal carries no reply, and must not be mistaken for one.
  assert.equal(tutorReplyFromPayload({ ok: false, error: "Free hints are over", needsPass: true }), "");
  // Nothing usable is an empty string, never a crash.
  for (const junk of [null, undefined, "", 42, {}, { data: {} }, { data: { reply: "   " } }, { reply: "  " }]) {
    assert.equal(tutorReplyFromPayload(junk), "", JSON.stringify(junk ?? null));
  }
  // Whitespace is trimmed, not treated as an answer.
  assert.equal(tutorReplyFromPayload({ data: { reply: "  ok  " } }), "ok");
}


// --- a child mid-practice is not thanked for their chat -----------------
{
  // 21 Sep 2026: fifteen closings landed straight after one of the tutor's
  // exam-eve questions, 39–65 minutes later the same evening.
  const now = new Date("2026-09-20T14:00:00.000Z");
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

  const live = tutorSessionsInProgress(
    [
      { mobile10: "9876500001", updatedAt: ago(0.75) },   // asked a question 45 min ago
      { mobile10: "919876500002", updatedAt: ago(3) },    // stored with the country code
      { mobile10: "9876500003", updatedAt: ago(TUTOR_SESSION_LIVE_HOURS + 1) }, // yesterday's
      { mobile10: "9876500004", updatedAt: "" },          // undated
      { mobile10: "12", updatedAt: ago(1) },              // not a number
    ],
    now,
  );
  assert.ok(live.has("9876500001"), "a question asked 45 minutes ago is still open");
  assert.ok(live.has("9876500002"), "keyed by the bare ten digits, whatever form was stored");
  assert.ok(!live.has("9876500003"), "a session idle past the window is abandoned, not waiting");
  assert.ok(!live.has("9876500004"), "an undated session is not evidence of a child at work");
  assert.equal(live.size, 2);

  // Just inside and just outside the window.
  assert.ok(tutorSessionsInProgress([{ mobile10: "9876500005", updatedAt: ago(TUTOR_SESSION_LIVE_HOURS - 0.1) }], now).has("9876500005"));
  assert.equal(tutorSessionsInProgress([{ mobile10: "9876500005", updatedAt: ago(TUTOR_SESSION_LIVE_HOURS + 0.1) }], now).size, 0);

  // Same half-day as the drill guard, on purpose: two rules about "is this
  // family still working?" that disagree would close one and not the other.
  assert.equal(TUTOR_SESSION_LIVE_HOURS, 12);
}

console.log("OK — waTutorBotEngine.selftest.ts");
