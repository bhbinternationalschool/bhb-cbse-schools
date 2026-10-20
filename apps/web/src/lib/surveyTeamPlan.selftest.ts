/**
 * Field survey team rules (lib/surveyTeamPlan.ts, 15 Oct 2026): who may change
 * what, and the exact rows a change writes through desk_write_guarded.
 *
 * Run: npx tsx src/lib/surveyTeamPlan.selftest.ts
 */
import assert from "node:assert/strict";
import { planSurveyTeamOp, type RosterStaff, type SurveyActor } from "./surveyTeamPlan";
import type { SurveyBeatRow, SurveyMemberRow, SurveyTeamData } from "./surveyTeamShared";

console.log("surveyTeamPlan.selftest.ts");

const now = new Date("2026-10-15T05:00:00.000Z");
let n = 0;
const newId = (p: string) => `${p}_${++n}`;
const mem = (id: string, over: Partial<SurveyMemberRow> = {}): SurveyMemberRow => ({
  id,
  kind: "staff",
  staffId: `st_${id}`,
  externalId: "",
  fullName: `Name ${id}`,
  mobile: "9876500000",
  empCode: "E1",
  note: "",
  role: "agent",
  assigned: true,
  startMode: "school",
  beatIds: [],
  createdAt: "",
  revision: `2026-10-15T00:00:00.${id.length}Z`,
  ...over,
});
const beat = (id: string, over: Partial<SurveyBeatRow> = {}): SurveyBeatRow => ({
  id,
  code: "B1",
  name: `Beat ${id}`,
  area: "",
  targetHouseholds: 10,
  isActive: true,
  note: "",
  createdAt: "",
  revision: "2026-10-15T01:00:00Z",
  ...over,
});
const data: SurveyTeamData = {
  members: [mem("lead", { role: "leader" }), mem("a"), mem("ext", { kind: "external", staffId: "", externalId: "sve_1" })],
  beats: [beat("b1"), beat("b2", { code: "B2", name: "North" })],
};
const roster: RosterStaff[] = [
  { id: "st_new", fullName: "New Person", mobile: "+91 98765 43210", empCode: "E9", active: true },
  { id: "st_left", fullName: "Left", mobile: "", empCode: "E8", active: false },
  { id: "st_a", fullName: "Name a", mobile: "", empCode: "E1", active: true },
];
const office: SurveyActor = { kind: "office", name: "Office" };
const leader: SurveyActor = { kind: "leader", memberId: "lead", name: "Lead" };
const agentPosingAsLeader: SurveyActor = { kind: "leader", memberId: "a", name: "A" };

const plan = (op: Parameters<typeof planSurveyTeamOp>[0], who: SurveyActor, d = data) => planSurveyTeamOp(op, who, d, roster, now, newId);

// ── Office: add staff (as leader demotes the current leader, same batch) ──
{
  const p = plan({ op: "member_add_staff", staffId: "st_new", leader: true }, office);
  assert.ok(p.ok);
  assert.equal(p.collection, "admissions.survey-members");
  assert.equal(p.ops.length, 2, "the old leader is demoted in the same all-or-none batch");
  assert.deepEqual(p.ops[0], { op: "upsert", id: "lead", base: data.members[0]!.revision, row: { role: "agent" } });
  const add = p.ops[1]!;
  assert.equal(add.op, "upsert");
  assert.equal(add.base, null, "a new row has no base");
  assert.equal((add as { row: Record<string, unknown> }).row.role, "leader");
  assert.equal((add as { row: Record<string, unknown> }).row.mobile, "9876543210");
  assert.equal((add as { row: Record<string, unknown> }).row.assigned, true, "added = may start on the app");
}
{
  const dup = plan({ op: "member_add_staff", staffId: "st_a" }, office);
  assert.ok(!dup.ok && dup.status === 409, "already on the team");
  const left = plan({ op: "member_add_staff", staffId: "st_left" }, office);
  assert.ok(!left.ok && left.status === 400, "a member of staff who left cannot be added");
  const ghost = plan({ op: "member_add_staff", staffId: "nobody" }, office);
  assert.ok(!ghost.ok && ghost.status === 400);
}

// ── Leader: the four leader ops; never leadership, never office-only ops ──
{
  const p = plan({ op: "member_add_staff", staffId: "st_new", leader: true }, leader);
  assert.ok(p.ok && p.ops.length === 1, "a leader's add never makes a leader");
  assert.equal((p.ops[0] as { row: Record<string, unknown> }).row.role, "agent");
  assert.ok(plan({ op: "member_remove", id: "a", base: data.members[1]!.revision }, leader).ok, "leader removes an agent");
  const self = plan({ op: "member_remove", id: "lead", base: "x" }, leader);
  assert.ok(!self.ok && self.status === 403, "not themselves");
  const ext = plan({ op: "member_remove", id: "ext", base: "x" }, leader);
  assert.ok(!ext.ok && ext.status === 403, "not an outside surveyor");
  for (const op of [
    { op: "member_leader", id: "a", base: "x" },
    { op: "member_update", id: "a", base: "x", assigned: false },
    { op: "member_add_external", fullName: "Out Side", mobile: "9876543210" },
  ] as const) {
    const r = plan(op, leader);
    assert.ok(!r.ok && r.status === 403, `leader may not ${op.op}`);
  }
  const b = plan({ op: "beat_save", name: "East" }, leader);
  assert.ok(b.ok && b.collection === "admissions.survey-beats");
  assert.ok(plan({ op: "beat_active", id: "b1", base: "x", isActive: false }, leader).ok);
}
// An agent claiming the leader's door is refused on the stored row, not the claim.
{
  const r = plan({ op: "beat_save", name: "East" }, agentPosingAsLeader);
  assert.ok(!r.ok && r.status === 403);
  const gone = plan({ op: "beat_save", name: "East" }, { kind: "leader", memberId: "nobody", name: "?" });
  assert.ok(!gone.ok && gone.status === 403);
}

// ── Beats ──
{
  const p = plan({ op: "beat_save", name: "  East Ward ", area: "Sigra", targetHouseholds: 40.6 }, office);
  assert.ok(p.ok);
  const row = (p.ops[0] as { row: Record<string, unknown>; base: unknown }).row;
  assert.equal(row.name, "East Ward");
  assert.equal(row.target_households, 41);
  assert.equal(row.code, "B3", "next free code");
  assert.equal(row.is_active, true);
  const dup = plan({ op: "beat_save", name: "north" }, office);
  assert.ok(!dup.ok && dup.status === 409, "names are unique, case-blind");
  const edit = plan({ op: "beat_save", id: "b2", base: "2026-10-15T01:00:00Z", name: "North", area: "X" }, office);
  assert.ok(edit.ok && edit.ops[0]!.base === "2026-10-15T01:00:00Z", "an edit carries the base the screen loaded");
  const short = plan({ op: "beat_save", name: "E" }, office);
  assert.ok(!short.ok && short.status === 400);
}

// ── Member update: beats must exist ──
{
  const ok = plan({ op: "member_update", id: "a", base: "r", beatIds: ["b1", "b1", "b2"] }, office);
  assert.ok(ok.ok);
  assert.deepEqual((ok.ops[0] as { row: Record<string, unknown> }).row, { beat_ids: ["b1", "b2"] });
  const bad = plan({ op: "member_update", id: "a", base: "r", beatIds: ["nope"] }, office);
  assert.ok(!bad.ok && bad.status === 400);
  const none = plan({ op: "member_update", id: "a", base: "r" }, office);
  assert.ok(!none.ok);
}

// ── Remove carries the base (a stale screen is refused by the kernel) ──
{
  const r = plan({ op: "member_remove", id: "a", base: "2026-10-15T00:00:00.1Z" }, office);
  assert.ok(r.ok);
  assert.deepEqual(r.ops, [{ op: "delete", id: "a", base: "2026-10-15T00:00:00.1Z" }]);
}

// ── Outside surveyor ──
{
  const ok = plan({ op: "member_add_external", fullName: "Out Side", mobile: "98765-43211" }, office);
  assert.ok(ok.ok);
  const row = (ok.ops[0] as { row: Record<string, unknown> }).row;
  assert.equal(row.kind, "external");
  assert.equal(row.start_mode, "field");
  assert.ok(String(row.external_id).startsWith("sve_"));
  const again = plan({ op: "member_add_external", fullName: "Again", mobile: "9876500000", externalId: "sve_1" }, office);
  assert.ok(!again.ok && again.status === 409);
  const badMobile = plan({ op: "member_add_external", fullName: "X Y", mobile: "12345" }, office);
  assert.ok(!badMobile.ok && badMobile.status === 400);
}

console.log("surveyTeamPlan.selftest: all assertions passed");
