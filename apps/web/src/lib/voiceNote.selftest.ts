/**
 * Parent voice notes.
 *
 * The rule under test is not "does it transcribe" but "does a voice note ever
 * get answered as if we understood it". Every path that fails to produce
 * words must come back as unusable and escalate to a human, because the
 * failure being replaced is a parent who spoke and was told the school did
 * not understand — when in truth nobody ever listened.
 *
 * The second rule is that the model's own confidence is not evidence:
 * audible:true with an empty transcript is treated as inaudible.
 *
 * Run: npx tsx src/lib/voiceNote.selftest.ts
 */
import assert from "node:assert/strict";

import {
  MAX_TRANSCRIPT_CHARS,
  MAX_VOICE_NOTE_BYTES,
  VOICE_NOTE_STAFF_NOTE,
  cleanTranscript,
  guardVoiceNote,
  labelledTranscript,
  parseVoiceNoteTranscript,
  transcriptIsUsable,
  VOICE_NOTE_PARENT_ACK,
  voiceNoteAuditDescriptor,
  voiceNoteHubNote,
  voiceNoteOutcome,
  type VoiceNoteUnusableReason,
} from "./voiceNote";

console.log("voiceNote.selftest.ts");

// WhatsApp sends ogg/opus with codec parameters attached — the guard compares
// on the type alone, or every real voice note would be refused.
{
  const g = guardVoiceNote({ mimeType: "audio/ogg; codecs=opus", byteLength: 42_000 });
  assert.equal(g.ok, true);
  assert.equal(g.ok && g.mimeType, "audio/ogg", "codec parameters are stripped");

  assert.equal(
    guardVoiceNote({ mimeType: "AUDIO/MPEG", byteLength: 10 }).ok,
    true,
    "mime comparison is case-insensitive",
  );
}

// Things we refuse before spending a model call or a budget slot.
{
  assert.deepEqual(guardVoiceNote({ mimeType: "audio/ogg", byteLength: 0 }), {
    ok: false,
    reason: "empty",
  });
  assert.deepEqual(
    guardVoiceNote({ mimeType: "audio/ogg", byteLength: MAX_VOICE_NOTE_BYTES + 1 }),
    { ok: false, reason: "too-large" },
  );
  assert.deepEqual(guardVoiceNote({ mimeType: "video/mp4", byteLength: 10 }), {
    ok: false,
    reason: "unsupported-type",
  });
  assert.deepEqual(guardVoiceNote({ mimeType: undefined, byteLength: 10 }), {
    ok: false,
    reason: "unsupported-type",
  });
  assert.equal(
    guardVoiceNote({ mimeType: "audio/ogg", byteLength: MAX_VOICE_NOTE_BYTES }).ok,
    true,
    "the cap itself is allowed — the refusal is for exceeding it",
  );
}

// The wrapping a model puts around a transcript is removed; the words are not.
{
  assert.equal(cleanTranscript("```\nनमस्ते जी\n```"), "नमस्ते जी");
  assert.equal(cleanTranscript("Transcript: fees kab jama karna hai"), "fees kab jama karna hai");
  assert.equal(cleanTranscript('"मेरी बेटी कल नहीं आएगी"'), "मेरी बेटी कल नहीं आएगी");
  assert.equal(cleanTranscript("  bahut   zyada    space "), "bahut zyada space");
  assert.equal(
    cleanTranscript("x".repeat(MAX_TRANSCRIPT_CHARS + 500)).length,
    MAX_TRANSCRIPT_CHARS,
    "a runaway transcript is capped",
  );
  // An apostrophe inside the text must not be mistaken for a wrapping quote.
  assert.equal(cleanTranscript("bacche's copy"), "bacche's copy");
}

// Punctuation is not speech.
{
  assert.equal(transcriptIsUsable("फीस"), true);
  assert.equal(transcriptIsUsable("ok"), true);
  assert.equal(transcriptIsUsable("..."), false);
  assert.equal(transcriptIsUsable(" "), false);
  assert.equal(transcriptIsUsable(""), false);
  assert.equal(transcriptIsUsable("।"), false, "a Devanagari danda alone is not speech");
}

// The model's JSON is read, never trusted.
{
  const good = parseVoiceNoteTranscript({
    transcript: "  कल छुट्टी चाहिए  ",
    language: "hi",
    audible: true,
  });
  assert.deepEqual(good, { transcript: "कल छुट्टी चाहिए", language: "hi", audible: true });

  const noWords = parseVoiceNoteTranscript({ transcript: "", language: "hi", audible: true });
  assert.equal(noWords.audible, false, "audible:true with no words is not audible");

  const junk = parseVoiceNoteTranscript({ transcript: "hello", language: "klingon", audible: true });
  assert.equal(junk.language, "unknown", "an unlisted language falls back to unknown");

  assert.deepEqual(parseVoiceNoteTranscript(null), {
    transcript: "",
    language: "unknown",
    audible: false,
  });
  assert.deepEqual(parseVoiceNoteTranscript("not an object"), {
    transcript: "",
    language: "unknown",
    audible: false,
  });
}

// The whole point: words go to the bot, everything else goes to a human.
{
  const ok = voiceNoteOutcome({
    guard: { ok: true, mimeType: "audio/ogg" },
    result: { transcript: "फीस कितनी बाकी है", language: "hi", audible: true },
  });
  assert.deepEqual(ok, {
    kind: "transcribed",
    text: "फीस कितनी बाकी है",
    language: "hi",
  });
}

// Every failure branch is unusable — none of them reaches the bot as text.
{
  const cases: { input: Parameters<typeof voiceNoteOutcome>[0]; reason: VoiceNoteUnusableReason }[] = [
    { input: { guard: { ok: false, reason: "too-large" } }, reason: "too-large" },
    { input: { guard: { ok: false, reason: "unsupported-type" } }, reason: "unsupported-type" },
    { input: { guard: { ok: false, reason: "empty" } }, reason: "empty" },
    {
      input: { guard: { ok: true, mimeType: "audio/ogg" }, failure: "download-failed" },
      reason: "download-failed",
    },
    {
      input: { guard: { ok: true, mimeType: "audio/ogg" }, failure: "transcribe-failed" },
      reason: "transcribe-failed",
    },
    {
      input: { guard: { ok: true, mimeType: "audio/ogg" }, failure: "budget" },
      reason: "budget",
    },
    {
      input: { guard: { ok: true, mimeType: "audio/ogg" }, result: null },
      reason: "inaudible",
    },
    {
      input: {
        guard: { ok: true, mimeType: "audio/ogg" },
        result: { transcript: "...", language: "unknown", audible: true },
      },
      reason: "inaudible",
    },
  ];
  for (const c of cases) {
    const out = voiceNoteOutcome(c.input);
    assert.equal(out.kind, "unusable", `${c.reason} must not reach the bot as text`);
    assert.equal(out.kind === "unusable" && out.reason, c.reason);
    const note = VOICE_NOTE_STAFF_NOTE[c.reason];
    assert.ok(note && note.length > 0, `${c.reason} needs a note a human can act on`);
  }
}

// A guard failure wins over a transcript — we never transcribe what we refused.
{
  const out = voiceNoteOutcome({
    guard: { ok: false, reason: "too-large" },
    result: { transcript: "should be ignored", language: "en", audible: true },
  });
  assert.equal(out.kind === "unusable" && out.reason, "too-large");
}

// Staff can tell a machine transcript from something the parent typed.
{
  const l = labelledTranscript("कल छुट्टी चाहिए");
  assert.ok(l.includes("कल छुट्टी चाहिए"));
  assert.notEqual(l, "कल छुट्टी चाहिए", "a transcript is marked as one");
}

// The audit row describes the audio; it never carries the audio.
{
  const d = voiceNoteAuditDescriptor({
    mimeType: "audio/ogg",
    byteLength: 65_536,
    waMessageId: "wamid.ABC",
  });
  assert.equal(d, "[audio audio/ogg 64KB wa=wamid.ABC]");
  assert.ok(d.length < 200, "the descriptor stays small — base64 must never land in ai_generations");
  assert.equal(
    voiceNoteAuditDescriptor({ mimeType: "audio/mpeg", byteLength: 2048 }),
    "[audio audio/mpeg 2KB]",
  );
}

// The parent is told the truth: the message arrived, a person will listen.
{
  assert.ok(VOICE_NOTE_PARENT_ACK.includes("वॉइस"), "Hindi first — this parent may not read English");
  assert.ok(
    /voice message/i.test(VOICE_NOTE_PARENT_ACK),
    "and English underneath, for the households that prefer it",
  );
  // The failure being replaced is a parent being asked to do it again in a
  // way they cannot. Nothing here may ask them to type.
  assert.ok(
    !/\btype\b|\blikh|टाइप|लिख/i.test(VOICE_NOTE_PARENT_ACK),
    "never ask a parent who cannot type to type",
  );
  assert.ok(
    !/understand|समझ/i.test(VOICE_NOTE_PARENT_ACK),
    "we did not misunderstand them — nobody has listened yet",
  );
}

// Every failure reason produces a hub line a human can act on.
{
  const reasons: VoiceNoteUnusableReason[] = [
    "empty",
    "too-large",
    "unsupported-type",
    "inaudible",
    "download-failed",
    "transcribe-failed",
    "budget",
    "disabled",
  ];
  for (const r of reasons) {
    const note = voiceNoteHubNote(r);
    assert.ok(note.startsWith("[VOICE NOTE] "), `${r} is marked as a handoff, not parent text`);
    assert.ok(note.length > "[VOICE NOTE] ".length + 5, `${r} says something`);
  }
}

console.log("OK (escalation)");
