/**
 * Self-test: the three numbers the staff app's home screen shows.
 * Run: npx tsx apps/web/src/lib/appHomeNumbers.selftest.ts
 *
 * 1. STAFF PRESENT. `summarizeStaffMarks` returns a map keyed by status
 *    code — `{ P: 12, A: 2 }`. Its old `Record<string, number>` type made
 *    `summary.present` a legal `number` access, so the principal snapshot
 *    read `staffSum.present ?? 0` and every app in the school showed staff
 *    present as 0 against a full register, while the WhatsApp leadership
 *    note printed "Present undefined". No data was wrong and nothing threw.
 *
 * 2. TODAY BY PAYMENT MODE. Gateway money must not hide inside UPI, and the
 *    parts must add up to the total shown beside them.
 */

import assert from "node:assert/strict";

import { staffMarkTotals, summarizeStaffMarks } from "./staffAttendance";
import { collectionsByMode } from "./fees";
import type { StaffAttendanceMark } from "./staffAttendance";
import type { CollectionVoucher } from "./fees";

console.log("appHomeNumbers.selftest.ts");

/* ── 1. Staff present / absent ──────────────────────────────────────── */

const marks = [
  { staffId: "a", status: "P" },
  { staffId: "b", status: "P" },
  { staffId: "c", status: "A" },
  { staffId: "d", status: "L" }, // late — came to work
  { staffId: "e", status: "HD" }, // half day — came to work
  { staffId: "f", status: "LE" }, // leave
] as unknown as StaffAttendanceMark[];

const totals = staffMarkTotals(marks);
assert.equal(totals.present, 4, "present counts P + late + half day");
assert.equal(totals.absent, 1);
assert.equal(totals.leave, 1);
assert.equal(totals.late, 1);
assert.equal(totals.halfDay, 1);
assert.equal(totals.marked, 6, "everyone on the register is accounted for");

// The shape that caused the bug still exists, and is still keyed by code.
const byCode = summarizeStaffMarks(marks);
assert.equal(byCode.P, 2);
assert.equal(byCode.A, 1);
assert.ok(
  !("present" in byCode),
  "summarizeStaffMarks must NOT look like it carries named totals",
);

// An empty register is zero, not a crash — and must stay distinguishable
// from "nobody came".
assert.equal(staffMarkTotals([]).marked, 0);

/* ── 2. Today's collection, by payment mode ─────────────────────────── */

const voucher = (
  tenders: { mode: string; amountPaise: number; gatewayProvider?: string }[],
  totalPaise: number,
): CollectionVoucher =>
  ({ totalPaise, tenders }) as unknown as CollectionVoucher;

const day = collectionsByMode(
  [
    voucher([{ mode: "cash", amountPaise: 500000 }], 500000),
    voucher([{ mode: "upi", amountPaise: 300000 }], 300000),
    voucher(
      [{ mode: "upi", amountPaise: 200000, gatewayProvider: "cashfree" }],
      200000,
    ),
    voucher(
      [
        { mode: "cash", amountPaise: 100000 },
        { mode: "cheque", amountPaise: 400000 },
      ],
      500000,
    ),
  ],
  1500000,
);

const find = (mode: string) => day.find((d) => d.mode === mode);
assert.equal(find("cash")!.paise, 600000, "two cash tenders add up");
assert.equal(
  find("upi")!.paise,
  300000,
  "the QR UPI stays UPI — the gateway one must not be folded in",
);
assert.equal(
  find("online")!.paise,
  200000,
  "gateway money gets its own line; the office reconciles it separately",
);
assert.equal(find("cheque")!.paise, 400000);
assert.equal(
  day.reduce((s, d) => s + d.paise, 0),
  1500000,
  "the parts add up to the day's total",
);
assert.deepEqual(
  day.map((d) => d.mode),
  ["cash", "cheque", "upi", "online"],
  "biggest first",
);
assert.equal(find("online")!.label, "Online (gateway)");
assert.equal(find("cash")!.label, "Cash");

/* ── A receipt whose tenders were lost is still named ───────────────── */

const withHole = collectionsByMode(
  [voucher([{ mode: "cash", amountPaise: 100000 }], 100000), voucher([], 325000)],
  425000,
);
assert.equal(
  withHole.find((d) => d.mode === "unrecorded")!.paise,
  325000,
  "the 2026-09-06 wipe left receipts with no tenders — say so, do not fall short",
);
assert.equal(
  withHole.reduce((s, d) => s + d.paise, 0),
  425000,
  "the parts still add up to the total",
);

/* ── No receipts: no lines, no phantom zero row ─────────────────────── */

assert.deepEqual(collectionsByMode([], 0), []);

console.log("  ok — staff present counts, and today's money is split by mode");
