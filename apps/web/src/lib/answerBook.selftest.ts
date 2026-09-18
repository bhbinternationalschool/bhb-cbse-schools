/**
 * Self-test: the answer book's refusals.
 * Run: npx tsx apps/web/src/lib/answerBook.selftest.ts
 */
import assert from "node:assert/strict";
import {
  entryIsLive,
  worthRecording,
  kbChunkFor,
  notLiveReason,
  questionKey,
  sameQuestion,
  tidy,
  type AnswerEntry,
} from "@/lib/answerBook";

console.log("answerBook.selftest.ts");

const base: AnswerEntry = {
  id: "e1",
  question: "Security deposit kya hai?",
  variants: ["What is the security deposit?"],
  answer: "It is a refundable ₹2,000 held once per family and returned when the child leaves.",
  language: "both",
  category: "fees",
  status: "approved",
  source: "office_reply",
  sourceRef: "relay:AB12",
  validUntil: null,
  askedCount: 3,
  approvedBy: "Principal",
  approvedAt: "2026-09-19T05:00:00Z",
  updatedAt: "2026-09-19T05:00:00Z",
};

/* ── only the school speaks to parents ──────────────────────────────── */
{
  assert.equal(entryIsLive(base, "2026-09-19"), true);

  // What the office typed once is not yet the school's answer.
  assert.equal(entryIsLive({ ...base, status: "proposed" }, "2026-09-19"), false);
  assert.equal(notLiveReason({ ...base, status: "proposed" }, "2026-09-19"), "Waiting for approval");

  // Approved with nothing written in it must never answer.
  assert.equal(entryIsLive({ ...base, answer: "   " }, "2026-09-19"), false);
  assert.equal(notLiveReason({ ...base, answer: "" }, "2026-09-19"), "Waiting for an answer");

  assert.equal(entryIsLive({ ...base, status: "retired" }, "2026-09-19"), false);
  assert.equal(notLiveReason({ ...base, status: "retired" }, "2026-09-19"), "Retired");
}

/* ── an answer with a date stops on that date ───────────────────────── */
{
  const dated = { ...base, validUntil: "2026-09-30" };
  assert.equal(entryIsLive(dated, "2026-09-30"), true, "on the last day it still holds");
  assert.equal(entryIsLive(dated, "2026-10-01"), false, "the day after, it says nothing");
  assert.equal(notLiveReason(dated, "2026-10-01"), "Expired on 2026-09-30");
}

/* ── the same question twice is one question ────────────────────────── */
{
  assert.ok(sameQuestion("Security deposit kya hai?", "security deposit kya hai"));
  assert.ok(sameQuestion("What is the security deposit?", "what is security deposit"));
  assert.ok(sameQuestion("Sir, fees ka last date kya hai?", "fees last date kya hai"));
  // Different questions must not collapse into one answer.
  assert.ok(!sameQuestion("Security deposit kya hai?", "Transport fees kya hai?"));
  assert.ok(!sameQuestion("", "anything"));
  assert.equal(questionKey("   ?? "), "");
}

/* ── what reaches the knowledge base ────────────────────────────────── */
{
  const chunk = kbChunkFor(base);
  assert.ok(chunk.title.includes("Security deposit"));
  assert.ok(chunk.content.includes("refundable ₹2,000"), "the school's own words are what is stored");
  assert.ok(chunk.content.includes("What is the security deposit?"), "and the other phrasings ride along");
  assert.ok(!chunk.content.includes("holds until"), "no expiry line when there is no expiry");

  const dated = kbChunkFor({ ...base, validUntil: "2027-03-31" });
  assert.ok(dated.content.includes("holds until 2027-03-31"), "a dated answer says so inside the chunk too");

  // The same phrasing twice does not appear twice.
  const dupes = kbChunkFor({ ...base, variants: ["Security deposit kya hai", "security deposit KYA HAI?"] });
  assert.equal(dupes.content.split("Security deposit").length - 1, 1);
}

/* ── tidy ───────────────────────────────────────────────────────────── */
{
  assert.equal(tidy("  a\n\nb  ", 10), "a b");
  assert.equal(tidy(undefined, 10), "");
  assert.equal(tidy("abcdefghijk", 5), "abcde");
}

/* ── what is worth putting in front of the office ───────────────────── */
{
  // Real questions the bot actually failed on, 8–18 Sep 2026.
  for (const q of [
    "Security deposit kya hai",
    "Mere bacchon ka admission May mahine mein hua",
    "Transport ka kitna lagega",
    "Ayar tawar se 50 mtr under dihbaba mandir ke pas",
    "फीस जमा करने की आखिरी तारीख क्या है",
  ]) {
    assert.equal(worthRecording(q), true, q);
  }

  // Noise that would make the office stop opening the screen.
  for (const junk of [
    "ok", "Ok ji", "thanks", "Thank you", "hlw", "hi", "नमस्ते", "जी", "हाँ",
    "Bye", "good night", "5", "1500", "MEDIA audio", "[image (image/jpeg)]",
    "", "   ", "yes", "k",
  ]) {
    assert.equal(worthRecording(junk), false, JSON.stringify(junk));
  }

  // A single word is a keyword, not a question.
  assert.equal(worthRecording("DUES"), false);
  assert.equal(worthRecording("timetable"), false);
}

console.log("  ok — proposed and expired answers stay silent, and the school's words are what is stored");
