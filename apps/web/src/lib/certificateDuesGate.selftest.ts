/**
 * The TC / fee-clearance gate (lib/certificates.ts certificateEligibility,
 * issueCertificate) — 21 Oct 2026.
 *
 * The defect: the gate counted dues from this tab's page copy of Masters. A
 * person without the Masters grant holds the TEACHING SUBSET (fee groups,
 * heads, structure, grants withheld), so every child came out at ₹0 and a TC
 * or a "no outstanding fee dues" certificate could be issued for a child who
 * owed fees. Now the gate decides from the server's answer (GET
 * /api/data/views/certificate-dues); with a full book the larger of that and
 * the screen's own figure; with no answer it refuses.
 *
 * Runs in Node: loadMasters / loadFees / loadSis read the school mirror
 * (setMirrorSlice), exactly as the page copies would be filled. The "server
 * answer" here is an independent oracle — computeStudentDues on the FULL book
 * — not the code under test.
 *
 * Needs Supabase env placeholders (ensureFeeSetup's tenant rules); the npm
 * script supplies them. Run: npm run test:certificate-dues-gate
 */
import assert from "node:assert/strict";

import { AY_CURRENT, buildFixture } from "../../e2e/fixture";
import * as cert from "./certificates";
import { computeStudentDues, emptyFeesState, openFeeDues, type FeesState } from "./fees";
import { buildSessionInstallments, type MastersState } from "./masters";
import { teachingMastersSubset } from "./mastersTeachingSubset";
import { setMirrorSlice } from "./schoolDataMirror";
import type { SisStudent } from "./sis";
import { isSupabaseConfigured } from "./supabase/client";

if (!isSupabaseConfigured()) {
  console.error("certificateDuesGate.selftest: needs Supabase env — run `npm run test:certificate-dues-gate`.");
  process.exit(1);
}

console.log("certificateDuesGate.selftest.ts");
const failures: string[] = [];
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(`  FAIL ${name}: ${(err as Error).message.split("\n")[0]}`);
    console.log(failures[failures.length - 1]);
  }
}

const fx = buildFixture();
const current = fx.sis.students.filter((s) => s.academicYearCode === AY_CURRENT && s.status === "active" && s.householdId);
// Both billed by the same group; CLEAR has paid every month, OWES nothing.
const OWES = current[0]!;
const CLEAR = current.find((s) => s.id !== OWES.id && s.classId === OWES.classId && s.studentType === OWES.studentType)!;

// ── A production-shaped fee book: 12 monthly installments, a tuition head,
// an active group per class and student type, ₹1,000 a month (every class
// billed, as in production — a class with no group would be filled in by
// ensureFeeSetup on load). ────────────────────────────────────────────────
const installments = buildSessionInstallments(AY_CURRENT, "monthly");
const full: MastersState = {
  ...fx.masters,
  staff: fx.staff.staff,
  departments: fx.staff.departments,
  designations: fx.staff.designations,
  installments,
  feeHeads: [
    { id: "fh_gate_tui", code: "TUITION", nameEn: "Tuition", category: "academic", frequency: "monthly", isOptional: false, isRefundable: false, isActive: true, sortOrder: 1 },
  ] as unknown as MastersState["feeHeads"],
  feeGroups: groups() as unknown as MastersState["feeGroups"],
  feeStructureLines: groups().flatMap((g) =>
    installments.map((i) => ({
      id: `fsl_${g.id}_${i.code}`,
      feeGroupId: g.id,
      feeHeadId: "fh_gate_tui",
      classId: null,
      amountPaise: 100000,
      installmentId: i.id,
    })),
  ) as unknown as MastersState["feeStructureLines"],
};
function groups() {
  const types = Array.from(new Set(current.map((c) => c.studentType)));
  return fx.masters.classes.flatMap((c) =>
    types.map((t) => ({
      id: `fg_gate_${c.id}_${t}`,
      code: `GATE-${c.id}-${t}`,
      name: `Gate ${c.id} ${t}`,
      academicYearCode: AY_CURRENT,
      studentType: t,
      classIds: [c.id],
      isActive: true,
      structurePublishedAt: "2026-04-01T00:00:00.000Z",
      structurePublishedBy: "selftest",
    })),
  );
}
// What someone without the Masters grant is sent (masters-desk / views/masters).
const teaching = {
  ...full,
  ...(teachingMastersSubset(full as unknown as Record<string, unknown>) as unknown as Partial<MastersState>),
} as MastersState;
// One receipt paying every line CLEAR is billed (keys from the raw book).
const clearLines = openFeeDues(
  computeStudentDues(CLEAR, full, emptyFeesState(), { includeFuture: true, includeInactive: true }),
);
const fees: FeesState = {
  ...emptyFeesState(),
  vouchers: [
    {
      id: "gate_rcv_1",
      receiptNo: "GATE-1",
      householdId: CLEAR.householdId,
      academicYearCode: AY_CURRENT,
      collectionDate: "2026-04-10",
      transactionDate: "2026-04-10",
      collectedAt: "2026-04-10T05:30:00.000Z",
      lines: clearLines.map((d) => ({
        dueKey: d.dueKey,
        studentId: CLEAR.id,
        studentName: CLEAR.fullName,
        label: d.label,
        kind: d.kind,
        amountPaise: d.balancePaise,
        billedPaise: d.balancePaise,
        concessionPaise: 0,
        concessionDetails: [],
      })),
      tenders: [{ mode: "cash", amountPaise: clearLines.reduce((t, d) => t + d.balancePaise, 0), ref: "", realisation: "cleared" }],
      totalPaise: clearLines.reduce((t, d) => t + d.balancePaise, 0),
      voidedAt: null,
    } as unknown as FeesState["vouchers"][number],
  ],
};

setMirrorSlice("fees", fees);
setMirrorSlice("sis", { version: 1, households: fx.sis.households, students: fx.sis.students });

/** The oracle: what the server counts from the FULL book. */
function serverAnswer(s: SisStudent): cert.CertificateDuesAnswer {
  const open = openFeeDues(computeStudentDues(s, full, fees, { includeFuture: true, includeInactive: true }));
  return { state: "known", openBalancePaise: open.reduce((t, d) => t + d.balancePaise, 0), openDueCount: open.length };
}

const useBook = (book: MastersState) => setMirrorSlice("masters", book);
const GATED = ["tc", "fee_clearance"] as const;

check("precondition: in the full book OWES owes, CLEAR owes nothing; the teaching subset bills nobody", () => {
  assert.equal(clearLines.length, 12, "CLEAR is billed twelve months before the receipt");
  const owes = serverAnswer(OWES);
  assert.ok(owes.state === "known" && owes.openBalancePaise > 0, `OWES: ${JSON.stringify(owes)}`);
  const clear = serverAnswer(CLEAR);
  assert.ok(clear.state === "known" && clear.openDueCount === 0, `CLEAR: ${JSON.stringify(clear)}`);
  assert.equal(teaching.feeGroups.length, 0, "fee groups withheld");
  assert.equal(teaching.feeStructureLines.length, 0, "fee structure withheld");
  const onTeaching = openFeeDues(computeStudentDues(OWES, teaching, fees, { includeFuture: true, includeInactive: true }));
  assert.equal(onTeaching.length, 0, "the teaching subset computes ₹0 for OWES — the defect's input");
});

// ── Teaching-subset book ─────────────────────────────────────────────────
for (const kind of GATED) {
  check(`teaching-subset book, no server answer (role): ${kind} REFUSED with the role message`, () => {
    useBook(teaching);
    const e = cert.certificateEligibility(OWES, kind, { server: { state: "role" }, bookIsFull: false });
    assert.equal(e.canIssue, false, "must refuse — on the old code this book gave ₹0 and canIssue: true");
    assert.ok(e.blockers.includes("Fee dues could not be checked for your role — ask the office"), `blockers: ${JSON.stringify(e.blockers)}`);
    assert.equal(e.openBalancePaise, null, "unknown is not ₹0");
  });

  check(`teaching-subset book, server failed / still checking: ${kind} REFUSED`, () => {
    useBook(teaching);
    for (const server of [{ state: "failed" }, { state: "checking" }] as const) {
      const e = cert.certificateEligibility(OWES, kind, { server, bookIsFull: false });
      assert.equal(e.canIssue, false, `${server.state}: must refuse`);
      assert.equal(e.openBalancePaise, null);
    }
  });

  check(`teaching-subset book, server says OWES owes: ${kind} REFUSED with the server's figure`, () => {
    useBook(teaching);
    const server = serverAnswer(OWES);
    const e = cert.certificateEligibility(OWES, kind, { server, bookIsFull: false });
    assert.equal(e.canIssue, false);
    assert.equal(e.openBalancePaise, server.state === "known" ? server.openBalancePaise : -1);
    assert.ok(e.blockers.some((b) => b.startsWith("Open dues ₹")), `blockers: ${JSON.stringify(e.blockers)}`);
  });

  check(`teaching-subset book, server says CLEAR owes nothing: ${kind} allowed`, () => {
    useBook(teaching);
    const e = cert.certificateEligibility(CLEAR, kind, { server: serverAnswer(CLEAR), bookIsFull: false });
    assert.equal(e.canIssue, true, `blockers: ${JSON.stringify(e.blockers)}`);
    assert.equal(e.openBalancePaise, 0);
  });
}

// ── Full book ────────────────────────────────────────────────────────────
for (const kind of GATED) {
  check(`full book with dues (OWES): ${kind} REFUSED`, () => {
    useBook(full);
    const e = cert.certificateEligibility(OWES, kind, { server: serverAnswer(OWES), bookIsFull: true });
    assert.equal(e.canIssue, false);
    assert.equal(e.openDueCount, 12, "the twelve tuition months");
  });

  check(`full book without dues (CLEAR): ${kind} PASSES`, () => {
    useBook(full);
    const e = cert.certificateEligibility(CLEAR, kind, { server: serverAnswer(CLEAR), bookIsFull: true });
    assert.equal(e.canIssue, true, `blockers: ${JSON.stringify(e.blockers)}`);
    assert.equal(e.openBalancePaise, 0);
    assert.deepEqual(e.blockers, []);
  });

  check(`full book: the larger of screen and server decides — either one owing REFUSES ${kind}`, () => {
    useBook(full);
    const serverClear = cert.certificateEligibility(OWES, kind, {
      server: { state: "known", openBalancePaise: 0, openDueCount: 0 },
      bookIsFull: true,
    });
    assert.equal(serverClear.canIssue, false, "the screen's full book shows dues → refused");
    assert.ok(serverClear.warnings.some((w) => w.startsWith("This screen's copy shows")), "the disagreement is said");
    const serverOwes = cert.certificateEligibility(CLEAR, kind, {
      server: { state: "known", openBalancePaise: 50000, openDueCount: 1 },
      bookIsFull: true,
    });
    assert.equal(serverOwes.canIssue, false, "the server shows dues → refused");
    assert.equal(serverOwes.openBalancePaise, 50000);
  });

  check(`full book, server unreachable: ${kind} REFUSED (the screen's book alone is not trusted)`, () => {
    useBook(full);
    const e = cert.certificateEligibility(CLEAR, kind, { server: { state: "failed" }, bookIsFull: true });
    assert.equal(e.canIssue, false);
    assert.ok(e.blockers.includes("Fee dues could not be checked just now — try again"));
  });
}

// ── A certificate that states nothing about fees ─────────────────────────
check("bonafide with unknown dues: allowed, dues null (not ₹0)", () => {
  useBook(teaching);
  const e = cert.certificateEligibility(OWES, "bonafide", { server: { state: "role" }, bookIsFull: false });
  assert.equal(e.canIssue, true);
  assert.equal(e.openBalancePaise, null);
});

// ── issueCertificate itself (not only the screen's button) ──────────────
check("issueCertificate: TC on a teaching-subset book with no server answer is refused", () => {
  useBook(teaching);
  const r = cert.issueCertificate({
    kind: "tc",
    studentId: OWES.id,
    issuedBy: "selftest",
    leavingDate: "2026-10-21",
    reasonForLeaving: "selftest",
    admissionDate: "2024-04-01",
    dues: { server: { state: "role" }, bookIsFull: false },
  });
  assert.equal(r.ok, false, "must refuse — the old code issued it");
  assert.equal(!r.ok && r.error, "Fee dues could not be checked for your role — ask the office");
});

check("issueCertificate: fee clearance with the server's dues is refused", () => {
  useBook(teaching);
  const r = cert.issueCertificate({
    kind: "fee_clearance",
    studentId: OWES.id,
    issuedBy: "selftest",
    dues: { server: serverAnswer(OWES), bookIsFull: false },
  });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /^Open dues ₹/);
});

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("certificateDuesGate.selftest: all ok");
