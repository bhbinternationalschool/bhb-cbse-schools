/**
 * The staff keyword bot answers a staff member only when summoned.
 *
 * It used to answer everything the ERP command desk stepped aside from.
 * On a number staff also use to talk to the school, that is a bot cutting
 * into conversation: a greeting got a menu, a half-typed thought got a
 * canned line about admissions. A parent or a visitor has nothing BUT
 * that bot, so nothing changes for them — this is a staff-only rule.
 *
 * Run: npx tsx src/lib/staffBotSwitch.selftest.ts
 */
import assert from "node:assert/strict";

import {
  isUnifiedMenuCommand,
  parseStaffBotSwitch,
  staffBotAwake,
  STAFF_BOT_WINDOW_MINUTES,
} from "./waUnifiedBotEngine";

console.log("staffBotSwitch.selftest.ts");

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

console.log("OK");
