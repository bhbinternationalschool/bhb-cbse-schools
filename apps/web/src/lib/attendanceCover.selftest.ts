/**
 * Self-test: substitutes and co-ordinators may take a class's register on
 * the day they cover it (director, 13 Oct 2026).
 * Run: npx tsx src/lib/attendanceCover.selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  coverSectionsFor,
  emptyClassCoordinators,
  normalizeClassCoordinators,
  setCoordinatorSections,
  todayIst,
} from "./attendanceCover";

console.log("attendanceCover.selftest.ts");

const ay = "2026-27";
const day = "2026-10-13";
const staff = [
  { id: "kanchan", fullName: "Kanchan Singh", status: "active", classTeacherLinks: [{ classId: "c5", sectionId: "s5a", academicYearCode: ay }] },
  { id: "neha", fullName: "Neha Pathak", status: "active", classTeacherLinks: [{ classId: "c6", sectionId: "s6a", academicYearCode: ay }] },
  { id: "jyoti", fullName: "Jyoti Singh", status: "active", classTeacherLinks: [] },
  { id: "vishal", fullName: "Vishal Mishra", status: "active", classTeacherLinks: [] },
];
const sub = (o: Partial<{ date: string; substituteTeacherId: string; academicYearCode: string }> = {}) => ({
  academicYearCode: ay, date: day, periodNo: 3, classId: "c5", sectionId: "s5a", absentTeacherId: "kanchan", substituteTeacherId: "vishal", ...o,
});

/* ── substitute: today, for the class of the period only ─────────────── */
{
  const cover = coverSectionsFor({ staffId: "vishal", date: day, academicYearCode: ay, substitutions: [sub()], coordinators: emptyClassCoordinators(), staff, absentStaffIds: new Set() });
  assert.deepEqual(cover.map((c) => [c.classId, c.sectionId, c.reason]), [["c5", "s5a", "substitute"]]);
  assert.match(cover[0]!.detail, /period 3 for Kanchan Singh/);
  assert.equal(coverSectionsFor({ staffId: "vishal", date: "2026-10-14", academicYearCode: ay, substitutions: [sub()], coordinators: emptyClassCoordinators(), staff, absentStaffIds: new Set() }).length, 0, "not another day");
  assert.equal(coverSectionsFor({ staffId: "jyoti", date: day, academicYearCode: ay, substitutions: [sub()], coordinators: emptyClassCoordinators(), staff, absentStaffIds: new Set() }).length, 0, "not someone else");
  assert.equal(coverSectionsFor({ staffId: "vishal", date: day, academicYearCode: ay, substitutions: [sub({ substituteTeacherId: "" })], coordinators: emptyClassCoordinators(), staff, absentStaffIds: new Set() }).length, 0, "a period left free gives nobody cover");
}

/* ── co-ordinators: one per class ────────────────────────────────────── */
let coord = emptyClassCoordinators();
{
  const a = setCoordinatorSections(coord, "jyoti", ["c5|s5a", "c6|s6a"], "office", (id) => staff.find((s) => s.id === id)!.fullName, (k) => k);
  assert.ok(a.ok);
  coord = a.ok ? a.state : coord;
  const b = setCoordinatorSections(coord, "vishal", ["c6|s6a"], "office", (id) => staff.find((s) => s.id === id)!.fullName, () => "Class 6");
  assert.ok(!b.ok && /Class 6 \(Jyoti Singh\)/.test(b.error) && /one co-ordinator/.test(b.error), "a class already given to someone is refused, naming them");
  const c = setCoordinatorSections(coord, "jyoti", ["c5|s5a"], "office");
  assert.ok(c.ok && c.state.byStaff.jyoti!.join() === "c5|s5a", "the same person may change their own classes");
  const d = setCoordinatorSections(coord, "jyoti", [], "office");
  assert.ok(d.ok && !d.state.byStaff.jyoti, "an empty list removes them");
  assert.deepEqual(normalizeClassCoordinators({ byStaff: { x: ["bad", "c1|s1", "c1|s1"] } }).byStaff, { x: ["c1|s1"] }, "garbage and repeats dropped");
}

/* ── co-ordinator cover: only while the class teacher is away ───────── */
{
  const base = { staffId: "jyoti", date: day, academicYearCode: ay, substitutions: [], coordinators: coord, staff };
  assert.equal(coverSectionsFor({ ...base, absentStaffIds: new Set() }).length, 0, "teacher present: nothing extra");
  const away = coverSectionsFor({ ...base, absentStaffIds: new Set(["kanchan"]) });
  assert.deepEqual(away.map((c) => [c.sectionId, c.reason]), [["s5a", "coordinator"]], "only the absent teacher's class");
  assert.match(away[0]!.detail, /Kanchan Singh absent today/);
  assert.equal(coverSectionsFor({ ...base, absentStaffIds: null }).length, 0, "absence unknown → no cover (unknown is not 'away')");
  const noTeacher = { ...coord, byStaff: { jyoti: ["c9|s9"] } };
  assert.equal(coverSectionsFor({ ...base, coordinators: noTeacher, absentStaffIds: new Set() })[0]?.detail.includes("no class teacher"), true, "a class with no class teacher is the co-ordinator's");
}

/* ── wiring ──────────────────────────────────────────────────────────── */
{
  assert.match(todayIst(new Date("2026-10-12T20:00:00Z")), /^2026-10-13$/, "today is IST");
  const api = join(__dirname, "../app/api/v1");
  const mark = readFileSync(join(api, "attendance/mark/route.ts"), "utf8");
  const roster = readFileSync(join(api, "attendance/roster/route.ts"), "utf8");
  assert.ok(/assertAttendanceScope\(ctx, body\.classId, body\.sectionId, body\.date\)/.test(mark), "marking checks cover for the body's date");
  assert.ok(/assertAttendanceScope\(ctx, classId, sectionId, date\)/.test(roster));
  const scope = readFileSync(join(__dirname, "api/v1/attendanceScope.server.ts"), "utf8");
  assert.ok(/if \(date !== todayIst\(\)\)/.test(scope), "cover is for today's date only");
  const month = readFileSync(join(api, "attendance/month/route.ts"), "utf8");
  assert.ok(!/attendanceCover|assertAttendanceScope/.test(month), "the month register stays the class teacher's");
  const coordRoute = readFileSync(join(api, "staff/coordinators/route.ts"), "utf8");
  assert.ok(/requireStaffPermission\(req, "staff", "edit"\)/.test(coordRoute) && /baseUpdatedAt/.test(coordRoute), "saving needs Staff · edit and the loaded copy");
}

console.log("  ok");
