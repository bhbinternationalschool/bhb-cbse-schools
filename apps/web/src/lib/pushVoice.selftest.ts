import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  PUSH_VOICE_KINDS,
  PUSH_VOICE_V2_KINDS,
  PUSH_VOICE_V2_MIN_BUILD,
  pushVoiceChannel,
  pushVoiceChannelForApp,
  pushVoiceKind,
  pushVoiceSound,
  pushVoiceSoundOfChannel,
} from "./pushVoice";

console.log("pushVoice.selftest.ts");

// The links the ERP's notifications actually use (9 Oct 2026).
assert.equal(pushVoiceKind("/homework"), "homework");
assert.equal(pushVoiceKind("/attendance?studentId=s1"), "attendance");
assert.equal(pushVoiceKind("/fees"), "fees");
assert.equal(pushVoiceKind("/pay/share?linkId=x"), "fees");
assert.equal(pushVoiceKind("/leave-approvals"), "leave");
assert.equal(pushVoiceKind("/student-leave"), "leave");
assert.equal(pushVoiceKind("/leave?studentId=s1"), "leave");
assert.equal(pushVoiceKind("/chat?studentId=s1"), "message");
assert.equal(pushVoiceKind("/complaints"), "message");
assert.equal(pushVoiceKind("/notices"), "notice");
assert.equal(pushVoiceKind("/ptm"), "notice");
assert.equal(pushVoiceKind("/", "fleet_alert"), "notice");
assert.equal(pushVoiceKind(undefined, "fee_receipt"), "fees");

assert.equal(pushVoiceChannel("homework", "hi"), "bhb_voice_homework_hi");

// 21 Oct 2026: approval/document ring on `_v2` channels (a build with
// placeholder clips created the old ones; Android keeps a channel's first
// sound). Every other channel id is unchanged.
for (const l of ["hi", "en"] as const) {
  assert.equal(pushVoiceChannel("approval", l), `bhb_voice_approval_${l}_v2`);
  assert.equal(pushVoiceChannel("document", l), `bhb_voice_document_${l}_v2`);
  for (const k of ["homework", "attendance", "fees", "message", "leave", "notice"] as const) {
    assert.equal(pushVoiceChannel(k, l), `bhb_voice_${k}_${l}`, `${k} keeps its id`);
  }
}
assert.deepEqual([...PUSH_VOICE_V2_KINDS].sort(), ["approval", "document"]);
assert.equal(pushVoiceSoundOfChannel("bhb_voice_approval_en_v2"), "bhb_voice_approval_en");
assert.equal(pushVoiceSoundOfChannel("bhb_voice_fees_en"), "bhb_voice_fees_en");

// Old apps (no `_v2` channels) get the id they have; new apps the v2 one.
assert.equal(pushVoiceChannelForApp("bhb_voice_approval_hi_v2", "1.0.34+35"), "bhb_voice_approval_hi_v2");
assert.equal(pushVoiceChannelForApp("bhb_voice_approval_hi_v2", "1.0.33+34"), "bhb_voice_approval_hi");
assert.equal(pushVoiceChannelForApp("bhb_voice_approval_hi_v2", ""), "bhb_voice_approval_hi");
assert.equal(pushVoiceChannelForApp("bhb_voice_fees_hi", "1.0.10+11"), "bhb_voice_fees_hi");
assert.equal(pushVoiceChannelForApp("bhb_default", undefined), "bhb_default");

// Every channel the server can name has its clip in the Android app.
const mobile = join(__dirname, "../../../../cbse_school_mobile");
const raw = readdirSync(join(mobile, "android/app/src/main/res/raw"));
for (const k of PUSH_VOICE_KINDS) {
  for (const l of ["hi", "en"] as const) {
    const id = pushVoiceSound(k, l);
    assert.ok(raw.some((f) => f.startsWith(`${id}.`)), `missing clip ${id}`);
    assert.equal(pushVoiceSoundOfChannel(pushVoiceChannel(k, l)), id);
  }
}

// The app agrees: same v2 kinds, and its version is at least the build the
// server waits for before naming a v2 channel.
const dart = readFileSync(join(mobile, "lib/core/push/push_service.dart"), "utf8");
const v2 = /static const voiceV2Kinds = \{([^}]*)\}/.exec(dart);
assert.ok(v2, "push_service.dart declares voiceV2Kinds");
assert.deepEqual(
  [...v2[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort(),
  [...PUSH_VOICE_V2_KINDS].sort(),
  "app and server rename the same channels",
);
const build = /^version:\s*\S+\+(\d+)/m.exec(readFileSync(join(mobile, "pubspec.yaml"), "utf8"));
assert.ok(build && Number(build[1]) >= PUSH_VOICE_V2_MIN_BUILD, "the app build that creates v2 channels is ≥ PUSH_VOICE_V2_MIN_BUILD");

console.log("pushVoice.selftest: all assertions passed");
