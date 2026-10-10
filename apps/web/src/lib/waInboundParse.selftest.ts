/**
 * What the webhook parser says a parent sent — and what it must NOT invent.
 *
 * Voice-note transcription shipped on 2026-09-10 and never ran once. Both
 * gates on the path ask the same question, "is the text empty?":
 *
 *   webhook:  const isVoiceNote = media.mediaType === "audio" && !text.trim()
 *   unified:  if (opts.audio?.mediaId && !(opts.text || "").trim()) transcribe
 *
 * and the parser was answering a captionless voice note with the fabricated
 * text "MEDIA audio" — not empty. So neither gate ever opened, the audio was
 * never sent to the model, and the literal string "MEDIA audio" was handed to
 * the parent bot as the parent's words. It matched no keyword, so two parents
 * on 2026-09-11 were told "I don't have that information here."
 *
 * The old self-test fed a transcript straight to the composer and passed,
 * which is exactly why nobody noticed: it never went through the parser.
 *
 * Run: npx tsx src/lib/waInboundParse.selftest.ts
 */
import assert from "node:assert/strict";
import { parseMetaWebhookInbound } from "./waInboundParse";

console.log("waInboundParse.selftest.ts");

const envelope = (message: Record<string, unknown>) => ({
  entry: [
    {
      changes: [
        {
          value: {
            contacts: [{ profile: { name: "Mr. Dilip Kumar Dixit" }, wa_id: "918853068285" }],
            messages: [{ from: "918853068285", id: "wamid.TEST", ...message }],
          },
        },
      ],
    },
  ],
});

/* ── A voice note, which is how it actually arrives ── */
const [voice] = parseMetaWebhookInbound(
  envelope({ type: "audio", audio: { id: "MEDIA_ID_1", mime_type: "audio/ogg; codecs=opus" } }),
);
assert.ok(voice, "a voice note must not be dropped");
assert.equal(voice.text, "", "a voice note carries NO text — the fabricated label is what broke transcription");
assert.equal(voice.media?.mediaType, "audio");
assert.equal(voice.media?.mediaId, "MEDIA_ID_1");
assert.equal(voice.mediaNote, "audio", "what arrived is reported here, not as the parent's words");

/* The two gates, spelled out, against this parse. */
const isVoiceNote = voice.media?.mediaType === "audio" && !(voice.text || "").trim();
assert.equal(isVoiceNote, true, "the webhook must recognise it and defer for transcription");
assert.equal(!(voice.text || "").trim(), true, "the unified bot must reach the transcribe step");

/* ── Media with a caption: the caption is the parent's words, and survives ── */
const [captioned] = parseMetaWebhookInbound(
  envelope({ type: "image", image: { id: "IMG1", mime_type: "image/jpeg", caption: "Aarav ka aadhaar" } }),
);
assert.equal(captioned.text, "Aarav ka aadhaar");
assert.equal(captioned.media?.mediaType, "image");

/* ── Media with no caption: empty, so the UDISE intake gets an honest caption ── */
const [bare] = parseMetaWebhookInbound(envelope({ type: "image", image: { id: "IMG2", mime_type: "image/jpeg" } }));
assert.equal(bare.text, "", "a captionless photo says nothing; it must not say 'MEDIA image'");
assert.equal(bare.media?.mediaId, "IMG2");
assert.ok((bare.mediaNote || "").startsWith("image"));

/* ── Plain text is untouched ── */
const [typed] = parseMetaWebhookInbound(envelope({ type: "text", text: { body: "भुगतान हो गया" } }));
assert.equal(typed.text, "भुगतान हो गया");
assert.equal(typed.media, undefined);
assert.equal(typed.profileName, "Mr. Dilip Kumar Dixit");

/* ── Nothing at all is still dropped ── */
assert.equal(parseMetaWebhookInbound(envelope({ type: "reaction" })).length, 0);
assert.equal(parseMetaWebhookInbound({}).length, 0);

console.log("ok");
