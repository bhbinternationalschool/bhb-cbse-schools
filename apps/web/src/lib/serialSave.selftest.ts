import assert from "node:assert/strict";
import { saveInFlight, serialSave } from "./serialSave";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // The 12 Oct case: a second save must not start before the first returns,
  // or it carries the version the first one is about to replace.
  let version = 1;
  const log: string[] = [];
  const save = (name: string, ms: number) =>
    serialSave("staff_hr", async () => {
      const base = version; // read when it RUNS, not when it was queued
      log.push(`${name} start @${base}`);
      await sleep(ms);
      assert.equal(version, base, `${name}: nobody moved the version under it`);
      version = base + 1;
      log.push(`${name} done @${version}`);
      return name;
    });

  const a = save("A", 30);
  const b = save("B", 5);
  assert.ok(saveInFlight("staff_hr"));
  assert.deepEqual(await Promise.all([a, b]), ["A", "B"]);
  assert.deepEqual(log, ["A start @1", "A done @2", "B start @2", "B done @3"]);

  // A failed save does not block the next one, and its error still reaches its caller.
  const bad = serialSave("rbac", async () => {
    throw new Error("network");
  });
  const good = serialSave("rbac", async () => "ok");
  await assert.rejects(bad, /network/);
  assert.equal(await good, "ok");

  // Different desks do not wait for each other.
  const order: string[] = [];
  const slow = serialSave("payroll", async () => {
    await sleep(30);
    order.push("payroll");
  });
  const fast = serialSave("library", async () => {
    order.push("library");
  });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ["library", "payroll"]);

  await sleep(0);
  assert.ok(!saveInFlight("staff_hr") && !saveInFlight("rbac"), "chains are cleaned up");
  console.log("serialSave.selftest.ts\n  ok");
}

void main();
