#!/usr/bin/env npx tsx
/**
 * Seed trust_desk_* — demo construction project (matches seedTrustIfEmpty).
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-trust-desk.ts
 */

import type { TrustState } from "../src/lib/trust";
import {
  fetchTrustDeskFromDb,
  pushTrustDeskToDb,
} from "../src/lib/trustNormalized.server";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const projectId = "prj_seed_block_b";
  const workId = "wrk_seed_flooring";
  const contractorId = "ctr_seed_sharma";

  const state: TrustState = {
    version: 1,
    projects: [
      {
        id: projectId,
        code: "CAP/25-26/001",
        name: "New Primary Wing — Block B",
        campus: "Main campus",
        type: "new_build",
        budgetPaise: 120_000_000_00,
        startDate: todayIso(),
        targetEndDate: `${new Date().getFullYear() + 1}-03-31`,
        status: "in_progress",
        managerName: "Site engineer",
        linkedOwnerLoanId: "",
        physicalPct: 15,
        note: "Demo seed project",
        createdAt: new Date().toISOString(),
      },
    ],
    workItems: [
      {
        id: workId,
        projectId,
        code: "WRK-01",
        name: "Classroom flooring — GF",
        category: "civil",
        unit: "sq.ft",
        qtyPlanned: 2500,
        ratePaise: 8500,
        amountPaise: 21_250_000_00,
        specNote: "",
        status: "in_progress",
      },
    ],
    materials: [],
    labourEntries: [],
    allotments: [],
    contractors: [
      {
        id: contractorId,
        name: "Sharma Civil Contractors",
        gstin: "09AABCS1234A1Z5",
        phone: "9876543210",
        isActive: true,
      },
    ],
    workOrders: [],
    raBills: [],
    costLines: [],
    rateCard: [
      {
        id: nid("rc"),
        category: "civil",
        unit: "sq.ft",
        workName: "Vitrified tile flooring",
        ratePaise: 8500,
        locality: "Lucknow",
      },
    ],
  };

  console.log(`Seeding trust desk — ${state.projects.length} project(s)`);

  const before = await fetchTrustDeskFromDb();
  console.log(`DB before: ${before.bundle.projects.length} projects`);

  const result = await pushTrustDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchTrustDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.projects.length} projects, ${after.meta?.sliceCount ?? 0} slices`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
