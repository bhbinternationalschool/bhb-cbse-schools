#!/usr/bin/env npx tsx
/**
 * Seed purchase_desk_* — approved indent + issued PO (indent → PO chain).
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-purchase-desk.ts
 */

import { DEFAULT_AY } from "../src/lib/masters";
import type {
  IndentLine,
  PoLine,
  PurchaseIndent,
  PurchaseOrder,
  PurchaseState,
} from "../src/lib/purchase";
import {
  fetchPurchaseDeskFromDb,
  pushPurchaseDeskToDb,
} from "../src/lib/purchaseNormalized.server";

function nowIso(): string {
  return new Date().toISOString();
}

function lineAmountPaise(qty: number, ratePaise: number) {
  return Math.round(Math.max(0, qty) * Math.max(0, ratePaise));
}

async function main() {
  const ay = DEFAULT_AY;
  const indentLines: IndentLine[] = [
    {
      id: "piln_seed_notebooks",
      description: "A4 ruled notebooks (200 pages)",
      qty: 500,
      uom: "nos",
      estRatePaise: 4500,
    },
    {
      id: "piln_seed_pens",
      description: "Blue ball pens",
      qty: 200,
      uom: "nos",
      estRatePaise: 1200,
    },
  ];
  const estimatedPaise = indentLines.reduce(
    (s, l) => s + lineAmountPaise(l.qty, l.estRatePaise),
    0,
  );

  const indent: PurchaseIndent = {
    id: "pind_seed_term",
    indentNo: `IND/${ay}/001`,
    academicYearCode: ay,
    requesterName: "Store incharge",
    requesterStaffId: "",
    department: "Store",
    urgency: "normal",
    status: "approved",
    lines: indentLines,
    note: "Term-start stationery replenishment",
    createdAt: nowIso(),
    submittedAt: nowIso(),
    decidedBy: "Admin",
    decidedAt: nowIso(),
    decisionNote: "Admin approval (seed)",
    estimatedPaise,
  };

  const poLines: PoLine[] = indentLines.map((l) => ({
    id: `poln_seed_${l.id}`,
    description: l.description,
    qty: l.qty,
    uom: l.uom,
    ratePaise: l.estRatePaise,
  }));
  const amountPaise = poLines.reduce(
    (s, l) => s + lineAmountPaise(l.qty, l.ratePaise),
    0,
  );

  const order: PurchaseOrder = {
    id: "po_seed_stationery",
    poNo: `PO/${ay}/001`,
    indentId: indent.id,
    vendorId: "vnd_seed_stationery",
    vendorName: "City Stationers",
    lines: poLines,
    status: "issued",
    approvedBy: "Admin",
    approvedAt: nowIso(),
    academicYearCode: ay,
    note: "Seeded PO from approved indent",
    createdAt: nowIso(),
    discountPaise: 0,
    taxPaise: 0,
    amountPaise,
  };

  const state: PurchaseState = {
    version: 1,
    indents: [indent],
    orders: [order],
    grns: [],
    returns: [],
    settings: { adminLimitPaise: 500_000, principalLimitPaise: 5_000_000 },
  };

  console.log(
    `Seeding ${state.indents.length} indents (${indentLines.length} lines), ${state.orders.length} POs (${poLines.length} lines)`,
  );

  const before = await fetchPurchaseDeskFromDb();
  console.log(`DB before: ${before.bundle.indents.length} indents`);

  const result = await pushPurchaseDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchPurchaseDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.indents.length} indents, ${after.meta?.orderCount ?? 0} POs, ${after.meta?.openPoCount ?? 0} open POs`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
