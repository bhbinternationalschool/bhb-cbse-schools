import assert from "node:assert/strict";

console.log("reviewDemoHidden.selftest.ts");

/**
 * The Play review family is invisible to staff (director, 9 Oct 2026): the
 * browser's roster and pay-link list drop it, everyone else stays.
 */

const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = Object.assign(globalThis, {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
});
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

async function main() {
  const sis = await import("./sis");
  const payments = await import("./payments");
  store.set("bhb_demo_roster_cleared_v1", "1");
  const hh = (id: string, code: string) => ({ id, code, guardianName: id, mobile: "" });
  const st = (id: string, householdId: string, admissionNo: string) => ({
    id, householdId, admissionNo, fullName: id, status: "active", classId: "", sectionId: "", academicYearCode: "2026-27",
  });
  store.set(
    "bhb_sis_v1",
    JSON.stringify({
      version: 1,
      households: [hh("hh_real", "H-1"), hh("hh_zzdemo01", "DEMO-REVIEW")],
      students: [st("s_real", "hh_real", "BHB-0001"), st("stu_zzdemo01", "hh_zzdemo01", "BHB-DEMO-0001"), st("stu_zzdemo02", "hh_zzdemo01", "BHB-DEMO-0002")],
    }),
  );
  const roster = sis.loadSis();
  assert.deepEqual(roster.students.map((s) => s.id), ["s_real"], "the review children are not in the staff roster");
  assert.deepEqual(roster.households.map((h) => h.id), ["hh_real"]);
  assert.equal(sis.isHiddenReviewDemoHousehold("hh_zzdemo01"), true);
  assert.equal(sis.isHiddenReviewDemoHousehold("hh_real"), false);

  const link = (id: string, householdId: string) =>
    ({ id, code: id, householdId, studentId: "", studentName: "", classLabel: "", amountPaise: 100, lines: [], status: "open", createdAt: "2026-10-09", createdBy: "", expiresOn: "2026-10-20", upiRef: "", paidAt: null, voucherId: null, receiptNo: null, note: "", academicYearCode: "2026-27" }) as never;
  const listed = payments.listPaymentLinks({ version: 1, links: [link("a", "hh_real"), link("b", "hh_zzdemo01")] });
  assert.deepEqual(listed.map((l) => l.id), ["a"], "the review family's pay links are not listed");

  console.log("reviewDemoHidden.selftest: all assertions passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
