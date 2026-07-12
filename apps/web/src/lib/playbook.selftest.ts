import assert from "node:assert/strict";
import {
  buildPlaybook,
  resolveStage,
  type PlaybookHold,
} from "./playbook";

assert.equal(resolveStage(-1), "S0");
assert.equal(resolveStage(0), "S1");
assert.equal(resolveStage(7), "S1");
assert.equal(resolveStage(8), "S2");
assert.equal(resolveStage(15), "S2");
assert.equal(resolveStage(18), "S3");
assert.equal(resolveStage(31), "S4");

const s3 = buildPlaybook({
  overdueDays: 18,
  amountPaise: 420000,
  studentName: "Rahul",
});
assert.equal(s3.stage, "S3");
assert.ok(
  s3.holds.some((h: PlaybookHold) => h.code === "HOLD_TRANSPORT" && h.active),
);
assert.ok(s3.holds.some((h: PlaybookHold) => h.code === "HOLD_TC" && !h.active));
assert.ok(s3.doNow.length >= 2);

const s4 = buildPlaybook({
  overdueDays: 32,
  amountPaise: 960000,
  studentName: "Kabir",
});
assert.ok(s4.holds.some((h: PlaybookHold) => h.code === "HOLD_TC" && h.active));

console.log("playbook.selftest: ok");
