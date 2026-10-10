import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Heavy desks load on demand (10 Oct 2026, storage plan Phase 3). The idle
 * sweep used to download admissions, fees, payments and attendance on every
 * page, so a phone opening Homework pulled the fee book and every lead. Now
 * they load on the routes that use them and on first read; a page that
 * never reads one never downloads it.
 */

console.log("deskOnDemand.selftest.ts");

const g = globalThis as Record<string, unknown>;
const events: string[] = [];
g.window = { dispatchEvent: (e: { detail?: { id?: string } }) => events.push(String(e.detail?.id)) };
g.CustomEvent = class {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
};

void (async () => {
  const { HEAVY_ON_DEMAND_IDS, priorityDeskHydrateIds } = await import("./deskHydrationSchedule");
  const { hydrateOnFirstRead } = await import("./deskLazyHydrate");

  for (const id of ["admissions", "fees", "payments", "attendance"] as const) {
    assert.ok(HEAVY_ON_DEMAND_IDS.has(id), `${id} is loaded on demand`);
  }
  // A teacher on Homework: nothing heavy up front.
  const homework = priorityDeskHydrateIds("/homework");
  for (const id of HEAVY_ON_DEMAND_IDS) assert.equal(homework.has(id), false, `/homework does not load ${id}`);
  // Routes whose screens read a heavy desk load it up front.
  assert.ok(priorityDeskHydrateIds("/fees/take").has("fees"));
  assert.ok(priorityDeskHydrateIds("/transport").has("fees"), "transport bills and shows dues");
  assert.ok(priorityDeskHydrateIds("/students").has("attendance"), "student profile shows attendance");
  assert.ok(priorityDeskHydrateIds("/exams").has("attendance"), "report cards use attendance");
  assert.ok(priorityDeskHydrateIds("/field/calling").has("admissions"), "field apps read leads");
  // Everyone lands on home: it forces nothing heavy; its dashboards load on first read.
  for (const id of HEAVY_ON_DEMAND_IDS) assert.equal(priorityDeskHydrateIds("/").has(id), false, `home does not force ${id}`);
  console.log("  ok  heavy desks load on their routes only");

  // First read starts one load; later reads do not start another.
  let runs = 0;
  hydrateOnFirstRead("fees", async () => {
    runs++;
  });
  hydrateOnFirstRead("fees", async () => {
    runs++;
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(runs, 1, "one load per page");
  assert.deepEqual(events, ["fees"], "screens are told when it lands");
  // A failed load may be retried by the next read.
  hydrateOnFirstRead("attendance", async () => {
    runs++;
    throw new Error("offline");
  });
  await new Promise((r) => setTimeout(r, 5));
  hydrateOnFirstRead("attendance", async () => {
    runs++;
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(runs, 3, "a failed load is retried on the next read");
  console.log("  ok  first read loads once, announces it, retries after a failure");

  // Wiring.
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
  const sched = read("deskHydrationSchedule.ts");
  assert.ok(/!priorityIds\.has\(t\.id\) && !HEAVY_ON_DEMAND_IDS\.has\(t\.id\)/.test(sched), "the idle sweep skips heavy desks");
  for (const [file, fn, id] of [
    ["admissions.ts", "loadAdmissions", "admissions"],
    ["fees.ts", "loadFees", "fees"],
    ["attendance.ts", "loadAttendance", "attendance"],
    ["payments.ts", "loadPayments", "payments"],
  ] as const) {
    const src = read(file);
    const body = src.slice(src.indexOf(`export function ${fn}()`), src.indexOf(`export function ${fn}()`) + 300);
    assert.ok(body.includes(`hydrateOnFirstRead("${id}"`), `${fn} loads its desk on first read`);
  }
  assert.ok(/addEventListener\("bhb-desk-hydrated", refresh\)/.test(read("../components/dashboard/SchoolHomeDashboard.tsx")), "the home dashboard redraws when a desk lands");
  console.log("  ok  wiring: idle sweep skips heavy desks; each load*() is a first-read trigger");
  console.log("\nAll on-demand desk checks passed.");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
