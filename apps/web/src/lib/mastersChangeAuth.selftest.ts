/**
 * Run: npx tsx src/lib/mastersChangeAuth.selftest.ts
 *
 * Director, 6 Oct 2026: roles carry FUNCTIONS of a module, not just the
 * module — a teacher adds, changes and removes the subjects of the classes
 * they teach, and nothing else in Masters.
 */
import assert from "node:assert/strict";
import { authorizeMastersFeatureChange } from "./mastersChangeAuth";
import { authorizeFeatureChange } from "./deskFeatureAuth";
import { RBAC_FEATURES, featuresForRoute } from "./rbacFeatures";
import { RBAC_MODULES, canSeeModuleTab, canWriteModuleTab, visibleModuleTabs } from "./rbac";
import {
  defaultRbacState,
  featureAccess,
  hasAnyFeatureInModule,
  normalizeRbacState,
  setRoleFeaturePermission,
  type RbacState,
} from "./rbac";

console.log("mastersChangeAuth.selftest.ts");

type Link = { id: string; classId: string; subjectId: string; periodsPerWeek: number; isActive: boolean };
const link = (id: string, classId: string, subjectId: string): Link => ({
  id,
  classId,
  subjectId,
  periodsPerWeek: 5,
  isActive: true,
});

const stored = {
  classSubjects: [link("l1", "c6", "eng"), link("l2", "c6", "hin"), link("l3", "c7", "eng")],
  subjects: [{ id: "eng", code: "ENG" }, { id: "hin", code: "HIN" }],
  feeHeads: [{ id: "f1", name: "Tuition" }],
  schoolTiming: { start: "08:00" },
};

// A teacher: class subjects (all four actions) in their own classes, subject list read-only.
const teacher = (featureId: string, action: string) => {
  if (featureId === "masters.class_subjects") return { allowed: true, ownClassesOnly: true };
  if (featureId === "masters.subjects" && action === "view") return { allowed: true, ownClassesOnly: false };
  return { allowed: false, ownClassesOnly: false };
};
const own = new Set(["c6"]);
const label = (id: string) => ({ c6: "Class 6", c7: "Class 7" })[id] ?? id;

/* ── Add, change and remove a subject in their own class ── */
{
  const incoming = {
    ...stored,
    classSubjects: [
      { ...stored.classSubjects[0]!, periodsPerWeek: 6 }, // change
      // l2 removed
      stored.classSubjects[2]!,
      link("l4", "c6", "sci"), // add
    ],
  };
  const v = authorizeMastersFeatureChange(stored, incoming, teacher, own, label);
  assert.ok(v.ok, v.ok ? "" : v.reason);
  assert.deepEqual(v.changedSlices, ["classSubjects"]);
  const rows = v.merged.classSubjects as Link[];
  assert.deepEqual(rows.map((r) => r.id), ["l1", "l3", "l4"], "stored order kept, new row last");
  assert.equal(rows[0]!.periodsPerWeek, 6);
}

/* ── Another class: refused, by name ── */
{
  const add = { ...stored, classSubjects: [...stored.classSubjects, link("l9", "c7", "sci")] };
  const v = authorizeMastersFeatureChange(stored, add, teacher, own, label);
  assert.ok(!v.ok);
  assert.match(v.reason, /^Class 7 is not one of your classes/);

  const move = {
    ...stored,
    classSubjects: [{ ...stored.classSubjects[0]!, classId: "c7" }, stored.classSubjects[1]!, stored.classSubjects[2]!],
  };
  assert.ok(!authorizeMastersFeatureChange(stored, move, teacher, own, label).ok, "moving a row out of their class");

  const pull = {
    ...stored,
    classSubjects: [stored.classSubjects[0]!, stored.classSubjects[1]!, { ...stored.classSubjects[2]!, classId: "c6" }],
  };
  assert.ok(!authorizeMastersFeatureChange(stored, pull, teacher, own, label).ok, "pulling another class's row in");
}

/* ── A stale copy of OTHER classes neither blocks nor overwrites ── */
{
  // Since this teacher loaded, someone added l5 to Class 7 and changed l3.
  const now = {
    ...stored,
    classSubjects: [...stored.classSubjects.slice(0, 2), { ...stored.classSubjects[2]!, periodsPerWeek: 2 }, link("l5", "c7", "hin")],
  };
  const incoming = { ...stored, classSubjects: [...stored.classSubjects, link("l6", "c6", "sci")] };
  const v = authorizeMastersFeatureChange(now, incoming, teacher, own, label);
  assert.ok(v.ok, v.ok ? "" : v.reason);
  const rows = v.merged.classSubjects as Link[];
  assert.deepEqual(rows.map((r) => r.id), ["l1", "l2", "l3", "l5", "l6"]);
  assert.equal(rows.find((r) => r.id === "l3")!.periodsPerWeek, 2, "Class 7 stays as stored");
}

/* ── Everything outside their functions is taken from the stored desk ── */
{
  // The teaching subset a teacher's browser holds: no fee heads at all.
  const incoming = { ...stored, feeHeads: [], schoolTiming: { start: "09:00" } };
  const v = authorizeMastersFeatureChange(stored, incoming, teacher, own, label);
  assert.ok(v.ok);
  assert.deepEqual(v.changedSlices, [], "nothing of theirs changed");
  assert.deepEqual(v.merged.feeHeads, stored.feeHeads, "fee heads never emptied by a teacher's push");
  assert.deepEqual(v.merged.schoolTiming, stored.schoolTiming);
}

/* ── View-only on the subject list: a change to it is refused ── */
{
  const incoming = { ...stored, subjects: [...stored.subjects, { id: "sci", code: "SCI" }] };
  const v = authorizeMastersFeatureChange(stored, incoming, (f, a) =>
    f === "masters.subjects" && a === "edit" ? { allowed: false, ownClassesOnly: false } : teacher(f, a),
  own, label);
  // masters.subjects has no write grant → the slice is not lifted at all.
  assert.ok(v.ok);
  assert.deepEqual(v.merged.subjects, stored.subjects);

  const canAdd = (f: string, a: string) =>
    f === "masters.subjects" && a === "create" ? { allowed: true, ownClassesOnly: false } : teacher(f, a);
  const added = authorizeMastersFeatureChange(stored, incoming, canAdd, own, label);
  assert.ok(added.ok, "create granted → a new subject stands");
  const renamed = { ...stored, subjects: [{ id: "eng", code: "ENGL" }, stored.subjects[1]!] };
  const r = authorizeMastersFeatureChange(stored, renamed, canAdd, own, label);
  assert.ok(!r.ok);
  assert.match(r.reason, /may not change subject list/);
}

/* ── rbac: defaults, module grant wins, built-in back-fill once ── */
{
  const base = defaultRbacState();
  const teacherRole = base.roles.find((r) => r.code === "teacher")!;
  assert.ok(teacherRole.featureGrants?.some((g) => g.feature === "masters.class_subjects"));
  const transportRole = base.roles.find((r) => r.code === "transport");
  assert.ok(!transportRole?.featureGrants?.length, "only Teacher carries the class-subjects default");

  // A teacher session (designation resolves to the teacher role).
  const session = { persona: "staff", roleCode: "teacher", staffId: "t1", fullName: "T" };
  const a = featureAccess(session, null, "masters.class_subjects", "create", base);
  assert.ok(a.allowed && a.ownClassesOnly, "teacher: own classes only");
  assert.ok(!featureAccess(session, null, "masters.fee_heads", "edit", base).allowed);
  assert.ok(hasAnyFeatureInModule(session, null, "masters", "view", base));

  // Stored roles from before 6 Oct have no featureGrants field → defaults once.
  const legacy = JSON.parse(JSON.stringify(base)) as RbacState;
  for (const r of legacy.roles) delete r.featureGrants;
  const back = normalizeRbacState(legacy);
  assert.ok(back.roles.find((r) => r.code === "teacher")!.featureGrants!.length > 0);

  // …but a role the office cleared stays cleared.
  let cleared = base;
  for (const act of ["view", "create", "edit", "delete"] as const) {
    cleared = setRoleFeaturePermission(cleared, "role_teacher", "masters.class_subjects", act, false, "test");
  }
  cleared = setRoleFeaturePermission(cleared, "role_teacher", "masters.subjects", "view", false, "test");
  const reread = normalizeRbacState(JSON.parse(JSON.stringify(cleared)));
  assert.deepEqual(reread.roles.find((r) => r.code === "teacher")!.featureGrants, []);
  assert.ok(cleared.audit.length > base.audit.length, "every change is audited");

  // Unknown functions and actions a function does not have are dropped.
  let odd = setRoleFeaturePermission(base, "role_teacher", "masters.nope", "edit", true, "t");
  assert.equal(odd, base);
  odd = setRoleFeaturePermission(base, "role_teacher", "masters.school_profile", "delete", true, "t");
  assert.equal(odd, base);
}

/* ── Every module: the same rule (Transport as the example) ── */
{
  const storedT = {
    vehicles: [{ id: "v1", plate: "UP65" }],
    fuelRefillLogs: [{ id: "r1", litres: 20 }],
    routes: [{ id: "rt1", name: "Ayar" }],
    feePolicy: { perKm: 10 },
  };
  const fuelClerk = (f: string, a: string) =>
    f === "transport.fuel" && a !== "delete"
      ? { allowed: true, ownClassesOnly: false }
      : { allowed: false, ownClassesOnly: false };
  // The clerk's browser holds only their slices; everything else empty.
  const incoming = {
    vehicles: [],
    routes: [],
    fuelRefillLogs: [...storedT.fuelRefillLogs, { id: "r2", litres: 35 }],
  };
  const v = authorizeFeatureChange("transport", storedT, incoming, fuelClerk, null);
  assert.ok(v.ok, v.ok ? "" : v.reason);
  assert.deepEqual(v.changedSlices, ["fuelRefillLogs"]);
  assert.deepEqual(v.merged.vehicles, storedT.vehicles, "vehicles never emptied");
  assert.deepEqual(v.merged.routes, storedT.routes);
  assert.deepEqual(v.merged.feePolicy, storedT.feePolicy);

  const del = authorizeFeatureChange("transport", storedT, { fuelRefillLogs: [] }, fuelClerk, null);
  assert.ok(!del.ok, "delete not granted");
  assert.match(del.reason, /may not remove fuel log/);

  // Routes listed on a function open those API paths, and only those.
  assert.ok(featuresForRoute("transport", "/api/transport/live-positions").some((f) => f.id === "transport.live"));
  assert.equal(featuresForRoute("transport", "/api/transport/live-positionsX").length, 0);
  assert.equal(featuresForRoute("fees", "/api/transport/live").length, 0);
}

/* ── Catalogue hygiene: ids, modules, one owner per slice ── */
{
  const ids = new Set<string>();
  const owner = new Map<string, string>();
  const modules = new Set(RBAC_MODULES.map((m) => m.id));
  for (const f of RBAC_FEATURES) {
    assert.ok(!ids.has(f.id), `duplicate function id ${f.id}`);
    ids.add(f.id);
    assert.ok(f.id.startsWith(`${f.module}.`), `${f.id} must start with its module`);
    assert.ok(modules.has(f.module), `${f.id}: unknown module`);
    assert.ok(f.actions.length > 0, `${f.id}: no actions`);
    for (const k of f.slices ?? []) {
      const key = `${f.module}:${k}`;
      assert.ok(!owner.has(key), `${key} owned by both ${owner.get(key)} and ${f.id}`);
      owner.set(key, f.id);
    }
  }
}

/* ── Screens: a function opens its tabs, and editing there ── */
{
  // The Teacher role holds no Transport; give it one function.
  const st = setRoleFeaturePermission(defaultRbacState(), "role_teacher", "transport.fuel", "create", true, "t");
  const clerk = { persona: "staff", roleCode: "teacher", staffId: "s9", fullName: "F" };
  const tabs = [{ id: "dashboard" }, { id: "fuel" }, { id: "fleet" }];
  assert.deepEqual(visibleModuleTabs(tabs, clerk, null, "transport", st).map((t) => t.id), ["fuel"]);
  assert.ok(canSeeModuleTab(clerk, null, "transport", "fuel", st));
  assert.ok(canWriteModuleTab(clerk, null, "transport", "fuel", "create", st));
  assert.ok(!canWriteModuleTab(clerk, null, "transport", "fleet", "create", st));
}

console.log("  ✓ masters function grants — own classes only, nothing else lifted");
