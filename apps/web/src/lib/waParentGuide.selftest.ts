/**
 * Self-test: the parent guide promises only what the bot does, fits in one
 * WhatsApp message, and every chat is closed once — not after every message.
 * Run: npx tsx src/lib/waParentGuide.selftest.ts
 */

import assert from "node:assert/strict";

import {
  GUIDE_KEYWORDS,
  parentBotGuideEn,
  parentBotGuideHi,
  parentBotIntroMessage,
  parentChatClosingMessage,
} from "./parentBotGuide";
import { alreadyClosed, shouldCloseThread } from "./parentChatClose";
import { detectSisBotIntent, detectSisFeeQuestion, detectSisFeeReplyIntent } from "./sisParentBotEngine";
import { parseWaTutorCommand } from "./waTutorBotEngine";
import { LANGUAGE_MENU_KEYWORDS } from "./householdPrefs";

console.log("waParentGuide.selftest.ts");

/* ── every keyword the guide names is one the bot acts on ─────── */

for (const k of GUIDE_KEYWORDS) {
  const known =
    detectSisBotIntent(k) !== "unknown" ||
    parseWaTutorCommand(k, false).kind !== "none" ||
    k === "MENU" ||
    LANGUAGE_MENU_KEYWORDS.includes(k);
  assert.ok(known, `the guide tells parents to type ${k}, and the bot must recognise it`);
  assert.ok(parentBotGuideHi().includes(`*${k}*`) || k === "PAY 1", `Hindi guide names ${k}`);
  assert.ok(parentBotGuideEn().includes(`*${k}*`) || k === "PAY 1", `English guide names ${k}`);
}
// The example phrases it suggests are understood too.
assert.ok(detectSisFeeQuestion("UKG की फीस कितनी है?"));
assert.ok(detectSisFeeQuestion("bus fee?") || detectSisFeeQuestion("बस की फीस?"));
assert.equal(detectSisFeeReplyIntent("जमा हो गया"), "claims_paid");
assert.equal(detectSisFeeReplyIntent("already paid"), "claims_paid");
assert.equal(detectSisFeeReplyIntent("थोड़ा समय चाहिए"), "need_time");

/* ── wording and size ─────────────────────────────────────────── */

for (const text of [parentBotIntroMessage({ guardianName: "RAMESH KUMAR" }), parentChatClosingMessage({ needsOffice: true })]) {
  assert.ok(text.length < 4096, `one WhatsApp message (${text.length})`);
  assert.match(text, /धन्यवाद|नमस्ते/);
  assert.match(text, /Thank you|Namaste/);
  assert.doesNotMatch(text, /Confirm paid/);
}
assert.match(parentChatClosingMessage({}), /धन्यवाद[\s\S]*Thank you[\s\S]*DUES/);
assert.match(parentChatClosingMessage({ needsOffice: true }), /ऑफिस तक पहुँच गया/);
assert.doesNotMatch(parentBotGuideHi({ hasTransport: false }), /\*BUS\*/, "BUS only for families on the bus");

/* ── when a chat is closed ────────────────────────────────────── */

const at = (iso: string) => new Date(iso);
const t = (msgs: [("parent" | "bot"), string][], extra: { status?: string; closingSentAt?: string } = {}) => ({
  status: extra.status ?? "bot",
  closingSentAt: extra.closingSentAt,
  messages: msgs.map(([role, a]) => ({ role, at: a })),
});
// 11:00 IST = 05:30Z
const chat = t([["parent", "2026-09-14T05:00:00Z"], ["bot", "2026-09-14T05:00:02Z"]]);
assert.deepEqual(shouldCloseThread(chat, at("2026-09-14T05:10:00Z")), { close: false, reason: "still_active" });
assert.deepEqual(shouldCloseThread(chat, at("2026-09-14T05:31:00Z")), { close: true, needsOffice: false });
// Once closed, not again — until the parent writes again.
const closed = { ...chat, closingSentAt: "2026-09-14T05:31:00Z" };
assert.ok(alreadyClosed(closed));
assert.deepEqual(shouldCloseThread(closed, at("2026-09-14T08:00:00Z")), { close: false, reason: "already_closed" });
const reopened = t([["parent", "2026-09-14T05:00:00Z"], ["bot", "2026-09-14T05:31:00Z"], ["parent", "2026-09-14T07:00:00Z"]], { closingSentAt: "2026-09-14T05:31:00Z" });
assert.equal(shouldCloseThread(reopened, at("2026-09-14T07:40:00Z")).close, true);
// A question with the office waits longer and says so.
const office = t([["parent", "2026-09-14T05:00:00Z"]], { status: "needs_staff" });
assert.equal(shouldCloseThread(office, at("2026-09-14T06:00:00Z")).close, false);
assert.deepEqual(shouldCloseThread(office, at("2026-09-14T07:05:00Z")), { close: true, needsOffice: true });
// Not at night, and never outside the 24-hour window.
assert.deepEqual(shouldCloseThread(chat, at("2026-09-14T15:00:00Z")), { close: false, reason: "quiet_hours" }); // 20:30 IST
assert.deepEqual(shouldCloseThread(chat, at("2026-09-15T04:30:00Z")), { close: false, reason: "window_closing" });
// A question the tutor asked outranks the clock: a quiet half hour is a
// child fetching their book, not the end of the chat (18 Sep 2026).
assert.deepEqual(shouldCloseThread(chat, at("2026-09-14T05:31:00Z"), { awaitingAnswer: true }), {
  close: false,
  reason: "mid_answer",
});
// …and it outranks the office's longer wait too.
assert.deepEqual(shouldCloseThread(office, at("2026-09-14T07:05:00Z"), { awaitingAnswer: true }), {
  close: false,
  reason: "mid_answer",
});
// With nobody waiting, nothing about the old behaviour changes.
assert.deepEqual(shouldCloseThread(chat, at("2026-09-14T05:31:00Z"), { awaitingAnswer: false }), {
  close: true,
  needsOffice: false,
});

// A thread the parent never wrote in is not a conversation.
assert.deepEqual(shouldCloseThread(t([["bot", "2026-09-14T05:00:00Z"]]), at("2026-09-14T06:00:00Z")), { close: false, reason: "no_parent_message" });

console.log("  ok");
