import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("serverFallbackSaves.selftest.ts");

/**
 * Two server writers built their state on a failed desk read and saved it.
 *
 *  - Automation: loadAutomationFromDb ignored `ok`, fell back to the legacy
 *    blob or an empty state, and the scheduler tick then EVALUATED and SENT
 *    from it (a card the blob still shows as approved goes out again) and
 *    saved it over the desk. Now a failed read throws
 *    AutomationStateUnreadable and the tick, run and approve routes answer
 *    503 having done nothing.
 *  - Staff HR: the server hydrate took the legacy blob whenever the desk read
 *    failed — or merely held no leave types — and the leave apply / decide /
 *    withdraw routes and the WhatsApp leave flows saved that back. Now a save
 *    is refused unless the copy came from a successful desk read, and a desk
 *    that has ever been written is the truth even with no leave types.
 *
 * Unknown is not empty. This reads the code itself.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

// ── Automation ─────────────────────────────────────────────────────────────
{
  const src = read("automationState.server.ts");
  const load = src.slice(src.indexOf("export async function loadAutomationFromDb"), src.indexOf("export async function saveAutomationToDb"));
  assert.ok(/if \(!read\.ok\) throw new AutomationStateUnreadable/.test(load), "a failed desk read throws");
  assert.ok(load.indexOf("throw new AutomationStateUnreadable") < load.indexOf("fetchServerBlob"), "before any blob fallback");
  for (const r of ["tick", "run", "approve"]) {
    const route = read(`../app/api/wa/automation/${r}/route.ts`);
    assert.ok(/e instanceof AutomationStateUnreadable[\s\S]*?status: 503/.test(route), `${r} route answers 503 on an unreadable desk`);
  }
}

// ── Staff HR ───────────────────────────────────────────────────────────────
{
  const persist = read("staffHrPersistence.ts");
  assert.ok(/serverCopyFromDesk = deskRead\.ok;/.test(persist), "the hydrate records whether the copy came from the desk");
  assert.ok(/deskRead\.meta != null/.test(persist), "a written desk is the truth even with no leave types");
  const leave = read("api/v1/staffLeave.ts");
  const save = leave.slice(leave.indexOf("export async function saveStaffHrServer"));
  assert.ok(save.indexOf("if (!staffHrServerCopyIsFromDesk())") >= 0, "a save checks where its copy came from");
  assert.ok(save.indexOf("if (!staffHrServerCopyIsFromDesk())") < save.indexOf("pushStaffHrRemoteServer("), "before pushing");
}

console.log("serverFallbackSaves.selftest: all assertions passed");
