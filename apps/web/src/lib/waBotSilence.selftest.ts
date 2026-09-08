/**
 * When the WhatsApp bots speak, and when they stay quiet.
 *
 * Two rules, both learned from a live number.
 *
 * STAFF. The keyword bot used to answer everything the ERP command desk
 * stepped aside from. On a number staff also use to talk to the school,
 * that is a bot cutting into conversation. It now waits to be summoned.
 *
 * OUTSIDERS. The visitor flow had no notion of giving up, so it never
 * did — one number was sent the purpose menu on every message for three
 * weeks. A parent or a visitor has nothing BUT these bots, so the fix is
 * to answer them better, not less.
 *
 * Run: npx tsx src/lib/waBotSilence.selftest.ts
 */
import assert from "node:assert/strict";

import {
  detectVisitorPurpose,
  isUnifiedMenuCommand,
  shouldShowUnifiedMenu,
  looksLikeForward,
  parseStaffBotSwitch,
  readVisitorName,
  staffBotAwake,
  STAFF_BOT_WINDOW_MINUTES,
  VISITOR_ASK_LIMIT,
  VISITOR_NAME_MAX,
} from "./waUnifiedBotEngine";

console.log("waBotSilence.selftest.ts");

// ── Summoning it ──────────────────────────────────────────────────────
for (const t of [
  "school bot",
  "School Bot",
  "  schoolbot  ",
  "school bot start",
  "school bot on",
  "bot on",
  "start bot",
  "bot chalu",
  "स्कूल बॉट",
]) {
  assert.equal(parseStaffBotSwitch(t), "on", `"${t}" should start the bot`);
}

for (const t of ["bot off", "bot band", "stop bot", "exit bot", "बॉट बंद"]) {
  assert.equal(parseStaffBotSwitch(t), "off", `"${t}" should close the bot`);
}

// Everything else is an ordinary message. These are the ones that matter:
// a sentence that merely CONTAINS the word must not flip the switch,
// because the whole point is that ordinary talk goes unanswered rather
// than being interpreted.
for (const t of [
  "school bot is not working",
  "is the school bot down?",
  "bot",
  "the bot said something odd",
  "school",
  "5A me aaj kaun absent hai",
  "",
  "kal chhutti hai kya",
]) {
  assert.equal(parseStaffBotSwitch(t), null, `"${t}" must not be a switch`);
}

// ── How long it stays awake ───────────────────────────────────────────
const now = Date.parse("2026-09-07T10:00:00.000Z");
const inMinutes = (m: number) => new Date(now + m * 60_000).toISOString();
assert.equal(staffBotAwake(inMinutes(STAFF_BOT_WINDOW_MINUTES), now), true);
assert.equal(staffBotAwake(inMinutes(1), now), true);
assert.equal(staffBotAwake(inMinutes(-1), now), false, "expired is asleep");
assert.equal(staffBotAwake("", now), false, "never summoned is asleep");
assert.equal(staffBotAwake(undefined, now), false);
assert.equal(staffBotAwake("not a date", now), false);
// The default has to be OFF. A bug that reads as "awake" would put the
// interruption straight back, and nobody would notice it had.
assert.equal(staffBotAwake(undefined, now), false);

// ── Who still gets the greeting menu ──────────────────────────────────
// A parent or a visitor has only the bot. Nothing about them changes.
for (const t of ["hi", "Hello", "namaste", "hey", "menu", "main", "start", "help", ""]) {
  assert.equal(
    isUnifiedMenuCommand(t),
    true,
    `"${t}" must still open the menu for a parent or visitor`,
  );
}

// A staff member keeps the EXPLICIT ones, so there is always a way back
// without having to remember a new phrase.
for (const t of ["menu", "main", "start", ""]) {
  assert.equal(
    isUnifiedMenuCommand(t, { staff: true }),
    true,
    `"${t}" is an explicit ask and still resets`,
  );
}

// …and loses the ones that are just conversation.
for (const t of ["hi", "hello", "namaste", "hey"]) {
  assert.equal(
    isUnifiedMenuCommand(t, { staff: true }),
    false,
    `"${t}" from a colleague is a greeting, not a menu request`,
  );
}

// "help" is the one that sent a director to the visitor menu on the first
// day of the pilot. It belongs to the command desk, which sits after this
// check — so this must let it through.
assert.equal(
  isUnifiedMenuCommand("help", { staff: true }),
  false,
  "a staff member's help is a question for the desk",
);

// ── An outsider who is not asking anything ────────────────────────────
//
// Found live on 2026-09-07: one number had been sent the purpose menu on
// every message since 18 August. Twenty-one messages in, ten-plus replies
// out, every one of them addressed to
//
//   "https://www.facebook.com/share/r/1BkJUpZ93g/good morning have a glorious day"
//
// which is what the bot had accepted as the person's name, because
// `collect_name` took anything two characters or longer. Three faults in
// one thread: a name that was not a name, a forward that got answered,
// and a bot with no notion of giving up.

// A forward is logged, never answered.
for (const t of [
  "https://www.facebook.com/share/r/1BkJUpZ93g/good morning have a glorious day",
  "https://www.threads.com/share/_vLabZ3cD/",
  "https://www.facebook.com/share/p/19LkPECDWN/",
  "www.youtube.com/watch?v=abc",
  "Good morning https://example.com/x",
  "",
  "   ",
]) {
  assert.equal(looksLikeForward(t), true, `"${t}" is a broadcast, not a question`);
}

// A real message that happens to carry a link still gets answered — the
// rule is about broadcasts, not about the character ":" appearing.
for (const t of [
  "Hello, I want admission for my son in class 3, details here https://x.com/a",
  "I am a vendor of school furniture, my catalogue is at www.abc.com please check",
  "my daughter needs a bus from Sarnath, is there a route",
  "JOB",
  "Rajesh Kumar",
]) {
  assert.equal(looksLikeForward(t), false, `"${t}" says something`);
}

// ── What may be recorded as somebody's name ───────────────────────────
{
  const ok = (t: string) => {
    const r = readVisitorName(t);
    assert.equal(r.ok, true, `"${t}" should read as a name`);
    return r.ok ? r.name : "";
  };
  assert.equal(ok("Rajesh Kumar"), "Rajesh Kumar");
  assert.equal(ok("  anita   devi  "), "anita devi", "whitespace is tidied");
  assert.equal(ok("Md. Arif Ansari"), "Md. Arif Ansari");
  assert.equal(ok("सुनीता शर्मा"), "सुनीता शर्मा", "a Hindi name is a name");

  const bad = (t: string, reason: string) => {
    const r = readVisitorName(t);
    assert.equal(r.ok, false, `"${t}" must not become a name`);
    if (!r.ok) assert.equal(r.reason, reason, `"${t}" → ${r.reason}, expected ${reason}`);
  };
  // The exact string that was live in production for three weeks.
  bad("https://www.facebook.com/share/r/1BkJUpZ93g/good morning have a glorious day", "link");
  bad("www.abc.com", "link");
  bad("check this out on facebook.com/xyz", "link");
  bad("", "empty");
  bad("a", "too_short");
  bad("x".repeat(VISITOR_NAME_MAX + 1), "too_long");
  bad("I am looking for admission for my son in class three please help", "too_long");
  bad("9919101755", "not_a_name", );
  bad("👍👍👍", "not_a_name");
  bad("...", "not_a_name");
}

// ── The bot has to be able to give up ─────────────────────────────────
// Not a number for its own sake: this is the difference between a thread
// that costs one message and one that costs twenty-one.
assert.ok(VISITOR_ASK_LIMIT >= 2, "one bad answer is a typo, not a dead end");
assert.ok(VISITOR_ASK_LIMIT <= 3, "more than three is the loop we are fixing");

// ── A parked caller can still get through ─────────────────────────────
// Parking silences the bot; it must not silence the person. Anything that
// names a real purpose picks them back up.
for (const [t, want] of [
  ["ADMISSION", "admission"],
  ["I want to apply for a teacher vacancy", "job"],
  ["quotation for furniture", "vendor"],
  ["is there a bus for Sarnath", "transport"],
] as const) {
  assert.equal(detectVisitorPurpose(t), want, `"${t}" un-parks as ${want}`);
}
// …and a forward still does not.
assert.equal(detectVisitorPurpose("https://www.threads.com/share/_vLabZ3cD/"), null);

console.log("OK");

// ── A voice note is not a request for the menu ────────────────────────
// isUnifiedMenuCommand("") is true — no text reads as "show me the menu"
// — and a voice note carries no text. So every voice note a staff member
// sent was answered with the greeting and never reached the command desk,
// where the transcription lives. Voice commands could not work: they were
// swallowed one step before the code that handles them.
{
  const staffVoice = {
    text: "", staff: true, known: true, hasSession: true, hasAudio: true,
  };
  assert.equal(shouldShowUnifiedMenu(staffVoice), false, "staff voice note goes to the desk");
  // Same message with no audio is still a menu request — that is what an
  // empty text has always meant, and only the voice path is being fixed.
  assert.equal(
    shouldShowUnifiedMenu({ ...staffVoice, hasAudio: false }),
    true,
    "empty text with no audio still opens the menu",
  );
  // A staff member's bare photo is unchanged: audio only.
  assert.equal(
    shouldShowUnifiedMenu({ text: "", staff: true, known: true, hasSession: true, hasAudio: false }),
    true,
  );
  // A staff member's spoken-then-typed command is a command either way.
  assert.equal(
    shouldShowUnifiedMenu({ text: "5A me aaj kaun absent hai", staff: true, known: true, hasSession: true, hasAudio: false }),
    false,
  );
  // Staff keep the explicit way back to the old bot.
  for (const t of ["menu", "main", "start"]) {
    assert.equal(
      shouldShowUnifiedMenu({ text: t, staff: true, known: true, hasSession: true, hasAudio: false }),
      true,
      `staff still get the menu for "${t}"`,
    );
  }
  // A visitor forwarding a link is still not asking for the welcome.
  assert.equal(
    shouldShowUnifiedMenu({
      text: "https://fb.me/1BkJUpZ93g good morning have a glorious day",
      staff: false, known: false, hasSession: true, hasAudio: false,
    }),
    false,
  );
  // But a visitor's first "hi" still opens it.
  assert.equal(
    shouldShowUnifiedMenu({ text: "hi", staff: false, known: false, hasSession: false, hasAudio: false }),
    true,
  );
}

console.log("OK — a staff voice note reaches the desk, not the menu");
