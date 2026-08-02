#!/usr/bin/env npx tsx
/**
 * Seed payment_desk_links from active SIS students (demo open pay links).
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-payment-links-from-sis.ts
 *   cd apps/web && npx tsx scripts/seed-payment-links-from-sis.ts --count=12
 */

import type { PaymentLink, PaymentsState } from "../src/lib/payments";
import { DEFAULT_AY } from "../src/lib/masters";
import { fetchSisFromDb } from "../src/lib/sisNormalized.server";
import {
  fetchPaymentDeskFromDb,
  pushPaymentDeskToDb,
} from "../src/lib/paymentsNormalized.server";

function linkCountArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--count="));
  const n = arg ? Number(arg.split("=")[1]) : 10;
  return Number.isFinite(n) && n > 0 ? Math.min(50, Math.floor(n)) : 10;
}

function plusDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const count = linkCountArg();
  const { bundle } = await fetchSisFromDb();
  const students = bundle.students
    .filter((s) => s.status === "active" && s.householdId)
    .slice(0, count);

  if (!students.length) {
    throw new Error("No active SIS students with households — seed SIS first.");
  }

  const now = new Date().toISOString();
  const links: PaymentLink[] = students.map((st, i) => {
    const amountPaise = 5_000_00 + i * 250_00;
    const dueKey = `tuition:${st.id}:term1`;
    return {
      id: `pl_seed_${st.id}`,
      code: `PL-SEED${String(i + 1).padStart(2, "0")}`,
      householdId: st.householdId,
      studentId: st.id,
      studentName: st.fullName || "Student",
      classLabel: st.classId || "",
      academicYearCode: st.academicYearCode || DEFAULT_AY,
      amountPaise,
      lines: [
        {
          dueKey,
          studentId: st.id,
          studentName: st.fullName || "Student",
          label: "Tuition — Term 1",
          kind: "academic",
          amountPaise,
        },
      ],
      status: "open",
      createdAt: now,
      createdBy: "seed-payment-links-from-sis",
      expiresOn: plusDaysIso(14),
      upiRef: "",
      paidAt: null,
      voucherId: null,
      receiptNo: null,
      note: "Seeded demo pay link for desk cutover",
      gatewayMode: "demo",
    };
  });

  const state: PaymentsState = { version: 1, links };
  console.log(`Seeding ${links.length} open payment links`);

  const before = await fetchPaymentDeskFromDb();
  console.log(`DB before: ${before.links.length} links`);

  const result = await pushPaymentDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchPaymentDeskFromDb();
  console.log(
    `Seed OK — ${result.linkCount} links written (DB now ${after.links.length}, ${after.meta?.openLinkCount ?? 0} open)`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
