/**
 * Run: npx tsx src/lib/pickerSearch.selftest.ts
 *
 * Director, 14 Oct 2026: "build in search heads, staff in advance by alphabet
 * or make easier to pick name". Every word typed must match, lists read A→Z,
 * recent picks lead, a found sub-head never loses its head, and a browser
 * whose storage throws still gets a working picker.
 */
import assert from "node:assert/strict";
import {
  filterPickItems,
  groupAccountsForPicker,
  pushRecentPick,
  readRecentPicks,
  RECENT_GROUP,
  type PickItem,
} from "./pickerSearch";

console.log("pickerSearch.selftest.ts");

const staff: PickItem[] = [
  { id: "s3", label: "zoya Khan", sub: "EMP010 · Teacher", keywords: ["EMP010", "Teacher"] },
  { id: "s1", label: "Ravi Kumar", sub: "EMP002 · Driver", keywords: ["EMP002", "Driver"] },
  { id: "s2", label: "Anita Singh", sub: "EMP001 · Teacher", keywords: ["EMP001", "Teacher"] },
  { id: "s4", label: "Ravi Verma", sub: "EMP003 · Accountant", keywords: ["EMP003", "Accountant"] },
  { id: "s5", label: "Item 10", sub: "EMP020" },
  { id: "s6", label: "Item 2", sub: "EMP021" },
];
const ids = (rows: PickItem[]) => rows.map((r) => r.id);

// A→Z by name, case-insensitive and numeric-aware — not by emp code.
assert.deepEqual(ids(filterPickItems(staff, "", [])), ["s2", "s6", "s5", "s1", "s4", "s3"]);

// Every token must match, across name, code and designation.
assert.deepEqual(ids(filterPickItems(staff, "ravi", [])), ["s1", "s4"]);
assert.deepEqual(ids(filterPickItems(staff, "ravi driver", [])), ["s1"]);
assert.deepEqual(ids(filterPickItems(staff, "emp003", [])), ["s4"]);
assert.deepEqual(ids(filterPickItems(staff, "  TEACHER  ", [])), ["s2", "s3"]);
assert.deepEqual(ids(filterPickItems(staff, "teacher khan", [])), ["s3"]);
assert.deepEqual(ids(filterPickItems(staff, "nobody", [])), []);

// Recent picks lead (in recent order), only when they match, never twice.
{
  const rows = filterPickItems(staff, "", ["s4", "missing", "s3", "s4"]);
  assert.deepEqual(ids(rows), ["s4", "s3", "s2", "s6", "s5", "s1"]);
  assert.equal(rows[0]!.group, RECENT_GROUP);
  assert.equal(rows[1]!.group, RECENT_GROUP);
  assert.equal(rows[2]!.group, "All", "the rest get their own heading under Recent");
  assert.equal(new Set(ids(rows)).size, rows.length, "each id once");
  // Searching: a recent that does not match is not shown.
  assert.deepEqual(ids(filterPickItems(staff, "ravi", ["s3", "s4"])), ["s4", "s1"]);
  // At most five recents shown.
  const many = filterPickItems(staff, "", ["s1", "s2", "s3", "s4", "s5", "s6"]);
  assert.equal(many.filter((r) => r.group === RECENT_GROUP).length, 5);
  // No recents → rows keep no heading.
  assert.equal(filterPickItems(staff, "", [])[0]!.group, undefined);
}

// ── Accounts: grouped by parent head, sub-heads indented, A→Z ──────────
const accounts = [
  { code: "5010", name: "Utilities", parentCode: "5", hasChildren: true },
  { code: "5012", name: "Water", parentCode: "5010" },
  { code: "5011", name: "Electricity", parentCode: "5010" },
  { code: "5030", name: "Fuel", parentCode: "5" },
  { code: "5020", name: "Repairs", parentCode: "5", hasChildren: true },
  { code: "5021", name: "Building repairs", parentCode: "5020" },
  { code: "5022", name: "Vehicle repairs", parentCode: "5020" },
];
{
  const rows = groupAccountsForPicker(accounts, "", []);
  assert.deepEqual(ids(rows), ["5030", "5020", "5021", "5022", "5010", "5011", "5012"]);
  assert.deepEqual(
    rows.map((r) => r.depth),
    [0, 0, 1, 1, 0, 1, 1],
  );
}
// Search by sub-head name keeps its head visible.
assert.deepEqual(ids(groupAccountsForPicker(accounts, "elec", [])), ["5010", "5011"]);
// Search by code.
assert.deepEqual(ids(groupAccountsForPicker(accounts, "5022", [])), ["5020", "5022"]);
// Search by the head's name shows the head and everything under it.
assert.deepEqual(ids(groupAccountsForPicker(accounts, "utilities", [])), ["5010", "5011", "5012"]);
// Words across head and sub-head narrow to that sub-head.
assert.deepEqual(ids(groupAccountsForPicker(accounts, "repairs vehicle", [])), ["5020", "5022"]);
assert.deepEqual(ids(groupAccountsForPicker(accounts, "zzz", [])), []);

// Recent heads first, in their own group, with the parent named.
{
  const rows = groupAccountsForPicker(accounts, "", ["5011", "nope", "5030"]);
  assert.deepEqual(ids(rows).slice(0, 2), ["5011", "5030"]);
  assert.equal(rows[0]!.group, RECENT_GROUP);
  assert.equal(rows[0]!.depth, 0);
  assert.match(rows[0]!.sub!, /Utilities/);
  assert.equal(rows[2]!.group, "All");
  // Recent also filtered by the query.
  assert.deepEqual(ids(groupAccountsForPicker(accounts, "water", ["5011", "5012"])), ["5012", "5010", "5012"]);
}

// Headings with sub-heads can be shown but not picked; never a recent.
{
  const rows = groupAccountsForPicker(accounts, "", ["5010"], {
    isSelectable: (a) => !("hasChildren" in a && a.hasChildren),
  });
  assert.equal(rows.find((r) => r.id === "5010")!.disabled, true);
  assert.equal(rows.find((r) => r.id === "5011")!.disabled, undefined);
  assert.equal(rows.filter((r) => r.group === RECENT_GROUP).length, 0);
}

// Group headings order by the given order, then A→Z.
{
  const chart = [
    { code: "1100", name: "Cash", kind: "asset" },
    { code: "4000", name: "Fees", kind: "income" },
    { code: "1200", name: "Bank", kind: "asset" },
  ];
  const rows = groupAccountsForPicker(chart, "", [], {
    groupOf: (a) => (a.kind === "asset" ? "Assets" : "Income"),
    groupOrder: ["Income", "Assets"],
  });
  assert.deepEqual(ids(rows), ["4000", "1200", "1100"]);
  assert.deepEqual(rows.map((r) => r.group), ["Income", "Assets", "Assets"]);
}

// A parent cycle in bad data does not hang the picker.
{
  const loop = [
    { code: "A", name: "Alpha", parentCode: "B" },
    { code: "B", name: "Beta", parentCode: "A" },
    { code: "C", name: "Gamma" },
  ];
  assert.deepEqual(ids(groupAccountsForPicker(loop, "", [])), ["C"]);
}

// ── Recent-pick storage ────────────────────────────────────────────────
const g = globalThis as { localStorage?: unknown };
{
  // No storage at all (server render).
  delete g.localStorage;
  assert.deepEqual(readRecentPicks("t"), []);
  assert.deepEqual(pushRecentPick("t", "x"), ["x"]);
}
{
  // Working storage: newest first, no duplicates, capped.
  const mem = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
  };
  pushRecentPick("t", "a");
  pushRecentPick("t", "b");
  pushRecentPick("t", "a");
  assert.deepEqual(readRecentPicks("t"), ["a", "b"]);
  for (const id of ["c", "d", "e"]) pushRecentPick("t", id, 3);
  assert.deepEqual(readRecentPicks("t"), ["e", "d", "c"]);
  assert.deepEqual(readRecentPicks("other"), [], "keys are separate");
  // Garbage in storage reads as no recents.
  mem.set("bhb.recentPicks.bad", "{not json");
  assert.deepEqual(readRecentPicks("bad"), []);
  mem.set("bhb.recentPicks.bad", JSON.stringify(["ok", 3, null, ""]));
  assert.deepEqual(readRecentPicks("bad"), ["ok"]);
}
{
  // Storage that throws on every call (private window, blocked site data).
  g.localStorage = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.deepEqual(readRecentPicks("t"), []);
  assert.deepEqual(pushRecentPick("t", "z"), ["z"]);
}
{
  // Even reading the localStorage property throws.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  assert.deepEqual(readRecentPicks("t"), []);
  assert.deepEqual(pushRecentPick("t", "z"), ["z"]);
  delete g.localStorage;
}

console.log("  ✓ picker search — every word matches, A→Z, recent first, heads kept, storage failures harmless");
