/**
 * Re-attaching a receipt to the dues it actually paid.
 *
 * A receipt clears its dues THROUGH its lines. When the lines are lost — a
 * push that carried headers without them, an old sync incident — the money is
 * still recorded but every month it paid reads unpaid, and the family's page
 * shows a guardian, an amount and nothing else.
 *
 * The only correct repair is to say again which dues the money went to. The
 * tempting alternative, a waiver to make the month look settled, records the
 * money as FORGIVEN rather than PAID: it understates fee income and leaves the
 * family's record saying they never paid. So this exists instead.
 *
 * The rule that makes it safe is arithmetic: what is re-attached must equal
 * what the receipt collected, to the paisa. A repair that does not tie has
 * either invented money or lost some, and both are worse than the blank.
 */

export type RepairAllocation = {
  /** The due being paid — the same key the fee desk uses. */
  dueKey: string;
  studentId: string;
  kind: string;
  label: string;
  amountPaise: number;
  /** What is still open on that due, so a line cannot overpay it. */
  outstandingPaise: number;
};

export type RepairCheck = {
  ok: boolean;
  allocatedPaise: number;
  receiptTotalPaise: number;
  remainingPaise: number;
  /** Every reason it cannot be saved, in the words the counter would use. */
  problems: string[];
};

export function checkReceiptRepair(input: {
  receiptTotalPaise: number;
  allocations: RepairAllocation[];
}): RepairCheck {
  const total = Math.round(input.receiptTotalPaise);
  const rows = input.allocations.filter((a) => a.dueKey);
  const allocated = rows.reduce((n, a) => n + Math.round(a.amountPaise), 0);
  const problems: string[] = [];

  if (total <= 0) {
    problems.push("This receipt has no amount to attach.");
  }

  for (const a of rows) {
    const amt = Math.round(a.amountPaise);
    if (amt <= 0) {
      problems.push(`${a.label || a.dueKey}: enter an amount greater than zero.`);
      continue;
    }
    // A line may not pay more of a due than is open on it, or the family ends
    // up showing a credit they never have.
    if (amt > Math.round(a.outstandingPaise)) {
      problems.push(
        `${a.label || a.dueKey}: only ${rupees(a.outstandingPaise)} is outstanding, cannot attach ${rupees(amt)}.`,
      );
    }
    if (!a.studentId) {
      problems.push(`${a.label || a.dueKey}: pick the student this belongs to.`);
    }
  }

  const seen = new Set<string>();
  for (const a of rows) {
    if (seen.has(a.dueKey)) {
      problems.push(`${a.label || a.dueKey} is listed twice — combine it into one line.`);
    }
    seen.add(a.dueKey);
  }

  if (rows.length === 0) {
    problems.push("Choose the months and heads this receipt paid.");
  } else if (allocated !== total) {
    problems.push(
      allocated < total
        ? `${rupees(total - allocated)} of this receipt is still unattached.`
        : `${rupees(allocated - total)} more has been attached than the receipt collected.`,
    );
  }

  return {
    ok: problems.length === 0,
    allocatedPaise: allocated,
    receiptTotalPaise: total,
    remainingPaise: total - allocated,
    problems,
  };
}

/**
 * The lines to write, once the check passes.
 *
 * The id is the desk's own natural key — voucher and due — so re-running a
 * repair replaces the same rows rather than adding a second set, and a line
 * can always be traced back to the due it settles.
 */
export function buildRepairLines(input: {
  voucherId: string;
  tenantId: string;
  allocations: RepairAllocation[];
}): {
  id: string;
  voucher_id: string;
  tenant_id: string;
  student_id: string;
  due_key: string;
  kind: string;
  label: string;
  amount_paise: number;
  line_json: Record<string, unknown>;
}[] {
  return input.allocations
    .filter((a) => a.dueKey && Math.round(a.amountPaise) > 0)
    .map((a) => ({
      id: `${input.voucherId}:${a.dueKey}`,
      voucher_id: input.voucherId,
      tenant_id: input.tenantId,
      student_id: a.studentId,
      due_key: a.dueKey,
      kind: a.kind || "academic",
      label: a.label,
      amount_paise: Math.round(a.amountPaise),
      line_json: {
        dueKey: a.dueKey,
        studentId: a.studentId,
        kind: a.kind || "academic",
        label: a.label,
        amountPaise: Math.round(a.amountPaise),
        // Marked so a later reader knows this allocation was reconstructed by
        // a person, not captured at the counter when the money was taken.
        repairedAt: new Date().toISOString(),
      },
    }));
}

function rupees(paise: number): string {
  return `₹${(Math.round(paise) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
