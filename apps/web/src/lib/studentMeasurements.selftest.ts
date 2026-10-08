/**
 * Run: npx tsx src/lib/studentMeasurements.selftest.ts
 */
import assert from "node:assert/strict";
import { ageYears, checkMeasurement } from "@/lib/studentMeasurements";

const ok = (h: string, w: string) => {
  const r = checkMeasurement(h, w);
  assert.ok(r.ok, `${h}/${w}: ${r.ok ? "" : r.error}`);
  return r;
};
const bad = (h: string, w: string, re: RegExp) => {
  const r = checkMeasurement(h, w);
  assert.ok(!r.ok, `${h}/${w} should be refused`);
  assert.match(r.error, re);
};

assert.deepEqual(ok("112", "19.5"), { ok: true, heightCm: "112", weightKg: "19.5" });
assert.deepEqual(ok("112,5", ""), { ok: true, heightCm: "112.5", weightKg: "" }, "comma decimal; one box may wait");
assert.deepEqual(ok("", ""), { ok: true, heightCm: "", weightKg: "" });
assert.equal((ok("98.25", "15") as { heightCm: string }).heightCm, "98.3");
bad("1.12", "19", /metres/);
bad("112", "19500", /grams/);
bad("19", "112", /swapped/);
bad("40", "", /between 60 and 190/);
bad("112", "200", /between 8 and 110/);
bad("abc", "19", /number in cm/);
bad("112", "-3", /number in kg/);

assert.equal(ageYears("2019-10-08", "2026-10-07"), 6);
assert.equal(ageYears("2019-10-07", "2026-10-07"), 7);
assert.equal(ageYears("", "2026-10-07"), null);

console.log("studentMeasurements selftest: ok");
