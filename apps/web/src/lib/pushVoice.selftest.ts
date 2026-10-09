import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PUSH_VOICE_KINDS, pushVoiceChannel, pushVoiceKind } from "./pushVoice";

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

// Every channel the server can name has its clip in the Android app.
const raw = readdirSync(join(__dirname, "../../../../cbse_school_mobile/android/app/src/main/res/raw"));
for (const k of PUSH_VOICE_KINDS) {
  for (const l of ["hi", "en"] as const) {
    const id = pushVoiceChannel(k, l);
    assert.ok(raw.some((f) => f.startsWith(`${id}.`)), `missing clip ${id}`);
  }
}

console.log("pushVoice.selftest: all assertions passed");
