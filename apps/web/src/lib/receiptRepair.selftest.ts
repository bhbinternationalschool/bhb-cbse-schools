/**
 * Self-test: re-attaching a receipt to the dues it paid.
 *
 * The repair is only safe if it ties. What is attached must equal what the
 * receipt collected, to the paisa — a repair that does not tie has either
 * invented money or lost some, and both are worse than the blank receipt it
 * was meant to fix.
 */

import assert from "node:assert/strict";

import {
  buildRepairLines,
  checkReceiptRepair,
  type RepairAllocation,
} from "./receiptRepair";

console.log("receiptRepair.selftest.ts");

const a = (p: Partial<RepairAllocation>): RepairAllocation => ({
  dueKey: "acad:stu_1:fsl_apr",
  studentId: "stu_1",
  kind: "academic",
  label: "Tuition Fee · April",
  amountPaise: 0,
  outstandingPaise: 1650_00,
  ...p,
});

/* Ties exactly — the only state that may be saved. */
{
  const r = checkReceiptRepair({
    receiptTotalPaise: 2650_00,
    allocations: [
      a({ amountPaise: 1650_00 }),
      a({ dueKey: "acad:stu_1:fsl_misc", label: "Misc · April", amountPaise: 1000_00, outstandingPaise: 1000_00 }),
    ],
  });
  assert.equal(r.ok, true, r.problems.join(" | "));
  assert.equal(r.allocatedPaise, 2650_00);
  assert.equal(r.remainingPaise, 0);
}

/* Short and over are both refused, and each says which way. */
{
  const short = checkReceiptRepair({ receiptTotalPaise: 2000_00, allocations: [a({ amountPaise: 1650_00 })] });
  assert.equal(short.ok, false);
  assert.match(short.problems.join(" "), /still unattached/);
  assert.equal(short.remainingPaise, 350_00);

  const over = checkReceiptRepair({
    receiptTotalPaise: 1000_00,
    allocations: [a({ amountPaise: 1650_00 })],
  });
  assert.equal(over.ok, false);
  assert.match(over.problems.join(" "), /more has been attached/);
}

/* A line may not pay more of a due than is open on it. */
{
  const r = checkReceiptRepair({
    receiptTotalPaise: 2000_00,
    allocations: [a({ amountPaise: 2000_00, outstandingPaise: 1650_00 })],
  });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /only ₹1,650.00 is outstanding/);
}

/* A part payment is legitimate: less than the due, tying to the receipt. */
{
  const r = checkReceiptRepair({
    receiptTotalPaise: 500_00,
    allocations: [a({ amountPaise: 500_00, outstandingPaise: 1650_00 })],
  });
  assert.equal(r.ok, true, "paying part of a due is normal and must be allowed");
}

/* Nothing chosen, zero amounts, a missing student, and a repeated due. */
{
  assert.match(
    checkReceiptRepair({ receiptTotalPaise: 100, allocations: [] }).problems.join(" "),
    /Choose the months and heads/,
  );
  assert.match(
    checkReceiptRepair({ receiptTotalPaise: 100, allocations: [a({ amountPaise: 0 })] }).problems.join(" "),
    /greater than zero/,
  );
  assert.match(
    checkReceiptRepair({
      receiptTotalPaise: 1650_00,
      allocations: [a({ amountPaise: 1650_00, studentId: "" })],
    }).problems.join(" "),
    /pick the student/,
  );
  const twice = checkReceiptRepair({
    receiptTotalPaise: 1650_00,
    allocations: [a({ amountPaise: 650_00 }), a({ amountPaise: 1000_00 })],
  });
  assert.equal(twice.ok, false);
  assert.match(twice.problems.join(" "), /listed twice/);
}

/* The written lines carry the desk's natural key, so a re-repair replaces. */
{
  const lines = buildRepairLines({
    voucherId: "rcv_x",
    tenantId: "t1",
    allocations: [a({ amountPaise: 1650_00 })],
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.id, "rcv_x:acad:stu_1:fsl_apr", "voucher + due is the identity");
  assert.equal(lines[0]!.amount_paise, 1650_00);
  assert.equal(lines[0]!.student_id, "stu_1");
  assert.ok(
    (lines[0]!.line_json as { repairedAt?: string }).repairedAt,
    "the line records that it was reconstructed, not captured at the counter",
  );

  const again = buildRepairLines({
    voucherId: "rcv_x", tenantId: "t1", allocations: [a({ amountPaise: 1650_00 })],
  });
  assert.equal(again[0]!.id, lines[0]!.id, "repairing twice writes the same row, never a second");
}

/* Zero-value rows never reach the book. */
{
  assert.equal(
    buildRepairLines({ voucherId: "rcv_x", tenantId: "t1", allocations: [a({ amountPaise: 0 })] }).length,
    0,
  );
}

console.log("  ok — a repair is saveable only when it ties to the money collected");
