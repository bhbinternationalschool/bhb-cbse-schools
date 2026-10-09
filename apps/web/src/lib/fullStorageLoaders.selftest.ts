/**
 * Run: npx tsx src/lib/fullStorageLoaders.selftest.ts
 *
 * A phone whose browser storage is full (director, 9 Oct 2026: "attendance
 * shows proper on this browser but 0 in the mobile browser"). Every write is
 * refused with a quota error; writeCacheOrInvalidate keeps the value in
 * memory, and every loader must read it back through readCache instead of
 * localStorage — which is empty — and showing 0.
 */
import assert from "node:assert/strict";

class FullStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem() { throw new Error("QuotaExceededError: the quota has been exceeded"); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const storage = new FullStorage();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: storage,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
  setTimeout,
  clearTimeout,
};
(globalThis as unknown as { localStorage: unknown }).localStorage = storage;
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent ??= class { constructor(public type: string) {} };

async function main() {
  const { writeCacheOrInvalidate, readCache, removeCache } = await import("@/lib/browserStorage");
  const { loadAttendance } = await import("@/lib/attendance");
  const { loadStaffAttendance } = await import("@/lib/staffAttendance");

  // The store refuses the write; the value is still readable.
  assert.equal(writeCacheOrInvalidate("bhb_test_key", "v1"), false, "a full store refuses");
  assert.equal(readCache("bhb_test_key"), "v1", "held in memory");
  removeCache("bhb_test_key");
  assert.equal(readCache("bhb_test_key"), null, "removeCache clears the memory copy too");

  // Student attendance: one register, two marks.
  writeCacheOrInvalidate(
    "bhb_attendance_v1",
    JSON.stringify({
      version: 2,
      registers: [
        { id: "ar1", academicYearCode: "2026-27", campusId: "", classId: "c1", sectionId: "s1", date: "2026-10-08", markedBy: "t", markedAt: "2026-10-08T05:00:00Z", remark: "",
          marks: [{ studentId: "a", status: "P", note: "" }, { studentId: "b", status: "A", note: "" }] },
      ],
      policy: {},
      absentNudges: [],
      exceptions: [],
    }),
  );
  const att = loadAttendance();
  assert.equal(att.registers.length, 1, "student attendance is not 0 on a full phone");
  assert.equal(att.registers[0].marks.length, 2);

  // Staff attendance likewise.
  writeCacheOrInvalidate(
    "bhb_staff_attendance_v1",
    JSON.stringify({
      version: 1,
      registers: [
        { id: "sar1", academicYearCode: "2026-27", date: "2026-10-08", markedBy: "office", markedAt: "2026-10-08T03:30:00Z", remark: "",
          marks: [{ staffId: "stf1", status: "P", note: "", inTime: "08:00", outTime: "", punchWay: "self" }] },
      ],
    }),
  );
  const staff = loadStaffAttendance();
  assert.equal(staff.registers.length, 1, "staff attendance is not 0 on a full phone");
  console.log("fullStorageLoaders selftest: ok");
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
