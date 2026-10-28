/**
 * Run: npx tsx src/lib/deskConflictReload.selftest.ts
 *
 * data-layer 0.5a. A save that comes back with "changed elsewhere first"
 * rows reloads THAT desk — not every desk. Until 13 Oct 2026 one refused
 * row on a leave request ran ensureAllDeskHydrated(): every desk, the four
 * heavy on-demand ones included (~6 MB, ~45 requests on a phone).
 *
 * Drives the real conflict handlers (rowStampClient, sliceRevClient), the
 * real SIS merge push and the real hydrate guard, against a fake `fetch`
 * that records which desk routes the page asked for.
 */
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};
const g = globalThis as unknown as Record<string, unknown>;
g.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  localStorage: storage,
  sessionStorage: storage,
  location: { origin: "https://example.test", href: "https://example.test/" },
  setTimeout,
  clearTimeout,
};
g.localStorage = storage;
g.sessionStorage = storage;
if (typeof g.CustomEvent !== "function") {
  g.CustomEvent = class {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
}

const asked: string[] = [];
g.fetch = async (input: unknown, init?: { method?: string }) => {
  const url = String(input);
  const method = (init?.method || "GET").toUpperCase();
  asked.push(`${method} ${url}`);
  if (method === "POST" && url.startsWith("/api/school-data/sis-roster")) {
    return new Response(JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }), { status: 200 });
  }
  // Every read fails: what is measured is which desks were ASKED for.
  return new Response(JSON.stringify({ ok: false, error: "test" }), { status: 503 });
};

const settle = () => new Promise((r) => setTimeout(r, 400));
const gets = () => asked.filter((a) => a.startsWith("GET "));
const HEAVY = ["fees-vouchers", "admissions-desk", "attendance-registers", "payment-links"].map(
  (r) => `/api/school-data/${r}`,
);

void (async () => {
  const guard = await import("./deskHydrateGuard");
  const sched = await import("./deskHydrationSchedule");
  const { onStampConflicts } = await import("./rowStampClient");
  const { onSaveConflicts } = await import("./sliceRevClient");

  // ── The mapping: guard keys → hydrate task ids.
  assert.equal(sched.deskHydrateIdForModule("staff_hr"), "staffHr");
  assert.equal(sched.deskHydrateIdForModule("staff_attendance"), "staffAttendance");
  assert.equal(sched.deskHydrateIdForModule("admissions"), "admissions");
  assert.equal(sched.deskHydrateIdForModule("ptm"), null, "a desk with no task is only reset");

  // ── resetDeskHydrated(module) forgets only that module's in-flight read.
  let release: () => void = () => {};
  const slow = new Promise<void>((r) => (release = r));
  let otherRuns = 0;
  const a = guard.dedupeHydration("desk_a", () => slow);
  const b = guard.dedupeHydration("desk_b", () => slow);
  guard.resetDeskHydrated("desk_a");
  const b2 = guard.dedupeHydration("desk_b", async () => {
    otherRuns++;
  });
  assert.equal(b2, b, "another desk's in-flight read survives a reset of desk_a");
  assert.equal(otherRuns, 0, "no second copy of desk_b's read was started");
  let aRuns = 0;
  const a2 = guard.dedupeHydration("desk_a", async () => {
    aRuns++;
  });
  assert.notEqual(a2, a, "desk_a itself starts afresh after its reset");
  release();
  await Promise.all([a, b, a2]);
  assert.equal(aRuns, 1);

  // ── A stamped desk conflict (staff attendance) reloads staff attendance only.
  asked.length = 0;
  guard.markDeskHydrated("staff_attendance");
  onStampConflicts("staff_attendance", { registers: ["r1"] });
  await settle();
  const g1 = gets();
  assert.ok(g1.length > 0, `the conflicted desk is re-read (asked: ${g1.join(", ")})`);
  assert.ok(g1.every((x) => x.includes("staff-attendance")), `only staff attendance is re-read, not: ${g1.join(", ")}`);
  assert.equal(guard.hasDeskLoaded("staff_attendance"), false, "its load is forgotten until the re-read lands");

  // ── A desk-slice conflict (staff HR) reloads staff HR only.
  asked.length = 0;
  onSaveConflicts("desk:staff_hr", "staff_hr", { leaveRequests: ["lr1"] });
  await settle();
  const g2 = gets();
  assert.ok(g2.length > 0, "staff HR is re-read");
  assert.ok(g2.every((x) => x.includes("staff_hr")), `only staff HR is re-read, not: ${g2.join(", ")}`);
  for (const h of HEAVY) assert.ok(!g2.some((x) => x.includes(h)), `a staff HR conflict does not pull ${h}`);

  // ── A desk with no hydrate task (PTM) is reset and nothing is fetched.
  asked.length = 0;
  guard.markDeskHydrated("ptm");
  onStampConflicts("ptm", { slots: ["s1"] });
  await settle();
  assert.deepEqual(gets(), [], "a PTM conflict fetches nothing by itself");
  assert.equal(guard.hasDeskLoaded("ptm"), false, "…but the PTM load is forgotten, so its screen re-reads");

  // ── A student merge re-reads the desks this page loaded — never one it did not.
  const { recordSisMerge, scheduleSisDeskSync, flushSisDeskSync } = await import("./sisNormalizedClient");
  guard.markDeskHydrated("staff_hr");
  asked.length = 0;
  recordSisMerge({ keepId: "stu_keep", dropIds: ["stu_drop"] });
  scheduleSisDeskSync({ households: [], students: [], tags: [], classUpgrades: [] } as never);
  await flushSisDeskSync();
  await settle();
  assert.ok(asked.some((x) => x.startsWith("POST /api/school-data/sis-roster")), "the merge was pushed");
  const g3 = gets();
  assert.ok(g3.some((x) => x.includes("staff_hr")), `a loaded desk (staff HR) is re-read after the merge: ${g3.join(", ")}`);
  for (const h of HEAVY) assert.ok(!g3.some((x) => x.includes(h)), `the merge does not pull ${h}, which this page never loaded`);

  console.log("deskConflictReload selftest: ok");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
