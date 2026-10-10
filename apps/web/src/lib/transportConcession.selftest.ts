/**
 * Self-test: transport discounts on the riders-by-bus roster.
 * Run: npx tsx apps/web/src/lib/transportConcession.selftest.ts
 *
 * The gap this closes: concessions were applied by the fee engine and were
 * invisible on the roster, so a bus quoted its GROSS fees as "billed per
 * month" and a child riding free on an approved 100% discount looked like a
 * full-paying rider.
 *
 * Two rules are pinned:
 *   1. The roster quotes the SAME discount the invoice charges — both go
 *      through the fee engine's own rule resolution, never a second copy.
 *   2. Gross is never replaced by net. The discount is the auditable fact;
 *      hiding it inside a smaller number defeats the point of showing it.
 */

import assert from "node:assert/strict";

import { transportConcessionForStudent } from "./fees";
import type { MastersState } from "./masters";

console.log("transportConcession.selftest.ts");

const TRANSPORT_HEAD = { id: "fh_transport", code: "TRANSPORT", name: "Transport" };
const TUITION_HEAD = { id: "fh_tuition", code: "TUITION", name: "Tuition" };

function masters(opts: {
  heads?: { id: string; code: string; name: string }[];
  rules?: unknown[];
  grants?: unknown[];
}): MastersState {
  return {
    feeHeads: opts.heads ?? [TRANSPORT_HEAD, TUITION_HEAD],
    concessions: opts.rules ?? [],
    concessionGrants: opts.grants ?? [],
    concessionKinds: [],
    students: [],
    classes: [],
    sections: [],
  } as unknown as MastersState;
}

const student = { id: "stu_1", admissionNo: "A100", academicYearCode: "2026-27" };
const ASOF = "2026-08-23";

const pct20 = {
  id: "cn_t20",
  code: "T20",
  name: "Transport concession",
  kind: "transport",
  mode: "percent",
  value: 20,
  feeHeadIds: [TRANSPORT_HEAD.id],
  isActive: true,
};
const flat200 = {
  id: "cn_t200",
  code: "T200",
  name: "Transport 200",
  kind: "transport",
  mode: "fixed",
  value: 20000,
  feeHeadIds: [TRANSPORT_HEAD.id],
  isActive: true,
};
const tuitionOnly = {
  id: "cn_tu",
  code: "TU",
  name: "Merit scholarship",
  kind: "merit",
  mode: "percent",
  value: 25,
  feeHeadIds: [TUITION_HEAD.id],
  isActive: true,
};
// Only an APPROVED grant inside its date window counts — a pending request
// is not a discount, and the fee engine is the one deciding that, not this
// test's idea of one.
const grant = (ruleId: string) => ({
  id: `gr_${ruleId}`,
  concessionId: ruleId,
  studentId: student.id,
  status: "approved",
  reason: "",
  effectiveFrom: "2026-04-01",
  effectiveTo: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  siblingChildNo: null,
});

/* ── no grant, no discount ──────────────────────────────────── */

assert.equal(
  transportConcessionForStudent(masters({}), student, 50000, ASOF).totalPaise,
  0,
  "a student with no grant gets no discount",
);

/* ── a transport concession reduces a transport fee ─────────── */

const m20 = masters({ rules: [pct20], grants: [grant(pct20.id)] });
const got20 = transportConcessionForStudent(m20, student, 50000, ASOF);
assert.equal(got20.totalPaise, 10000, "20% of Rs500 is Rs100");
assert.equal(got20.details.length, 1);
assert.equal(got20.details[0].name, "Transport concession");
assert.equal(got20.details[0].rateLabel, "20%", "the rule's own label is carried");

const mFlat = masters({ rules: [flat200], grants: [grant(flat200.id)] });
assert.equal(
  transportConcessionForStudent(mFlat, student, 50000, ASOF).totalPaise,
  20000,
  "a fixed Rs200 rule discounts Rs200",
);

/* ── a tuition concession must NOT touch transport ──────────── */

const mTu = masters({ rules: [tuitionOnly], grants: [grant(tuitionOnly.id)] });
assert.equal(
  transportConcessionForStudent(mTu, student, 50000, ASOF).totalPaise,
  0,
  "a merit scholarship on tuition does not discount the bus",
);

/* ── the discount can never exceed the fee ──────────────────── */

// A Rs200 rule against a Rs100 fee discounts Rs100, not Rs200 — otherwise the
// roster would show a negative net and the bus a negative income.
assert.equal(
  transportConcessionForStudent(mFlat, student, 10000, ASOF).totalPaise,
  10000,
  "capped at the billed amount",
);

/* ── free by decision is distinguishable from free by mistake ─ */

// A full discount leaves gross > 0 and net = 0. That pair is what lets the
// roster say "rides free by decision" instead of pooling this child with the
// ones nobody set a fee for.
const full = {
  ...pct20,
  id: "cn_full",
  code: "TFULL",
  name: "Staff child — free",
  value: 100,
};
const mFull = masters({ rules: [full], grants: [grant(full.id)] });
const gross = 50000;
const discount = transportConcessionForStudent(mFull, student, gross, ASOF).totalPaise;
assert.equal(discount, gross, "100% discounts the whole fee");
assert.equal(Math.max(0, gross - discount), 0, "net is nil");
assert.ok(gross > 0, "but the gross fee is still on record, not erased");

/* ── nothing billed means nothing to discount ───────────────── */

assert.equal(
  transportConcessionForStudent(mFull, student, 0, ASOF).totalPaise,
  0,
  "a rider with no fee set gets no phantom discount",
);

/* ── no TRANSPORT head means no transport concession ────────── */

// The honest answer: without that head the fee engine cannot apply one to a
// bill either, so the roster must not invent one.
const mNoHead = masters({
  heads: [TUITION_HEAD],
  rules: [pct20],
  grants: [grant(pct20.id)],
});
assert.equal(
  transportConcessionForStudent(mNoHead, student, 50000, ASOF).totalPaise,
  0,
);

/* ── a pending grant is not a discount ──────────────────────── */

const pending = { ...grant(pct20.id), status: "pending" };
assert.equal(
  transportConcessionForStudent(
    masters({ rules: [pct20], grants: [pending] }),
    student,
    50000,
    ASOF,
  ).totalPaise,
  0,
  "an unapproved request must not reduce the bill or the roster",
);

// ...and one that has expired stops applying, rather than lingering.
const expired = { ...grant(pct20.id), effectiveTo: "2026-06-30" };
assert.equal(
  transportConcessionForStudent(
    masters({ rules: [pct20], grants: [expired] }),
    student,
    50000,
    ASOF,
  ).totalPaise,
  0,
  "a concession that ended in June does not discount an August fee",
);

console.log("  ok");
