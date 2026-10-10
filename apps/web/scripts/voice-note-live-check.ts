/**
 * Live check: does Gemini actually transcribe a voice note?
 *
 * Calls Google and nothing else — no Supabase, no WhatsApp, no budget row.
 * The self-tests cover the decisions; this covers the one thing they cannot,
 * which is whether the model hears words at all.
 *
 * Run from apps/web:
 *   npx tsx --env-file=.env.local scripts/voice-note-live-check.ts <file.wav> [...]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { transcribeGeminiAudio } from "../src/lib/erpAiGemini.server";
import {
  VOICE_NOTE_PROMPT,
  VOICE_NOTE_SYSTEM,
  guardVoiceNote,
  parseVoiceNoteTranscript,
  voiceNoteOutcome,
} from "../src/lib/voiceNote";

async function main() {
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: voice-note-live-check.ts <audio file> [...]");
  process.exit(1);
}

for (const file of files) {
  const buf = readFileSync(file);
  const guard = guardVoiceNote({ mimeType: "audio/wav", byteLength: buf.byteLength });
  console.log(`\n── ${basename(file)} (${Math.round(buf.byteLength / 1024)}KB)`);
  if (!guard.ok) {
    console.log(`   refused before the call: ${guard.reason}`);
    continue;
  }

  const t0 = Date.now();
  const r = await transcribeGeminiAudio({
    system: VOICE_NOTE_SYSTEM,
    prompt: VOICE_NOTE_PROMPT,
    base64: buf.toString("base64"),
    mimeType: guard.mimeType,
  });
  const ms = Date.now() - t0;

  if (!r.ok) {
    console.log(`   FAILED after ${ms}ms — ${r.error}`);
    console.log(`   outcome: ${JSON.stringify(voiceNoteOutcome({ guard, failure: "transcribe-failed" }))}`);
    continue;
  }

  console.log(`   model: ${r.model}  ${ms}ms  tokens in/out: ${r.usage.promptTokens}/${r.usage.completionTokens}`);
  console.log(`   raw: ${r.text.replace(/\s+/g, " ").slice(0, 200)}`);
  let parsed;
  try {
    parsed = parseVoiceNoteTranscript(JSON.parse(r.text));
  } catch {
    console.log("   raw reply was not JSON — the route would report transcribe-failed");
    continue;
  }
  const outcome = voiceNoteOutcome({ guard, result: parsed });
  console.log(`   parsed: ${JSON.stringify(parsed)}`);
  console.log(`   outcome: ${outcome.kind}${outcome.kind === "transcribed" ? ` → "${outcome.text}"` : ` (${outcome.reason})`}`);
}
}

void main();
