/**
 * voiceDictation — dictation appends and never replaces; the recorder asks
 * for a format the speech service can read, and iPhone's mp4 is converted to
 * a valid WAV. Run: npx tsx src/lib/voiceDictation.selftest.ts
 */
import {
  MAX_DICTATION_MS,
  appendDictation,
  downsampleMono,
  encodeWavPcm16,
  formatDictationClock,
  needsWavConversion,
  pickRecorderMime,
  speechAudioKind,
  speechErrorMeansUseRecorder,
  speechErrorMessage,
} from "./voiceDictation";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// Append, never replace.
expect("empty field", appendDictation("", "बच्चा अच्छा है"), "बच्चा अच्छा है");
expect("null field", appendDictation(null, "good work"), "good work");
expect("whitespace-only field", appendDictation("   ", "good work"), "good work");
expect("joins with a space", appendDictation("Works hard.", "Needs to revise tables."), "Works hard. Needs to revise tables.");
expect("typed text kept verbatim", appendDictation("  Works hard.", "ok"), "  Works hard. ok");
expect("trailing newline respected", appendDictation("Line one\n", "line two"), "Line one\nline two");
expect("trailing space respected", appendDictation("Line one ", "two"), "Line one two");
expect("dictation trimmed + collapsed", appendDictation("A", "  b \n c  "), "A b c");
expect("empty dictation keeps field", appendDictation("keep me", "   "), "keep me");
expect("empty dictation on empty field", appendDictation("", ""), "");

// Recorder format: WebM (Chrome/Android) first, mp4 (iPhone) last, "" if nothing answers.
const chrome = new Set(["audio/webm;codecs=opus", "audio/webm"]);
expect("chrome picks webm opus", pickRecorderMime((m) => chrome.has(m)), "audio/webm;codecs=opus");
const firefox = new Set(["audio/ogg;codecs=opus"]);
expect("firefox picks ogg", pickRecorderMime((m) => firefox.has(m)), "audio/ogg;codecs=opus");
const safari = new Set(["audio/mp4"]);
expect("safari picks mp4", pickRecorderMime((m) => safari.has(m)), "audio/mp4");
expect("nothing supported → browser default", pickRecorderMime(() => false), "");
expect("throwing isTypeSupported → default", pickRecorderMime(() => { throw new Error("x"); }), "");

// What the speech service can read as-is.
expect("webm", speechAudioKind("audio/webm;codecs=opus"), "webm");
expect("ogg", speechAudioKind("audio/ogg; codecs=opus"), "ogg");
expect("wav", speechAudioKind("audio/wav"), "wav");
expect("x-wav", speechAudioKind("audio/x-wav"), "wav");
expect("mp4 unreadable", speechAudioKind("audio/mp4"), null);
expect("mp4 with opus codec is still mp4", speechAudioKind("audio/mp4;codecs=opus"), null);
expect("aac unreadable", speechAudioKind("audio/aac"), null);
expect("empty unreadable", speechAudioKind(""), null);
expect("mp4 needs conversion", needsWavConversion("audio/mp4"), true);
expect("webm needs none", needsWavConversion("audio/webm"), false);
expect("unknown type needs conversion", needsWavConversion(""), true);

// The recording clock and the one-minute cap of synchronous recognition.
expect("clock 0", formatDictationClock(0), "0:00");
expect("clock 7s", formatDictationClock(7_400), "0:07");
expect("clock 62s", formatDictationClock(62_000), "1:02");
expect("cap under a minute", MAX_DICTATION_MS < 60_000 && MAX_DICTATION_MS >= 30_000, true);

// Downsample 48 kHz → 16 kHz averages each group of three.
const src = new Float32Array([0.3, 0.3, 0.3, -0.6, -0.6, -0.6, 0, 0.3, 0.6]);
const ds = downsampleMono(src, 48_000, 16_000);
expect("downsample length", ds.length, 3);
expect("downsample values", Array.from(ds).map((x) => Math.round(x * 100) / 100), [0.3, -0.6, 0.3]);
expect("no upsampling", downsampleMono(src, 8_000, 16_000), src);

// WAV header — Google reads LINEAR16 WAV with a header; a wrong size field fails silently.
const wav = encodeWavPcm16(new Float32Array([0, 1, -1, 2]), 16_000);
const dv = new DataView(wav.buffer);
const ascii = (o: number) => String.fromCharCode(wav[o]!, wav[o + 1]!, wav[o + 2]!, wav[o + 3]!);
expect("wav length", wav.length, 44 + 8);
expect("RIFF", ascii(0), "RIFF");
expect("WAVE", ascii(8), "WAVE");
expect("riff size", dv.getUint32(4, true), 36 + 8);
expect("pcm format", dv.getUint16(20, true), 1);
expect("mono", dv.getUint16(22, true), 1);
expect("rate", dv.getUint32(24, true), 16_000);
expect("byte rate", dv.getUint32(28, true), 32_000);
expect("16 bit", dv.getUint16(34, true), 16);
expect("data size", dv.getUint32(40, true), 8);
expect("samples (clamped)", [0, 1, 2, 3].map((i) => dv.getInt16(44 + i * 2, true)), [0, 32767, -32768, 32767]);

// Errors are always said out loud, except our own abort.
expect("blocked mic named", speechErrorMessage("not-allowed").includes("blocked"), true);
expect("unknown code still says something", speechErrorMessage("weird").length > 0, true);
expect("aborted is silent", speechErrorMessage("aborted"), "");
expect("siri off → record instead", speechErrorMeansUseRecorder("service-not-allowed"), true);
expect("blocked mic → do not record", speechErrorMeansUseRecorder("not-allowed"), false);

if (failed) {
  console.error(`voiceDictation: ${failed} failure(s)`);
  process.exit(1);
}
console.log("voiceDictation: all checks passed");
