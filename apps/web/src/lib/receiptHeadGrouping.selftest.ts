import assert from "node:assert/strict";
import { groupLinesByHead, orderPeriods } from "@/components/fees/FeeReceiptSheet";
import type { VoucherLine } from "./fees";

console.log("receiptHeadGrouping.selftest.ts");

/**
 * The receipt's fee table shows one row per head, with its months gathered.
 *
 * Every rupee on a receipt has to survive that regrouping. A row that merges
 * two heads, or drops a line whose label has no month, is a receipt that
 * disagrees with the money actually taken — which is worse than a long
 * receipt. So the totals are asserted against the raw lines every time.
 */

const line = (p: Partial<VoucherLine>): VoucherLine =>
  ({
    dueKey: Math.random().toString(36).slice(2),
    studentId: "st1",
    studentName: "ANKIT MISHTRI",
    label: "Tuition Fee · May",
    kind: "academic",
    amountPaise: 148500,
    billedPaise: 165000,
    concessionPaise: 16500,
    ...p,
  }) as VoucherLine;

// ── A term of tuition becomes one row ───────────────────────────────────
{
  // Exactly the shape of production receipt RCV-00212.
  const lines = [
    line({ label: "Tuition Fee · May" }),
    line({ label: "Tuition Fee · June" }),
    line({ label: "Tuition Fee · July" }),
  ];
  const [g, ...rest] = groupLinesByHead(lines);

  assert.equal(rest.length, 0, "three months of one head is ONE row");
  assert.equal(g.head, "Tuition Fee");
  assert.deepEqual(
    g.periods,
    ["May", "June", "July"],
    "chronological, whatever order the lines arrived in",
  );
  assert.equal(g.amountPaise, 148500 * 3);
  assert.equal(g.concessionPaise, 16500 * 3);
}

// ── Months read in session order, not storage order ────────────────────
{
  // Production RCV-00212 stores these sorted by due key, which produced
  // "June, July, May" on the sheet — indistinguishable from a mistake.
  const [g] = groupLinesByHead([
    line({ label: "Tuition Fee · June" }),
    line({ label: "Tuition Fee · July" }),
    line({ label: "Tuition Fee · May" }),
  ]);
  assert.deepEqual(g.periods, ["May", "June", "July"]);

  // The school year runs April–March, so March comes LAST, not first.
  assert.deepEqual(
    orderPeriods(["March", "April", "January"]),
    ["April", "January", "March"],
    "January-first ordering would put March before April",
  );

  // Short forms rank the same as full names.
  assert.deepEqual(orderPeriods(["Jul", "Apr"]), ["Apr", "Jul"]);

  // A span ranks by the month it STARTS in, which is where a reader looks
  // for it: a transport period of "Apr · Jun" belongs with April.
  assert.deepEqual(
    orderPeriods(["Sep", "Apr · Jun", "May"]),
    ["Apr · Jun", "May", "Sep"],
  );

  // Something with no month at all cannot be ranked, so it keeps its
  // arrival order and follows the months rather than being guessed at.
  assert.deepEqual(
    orderPeriods(["Full year", "Jun", "One-time", "Apr"]),
    ["Apr", "Jun", "Full year", "One-time"],
  );
  assert.deepEqual(orderPeriods([]), []);
}

// ── Different heads never merge ─────────────────────────────────────────
{
  const lines = [
    line({ label: "Tuition Fee · May", amountPaise: 100 }),
    line({ label: "Computer Fee · May", amountPaise: 50, concessionPaise: 0 }),
    line({ label: "Tuition Fee · June", amountPaise: 100 }),
  ];
  const groups = groupLinesByHead(lines);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((g) => g.head),
    ["Tuition Fee", "Computer Fee"],
    "insertion order, so the sheet reads as collect built it",
  );
  assert.equal(groups[0].amountPaise, 200);
  assert.equal(groups[1].amountPaise, 50);
}

// ── The same head under two kinds stays apart ───────────────────────────
{
  // An arrear for a head is not the same thing as this term's charge, and
  // merging them would put an arrear under the wrong section total.
  const lines = [
    line({ label: "Tuition Fee · May", kind: "academic", amountPaise: 100 }),
    line({ label: "Tuition Fee · April", kind: "arrears", amountPaise: 70 }),
  ];
  assert.equal(groupLinesByHead(lines).length, 2, "kind separates heads");
}

// ── A label with no period keeps its row and reads sensibly ─────────────
{
  const [g] = groupLinesByHead([
    line({ label: "Admission Fee", amountPaise: 500, concessionPaise: 0 }),
  ]);
  assert.equal(g.head, "Admission Fee");
  assert.deepEqual(g.periods, [], "no month invented");
  assert.equal(g.amountPaise, 500);
}

// ── A period containing the separator is not truncated ──────────────────
{
  // Transport labels look like "Transport · Apr · Jun". Splitting on every
  // separator would lose the second half of the period.
  const [g] = groupLinesByHead([
    line({ label: "Transport · Apr · Jun", kind: "transport" }),
  ]);
  assert.equal(g.head, "Transport");
  assert.deepEqual(g.periods, ["Apr · Jun"]);
}

// ── A repeated period is listed once ────────────────────────────────────
{
  const [g] = groupLinesByHead([
    line({ label: "Tuition Fee · May", amountPaise: 100 }),
    line({ label: "Tuition Fee · May", amountPaise: 100 }),
  ]);
  assert.deepEqual(g.periods, ["May"], "May, May reads like a mistake");
  assert.equal(g.periods.length, 1);
  assert.equal(g.amountPaise, 200, "but BOTH lines are still counted");
}

// ── Nothing is ever lost: the invariant that matters ────────────────────
{
  const lines = [
    line({ label: "Tuition Fee · May", amountPaise: 148500, concessionPaise: 16500 }),
    line({ label: "Tuition Fee · June", amountPaise: 148500, concessionPaise: 16500 }),
    line({ label: "Computer Fee · May", amountPaise: 30000, concessionPaise: 0 }),
    line({ label: "Admission Fee", amountPaise: 50000, concessionPaise: 0 }),
    line({ label: "Transport · Apr", kind: "transport", amountPaise: 90000, concessionPaise: 0 }),
    line({ label: "Store · ISS/12", kind: "store", amountPaise: 12000, concessionPaise: 0 }),
  ];
  const groups = groupLinesByHead(lines);
  const sum = (f: (l: { amountPaise: number; concessionPaise: number }) => number) =>
    groups.reduce((s, g) => s + f(g), 0);

  assert.equal(
    sum((g) => g.amountPaise),
    lines.reduce((s, l) => s + l.amountPaise, 0),
    "grouped total must equal the money actually taken",
  );
  assert.equal(
    sum((g) => g.concessionPaise),
    lines.reduce((s, l) => s + (l.concessionPaise ?? 0), 0),
    "grouped discount must equal the discount actually given",
  );
  assert.equal(
    groups.reduce((s, g) => s + g.lines.length, 0),
    lines.length,
    "every line lands in exactly one group",
  );
}

// ── An empty receipt does not throw ─────────────────────────────────────
{
  assert.deepEqual(groupLinesByHead([]), []);
}

console.log("receiptHeadGrouping.selftest: all assertions passed");
