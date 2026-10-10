/**
 * Run: npx tsx src/lib/commsReach.selftest.ts
 */
import assert from "node:assert/strict";
import { buildReachReport } from "@/lib/commsReach";
import { normalizeStudent, type Household, type SisStudent } from "@/lib/sis";

const st = (p: Partial<SisStudent>) => normalizeStudent({ id: "x", admissionNo: "A", fullName: "X", status: "active", ...p } as SisStudent);
const hh = (id: string, mobile: string) => ({ id, guardianName: `G ${id}`, mobile, whatsappMobile: "", altMobile: "" }) as unknown as Household;
const households: Record<string, Household> = {
  h1: hh("h1", "9876500001"), // app
  h2: hh("h2", "9876500002"), // WhatsApp only (unchecked number still counts)
  h3: hh("h3", "9876500003"), // number known NOT on WhatsApp → unreachable
  h4: hh("h4", ""), // no number → unreachable
};
const students = [
  st({ id: "a", fullName: "ANU", householdId: "h1", classId: "c1", sectionId: "s1" }),
  st({ id: "b", fullName: "BABLU", householdId: "h1", classId: "c2", sectionId: "s2" }),
  st({ id: "c", fullName: "CHINTU", householdId: "h2", classId: "c1", sectionId: "s1" }),
  st({ id: "d", fullName: "DIPU", householdId: "h3", classId: "c1", sectionId: "s1" }),
  st({ id: "e", fullName: "EKTA", householdId: "h4", classId: "c2", sectionId: "s2" }),
];
const r = buildReachReport({
  students,
  householdOf: (id) => households[id],
  appHouseholds: new Set(["h1"]),
  notOnWhatsApp: new Set(["9876500003"]),
  onWhatsApp: new Set(["9876500001"]),
  classLabel: (s) => ({ key: `${s.classId}:${s.sectionId}`, label: s.classId === "c1" ? "I A" : "II A", order: s.classId === "c1" ? 1 : 2 }),
});
assert.deepEqual(r.totals, { families: 4, app: 1, whatsappOnly: 1, unreachable: 2, whatsappConfirmed: 1 });
assert.deepEqual(
  r.classes.map((c) => `${c.label}:${c.families}/${c.app}/${c.whatsappOnly}/${c.unreachable}`),
  ["I A:3/1/1/1", "II A:2/1/0/1"],
  "a family with children in two classes counts in both",
);
assert.deepEqual(r.unreachable.map((f) => f.children.join("+")).sort(), ["DIPU", "EKTA"]);
assert.equal(r.unreachable.find((f) => f.householdId === "h3")?.guardianName, "G h3");
console.log("commsReach selftest: ok");
